/**
 * The invariants of §8.2 and §8.5 of `R&D/Aliases, Anonymous Structs and Spreading.md`.
 *
 * These live at the level of the compiler's own bootstrap, which no `testsuite/`
 * case can reach: a test case there is a Haze snippet handed to an already-working
 * compiler, and everything checked here happens before that compiler can parse
 * anything at all.
 *
 * What they protect against is specific and has bitten before: editing
 * `compiler/haze-parser/src` invalidates the parser's source-hash stamp, the
 * rebuild that should follow cannot run under a compiled `dist/haze`, and the
 * compiler then *silently* falls back to the ANTLR parser -- turning a 2-minute
 * test suite into an hour-long one with no error anywhere to explain it.
 *
 * Run with: bun test scripts/parser-bootstrap.test.ts
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import {
  nativeParserBuildArgs,
  PARSER_PROJECT_DIR,
} from "../src/Parser/NativeParser";
import {
  nativeParserAvailable,
  resetNativeParserAvailability,
  setParserMode,
} from "../src/Parser/ParserMode";
import {
  detectPayloadRoot,
  NATIVE_PARSER_FILENAME,
} from "../src/shared/InstallPaths";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(REPO_ROOT, "dist");

describe("§8.2 parser bootstrap", () => {
  // `dist/` already looks like an install root to InstallPaths (it has
  // stdlib/core/haze.toml), so a missing dist/libexec does not make the
  // compiler look elsewhere -- it makes it believe no parser was deployed and
  // fall through to rebuilding one, which is the path that cannot work.
  test("dist/ is a whole install: the parser is deployed beside the compiler", () => {
    const deployed = join(DIST, "libexec", NATIVE_PARSER_FILENAME);
    expect(existsSync(deployed)).toBe(true);
  });

  test("HAZE_HOME=dist resolves the deployed parser binary", () => {
    const probe = `
      process.env.HAZE_HOME = ${JSON.stringify(DIST)};
      const m = await import(${JSON.stringify(join(REPO_ROOT, "src/shared/InstallPaths.ts"))});
      console.log(m.getInstalledParserBinary() ?? "");
    `;
    const result = spawnSync(process.execPath, ["-e", probe], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, HAZE_HOME: DIST },
    });
    const found = result.stdout.trim();
    expect(found).toBe(join(DIST, "libexec", NATIVE_PARSER_FILENAME));
  });

  // `dist/haze` sits one directory below a checkout that is itself a valid
  // payload root -- `stdlib/core/haze.toml` exists at the repo root too. The
  // "<root>/bin/haze" branch matched on that and handed dist/haze the whole
  // checkout as its payload root, so it looked for its parser in
  // `<repo>/libexec/` and never saw `dist/libexec/` at all. Deploying the
  // parser fixes nothing until the binary looks in the right place.
  test("a compiled compiler resolves its own payload, not the enclosing checkout", () => {
    expect(detectPayloadRoot(DIST)).toBe(DIST);
  });

  test("the <root>/bin/haze install layout still resolves to <root>", () => {
    const prefix = mkdtempSync(join(tmpdir(), "haze-fake-install-"));
    mkdirSync(join(prefix, "bin"), { recursive: true });
    mkdirSync(join(prefix, "stdlib", "core"), { recursive: true });
    writeFileSync(
      join(prefix, "stdlib", "core", "haze.toml"),
      'name = "core"\n'
    );
    expect(detectPayloadRoot(join(prefix, "bin"))).toBe(prefix);
  });

  test("a directory that is no payload root at all resolves to null", () => {
    expect(
      detectPayloadRoot(mkdtempSync(join(tmpdir(), "haze-nothing-")))
    ).toBe(null);
  });

  // Under `bun run src/main.ts` the host is a JS runtime and the script path is
  // required. Under a compiled `dist/haze` the host IS the compiler, and
  // passing `src/main.ts` makes argparse reject it as an unknown subcommand --
  // which is what made the rebuild silently impossible.
  test("bootstrap argv omits src/main.ts when the host is the compiled compiler", () => {
    expect(nativeParserBuildArgs(true)).toEqual([
      "build",
      "--dir",
      PARSER_PROJECT_DIR,
      "--parser",
      "antlr",
    ]);
  });

  test("bootstrap argv includes src/main.ts when the host is a JS runtime", () => {
    expect(nativeParserBuildArgs(false)).toEqual([
      join("src", "main.ts"),
      "build",
      "--dir",
      PARSER_PROJECT_DIR,
      "--parser",
      "antlr",
    ]);
  });

  // The whole point: never a warning followed by a slower, differently-behaving
  // compile. A parser that is neither installed nor buildable is a hard error
  // that names what failed.
  test("an unavailable native parser is a hard error, not a silent fallback", () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "haze-no-parser-"));
    setParserMode("native", emptyRoot);
    resetNativeParserAvailability();
    try {
      expect(() => nativeParserAvailable()).toThrow(/haze-parser/);
    } finally {
      setParserMode("antlr", REPO_ROOT);
      resetNativeParserAvailability();
    }
  });
});
