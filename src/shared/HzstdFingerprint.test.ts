import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSameHzstd,
  hzstdFingerprint,
  hzstdSources,
} from "./HzstdFingerprint";

const root = mkdtempSync(join(tmpdir(), "haze-hzstd-fp-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let trees = 0;

/** A fake stdlib/core/src with these files; returns its path. */
function tree(files: Record<string, string>) {
  const srcDir = join(root, `t${trees++}`);
  for (const [rel, text] of Object.entries(files)) {
    const file = join(srcDir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return srcDir;
}

const BASE: Record<string, string> = {
  "hzstd/hzstd_main.c": [
    "#include <uv.h>",
    '#include "include/hzstd.h"',
    '#include "../fiber/fiber.h"',
    "#if defined(HAZE_PLATFORM_LINUX)",
    '#include "src/linux.c"',
    "#else",
    '  #  include "src/win32.c"',
    "#endif",
    "",
  ].join("\n"),
  "hzstd/include/hzstd.h": '#include "../hzstd_types.h"\n',
  "hzstd/hzstd_types.h": "typedef int hz_int;\n",
  "hzstd/src/linux.c": '#include "hzstd/include/hzstd.h"\n',
  "hzstd/src/win32.c":
    '#include "haze-libunwind/include/libunwind.h"\n// #include "gone.h"\n',
  "fiber/fiber.h": "void fiber(void);\n",
  "fiber/README.md": "not C\n",
  "hzstd/src/unused.c": "int unused;\n",
  "other.hz": "fn main() {}\n",
};

const names = (srcDir: string) =>
  hzstdSources(srcDir).map((s) =>
    relative(srcDir, s.file).replaceAll("\\", "/")
  );

describe("hzstdSources", () => {
  test("follows quoted includes from both roots, on both platforms", () => {
    expect(names(tree(BASE))).toEqual([
      "fiber/fiber.h",
      "hzstd/hzstd_main.c",
      "hzstd/hzstd_types.h",
      "hzstd/include/hzstd.h",
      "hzstd/src/linux.c",
      "hzstd/src/win32.c",
    ]);
  });

  test("a missing root fails loud", () => {
    const { "hzstd/include/hzstd.h": _, ...rest } = BASE;
    expect(() => hzstdSources(tree(rest))).toThrow(/does not exist/);
  });

  test("the real hzstd: every C file under hzstd is reached, nothing outside the stdlib", () => {
    const srcDir = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../stdlib/core/src"
    );
    const found = names(srcDir);
    expect(found).toContain("hzstd/hzstd_main.c");
    expect(found).toContain("hzstd/src/hzstd_platform_linux.c");
    expect(found).toContain("hzstd/src/hzstd_platform_win32.c");
    expect(found).toContain("hzstd/src/json/cJSON.c");
    for (const f of found) {
      expect(f.startsWith("..")).toBe(false);
    }
  });
});

describe("hzstdFingerprint", () => {
  const base = hzstdFingerprint(tree(BASE));

  test("the same sources give the same fingerprint, CRLF or not", () => {
    expect(hzstdFingerprint(tree(BASE))).toBe(base);
    const crlf = Object.fromEntries(
      Object.entries(BASE).map(([k, v]) => [k, v.replaceAll("\n", "\r\n")])
    );
    expect(hzstdFingerprint(tree(crlf))).toBe(base);
  });

  for (const file of [
    "hzstd/hzstd_types.h",
    "hzstd/src/win32.c",
    "fiber/fiber.h",
    "hzstd/hzstd_main.c",
  ]) {
    test(`an edit of ${file} changes it`, () => {
      expect(
        hzstdFingerprint(tree({ ...BASE, [file]: `${BASE[file]}// edit\n` }))
      ).not.toBe(base);
    });
  }

  for (const file of ["hzstd/src/unused.c", "fiber/README.md", "other.hz"]) {
    test(`an edit of ${file}, which hzstd does not include, does not`, () => {
      expect(
        hzstdFingerprint(tree({ ...BASE, [file]: `${BASE[file]}// edit\n` }))
      ).toBe(base);
    });
  }

  test("moving a file changes it", () => {
    const { "fiber/fiber.h": text, ...rest } = BASE;
    const moved = {
      ...rest,
      "hzstd/hzstd_main.c": BASE["hzstd/hzstd_main.c"]!.replace(
        "../fiber/fiber.h",
        "fiber.h"
      ),
      "hzstd/fiber.h": text!,
    };
    expect(hzstdFingerprint(tree(moved))).not.toBe(base);
  });
});

describe("assertSameHzstd", () => {
  const meta = (fp: string | null) => ({ name: "dep", hzstdFingerprint: fp });

  test("the same fingerprint passes", () => {
    expect(() =>
      assertSameHzstd(meta("a".repeat(64)), "a".repeat(64))
    ).not.toThrow();
  });

  test("a different one fails, naming the module and both fingerprints", () => {
    expect(() => assertSameHzstd(meta("a".repeat(64)), "b".repeat(64))).toThrow(
      /Module 'dep' was compiled against a different version of hzstd .*aaaaaaaaaaaa, this build: bbbbbbbbbbbb/
    );
  });

  test("metadata without a fingerprint fails", () => {
    expect(() => assertSameHzstd(meta(null), "b".repeat(64))).toThrow(
      /did not record which one/
    );
  });
});
