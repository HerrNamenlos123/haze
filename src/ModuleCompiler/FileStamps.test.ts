import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkFile,
  checkFiles,
  type FileStamp,
  parseDependencyFile,
} from "./FileStamps";

const dir = mkdtempSync(join(tmpdir(), "haze-stamps-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let counter = 0;
function fresh(content: string) {
  const file = join(dir, `f${counter++}.txt`);
  writeFileSync(file, content);
  return file;
}

function setMtime(file: string, ms: number) {
  utimesSync(file, ms / 1000, ms / 1000);
}

describe("checkFile", () => {
  test("a file never seen is changed, and gets a full stamp", () => {
    const file = fresh("abc");
    const check = checkFile(file, undefined);
    expect(check.changed).toBe(true);
    expect(check.stamp?.size).toBe(3);
    expect(check.stamp?.hash).toMatch(/^(xxh3|sha1):/);
  });

  test("a missing file is changed and has no stamp", () => {
    expect(checkFile(join(dir, "missing"), { mtimeMs: 1 })).toEqual({
      changed: true,
      stamp: null,
    });
  });

  test("a new mtime with the same bytes is unchanged and restamped", () => {
    const file = fresh("same");
    const first = checkFile(file, undefined).stamp as FileStamp;
    setMtime(file, first.mtimeMs + 5000);
    const again = checkFile(file, first);
    expect(again.changed).toBe(false);
    expect(again.stamp?.mtimeMs).toBe(first.mtimeMs + 5000);
    expect(again.stamp?.hash).toBe(first.hash);
  });

  test("an mtime going backwards with other bytes is changed", () => {
    const file = fresh("old!");
    const first = checkFile(file, undefined).stamp as FileStamp;
    writeFileSync(file, "new!");
    setMtime(file, first.mtimeMs - 5000);
    expect(checkFile(file, first).changed).toBe(true);
  });

  test("equal mtime and size are trusted without reading the file", () => {
    const file = fresh("aaaa");
    const first = checkFile(file, undefined).stamp as FileStamp;
    writeFileSync(file, "bbbb");
    setMtime(file, first.mtimeMs);
    // The documented cost of the fast path: same mtime, same size, not read.
    expect(checkFile(file, first).changed).toBe(false);
  });

  test("a stamp from an older compiler: equal mtime unchanged, else changed", () => {
    const file = fresh("legacy");
    const mtimeMs = statSync(file).mtimeMs;
    expect(checkFile(file, { mtimeMs: mtimeMs }).changed).toBe(false);
    expect(checkFile(file, { mtimeMs: mtimeMs - 1 }).changed).toBe(true);
  });
});

describe("checkFile on what is not a regular file", () => {
  test("a directory is unchanged until its mtime moves", () => {
    const sub = join(dir, `d${counter++}`);
    mkdirSync(sub);
    const first = checkFile(sub, undefined);
    expect(first.stamp).not.toBeNull();
    expect(checkFile(sub, first.stamp as FileStamp).changed).toBe(false);
    setMtime(sub, (first.stamp as FileStamp).mtimeMs + 5000);
    expect(checkFile(sub, first.stamp as FileStamp).changed).toBe(true);
  });

  test("a dangling symlink is a stable thing, not a missing file", () => {
    const link = join(dir, `l${counter++}`);
    symlinkSync(join(dir, "nothing-here"), link);
    const first = checkFile(link, undefined);
    expect(first.stamp).not.toBeNull();
    expect(checkFile(link, first.stamp as FileStamp).changed).toBe(false);
  });
});

describe("checkFiles", () => {
  test("the same files unchanged; one more or one less is a change", () => {
    const a = fresh("a");
    const b = fresh("b");
    const before = checkFiles([a, b], undefined);
    expect(before.changed).toBe(true);
    expect(checkFiles([a, b], before.stamps).changed).toBe(false);
    expect(checkFiles([a], before.stamps).changed).toBe(true);
    expect(checkFiles([a, b, fresh("c")], before.stamps).changed).toBe(true);
  });
});

describe("parseDependencyFile", () => {
  test("clang's -MMD output: continuations, escaped spaces, $$", () => {
    const text =
      "/w/build/m.o: /w/build/m.c /usr/include/x.h \\\n" +
      "  /src/with\\ space/a.h /src/dollar$$.h \\\n" +
      "  /src/hash\\#.h\n";
    expect(parseDependencyFile(text)).toEqual([
      "/w/build/m.c",
      "/usr/include/x.h",
      "/src/with space/a.h",
      "/src/dollar$.h",
      "/src/hash#.h",
    ]);
  });

  test("a Windows target keeps its drive letter out of the separator", () => {
    const text = "C:/w/build/m.o: C:/w/build/m.c \\\r\n  D:\\inc\\a.h\r\n";
    expect(parseDependencyFile(text)).toEqual(["C:/w/build/m.c", "D:\\inc\\a.h"]);
  });

  test("nothing to parse is no files", () => {
    expect(parseDependencyFile("")).toEqual([]);
    expect(parseDependencyFile("m.o:\n")).toEqual([]);
  });
});
