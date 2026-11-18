/**
 * The files the parser-equivalence sweep (parser-equivalence.ts) reads.
 *
 * Every `.hz` file git tracks, and, given `freshSinceMs`, every other `.hz`
 * file in the tree written at or after that time: what the current gate run
 * generated (its test cases' sources, the module interfaces it built, the
 * dist/ copy). Build output an earlier run or another compiler left behind is
 * not swept: it differs from checkout to checkout and goes stale, and a check
 * whose verdict depends on it is not reproducible.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// node_modules holds no Haze; .git holds no working tree. .claude holds the
// sessions' worktrees and scratch copies, which are not this tree.
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "target", ".claude"]);

function collectFreshHazeFiles(
  dir: string,
  freshSinceMs: number,
  out: Set<string>
): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        collectFreshHazeFiles(path, freshSinceMs, out);
      }
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".hz") &&
      statSync(path).mtimeMs >= freshSinceMs
    ) {
      out.add(path);
    }
  }
}

/** Absolute paths, sorted. */
export function sweepFiles(root: string, freshSinceMs: number | null): string[] {
  const files = new Set<string>();
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "*.hz"], {
    cwd: root,
    encoding: "utf8",
  });
  for (const path of tracked.split("\0")) {
    // A file deleted from the working tree is still in the index.
    if (path !== "" && existsSync(join(root, path))) {
      files.add(join(root, path));
    }
  }
  if (freshSinceMs !== null) {
    collectFreshHazeFiles(root, freshSinceMs, files);
  }
  return [...files].sort();
}
