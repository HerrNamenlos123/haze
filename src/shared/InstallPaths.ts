// Where the compiler finds the things it ships with: the standard library, the
// build-time tools, and the native parser binary.
//
// The compiler runs in two very different shapes and this is the only module
// that is allowed to care about the difference:
//
//   source checkout   `bun run src/main.ts ...` inside this repo. Everything
//                     lives next to the sources (../../stdlib, ../../tools).
//
//   installed build   a single compiled binary deployed by `bun run install`.
//                     The payload sits next to the binary in a fixed layout:
//
//                       <root>/bin/haze              the compiler
//                       <root>/libexec/haze-parser   the native parser
//                       <root>/stdlib/...            the standard library
//                       <root>/tools/...             regex-compiler etc.
//                       <root>/resources/...         fonts, logo
//
// Detection is by layout, not by NODE_ENV: the binary is found through
// process.execPath (which a Bun standalone executable sets to itself), so it
// works no matter how the compiler was invoked -- via PATH, via an absolute
// path, or through a symlink -- and a source checkout can never be mistaken for
// an install because the Bun binary has no `stdlib/` beside it.

import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Marker that identifies a directory as a deployed Haze payload root. */
function isInstallRoot(dir: string): boolean {
  return existsSync(join(dir, "stdlib", "core", "haze.toml"));
}

function detectInstallRoot(): string | null {
  const explicit = process.env["HAZE_HOME"];
  if (explicit) {
    if (!isInstallRoot(explicit)) {
      throw new Error(
        `HAZE_HOME is set to '${explicit}', but that is not a Haze installation ` +
          `(no stdlib/core/haze.toml inside). Unset it or run 'bun run install' with --prefix.`
      );
    }
    return explicit;
  }

  let execDir: string;
  try {
    execDir = dirname(realpathSync(process.execPath));
  } catch {
    return null;
  }

  // <root>/bin/haze -- the layout `bun run install` deploys.
  const parent = dirname(execDir);
  if (isInstallRoot(parent)) {
    return parent;
  }
  // <root>/haze with <root>/stdlib beside it -- the older flat dist/ layout.
  if (isInstallRoot(execDir)) {
    return execDir;
  }
  return null;
}

let installRoot: string | null | undefined;

/** Root of the deployed payload, or null when running from a source checkout. */
export function getInstallRoot(): string | null {
  if (installRoot === undefined) {
    installRoot = detectInstallRoot();
  }
  return installRoot;
}

/** True when this process is a deployed compiler rather than a source checkout. */
export function isInstalledBuild(): boolean {
  return getInstallRoot() !== null;
}

/** Root of the source checkout this file was bundled from (dev layout only). */
function getSourceRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function resolveStdlibDirectory(): string {
  const override = process.env["HAZE_STDLIB_DIR"];
  if (override) {
    return override;
  }
  const root = getInstallRoot();
  return root ? join(root, "stdlib") : join(getSourceRoot(), "stdlib");
}

export function resolveToolsDirectory(): string {
  const override = process.env["HAZE_TOOLS_DIR"];
  if (override) {
    return override;
  }
  const root = getInstallRoot();
  return root ? join(root, "tools") : join(getSourceRoot(), "tools");
}

export const NATIVE_PARSER_FILENAME =
  process.platform === "win32" ? "haze-parser.exe" : "haze-parser";

/**
 * The native parser that was deployed alongside the compiler, if any.
 *
 * An installed compiler cannot rebuild the parser from source (there is no
 * checkout to build it in), so the deployed binary is authoritative: it was
 * built from the same commit as the compiler itself.
 */
export function getInstalledParserBinary(): string | null {
  const root = getInstallRoot();
  if (!root) {
    return null;
  }
  const binary = join(root, "libexec", NATIVE_PARSER_FILENAME);
  return existsSync(binary) ? binary : null;
}
