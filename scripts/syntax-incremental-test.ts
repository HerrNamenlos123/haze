#!/usr/bin/env bun
/**
 * Correctness + performance gate for the INCREMENTAL syntax engine.
 *
 * The engine keeps a per-line TextMate rule-stack cache so an edit can be
 * retokenized from the changed line and stopped as soon as the stack
 * reconverges. That is only safe if it produces byte-identical tokens to
 * a full reparse, for every edit shape -- including the nasty ones that
 * change the rule stack for the whole rest of the file (opening a string,
 * a block comment, a <script> block).
 *
 * So: apply a deterministic pseudo-random sequence of edits to a document,
 * and after EACH edit compare the engine's incremental state against a
 * from-scratch parse of the same text.
 *
 *   bun run scripts/syntax-incremental-test.ts
 *   bun run scripts/syntax-incremental-test.ts --seed 7 --edits 200
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "codeeditor",
  "syntax-engine",
);

/** Mulberry32 -- deterministic, so a failure reproduces from its seed. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Reply = { result: { tokens: any[]; firstLine: number; lastLine: number; lineCount: number } };

class Engine {
  private proc: ReturnType<typeof spawn>;
  private buf = "";
  private pending: ((r: any) => void)[] = [];

  constructor(command: string) {
    this.proc = spawn(command, command === "bun" ? ["run", "syntax-engine.ts"] : [], {
      cwd: ENGINE_DIR,
      stdio: ["pipe", "pipe", "inherit"],
      shell: false,
    });
    this.proc.stdout!.on("data", (d: Buffer) => {
      this.buf += d.toString();
      while (this.buf.startsWith("Content-Length: ") && this.buf.includes("\r\n\r\n")) {
        const h = this.buf.indexOf("\r\n\r\n");
        const len = Number.parseInt(this.buf.slice(16, h));
        const total = h + 4 + len;
        if (this.buf.length < total) break;
        const body = this.buf.slice(h + 4, total);
        this.buf = this.buf.slice(total);
        this.pending.shift()?.(JSON.parse(body));
      }
    });
  }

  send(req: any): Promise<Reply> {
    const s = JSON.stringify(req);
    return new Promise((res) => {
      this.pending.push(res);
      this.proc.stdin!.write(`Content-Length: ${s.length}\r\n\r\n${s}`);
    });
  }

  kill() {
    this.proc.kill();
  }
}

/** Canonical form of a token list, for exact comparison. */
const fingerprint = (tokens: any[]): string =>
  JSON.stringify(
    tokens.map((t) => [t.lineIndex, t.startIndex, t.endIndex, t.scopes.join("|")]),
  );

/**
 * Edit shapes, deliberately including the ones that change the rule stack
 * for everything below -- those are where an incremental tokenizer breaks.
 */
const REPLACEMENTS = [
  "const x = 1;",
  'const s = "a string";',
  "// a line comment",
  "/* opens a block comment",
  "closes it */",
  '"',                         // an unbalanced quote
  "<script setup lang=\"ts\">", // opens a whole new grammar region
  "</script>",
  "<template>",
  "</template>",
  "",
  "function f() { return 1; }",
];

// === Model of the editor's client-side token cache =============
//
// A faithful port of spliceTokenCache + mergeHighlightResult from
// codeeditor/src/codeui.hz. This is here because an engine that is
// perfectly self-consistent can still drive a BROKEN editor: the engine
// re-sends only the lines whose colouring changed, and the client keeps
// every other line in a per-line cache addressed by line number. An edit
// that inserts or removes lines renumbers that cache, so unless the
// client applies the same splice the engine did, every line below the
// edit keeps its neighbour's tokens -- permanently, since nothing later
// re-sends them.
//
// That was a real shipped bug (one inserted blank line wrecked all
// highlighting below it) which this suite did not catch, because its only
// cross-check replaced every line at once -- which makes the engine
// retokenize the whole document and so never exercises the incremental
// path the editor actually uses. Keep this model in sync with codeui.hz.
let clientBuckets: any[][] = [];

/** The structural splice, applied when the edit happens, before any reply. */
function clientSplice(startLine: number, removedCount: number, insertedCount: number) {
  if (removedCount === 0 && insertedCount === 0) {
    return;
  }
  if (startLine > clientBuckets.length) {
    return;
  }
  let removable = removedCount;
  if (startLine + removable > clientBuckets.length) {
    removable = clientBuckets.length - startLine;
  }
  for (let k = 0; k < removable; k++) {
    clientBuckets.splice(startLine, 1);
  }
  for (let k = 0; k < insertedCount; k++) {
    clientBuckets.splice(startLine + k, 0, []);
  }
}

/** Merge one reply into the cache. */
function clientMerge(result: Reply["result"], incremental: boolean) {
  if (!incremental) {
    clientBuckets = [];
  }
  if (result.lineCount > 0) {
    while (clientBuckets.length < result.lineCount) {
      clientBuckets.push([]);
    }
    while (clientBuckets.length > result.lineCount) {
      clientBuckets.pop();
    }
  }
  if (incremental) {
    for (let i = result.firstLine; i <= result.lastLine && i < clientBuckets.length; i++) {
      clientBuckets[i] = [];
    }
  }
  for (const t of result.tokens) {
    while (clientBuckets.length <= t.lineIndex) {
      clientBuckets.push([]);
    }
    clientBuckets[t.lineIndex].push(t);
  }
}

// Fingerprint of what the client would actually RENDER.
//
// Deliberately keyed on the bucket a token sits in, not on the token's own
// `lineIndex` field. The editor renders `buckets[line]` (see highlightedLine
// in codeui.hz) and only ever reads `token.lineIndex` when filing an
// incoming token into a bucket -- where it is always fresh from the engine.
// A token that merely SHIFTED keeps the lineIndex it was born with, which
// is stale and unread; comparing it would fail on a cache that renders
// perfectly.
function clientRenderFingerprint(): string {
  const rows: any[] = [];
  for (let line = 0; line < clientBuckets.length; line++) {
    for (const t of clientBuckets[line]) {
      rows.push([line, t.startIndex, t.endIndex, t.scopes.join("|")]);
    }
  }
  return JSON.stringify(rows);
}

/** The same fingerprint, taken from a full-reparse reply. */
function truthRenderFingerprint(tokens: any[]): string {
  const rows: any[] = [];
  for (const t of tokens) {
    rows.push([t.lineIndex, t.startIndex, t.endIndex, t.scopes.join("|")]);
  }
  rows.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return JSON.stringify(rows);
}

function baseDocument(): string[] {
  const lines = ['<script setup lang="ts">'];
  for (let i = 0; i < 120; i++) lines.push(`const value${i} = compute(${i});`);
  lines.push("</script>", "<template>", "  <div>{{ value0 }}</div>", "</template>");
  return lines;
}

/**
 * The engine under test is a `bun build --compile` artifact, and it is
 * untracked -- so it can silently be older than the source it was built
 * from. That is not a harmless staleness: this suite would then be
 * exercising a DIFFERENT engine than the editor ships, and can pass while
 * the real protocol is broken (or fail for a fix that is actually
 * present). Refuse to run rather than report a meaningless result.
 */
function assertEngineIsCurrent() {
  const bin = join(ENGINE_DIR, "syntax-engine");
  const src = join(ENGINE_DIR, "syntax-engine.ts");
  if (!existsSync(bin)) {
    console.error(`Engine binary missing: ${bin}`);
    console.error("Build it with:  cd codeeditor/syntax-engine && bun run build");
    process.exit(1);
  }
  if (statSync(bin).mtimeMs < statSync(src).mtimeMs) {
    console.error("Engine binary is OLDER than syntax-engine.ts -- results would be meaningless.");
    console.error("Rebuild it with:  cd codeeditor/syntax-engine && bun run build");
    process.exit(1);
  }
}

async function main() {
  assertEngineIsCurrent();

  const argv = process.argv.slice(2);
  const arg = (n: string, d: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const seed = Number(arg("seed", "1"));
  const editCount = Number(arg("edits", "120"));

  const rng = makeRng(seed);
  const engine = new Engine("./syntax-engine");
  await engine.send({ id: 0, method: "initialize" });

  let lines = baseDocument();
  const opened = await engine.send({
    id: 1, method: "open", uri: "doc", fileContent: lines.join("\n"),
  });
  // Seed the modelled client cache from the full reply, as the editor does.
  clientMerge(opened.result, false);

  let failures = 0;
  let totalIncrementalMs = 0;
  let retokenizedLines = 0;

  for (let n = 0; n < editCount; n++) {
    const startLine = Math.floor(rng() * lines.length);
    const removable = Math.min(lines.length - startLine, 3);
    const removedCount = Math.floor(rng() * (removable + 1));
    const insertCount = Math.floor(rng() * 3);
    const newLines: string[] = [];
    for (let i = 0; i < insertCount; i++) {
      newLines.push(REPLACEMENTS[Math.floor(rng() * REPLACEMENTS.length)]);
    }

    // Apply locally so we know the expected text.
    lines.splice(startLine, removedCount, ...newLines);
    if (lines.length === 0) lines = [""];

    // The client renumbers its cache at EDIT time, before any reply --
    // the same ordering as the editor's document change listener.
    clientSplice(startLine, removedCount, insertCount);

    const t0 = performance.now();
    const changed = await engine.send({
      id: 1, method: "change", uri: "doc",
      startLine, removedCount, newLines,
    });
    totalIncrementalMs += performance.now() - t0;
    retokenizedLines += changed.result.lastLine - changed.result.firstLine + 1;
    clientMerge(changed.result, true);

    // NOTE: no `continue` anywhere in this loop body from here on. Every
    // iteration must reach the whole-document change and the reseed at the
    // bottom, or the modelled client cache drifts out of step with the
    // engine and every later iteration reports a phantom failure.
    let clientWrong = false;

    if (changed.result.lineCount !== lines.length) {
      console.log(
        `edit ${n}: LINE COUNT MISMATCH engine=${changed.result.lineCount} expected=${lines.length}`,
      );
      clientWrong = true;
    }

    // The engine's incremental state must equal a from-scratch parse.
    const fresh = await engine.send({
      id: 1, method: "open", uri: `check${n}`, fileContent: lines.join("\n"),
    });
    const truth = await engine.send({ id: 1, method: "highlight", fileContent: lines.join("\n") });

    if (fingerprint(fresh.result.tokens) !== fingerprint(truth.result.tokens)) {
      console.log(`edit ${n}: open vs highlight disagree (engine self-inconsistency)`);
      clientWrong = true;
    }

    // The CLIENT-side cache must ALSO equal a full reparse -- a strictly
    // stronger claim than the engine being correct, and the one that
    // decides whether the editor actually renders the right colours.
    // Checked here, before the whole-document change below wipes the
    // incremental state this cache was built against.
    if (clientRenderFingerprint() !== truthRenderFingerprint(truth.result.tokens)) {
      console.log(`edit ${n}: CLIENT CACHE != FULL after edit at line ${startLine}`);
      console.log(`  removed=${removedCount} inserted=${JSON.stringify(newLines)}`);
      clientWrong = true;
    }

    // Pull the incremental document's full token set back out by asking
    // for every line, and compare against the fresh parse.
    const all = await engine.send({
      id: 1, method: "change", uri: "doc", startLine: 0, removedCount: lines.length,
      newLines: lines,
    });
    if (fingerprint(all.result.tokens) !== fingerprint(truth.result.tokens)) {
      console.log(`edit ${n}: INCREMENTAL != FULL after edit at line ${startLine}`);
      console.log(`  removed=${removedCount} inserted=${JSON.stringify(newLines)}`);
      clientWrong = true;
    }
    if (clientWrong) {
      failures++;
    }

    // That last request replaced every line, so the engine just re-sent
    // the whole document. Reseed the model from it -- the client check is
    // per-edit, and without this one failure would cascade into all the
    // iterations after it.
    clientMerge(all.result, false);
  }

  engine.kill();

  const avgMs = (totalIncrementalMs / editCount).toFixed(2);
  const avgLines = (retokenizedLines / editCount).toFixed(1);
  console.log(
    `\n${editCount - failures}/${editCount} edits produced identical tokens to a full reparse`,
  );
  console.log(`incremental edit cost: ${avgMs}ms avg, ${avgLines} lines retokenized avg`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
