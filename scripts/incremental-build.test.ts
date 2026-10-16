/**
 * What an incremental build rebuilds, and that what it skips is really
 * unchanged.
 *
 * A small project (app -> mid -> base, plus a C header and a generator) is
 * built again and again by the dev compiler from the repository root, each
 * time after one kind of edit. The timing graph of each build says, per
 * module, whether it was up to date, only relinked, or rebuilt; running the
 * app says whether the skipped work would have changed anything.
 *
 * The tests run in order and share the workspace state they leave behind.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE = join(REPO_ROOT, "__haze__");
const MODULES = ["incrt_base", "incrt_mid", "incrt_app", "incrt_gen_hz"];
const LONG = 300_000;

let root = "";

type Timeline = {
  builds: { id: number; parentRow: string | null }[];
  rows: { key: string; build: number; module: string; outcome: string }[];
  spans: { row: string; label: string }[];
};

type Result = {
  status: number;
  output: string;
  /** Per module of the outermost build: what happened to it. */
  did: Record<string, "up-to-date" | "relinked" | "rebuilt" | "other">;
  /** Per module: the labels of everything it did. */
  steps: Record<string, string[]>;
};

function build(...extra: string[]): Result {
  const run = spawnSync(
    "bun",
    [
      "run",
      "src/main.ts",
      "build",
      "--dir",
      join(root, "app"),
      "--quiet",
      "--timing-graph",
      ...extra,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "development" },
    }
  );
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const match = /Timing graph: (.*)\.svg/.exec(output);
  const did: Result["did"] = {};
  const steps: Result["steps"] = {};
  if (match) {
    const data = JSON.parse(
      readFileSync(`${match[1]}.json`, "utf8")
    ) as Timeline;
    const outer = data.builds.find((b) => b.parentRow === null);
    for (const row of data.rows) {
      if (row.build !== outer?.id) {
        continue;
      }
      const labels = data.spans
        .filter((s) => s.row === row.key)
        .map((s) => s.label);
      steps[row.module] = labels;
      if (row.outcome === "up-to-date") {
        did[row.module] = "up-to-date";
      } else if (labels.includes("analyze")) {
        did[row.module] = "rebuilt";
      } else if (labels.includes("link")) {
        did[row.module] = "relinked";
      } else {
        did[row.module] = "other";
      }
    }
  }
  return { status: run.status ?? -1, output: output, did: did, steps: steps };
}

function runApp(): string {
  const run = spawnSync(join(WORKSPACE, "incrt_app", "bin", "incrt_app"), [], {
    encoding: "utf8",
  });
  expect(run.status).toBe(0);
  return run.stdout.trim();
}

function write(rel: string, text: string) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

/** A new mtime, the same bytes. */
function touch(rel: string) {
  const file = join(root, rel);
  const now = new Date();
  utimesSync(file, now, now);
}

function manifest(
  name: string,
  id: string,
  type: "lib" | "exe",
  deps: string[],
  extra = ""
) {
  return [
    `name = "${name}"`,
    `id = "${id}"`,
    `version = "1.0.0"`,
    `description = "incremental build test"`,
    `license = "MIT"`,
    `authors = []`,
    `type = "${type}"`,
    "",
    "[dependencies]",
    ...deps.map((d) => `${d} = { path = "../${d.replace("incrt_", "")}" }`),
    extra,
    "",
  ].join("\n");
}

function generatorSource(comment: string, value: number) {
  return [
    `// ${comment}`,
    "fn main(): int {",
    '    let dir = env.get("HAZE_MODULE_AUTOGEN_DIR");',
    "    if !dir {",
    "        return 1;",
    "    }",
    `    fs.writeText(f"{dir}/generated.hz", "export fn generatedValue(): int {\\n    return ${value};\\n}\\n");`,
    "    return 0;",
    "}",
    "",
  ].join("\n");
}

function baseSource(value: number, statsFields = "    value: int = 0;") {
  return [
    "export struct Stats {",
    statsFields,
    "}",
    "",
    "export fn baseValue(): int {",
    `    return ${value};`,
    "}",
    "",
  ].join("\n");
}

beforeAll(() => {
  for (const name of MODULES) {
    rmSync(join(WORKSPACE, name), { recursive: true, force: true });
  }
  const cacheDir = join(WORKSPACE, "build-cache");
  if (existsSync(cacheDir)) {
    for (const file of readdirSync(cacheDir)) {
      if (MODULES.some((m) => file.startsWith(m))) {
        rmSync(join(cacheDir, file), { force: true });
      }
    }
  }

  root = mkdtempSync(join(tmpdir(), "haze-incr-"));

  write(
    "base/haze.toml",
    manifest(
      "incrt_base",
      "IncrBas1",
      "lib",
      [],
      [
        "",
        "[generator.incrt-gen]",
        'exec = "incrt_gen.hz"',
        "inputs = []",
        'outputs = [{ module="this", dir="autogen", path="generated.hz" }]',
      ].join("\n")
    )
  );
  write("base/incrt_gen.hz", generatorSource("v1", 7));
  write("base/src/base.hz", baseSource(1));

  write("mid/haze.toml", manifest("incrt_mid", "IncrMid1", "lib", ["incrt_base"]));
  write(
    "mid/src/mid.hz",
    [
      "import incrt_base;",
      "",
      "export fn midValue(): int {",
      "    let add = (x: int): int => x + 10;",
      "    let total = 0;",
      "    for (let i = 0; i < 2; i++) {",
      "        total += add(incrt_base.baseValue());",
      "    }",
      "    return total;",
      "}",
      "",
      "export fn midGenerated(): int {",
      "    return incrt_base.generatedValue();",
      "}",
      "",
      "export fn midStats(): incrt_base.Stats {",
      "    return incrt_base.Stats { value: 5 };",
      "}",
      "",
    ].join("\n")
  );

  write("hdr/value.h", "#define INCRT_HEADER_VALUE 100\n");
  write("app/haze.toml", manifest("incrt_app", "IncrApp1", "exe", ["incrt_mid"]));
  write(
    "app/src/main.hz",
    [
      `__c__("#include \\"${join(root, "hdr", "value.h")}\\"");`,
      "",
      "import incrt_mid;",
      "",
      "fn headerValue(): int {",
      "    let r: int = 0;",
      '    __c__("r = INCRT_HEADER_VALUE;");',
      "    return r;",
      "}",
      "",
      "fn main(): int {",
      "    fmt.println(incrt_mid.midValue());",
      "    fmt.println(headerValue());",
      "    fmt.println(incrt_mid.midGenerated());",
      "    fmt.println(incrt_mid.midStats().value);",
      "    return 0;",
      "}",
      "",
    ].join("\n")
  );
}, LONG);

describe("incremental builds", () => {
  test(
    "the first build builds everything and the app runs",
    () => {
      const r = build();
      expect(r.status, r.output).toBe(0);
      expect(r.did["incrt_app"]).toBe("rebuilt");
      expect(runApp()).toBe("22\n100\n7\n5");
    },
    LONG
  );

  test(
    "a build with nothing changed does nothing",
    () => {
      const bin = join(WORKSPACE, "incrt_app", "bin", "incrt_app");
      const published = statSync(bin).mtimeMs;
      const r = build();
      expect(r.status, r.output).toBe(0);
      expect(r.did).toMatchObject({
        "haze-stdlib": "up-to-date",
        incrt_base: "up-to-date",
        incrt_mid: "up-to-date",
        incrt_app: "up-to-date",
      });
      // Not even published again.
      expect(statSync(bin).mtimeMs).toBe(published);
    },
    LONG
  );

  test(
    "a source with a new mtime but the same bytes rebuilds nothing",
    () => {
      touch("base/src/base.hz");
      touch("app/haze.toml");
      const r = build();
      expect(r.status, r.output).toBe(0);
      expect(r.did).toMatchObject({
        incrt_base: "up-to-date",
        incrt_mid: "up-to-date",
        incrt_app: "up-to-date",
      });
    },
    LONG
  );

  test(
    "a changed function body rebuilds its module and only relinks the app",
    () => {
      write("base/src/base.hz", baseSource(2));
      const r = build();
      expect(r.status, r.output).toBe(0);
      expect(r.did).toMatchObject({
        incrt_base: "rebuilt",
        incrt_mid: "up-to-date",
        incrt_app: "relinked",
      });
      expect(runApp()).toBe("24\n100\n7\n5");
    },
    LONG
  );

  test(
    "a changed interface rebuilds every module that sees it, also transitively",
    () => {
      // The app reads Stats.value through mid, whose own interface text does
      // not change: only base's does. An app left alone would read the field
      // at its old offset and print 9.
      write(
        "base/src/base.hz",
        baseSource(2, "    extra: int = 9;\n    value: int = 0;")
      );
      const r = build();
      expect(r.status, r.output).toBe(0);
      expect(r.did).toMatchObject({
        incrt_base: "rebuilt",
        incrt_mid: "rebuilt",
        incrt_app: "rebuilt",
      });
      expect(runApp()).toBe("24\n100\n7\n5");
    },
    LONG
  );

  test(
    "a changed C header the app includes recompiles the app",
    () => {
      write("hdr/value.h", "#define INCRT_HEADER_VALUE 101\n");
      const r = build();
      expect(r.status, r.output).toBe(0);
      expect(r.did["incrt_app"]).toBe("rebuilt");
      expect(r.did["incrt_mid"]).toBe("up-to-date");
      expect(runApp()).toBe("24\n101\n7\n5");
    },
    LONG
  );

  test(
    "a generator that runs again with the same output rebuilds nothing",
    () => {
      write("base/incrt_gen.hz", generatorSource("v2, same output", 7));
      const r = build();
      expect(r.status, r.output).toBe(0);
      expect(r.steps["incrt_base"]).toContain("run generator incrt-gen");
      expect(r.did).toMatchObject({
        incrt_mid: "up-to-date",
        incrt_app: "up-to-date",
      });
      expect(r.steps["incrt_base"]).not.toContain("analyze");
    },
    LONG
  );

  test(
    "a generator whose output changes rebuilds its module and the app sees it",
    () => {
      write("base/incrt_gen.hz", generatorSource("v3", 8));
      const r = build();
      expect(r.status, r.output).toBe(0);
      expect(r.did["incrt_base"]).toBe("rebuilt");
      expect(runApp()).toBe("24\n101\n8\n5");
    },
    LONG
  );

  test(
    "a module's generated C does not depend on what else the build compiled",
    () => {
      const cFile = join(WORKSPACE, "incrt_mid", "build", "incrt_mid-linux-x64.c");
      // Everything compiled in one process: the old process-wide counter gave
      // mid whatever ids stdlib and base left over.
      expect(build("--full-rebuild").status).toBe(0);
      const together = readFileSync(cFile, "utf8");
      expect(together).toMatch(/__temp_|__hz_callable_/);

      // Only mid compiled: a trailing newline changes the file, not a line.
      write("mid/src/mid.hz", `${read("mid/src/mid.hz")}\n`);
      const r = build();
      expect(r.did["incrt_mid"]).toBe("rebuilt");
      expect(r.did["haze-stdlib"]).toBe("up-to-date");
      const alone = readFileSync(cFile, "utf8");
      expect(alone === together).toBe(true);
    },
    LONG
  );

  test(
    "switching build settings and back rebuilds nothing the second time",
    () => {
      const other = build("--no-debug");
      expect(other.status, other.output).toBe(0);
      expect(runApp()).toBe("24\n101\n8\n5");

      const back = build();
      expect(back.status, back.output).toBe(0);
      expect(back.did).toMatchObject({
        "haze-stdlib": "up-to-date",
        incrt_base: "up-to-date",
        incrt_mid: "up-to-date",
        incrt_app: "up-to-date",
      });

      const again = build("--no-debug");
      expect(again.did).toMatchObject({
        "haze-stdlib": "up-to-date",
        incrt_app: "up-to-date",
      });
      expect(runApp()).toBe("24\n101\n8\n5");
    },
    LONG
  );

  test(
    "stripping changes only the published binary, and is undone without a rebuild",
    () => {
      const bin = join(WORKSPACE, "incrt_app", "bin", "incrt_app");
      const symbols = () =>
        spawnSync("nm", [bin], { encoding: "utf8" }).stdout.includes(" main");

      const stripped = build("--strip");
      expect(stripped.status, stripped.output).toBe(0);
      expect(stripped.did["incrt_app"]).toBe("up-to-date");
      expect(symbols()).toBe(false);

      const plain = build();
      expect(plain.status, plain.output).toBe(0);
      expect(plain.did["incrt_app"]).toBe("up-to-date");
      expect(symbols()).toBe(true);
      expect(runApp()).toBe("24\n101\n8\n5");
    },
    LONG
  );

  test(
    "a library whose C failed after its interface was written is rebuilt after a revert",
    () => {
      const good = read("base/src/base.hz");
      const goodInterface = readFileSync(
        join(WORKSPACE, "incrt_base", "build", "import.hz"),
        "utf8"
      );
      // A new field changes the interface; the C then fails.
      write(
        "base/src/base.hz",
        `${good.replace("value: int = 0;", "value: int = 0;\n    more: int = 7;")}\nfn broken() {\n    __c__("this is not C;");\n}\n`
      );
      expect(build().status).not.toBe(0);

      write("base/src/base.hz", good);
      const r = build();
      expect(r.status, r.output).toBe(0);
      expect(
        readFileSync(join(WORKSPACE, "incrt_base", "build", "import.hz"), "utf8")
      ).toBe(goodInterface);
      expect(runApp()).toBe("24\n101\n8\n5");
    },
    LONG
  );

  test(
    "an app whose object file is gone is rebuilt, not relinked without it",
    () => {
      rmSync(join(WORKSPACE, "incrt_app", "build", "incrt_app-linux-x64.o"));
      const good = read("base/src/base.hz");
      write("base/src/base.hz", good.replace("return 2;", "return 3;"));
      const r = build();
      expect(r.status, r.output).toBe(0);
      expect(r.did["incrt_app"]).toBe("rebuilt");
      expect(runApp()).toBe("26\n101\n8\n5");
      write("base/src/base.hz", good);
      expect(build().status).toBe(0);
    },
    LONG
  );

  test(
    "a build with other settings does not read the default build's directories",
    () => {
      expect(build("--no-debug").status).toBe(0);
      for (const name of ["incrt_base", "incrt_mid"]) {
        rmSync(join(WORKSPACE, name, "build"), { recursive: true, force: true });
      }
      write("app/src/main.hz", `${read("app/src/main.hz")}\n`);
      const r = build("--no-debug");
      expect(r.status, r.output).toBe(0);
      expect(r.did).toMatchObject({
        incrt_base: "up-to-date",
        incrt_mid: "up-to-date",
        incrt_app: "rebuilt",
      });
      expect(runApp()).toBe("24\n101\n8\n5");
      expect(build().status).toBe(0);
    },
    LONG
  );

  test(
    "an executable may be named like a directory the build writes",
    () => {
      for (const name of ["embedded", "regex"]) {
        rmSync(join(WORKSPACE, name), { recursive: true, force: true });
        write(
          `${name}/haze.toml`,
          manifest(name, `IncrNam${name.length}`, "exe", [])
        );
        write(`${name}/src/main.hz`, "fn main(): int {\n    return 0;\n}\n");
        const run = spawnSync(
          "bun",
          ["run", "src/main.ts", "build", "--dir", join(root, name), "--quiet"],
          {
            cwd: REPO_ROOT,
            encoding: "utf8",
            env: { ...process.env, NODE_ENV: "development" },
          }
        );
        expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
        const exe = spawnSync(join(WORKSPACE, name, "bin", name));
        expect(exe.status).toBe(0);
        rmSync(join(WORKSPACE, name), { recursive: true, force: true });
      }
    },
    LONG
  );

  test(
    "a generator input edited while the generator runs makes it run again",
    () => {
      write("base/edit-input.txt", "v");
      write(
        "base/incrt_edit.hz",
        [
          "fn main(): int {",
          "    attempt {",
          '        let src = env.get("HAZE_MODULE_SOURCE_DIR");',
          '        if !src { raise "no source dir"; }',
          '        let dir = env.get("HAZE_MODULE_AUTOGEN_DIR");',
          '        if !dir { raise "no autogen dir"; }',
          '        let input = f"{src}/edit-input.txt";',
          "        let text = fs.readText(input)?!;",
          '        fs.writeText(f"{dir}/edited.hz", "export fn editedValue(): int {\\n    return 1;\\n}\\n")?!;',
          "        // What a person saving the input during a long run looks like.",
          '        fs.writeText(input, f"{text}x")?!;',
          "    }",
          "    else e {",
          "        if e is fs.Error {",
          '            fmt.println("incrt_edit failed:", e);',
          "            return 1;",
          "        }",
          "        else if e is str {",
          '            fmt.println(f"incrt_edit failed: {e}");',
          "            return 1;",
          "        }",
          "        assert(false);",
          "    };",
          "    return 0;",
          "}",
          "",
        ].join("\n")
      );
      write(
        "base/haze.toml",
        `${read("base/haze.toml")}\n${[
          "[generator.incrt-edit]",
          'exec = "incrt_edit.hz"',
          'inputs = [{ module="this", dir="root", path="edit-input.txt" }]',
          'outputs = [{ module="this", dir="autogen", path="edited.hz" }]',
          "",
        ].join("\n")}`
      );
      const first = build();
      expect(first.status, first.output).toBe(0);
      expect(first.steps["incrt_base"]).toContain("run generator incrt-edit");
      expect(read("base/edit-input.txt")).toBe("vx");

      const second = build();
      expect(second.status, second.output).toBe(0);
      expect(second.steps["incrt_base"]).toContain("run generator incrt-edit");
    },
    LONG
  );
});
