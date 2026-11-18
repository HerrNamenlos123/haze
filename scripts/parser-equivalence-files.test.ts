// Which files the parser-equivalence sweep reads (scripts/parser-equivalence.ts).
// Its verdict must follow from the commit and the current run alone: build
// output an older compiler left in a checkout (gitignored, often stale) is not
// part of it, while what the gate run itself just generated is.

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepFiles } from "./parser-equivalence-files";

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots = [];
});

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "haze-eqv-files-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, ".gitignore"), "__haze__/\nwork/\n");
  return root;
}

function write(root: string, path: string, mtimeSeconds: number) {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, "fn main(): int { return 0; }\n");
  utimesSync(full, mtimeSeconds, mtimeSeconds);
}

function track(root: string, ...paths: string[]) {
  execFileSync("git", ["add", "--", ...paths], { cwd: root });
}

function relativeSweep(root: string, freshSinceMs: number | null): string[] {
  return sweepFiles(root, freshSinceMs).map((p) => p.slice(root.length + 1));
}

describe("parser equivalence: the files it sweeps", () => {
  test("tracked files only, without a marker", () => {
    const root = repo();
    write(root, "src/a.hz", 1000);
    write(root, "src/untracked.hz", 1000);
    write(root, "__haze__/m/build/import.hz", 3000);
    write(root, "src/notes.txt", 1000);
    track(root, "src/a.hz", "src/notes.txt");
    expect(relativeSweep(root, null)).toEqual(["src/a.hz"]);
  });

  test("with a marker, also what was written at or after it", () => {
    const root = repo();
    write(root, "src/a.hz", 1000);
    track(root, "src/a.hz");
    write(root, "__haze__/stale/build/import.hz", 1999);
    write(root, "__haze__/fresh/build/import.hz", 2000);
    write(root, "work/case_1.hz", 2500);
    expect(relativeSweep(root, 2000 * 1000)).toEqual([
      "__haze__/fresh/build/import.hz",
      "src/a.hz",
      "work/case_1.hz",
    ]);
  });

  test("a tracked file is swept however old it is", () => {
    const root = repo();
    write(root, "src/old.hz", 10);
    track(root, "src/old.hz");
    expect(relativeSweep(root, 2000 * 1000)).toEqual(["src/old.hz"]);
  });

  test("fresh files in the skipped directories are not swept", () => {
    const root = repo();
    write(root, "node_modules/x/a.hz", 3000);
    write(root, ".claude/worktrees/w/a.hz", 3000);
    write(root, "rust/target/a.hz", 3000);
    expect(relativeSweep(root, 2000 * 1000)).toEqual([]);
  });

  test("a tracked file deleted from the working tree is not swept", () => {
    const root = repo();
    write(root, "src/gone.hz", 1000);
    track(root, "src/gone.hz");
    rmSync(join(root, "src/gone.hz"));
    expect(relativeSweep(root, null)).toEqual([]);
  });
});
