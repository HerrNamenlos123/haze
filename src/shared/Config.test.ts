/**
 * haze.toml validation that no `testsuite/` case can reach: a case there is a
 * Haze snippet handed to a project the framework writes itself, and every
 * manifest it writes is well-formed by construction.
 *
 * The rule under test: a `[plugins]` entry must also be a `[dependencies]`
 * entry naming the same package. `[plugins]` only registers a transformer --
 * it does not put the package on the module's import path -- so a plugin that
 * generates code referencing its own runtime helpers (hzui emits
 * `from hzui import ...` into every .hzui file) otherwise produced code that
 * could not resolve its own import. That surfaced as H2007 against a generated
 * line the user never wrote, in a module whose haze.toml looked complete.
 *
 * Run with: bun test src/shared/Config.test.ts
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
// Entering the compiler's module graph at Config.ts hits the
// Config <-> ModuleCompiler import cycle from the wrong side: ModuleCompiler
// reads Config's top-level `PLATFORM` while Config is still evaluating.
// Importing ModuleCompiler first orders it the way src/main.ts does.
import "../ModuleCompiler/ModuleCompiler";
import { ConfigParser } from "./Config";

const HAZE_CONFIG_FILE = "haze.toml";

let root: string;

/** Writes a module dir with the given haze.toml body and parses it. */
function parse(name: string, body: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, HAZE_CONFIG_FILE),
    `name = "${name}"\n` +
      `id = "AAAAAAAA"\n` +
      `version = "0.1.0"\n` +
      `description = "config test"\n` +
      `license = "MIT"\n` +
      `authors = []\n` +
      `type = "lib"\n` +
      body
  );
  return new ConfigParser(HAZE_CONFIG_FILE, undefined, dir).parseConfig();
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "haze-config-test-"));
  // The plugin package every case below points at. Never parsed -- the check
  // is purely on what the declaring manifest says.
  mkdirSync(join(root, "plug"), { recursive: true });
});

describe("[plugins] requires a matching [dependencies] entry", () => {
  test("a plugin that is not a dependency is rejected", async () => {
    const promise = parse(
      "plugin_only",
      `\n[plugins]\nplug = { path = "../plug" }\n`
    );
    await expect(promise).rejects.toThrow(
      /Plugin 'plug'.*is not also declared as a dependency/s
    );
  });

  test("the message names the exact line to add", async () => {
    const promise = parse(
      "plugin_only_msg",
      `\n[plugins]\nplug = { path = "../plug" }\n`
    );
    await expect(promise).rejects.toThrow(
      /\[dependencies\]\n\s*plug = \{ path = "\.\.\/plug" \}/
    );
  });

  test("declared in both tables, it parses", async () => {
    const config = await parse(
      "both",
      `\n[dependencies]\nplug = { path = "../plug" }\n\n[plugins]\nplug = { path = "../plug" }\n`
    );
    expect(config.plugins).toEqual([{ name: "plug", path: "../plug" }]);
    expect(config.dependencies).toEqual([{ name: "plug", path: "../plug" }]);
  });

  test("the same package written two ways is still the same package", async () => {
    const config = await parse(
      "equivalent_paths",
      `\n[dependencies]\nplug = { path = "../plug" }\n\n[plugins]\nplug = { path = "./../plug" }\n`
    );
    expect(config.plugins).toEqual([{ name: "plug", path: "./../plug" }]);
  });

  test("two different packages under one name are rejected", async () => {
    const promise = parse(
      "diverging_paths",
      `\n[dependencies]\nplug = { path = "../other" }\n\n[plugins]\nplug = { path = "../plug" }\n`
    );
    await expect(promise).rejects.toThrow(
      /Plugin 'plug'.*points at a different package than the dependency of the same name/s
    );
  });

  test("a pathless dependency is left to the stdlib lookup", async () => {
    // Resolved out of the standard library by ProjectCompiler, which is not
    // knowable here -- so the paths are not compared, only the name.
    const config = await parse(
      "stdlib_dep",
      `\n[dependencies]\nplug = {}\n\n[plugins]\nplug = { path = "../plug" }\n`
    );
    expect(config.plugins).toEqual([{ name: "plug", path: "../plug" }]);
  });

  test("no [plugins] table at all is fine", async () => {
    const config = await parse(
      "no_plugins",
      `\n[dependencies]\nplug = { path = "../plug" }\n`
    );
    expect(config.plugins).toEqual([]);
  });
});
