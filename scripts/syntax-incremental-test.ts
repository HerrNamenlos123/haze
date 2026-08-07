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

function baseDocument(): string[] {
  const lines = ['<script setup lang="ts">'];
  for (let i = 0; i < 120; i++) lines.push(`const value${i} = compute(${i});`);
  lines.push("</script>", "<template>", "  <div>{{ value0 }}</div>", "</template>");
  return lines;
}

async function main() {
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
  await engine.send({ id: 1, method: "open", uri: "doc", fileContent: lines.join("\n") });

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

    const t0 = performance.now();
    const changed = await engine.send({
      id: 1, method: "change", uri: "doc",
      startLine, removedCount, newLines,
    });
    totalIncrementalMs += performance.now() - t0;
    retokenizedLines += changed.result.lastLine - changed.result.firstLine + 1;

    if (changed.result.lineCount !== lines.length) {
      console.log(
        `edit ${n}: LINE COUNT MISMATCH engine=${changed.result.lineCount} expected=${lines.length}`,
      );
      failures++;
      continue;
    }

    // The engine's incremental state must equal a from-scratch parse.
    const fresh = await engine.send({
      id: 1, method: "open", uri: `check${n}`, fileContent: lines.join("\n"),
    });
    const truth = await engine.send({ id: 1, method: "highlight", fileContent: lines.join("\n") });

    if (fingerprint(fresh.result.tokens) !== fingerprint(truth.result.tokens)) {
      console.log(`edit ${n}: open vs highlight disagree (engine self-inconsistency)`);
      failures++;
      continue;
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
      failures++;
    }
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
