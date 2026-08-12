// Which parser the compiler uses, and the dual-parser equivalence check.
//
// Three modes:
//   antlr   the original ANTLR parser only (the default, always available)
//   native  the Haze parser in compiler/haze-parser (fast path)
//   assert  run BOTH and require the ASTs to be identical
//
// `assert` is what keeps the two implementations honest: building any project
// with it parses every file twice and fails loudly, with the exact JSON path of
// the first difference, if they ever diverge.

import { existsSync } from "node:fs";
import * as path from "node:path";
import type { ASTRoot } from "../shared/AST";
import { diffAST, formatDifferences } from "./ASTDiff";
import { NativeParserServer, ensureNativeParser } from "./NativeParser";

export type ParserMode = "antlr" | "native" | "assert";

let mode: ParserMode = "antlr";
let repoRoot = process.cwd();
let server: NativeParserServer | null = null;

export function setParserMode(newMode: ParserMode, root?: string): void {
  mode = newMode;
  if (root) {
    repoRoot = root;
  }
}

export function getParserMode(): ParserMode {
  return mode;
}

export function usesNativeParser(): boolean {
  return mode === "native" || mode === "assert";
}

export function getParserRepoRoot(): string {
  return repoRoot;
}

/**
 * Is the native parser binary usable right now?
 *
 * Checked per call (and cached) so that a mode of `native`/`assert` degrades to
 * ANTLR instead of breaking the build when the binary is missing.
 */
let availability: boolean | null = null;

export function nativeParserAvailable(): boolean {
  if (!usesNativeParser()) {
    return false;
  }
  if (availability === null) {
    availability = prepareNativeParser();
    if (!availability) {
      console.warn(
        "Warning: the native Haze parser is unavailable; falling back to the ANTLR parser."
      );
    }
  }
  return availability;
}

export function resetNativeParserAvailability(): void {
  availability = null;
}

/**
 * Make sure the native parser binary exists and is current. Returns false if it
 * could not be built, in which case the caller should fall back to ANTLR rather
 * than fail the build.
 */
export function prepareNativeParser(): boolean {
  if (!usesNativeParser()) {
    return true;
  }
  if (!existsSync(path.join(repoRoot, "compiler", "haze-parser"))) {
    return false;
  }
  return ensureNativeParser(repoRoot);
}

function getServer(): NativeParserServer {
  if (!server) {
    server = new NativeParserServer(repoRoot);
    server.start();
  }
  return server;
}

export function shutdownNativeParser(): void {
  server?.stop();
  server = null;
}

/**
 * Compare the two ASTs and throw with a precise report if they differ.
 *
 * Only the paths of the first differences are reported: a whole-AST dump would
 * be unreadable, and the path plus both values is what actually identifies the
 * bug (e.g. `[3].funcbody.statements[1].expr.literal.value: 5n !== 6n`).
 */
export function assertASTsEqual(
  filename: string,
  reference: ASTRoot,
  candidate: ASTRoot
): void {
  const differences = diffAST(reference, candidate);
  if (differences.length === 0) {
    return;
  }
  throw new Error(formatDifferences(filename, differences));
}

export async function parseFileWithNative(filepath: string): Promise<ASTRoot> {
  return await getServer().parse(filepath);
}
