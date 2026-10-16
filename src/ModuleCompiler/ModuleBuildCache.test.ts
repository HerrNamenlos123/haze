import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModuleBuildCache } from "./ModuleCompiler";

const dir = mkdtempSync(join(tmpdir(), "haze-buildcache-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("ModuleBuildCache.updateModule", () => {
  test("a file first seen by a build and written after its check is checked again", () => {
    const source = join(dir, "source.hz");
    const header = join(dir, "found.h");
    const quiet = join(dir, "quiet.h");
    writeFileSync(source, "a");
    writeFileSync(header, "b");
    writeFileSync(quiet, "c");
    const checkedAt = Date.now();
    // Written while the build ran, after the check.
    utimesSync(header, (checkedAt + 2000) / 1000, (checkedAt + 2000) / 1000);
    // Written well before it.
    utimesSync(quiet, (checkedAt - 60000) / 1000, (checkedAt - 60000) / 1000);

    const cache = new ModuleBuildCache(join(dir, "m.json"));
    const before = cache.checkModule("m", [source], "key");
    cache.updateModule("m", [source, header, quiet], before.stamps, "key", undefined, checkedAt);

    expect(cache.checkModule("m", [source, header, quiet], "key").changed).toBe(
      true
    );
    const settled = new ModuleBuildCache(join(dir, "n.json"));
    const again = settled.checkModule("n", [source], "key");
    settled.updateModule("n", [source, quiet], again.stamps, "key", undefined, checkedAt);
    expect(settled.checkModule("n", [source, quiet], "key").changed).toBe(false);
  });

  test("forgetting a module makes it changed until it is recorded again", () => {
    const source = join(dir, "forget.hz");
    writeFileSync(source, "a");
    const cache = new ModuleBuildCache(join(dir, "f.json"));
    const first = cache.checkModule("f", [source], "key");
    cache.updateModule("f", [source], first.stamps, "key", undefined, Date.now());
    expect(cache.checkModule("f", [source], "key").changed).toBe(false);
    cache.forget("f");
    cache.save();
    const reloaded = new ModuleBuildCache(join(dir, "f.json"));
    reloaded.load();
    expect(reloaded.checkModule("f", [source], "key").changed).toBe(true);
  });
});
