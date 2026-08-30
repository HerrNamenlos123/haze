/**
 * Deploy the native Haze parser into `dist/libexec/`, making `dist/` a whole
 * install rather than half of one.
 *
 * `dist/` already looks like an install root to `src/shared/InstallPaths.ts` --
 * `dist/stdlib/core/haze.toml` exists, and that is the marker. But nothing ever
 * put a parser in `dist/libexec/`, so `getInstalledParserBinary()` returned null
 * and `dist/haze` fell through to "rebuild the parser from the checkout" -- a
 * path that cannot succeed from a compiled binary and that used to degrade the
 * whole build to ANTLR without failing. See §8 of
 * `R&D/Aliases, Anonymous Structs and Spreading.md`.
 *
 * Run automatically by `bun run build`, after `copylib` (which wipes and
 * repopulates the payload directories).
 */

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isParserUpToDate,
  PARSER_PROJECT_DIR,
  stampNativeParser,
} from "../src/Parser/NativeParser";
import { NATIVE_PARSER_FILENAME } from "../src/shared/InstallPaths";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECKOUT_PARSER = join(
  REPO_ROOT,
  "__haze__",
  "haze-parser",
  "bin",
  NATIVE_PARSER_FILENAME
);

function build(parserMode: "native" | "antlr"): boolean {
  const result = spawnSync(
    "bun",
    [
      "run",
      join("src", "main.ts"),
      "build",
      "--dir",
      PARSER_PROJECT_DIR,
      "--parser",
      parserMode,
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "development" },
    }
  );
  return result.status === 0;
}

/**
 * The parser parses its own sources, so a current binary can build its
 * successor far faster than the ANTLR bootstrap can. ANTLR is the fallback for
 * when there is no binary yet, or when the existing one cannot handle newly
 * added syntax -- which is exactly the case a grammar change creates.
 */
function ensureCheckoutParser(): void {
  if (isParserUpToDate(REPO_ROOT)) {
    return;
  }
  const hasBinary = existsSync(CHECKOUT_PARSER);
  if (hasBinary && build("native")) {
    stampNativeParser(REPO_ROOT);
    return;
  }
  if (!build("antlr")) {
    console.error(
      "\ndeploy-parser: could not build the native Haze parser " +
        `(${PARSER_PROJECT_DIR}).\n`
    );
    process.exit(1);
  }
  stampNativeParser(REPO_ROOT);
}

function main(): void {
  ensureCheckoutParser();

  if (!existsSync(CHECKOUT_PARSER)) {
    console.error(
      `\ndeploy-parser: ${CHECKOUT_PARSER} does not exist after building.\n`
    );
    process.exit(1);
  }

  const libexec = join(REPO_ROOT, "dist", "libexec");
  mkdirSync(libexec, { recursive: true });
  const deployed = join(libexec, NATIVE_PARSER_FILENAME);
  copyFileSync(CHECKOUT_PARSER, deployed);
  chmodSync(deployed, 0o755);
  console.info(`deploy-parser: dist/libexec/${NATIVE_PARSER_FILENAME}`);
}

main();
