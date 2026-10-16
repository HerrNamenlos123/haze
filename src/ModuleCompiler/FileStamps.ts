// Has a file changed since a build last saw it?
//
// The stamp is the file's mtime, size and a hash of its content. Equal mtime
// and size count as unchanged without reading the file, which is what keeps
// a no-op build cheap. When either moved, the file is read and hashed, and an
// equal hash still counts as unchanged: a generator that rewrites the same
// bytes, a touched file, or a checkout that restores a file must not rebuild
// everything that depends on it. The caller saves the new stamp, so the next
// check of that file is the cheap one again.
//
// A stamp from an older compiler has no size or hash; it is unchanged when the
// mtime is equal and changed otherwise, as before. So is anything that is not
// a regular file (a directory, a dangling symlink): it has no content to hash.

import { createHash } from "node:crypto";
import fs from "node:fs";

export type FileStamp = {
  mtimeMs: number;
  size?: number;
  hash?: string;
};

declare const Bun:
  | { hash: { xxHash3(data: Uint8Array): bigint } }
  | undefined;

function hashContent(data: Buffer): string {
  // xxHash3 runs at ~20 GB/s here, sha256 at ~1 GB/s; Node has only the
  // latter kind. The prefix keeps the two from ever comparing equal.
  if (typeof Bun !== "undefined") {
    return `xxh3:${Bun.hash.xxHash3(data).toString(16)}`;
  }
  return `sha1:${createHash("sha1").update(data).digest("hex")}`;
}

// Every file is hashed at most once per process for a given mtime and size:
// stdlib's import.hz is an input of every module of a build.
const hashedThisProcess = new Map<string, Required<FileStamp>>();

function currentStamp(file: string, stat: fs.Stats): Required<FileStamp> {
  const known = hashedThisProcess.get(file);
  if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) {
    return known;
  }
  const stamp = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    hash: hashContent(fs.readFileSync(file)),
  };
  hashedThisProcess.set(file, stamp);
  return stamp;
}

/** What is at the path, a dangling symlink included; null when nothing. */
function statEntry(file: string): fs.Stats | null {
  try {
    return fs.statSync(file);
  } catch {
    try {
      return fs.lstatSync(file);
    } catch {
      return null;
    }
  }
}

export type FileCheck = {
  changed: boolean;
  /** What to remember for the file now; null when it does not exist. */
  stamp: FileStamp | null;
};

/** Compares a file with the stamp it had (none: never seen, so changed). */
export function checkFile(file: string, previous?: FileStamp): FileCheck {
  const stat = statEntry(file);
  if (!stat) {
    return { changed: true, stamp: null };
  }
  if (!stat.isFile()) {
    const unchanged =
      previous !== undefined &&
      previous.hash === undefined &&
      previous.mtimeMs === stat.mtimeMs;
    return { changed: !unchanged, stamp: { mtimeMs: stat.mtimeMs } };
  }
  if (previous && previous.mtimeMs === stat.mtimeMs) {
    if (previous.size === undefined) {
      // An old stamp: equal mtime is all it can tell.
      return { changed: false, stamp: currentStamp(file, stat) };
    }
    if (previous.size === stat.size) {
      return {
        changed: false,
        stamp: previous.hash ? previous : currentStamp(file, stat),
      };
    }
  }
  const stamp = currentStamp(file, stat);
  const changed = !(previous?.hash !== undefined && previous.hash === stamp.hash);
  return { changed: changed, stamp: stamp };
}

/** Do the files still match their stamps, and are they the same files? */
export function checkFiles(
  files: Iterable<string>,
  previous: Record<string, FileStamp> | undefined
): { changed: boolean; stamps: Record<string, FileStamp> } {
  const stamps: Record<string, FileStamp> = {};
  let changed = previous === undefined;
  let count = 0;
  for (const file of files) {
    if (file in stamps) {
      continue;
    }
    count++;
    const check = checkFile(file, previous?.[file]);
    if (check.changed) {
      changed = true;
    }
    if (check.stamp) {
      stamps[file] = check.stamp;
    }
  }
  if (previous && Object.keys(previous).length !== count) {
    changed = true;
  }
  return { changed: changed, stamps: stamps };
}

/** True when some stamp differs from the remembered one, e.g. a new mtime. */
export function stampsDiffer(
  a: Record<string, FileStamp> | undefined,
  b: Record<string, FileStamp>
): boolean {
  if (!a) {
    return true;
  }
  const keys = Object.keys(b);
  if (Object.keys(a).length !== keys.length) {
    return true;
  }
  for (const key of keys) {
    const x = a[key];
    const y = b[key];
    if (
      !x ||
      x.mtimeMs !== y.mtimeMs ||
      x.size !== y.size ||
      x.hash !== y.hash
    ) {
      return true;
    }
  }
  return false;
}

/** Every file under dir, recursively; nothing when it does not exist. */
export function listFilesRecursively(dir: string): string[] {
  const files: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

/**
 * The prerequisites of a make-style dependency file as clang writes it
 * (-MMD -MF): `target: dep dep \<newline> dep ...`, a space inside a path
 * escaped as `\ `, `#` as `\#`, `$` as `$$`.
 */
export function parseDependencyFile(text: string): string[] {
  const joined = text.replace(/\\\r?\n/g, " ");
  // The target ends at the first colon followed by whitespace; a Windows
  // drive letter's colon is followed by a slash.
  const separator = /:(\s|$)/.exec(joined);
  if (!separator) {
    return [];
  }
  const rest = joined.slice(separator.index + 1);
  const files: string[] = [];
  let current = "";
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === "\\" && (rest[i + 1] === " " || rest[i + 1] === "#")) {
      current += rest[i + 1];
      i++;
    } else if (c === "$" && rest[i + 1] === "$") {
      current += "$";
      i++;
    } else if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      if (current) {
        files.push(current);
        current = "";
      }
    } else {
      current += c;
    }
  }
  if (current) {
    files.push(current);
  }
  return files;
}
