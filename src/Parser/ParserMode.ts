// Which parser the compiler uses, and the dual-parser equivalence check.
//
// Three modes:
//   antlr   the original ANTLR parser only -- the bootstrap and the oracle,
//           never selected automatically; only by an explicit --parser antlr
//   native  the Haze parser in compiler/haze-parser (what every build uses)
//   assert  run BOTH and require the ASTs to be identical
//
// `assert` is what keeps the two implementations honest: building any project
// with it parses every file twice and fails loudly, with the exact JSON path of
// the first difference, if they ever diverge.

import { existsSync } from "node:fs";
import * as path from "node:path";
import type { ASTRoot } from "../shared/AST";
import { getInstalledParserBinary } from "../shared/InstallPaths";
import { diffAST, formatDifferences } from "./ASTDiff";
import {
  NativeParserServer,
  ensureNativeParser,
  nativeParserBuildFailure,
  warmupNativeParserSync,
} from "./NativeParser";
import { shutdownAllBridges } from "./SyncBridge";

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
 * There is deliberately no "no" answer that lets the build continue. ANTLR
 * exists to bootstrap the native parser and to check it, and nothing else in
 * the compiler ever uses it (§8 of `R&D/Aliases, Anonymous Structs and
 * Spreading.md`). A missing native parser used to warn and quietly switch the
 * whole compile to ANTLR, which is both much slower and a *different*
 * implementation -- so the observable effect of, say, a stale parser stamp was
 * a test suite that took an hour and behaved subtly differently, with nothing
 * but one line on stderr to explain it. It is a hard error now, naming what
 * failed.
 *
 * Checked once and cached; `--parser antlr` remains available as an explicit,
 * deliberate choice, but nothing ever selects it automatically.
 */
let availability: boolean | null = null;

export function nativeParserAvailable(): boolean {
  if (!usesNativeParser()) {
    return false;
  }
  if (availability === null) {
    availability = prepareNativeParser();
    if (!availability) {
      // The bootstrap build's own output, when there is any. Without it this
      // said only "could not be built", and the reason -- which exists, in the
      // child's stderr -- was thrown away.
      const detail = nativeParserBuildFailure();
      throw new Error(
        `The native Haze parser is unavailable and could not be built from ` +
          `'${path.join(repoRoot, "compiler", "haze-parser")}'.\n` +
          `The compiler does not fall back to ANTLR: that would be a slower and ` +
          `differently-behaving compile with no error to explain it.\n` +
          (detail ? `\n${detail}\n\n` : "") +
          `Build it with: bun run src/main.ts build --dir compiler/haze-parser --parser antlr\n` +
          `Or compile this project explicitly with --parser antlr.`
      );
    }
    // Safety net for entry points that never called startNativeParser().
    warmupNativeParserSync(repoRoot);
  }
  return availability;
}

export function resetNativeParserAvailability(): void {
  availability = null;
}

/**
 * Make sure the native parser binary exists and is current. Returns false if it
 * could not be built; the only caller, nativeParserAvailable(), turns that into
 * a hard error.
 */
export function prepareNativeParser(): boolean {
  if (!usesNativeParser()) {
    return true;
  }
  // An installed compiler carries its own parser: the cwd is the user's
  // project, which has no compiler checkout to build one from.
  if (getInstalledParserBinary()) {
    return true;
  }
  if (!existsSync(path.join(repoRoot, "compiler", "haze-parser"))) {
    return false;
  }
  return ensureNativeParser(repoRoot);
}

/**
 * Bring the native parser up at compiler start-up rather than on first use.
 *
 * Both parser processes take ~100ms to become usable — the server used by file
 * parsing, and the worker-owned one behind the synchronous bridge. Starting
 * them here overlaps that with project loading and dependency resolution, so
 * the first file parse and the first synthetic function do not pay for it.
 *
 * Cheap and safe to call when the native parser is not in use: it does nothing.
 */
export function startNativeParser(): void {
  if (!(usesNativeParser() && nativeParserAvailable())) {
    return;
  }
  warmupNativeParserSync(repoRoot);
  getServer();
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
  shutdownAllBridges();
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

/** Parse in-memory source through the long-lived server. */
export async function parseTextNativeAsync(
  text: string,
  filename: string
): Promise<ASTRoot> {
  return await getServer().parseText(text, filename);
}
