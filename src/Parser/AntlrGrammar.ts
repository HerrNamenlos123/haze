// Keeping the generated ANTLR parser in step with the .g4 files.
//
// The ANTLR parser the compiler runs is GENERATED from HazeLexer.g4 and
// HazeParser.g4 into src/Parser/grammar/autogen/, which is gitignored. Nothing
// regenerated it on a grammar change: `postinstall` does it, and so does
// `bun run install`, but pulling a commit that edits a .g4 does not.
//
// It therefore went stale silently, and a stale ANTLR parser is not a slower
// parser -- it is a DIFFERENT LANGUAGE. Since ANTLR is what bootstraps the
// native parser, a grammar commit that also uses the new syntax in the stdlib
// deadlocks the whole toolchain: the native parser needs rebuilding (its
// sources changed), rebuilding it goes through ANTLR, and ANTLR rejects the
// stdlib it has to compile. The observable symptom was "the native Haze parser
// is unavailable and could not be built", naming nothing.
//
// Content hash rather than mtimes: a `git stash` round-trip or a fresh checkout
// rewrites mtimes without changing a byte, and regenerating for that is a
// ten-second lie. Same mechanism the native parser's own stamp uses.

import * as child_process from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const GRAMMAR_DIR = path.join("src", "Parser", "grammar");
const GRAMMAR_SOURCES = ["HazeLexer.g4", "HazeParser.g4"];
const AUTOGEN_DIR = path.join(GRAMMAR_DIR, "autogen");
const GENERATED_PARSER = path.join(AUTOGEN_DIR, "HazeParser.ts");
const STAMP = path.join(AUTOGEN_DIR, ".grammar-hash");

/** The command that regenerates it, as a user would type it. */
export const REGENERATE_COMMAND = "bun run generate-parser";

/**
 * True when this is a checkout with grammar sources to generate from. An
 * installed compiler ships the generated parser and has no .g4 files, so there
 * is nothing to check and nothing that could go stale.
 */
export function hasGrammarSources(repoRoot: string): boolean {
  return GRAMMAR_SOURCES.every((file) =>
    fs.existsSync(path.join(repoRoot, GRAMMAR_DIR, file))
  );
}

function grammarHash(repoRoot: string): string {
  const hash = crypto.createHash("sha256");
  for (const file of GRAMMAR_SOURCES) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(repoRoot, GRAMMAR_DIR, file)));
  }
  return hash.digest("hex");
}

export function isAntlrParserCurrent(repoRoot: string): boolean {
  if (!hasGrammarSources(repoRoot)) {
    return true;
  }
  const generated = path.join(repoRoot, GENERATED_PARSER);
  const stamp = path.join(repoRoot, STAMP);
  if (!(fs.existsSync(generated) && fs.existsSync(stamp))) {
    return false;
  }
  try {
    return fs.readFileSync(stamp, "utf8").trim() === grammarHash(repoRoot);
  } catch {
    return false;
  }
}

/**
 * Regenerate the parser and stamp what it was generated from.
 *
 * Needs a Java runtime (antlr4ng-cli drives the ANTLR jar), which is the one
 * way this legitimately fails on an otherwise fine machine -- hence handing the
 * command's own output back rather than a bare boolean.
 */
export function regenerateAntlrParser(repoRoot: string): {
  ok: boolean;
  output: string;
} {
  const result = child_process.spawnSync("bun", ["run", "generate-parser"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    return { ok: false, output: output };
  }
  fs.mkdirSync(path.join(repoRoot, AUTOGEN_DIR), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, STAMP), grammarHash(repoRoot), "utf8");
  return { ok: true, output: output };
}

/**
 * Bring the generated parser up to date if it is behind the grammar.
 *
 * Returns a message describing the failure, or "" on success. Regenerating
 * rather than merely complaining, because staleness here is ROUTINE -- every
 * grammar edit and every pull that contains one causes it -- and a toolchain
 * that stops dead on a routine condition is one people learn to work around.
 *
 * A caller that is ALREADY parsing with ANTLR in this process cannot be fixed
 * by this: the generated module was imported at start-up, so regenerating on
 * disk changes nothing until the process restarts. Such a caller should report
 * staleness rather than try to repair it -- see Parser.parseWithANTLR.
 */
export function ensureAntlrParserCurrent(repoRoot: string): string {
  if (isAntlrParserCurrent(repoRoot)) {
    return "";
  }
  const result = regenerateAntlrParser(repoRoot);
  if (result.ok) {
    return "";
  }
  return (
    `The generated ANTLR parser is out of date and could not be regenerated ` +
    `(${REGENERATE_COMMAND} needs a working Java runtime).\n` +
    (result.output ? `${result.output}\n` : "")
  );
}
