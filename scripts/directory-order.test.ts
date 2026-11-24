/**
 * A build means the same whatever order the file system lists the source
 * directories in (src/ModuleCompiler/DirectoryOrder.ts).
 *
 * The standard library and a small app of several files are built from
 * scratch in several orders (HAZE_DIRECTORY_ORDER). Every build must succeed,
 * the app must print the same, and the standard library's interface must
 * declare the same. The app's files hold the shapes that once compiled
 * differently by order: an overload whose parameter type names another
 * namespace or a struct whose code calls that overload, and an overload in a
 * second block of its namespace (testsuite/src/cases_elaboration_order.hz has
 * them in one file each; here they are spread over files).
 *
 * What is not compared: the generated C. Numbers in generated names follow
 * the elaboration order, so the bytes differ between orders.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { orderEntries } from "../src/ModuleCompiler/DirectoryOrder";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE = join(REPO_ROOT, "__haze__");
const ORDERS = ["sorted", "reversed", "shuffle:1", "shuffle:2", "shuffle:3"];
const LONG = 300_000;
const EXE = process.platform === "win32" ? ".exe" : "";

const APP_FILES: Record<string, string> = {
  "a_show.hz": `namespace a {
    export fn show(x: b.Thing): str { return "thing"; }
    export fn show<T>(x: T): str { return "generic"; }
}
`,
  "b_thing.hz": `namespace b {
    export struct Thing { v: int = 1; }
    export fn useIt(): str { return a.show(Thing {}); }
}
`,
  "c_describe.hz": `fn describe(s: Box2): str { return "box"; }
fn describe<T>(x: T): str { return "generic"; }
`,
  "d_box.hz": `struct Box2 {
    v: int = 1;
    fn name(): str { return describe(Box2 {}); }
}
`,
  "e_show_other.hz": `namespace a {
    export fn show(x: c.Other): str { return "other"; }
}
`,
  "f_other.hz": `namespace c {
    export struct Other { v: int = 2; }
    export fn useOther(): str { return a.show(Other {}); }
}
`,
  "main.hz": `fn main(): int {
    let box = Box2 {};
    fmt.println(f"{b.useIt()} {box.name()} {c.useOther()} {a.show(1)}");
    return 0;
}
`,
};
const EXPECTED = "thing box other generic\n";

let app = "";

beforeAll(() => {
  app = mkdtempSync(join(tmpdir(), "haze-order-"));
  mkdirSync(join(app, "src"));
  writeFileSync(
    join(app, "haze.toml"),
    [
      'name = "order_probe"',
      'id = "OrderPr1"',
      'version = "0.1.0"',
      'description = "Builds the same in every directory order"',
      'license = "MIT"',
      "authors = []",
      'src = "src"',
      'type = "exe"',
      "",
    ].join("\n")
  );
  for (const [name, text] of Object.entries(APP_FILES)) {
    writeFileSync(join(app, "src", name), text);
  }
});

function build(order: string) {
  const run = spawnSync(
    "bun",
    ["run", "src/main.ts", "build", "--dir", app, "--quiet", "--full-rebuild"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "development",
        HAZE_DIRECTORY_ORDER: order,
      },
    }
  );
  return {
    status: run.status,
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

function runApp() {
  const run = spawnSync(join(WORKSPACE, "order_probe", "bin", `order_probe${EXE}`), {
    encoding: "utf8",
  });
  return run.stdout ?? "";
}

/** What the standard library's interface declares, whatever its order. */
function stdlibInterfaceLines() {
  return readFileSync(
    join(WORKSPACE, "haze-stdlib", "build", "import.hz"),
    "utf8"
  )
    .split("\n")
    .sort();
}

describe("directory order", () => {
  test("the permutations are permutations, the same on every machine", () => {
    const names = ["sync.hz", "task.hz", "system.hz", "print.hz", "a.hz"];
    expect(orderEntries(names, "sorted")).toEqual([
      "a.hz",
      "print.hz",
      "sync.hz",
      "system.hz",
      "task.hz",
    ]);
    expect(orderEntries(names, "reversed")).toEqual([
      "task.hz",
      "system.hz",
      "sync.hz",
      "print.hz",
      "a.hz",
    ]);
    const one = orderEntries(names, "shuffle:1");
    expect([...one].sort()).toEqual([...names].sort());
    expect(orderEntries(names, "shuffle:1")).toEqual(one);
    const seeds = ["shuffle:1", "shuffle:2", "shuffle:3", "shuffle:4"];
    const distinct = new Set(
      seeds.map((s) => orderEntries(names, s).join(","))
    );
    expect(distinct.size).toBeGreaterThan(1);
    expect(() => orderEntries(names, "random")).toThrow();
  });

  test(
    "the standard library and an app build and mean the same in every order",
    () => {
      let firstInterface: string[] | null = null;
      for (const order of ORDERS) {
        const r = build(order);
        expect(r.status, `${order}:\n${r.output}`).toBe(0);
        expect(runApp(), order).toBe(EXPECTED);
        const lines = stdlibInterfaceLines();
        if (firstInterface === null) {
          firstInterface = lines;
        } else {
          expect(lines, order).toEqual(firstInterface);
        }
      }
    },
    LONG
  );
});
