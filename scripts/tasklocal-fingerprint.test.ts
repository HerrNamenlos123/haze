// The layout fingerprint of a module's task-local block (CodeGenerator,
// emitTaskLocalBlock): with the module's name it keys hot reload, where a
// reloaded module keeps its old block only if the layout is the same
// (docs/async-decisions.md TL-10). It must change with every change of the
// layout, also inside a struct-typed field (review 2026-11-18: swapping two
// fields of such a struct kept the fingerprint), and stay the same otherwise.
// Builds the same module with the dev compiler, one source change at a time.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE = join(REPO_ROOT, "__haze__");
const MODULE = "tlfp_app";
const LONG = 300_000;

let root = "";

function forget() {
  rmSync(join(WORKSPACE, MODULE), { recursive: true, force: true });
  const cacheDir = join(WORKSPACE, "build-cache");
  if (existsSync(cacheDir)) {
    for (const file of readdirSync(cacheDir)) {
      if (file.startsWith(MODULE)) {
        rmSync(join(cacheDir, file), { force: true });
      }
    }
  }
}

function fingerprintOf(source: string): string {
  writeFileSync(join(root, "src", "main.hz"), source);
  const run = spawnSync(
    "bun",
    ["run", "src/main.ts", "build", "--dir", root, "--quiet"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "development" },
    }
  );
  expect(`${run.stdout ?? ""}${run.stderr ?? ""}`.trim()).toBe("");
  expect(run.status).toBe(0);
  const buildDir = join(WORKSPACE, MODULE, "build");
  const c = readdirSync(buildDir).find((f) => f.endsWith(".c"));
  expect(c).toBeDefined();
  const match = /\.fingerprint = (UINT64_C\(0x[0-9a-f]+\)[^}]*)\}/.exec(
    readFileSync(join(buildDir, c as string), "utf8")
  );
  expect(match).not.toBeNull();
  return (match as RegExpExecArray)[1];
}

function program(pointFields: string, extraField = "") {
  return [
    `struct Point { ${pointFields} }`,
    `struct Wrap { inner: Point = Point {}; }`,
    `tasklocal let p: Point = Point {};`,
    `tasklocal let w: Wrap = Wrap {};${extraField}`,
    `fn main(): int { return p.x + w.inner.x; }`,
    "",
  ].join("\n");
}

beforeAll(() => {
  forget();
  root = mkdtempSync(join(tmpdir(), "haze-tlfp-"));
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "haze.toml"),
    [
      `name = "${MODULE}"`,
      `id = "TlFprnt1"`,
      `version = "1.0.0"`,
      `description = "task-local fingerprint test"`,
      `license = "MIT"`,
      `authors = []`,
      `type = "exe"`,
      "",
      "[dependencies]",
      "",
    ].join("\n")
  );
});

afterAll(() => {
  forget();
  rmSync(root, { recursive: true, force: true });
});

describe("task-local block fingerprint", () => {
  test(
    "the same source gives the same fingerprint; every layout change another",
    () => {
      const base = fingerprintOf(program("x: int = 1; y: real = 2.0;"));
      expect(fingerprintOf(program("x: int = 1; y: real = 2.0;"))).toBe(base);
      // Same size and alignment, fields of a struct-typed field swapped.
      const swapped = fingerprintOf(program("y: real = 2.0; x: int = 1;"));
      expect(swapped).not.toBe(base);
      // A field's type changed inside the struct.
      const retyped = fingerprintOf(program("x: int = 1; y: int = 2;"));
      expect(retyped).not.toBe(base);
      // Only an initial value changed: the layout is the same.
      expect(fingerprintOf(program("x: int = 7; y: real = 2.0;"))).toBe(base);
    },
    LONG
  );
});
