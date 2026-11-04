// What a build without debug info may say about where its files are.
//
// Such a build is the one handed to others (`--release` turns debug info off),
// so the absolute paths of the machine it was built on must not end up in it:
// they name the builder's account and folders. Two kinds of file name reach a
// binary, and both go through this one mapping:
//
//   - C's own: __FILE__ in assertions and the `#line` names of Haze code,
//     rewritten by clang through the `-ffile-prefix-map` flags below;
//   - Haze's: the file of a source_location value (an assert's caller), a
//     string the compiler writes itself (mapOutputPath).
//
// The build folder becomes ".", the home folder "~" (where the stdlib of an
// installed haze lives). The most specific prefix wins.

import os from "node:os";

function prefixes(): [string, string][] {
  const result: [string, string][] = [];
  for (const [from, to] of [
    [process.cwd(), "."],
    [os.homedir(), "~"],
  ]) {
    for (const variant of new Set([from, from.replaceAll("\\", "/")])) {
      result.push([variant, to]);
    }
  }
  return result;
}

/** The clang flags that apply this mapping, quoted for a shell command line. */
export function outputPathMapFlags(): string[] {
  return prefixes().map(([from, to]) => `"-ffile-prefix-map=${from}=${to}"`);
}

/** `path` as a build without debug info states it: relative to ".", "~", or as it is. */
export function mapOutputPath(path: string): string {
  let best: [string, string] | null = null;
  for (const entry of prefixes()) {
    const [from] = entry;
    const boundary = path.length === from.length || path[from.length] === "\\" || path[from.length] === "/";
    if (path.startsWith(from) && boundary && (!best || from.length > best[0].length)) {
      best = entry;
    }
  }
  return best ? best[1] + path.slice(best[0].length) : path;
}
