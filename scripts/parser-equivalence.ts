/**
 * §8.3 — prove the two parsers agree on every `.hz` file in the repository.
 *
 * ANTLR is no longer a compilation path (§8.2 removed the silent fallback), but
 * it remains the correctness oracle: it is the specification the native parser
 * in `compiler/haze-parser` is checked against. `--parser assert` already diffs
 * the two, but only over files reachable from a compiled project. This sweep is
 * parse-only, so it reaches everything git tracks: the stdlib, the parser's own
 * sources, test fixtures, `R&D/` snippets, and files that belong to no project
 * or do not typecheck at all. With `--fresh-since <file>` (the gate passes a
 * marker it touched when it started) it also reads every untracked `.hz` file
 * written since: the run's test case sources and the module interfaces it
 * generated. Older build output is never read (parser-equivalence-files.ts).
 *
 * **Equivalence means same outcome, not same success.**
 *
 *   both parse, identical ASTs   equivalent
 *   both reject                  equivalent -- a deliberately malformed fixture
 *                                should be rejected by both, and their messages
 *                                are allowed to differ
 *   one accepts, one rejects     DIVERGENCE, and a failure
 *
 * That third case is the one that actually catches drift.
 *
 * Files are de-duplicated by content before parsing: `dist/stdlib` is a
 * byte-copy of `stdlib`, and `__haze__` is full of regenerated interfaces, so
 * 735 files carry only 373 distinct contents. Identical bytes cannot produce
 * different outcomes, so this costs nothing in coverage and takes the sweep
 * from ~950k lines to ~120k.
 *
 * Run with: bun run scripts/parser-equivalence.ts [--fresh-since <file>] [--verbose]
 */

import * as crypto from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureAntlrParserCurrent,
  isAntlrParserCurrent,
} from "../src/Parser/AntlrGrammar";
import { diffAST, formatDifferences } from "../src/Parser/ASTDiff";
import { NativeParserServer } from "../src/Parser/NativeParser";
import { normalizeLineEndings } from "../src/shared/Text";
import { Parser } from "../src/Parser/Parser";
import { setParserMode } from "../src/Parser/ParserMode";
import type { ModuleConfig } from "../src/shared/Config";
import { setDiagnosticSink } from "../src/shared/Errors";
import { sweepFiles } from "./parser-equivalence-files";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERBOSE = process.argv.includes("--verbose");

function freshSinceMs(): number | null {
  const at = process.argv.indexOf("--fresh-since");
  if (at < 0) {
    return null;
  }
  const marker = process.argv[at + 1];
  if (marker === undefined) {
    throw new Error("--fresh-since needs a file whose time marks the start of the run");
  }
  return statSync(marker).mtimeMs;
}

// The ASTBuilder takes a ModuleConfig but never reads it -- module identity
// comes from the source text, not from the project a file happens to sit in,
// which is what makes a parse-only sweep over unowned files meaningful at all.
const STUB_CONFIG = {
  name: "parser_equivalence",
  version: "0.0.1",
  id: "eqvsweep",
} as unknown as ModuleConfig;

type Outcome =
  | { accepted: true; ast: unknown }
  | { accepted: false; reason: string };

/**
 * ANTLR reports syntax errors by *printing* them and then throwing, so its
 * diagnostics are captured rather than printed for the duration: a sweep over
 * deliberately malformed fixtures would otherwise bury its own report under
 * hundreds of expected errors. The captured text becomes the rejection reason,
 * which is more useful than `SyntaxError` on its own.
 */
function parseWithAntlr(text: string, filename: string): Outcome {
  const captured: string[] = [];
  setDiagnosticSink((d) => {
    const at = d.loc
      ? `${d.loc.filename}:${d.loc.start.line}:${d.loc.start.column}: `
      : "";
    captured.push(`${at}${d.message}`);
  });
  try {
    return {
      accepted: true,
      ast: Parser.parseTextToAST(STUB_CONFIG, text, filename),
    };
  } catch (e) {
    const detail = captured.length > 0 ? captured.join("\n    ") : "";
    return {
      accepted: false,
      reason: detail || (e as Error).message || String(e),
    };
  } finally {
    setDiagnosticSink(null);
  }
}

async function parseWithNative(
  server: NativeParserServer,
  text: string,
  filename: string
): Promise<Outcome> {
  try {
    return { accepted: true, ast: await server.parseText(text, filename) };
  } catch (e) {
    return { accepted: false, reason: (e as Error).message || String(e) };
  }
}

/**
 * A stale oracle is worse than none: at 9007dcaf the generated ANTLR parser was
 * 8 days behind HazeParser.g4 and did not know `??` existed, which this sweep
 * reported as 38 divergences in files that were perfectly fine (§8.5, finding 1).
 *
 * Regenerate rather than complain: staleness is routine -- every grammar edit
 * causes it -- and a sweep that refuses to run is one people learn to skip.
 * The check itself lives in src/Parser/AntlrGrammar.ts, which the compiler's own
 * bootstrap uses too, so the two cannot drift apart.
 */
function assertAntlrParserIsCurrent(): void {
  if (isAntlrParserCurrent(REPO_ROOT)) {
    return;
  }
  console.info("  regenerating the ANTLR parser (the grammar changed)...");
  const failure = ensureAntlrParserCurrent(REPO_ROOT);
  if (failure) {
    console.error(
      `\n${failure}` +
        "It is the oracle the native parser is checked against, so a stale one " +
        "reports divergences that are not real.\n"
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  assertAntlrParserIsCurrent();

  // The sweep drives both parsers by hand, so nothing may auto-select one.
  setParserMode("antlr", REPO_ROOT);

  const files = sweepFiles(REPO_ROOT, freshSinceMs());

  // One representative per distinct content; the rest are recorded so the
  // report can say what the coverage actually was.
  const byContent = new Map<
    string,
    { path: string; text: string; duplicates: number }
  >();
  for (const file of files) {
    // A file deleted while the sweep runs is not a divergence.
    // Both parsers get what the compiler gives them: the source with its line
    // endings normalized (Parser.parseTextToAST does it again, which changes
    // nothing; the native server takes the text as it is handed over).
    let text: string;
    try {
      text = normalizeLineEndings(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const key = crypto.createHash("sha256").update(text).digest("hex");
    const existing = byContent.get(key);
    if (existing) {
      existing.duplicates++;
    } else {
      byContent.set(key, { path: file, text: text, duplicates: 0 });
    }
  }

  const server = new NativeParserServer(REPO_ROOT);
  server.start();

  let agreedParsed = 0;
  let agreedRejected = 0;
  const divergences: string[] = [];

  try {
    for (const { path, text } of byContent.values()) {
      const shown = relative(REPO_ROOT, path);
      const antlr = parseWithAntlr(text, path);
      const native = await parseWithNative(server, text, path);

      if (antlr.accepted !== native.accepted) {
        const accepted = antlr.accepted ? "ANTLR" : "native";
        const rejected = antlr.accepted ? "native" : "ANTLR";
        const reason = antlr.accepted
          ? (native as { reason: string }).reason
          : (antlr as { reason: string }).reason;
        divergences.push(
          `${shown}\n    ${accepted} accepted it, ${rejected} rejected it:\n    ${reason.trim()}`
        );
        continue;
      }

      if (!antlr.accepted) {
        agreedRejected++;
        if (VERBOSE) {
          console.info(`  [both reject] ${shown}`);
        }
        continue;
      }

      const differences = diffAST(antlr.ast, (native as { ast: unknown }).ast);
      if (differences.length > 0) {
        divergences.push(formatDifferences(shown, differences));
        continue;
      }

      agreedParsed++;
      if (VERBOSE) {
        console.info(`  [agree] ${shown}`);
      }
    }
  } finally {
    server.stop();
  }

  const duplicates = files.length - byContent.size;
  console.info(
    `parser equivalence: ${byContent.size} distinct files ` +
      `(${files.length} on disk, ${duplicates} byte-identical duplicates skipped)`
  );
  console.info(
    `  ${agreedParsed} parsed identically, ${agreedRejected} rejected by both`
  );

  if (divergences.length > 0) {
    console.error(
      `\n${divergences.length} file(s) where the two parsers disagree:\n`
    );
    for (const divergence of divergences) {
      console.error(`  ${divergence}\n`);
    }
    process.exit(1);
  }

  console.info("  the two parsers agree on every file.");
}

await main();
