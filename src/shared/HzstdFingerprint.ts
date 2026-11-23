// The fingerprint of hzstd, the C runtime every module is compiled against.
//
// Generated code reads hzstd's data (frames, cells, arrays, the context)
// through its headers and macros, so modules built against different hzstd
// sources do not fit together. Every module records the fingerprint it was
// built against in its metadata.json; a dependency whose fingerprint differs
// from the current one cannot be compiled and linked against
// (ModuleCompiler.loadDependencyBinaries).
//
// The fingerprint covers exactly what the runtime's C reads from the standard
// library: hzstd_main.c (the unity build, compiled into haze-stdlib) and
// include/hzstd.h (what generated code includes), and every file they reach
// through a quoted #include, wherever it lives (stdlib/core/src/fiber/fiber.h,
// for instance). Includes are followed whatever #if surrounds them, so both
// platforms' files count. Angle-bracket includes are system and third-party
// headers, pinned by the compiler itself.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { ModuleMetadata } from "./Config";
import { GeneralError } from "./Errors";

const QUOTED_INCLUDE = /^[ \t]*#[ \t]*include[ \t]*"([^"]+)"/gm;

/**
 * Every file of the runtime's C with its text, sorted by path. `srcDir` is
 * stdlib/core/src (the include directory generated code compiles with).
 * Each file is read once.
 */
export function hzstdSources(srcDir: string): { file: string; text: string }[] {
  const roots = [
    join(srcDir, "hzstd", "hzstd_main.c"),
    join(srcDir, "hzstd", "include", "hzstd.h"),
  ];
  const texts = new Map<string, string>();
  const visit = (file: string) => {
    if (texts.has(file)) {
      return;
    }
    const text = readFileSync(file, "utf-8");
    texts.set(file, text);
    for (const match of text.matchAll(QUOTED_INCLUDE)) {
      const name = match[1]!;
      // A quoted include is looked up next to the including file first, then
      // in the include directory, as clang does with -I<srcDir>. One found in
      // neither place comes from the other include directories, those of the
      // native libraries the compiler fetches at pinned versions
      // ("haze-libunwind/include/libunwind.h"): not standard library source.
      const found = [resolve(dirname(file), name), resolve(srcDir, name)].find(
        (c) => existsSync(c)
      );
      if (found) {
        visit(found);
      }
    }
  };
  for (const root of roots) {
    if (!existsSync(root)) {
      throw new GeneralError(`hzstd fingerprint: '${root}' does not exist`);
    }
    visit(root);
  }
  return [...texts.keys()]
    .sort()
    .map((file) => ({ file: file, text: texts.get(file)! }));
}

const cache = new Map<string, string>();

/**
 * The fingerprint of the hzstd in `srcDir`, computed once per process (a
 * build never changes the standard library it compiles against). Line
 * endings are normalized, so a checkout with CRLF gives the same value.
 */
export function hzstdFingerprint(srcDir: string): string {
  const cached = cache.get(srcDir);
  if (cached) {
    return cached;
  }
  const hash = createHash("sha256");
  for (const { file, text } of hzstdSources(srcDir)) {
    hash.update(relative(srcDir, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(text.replaceAll("\r\n", "\n"));
    hash.update("\0");
  }
  const fingerprint = hash.digest("hex");
  cache.set(srcDir, fingerprint);
  return fingerprint;
}

/**
 * A dependency is usable only if it was compiled against the same hzstd as
 * this build. Every module of a build has its source and is rebuilt when its
 * fingerprint differs (checkUpToDate), so a mismatch here is a module that
 * was not rebuilt from source: it cannot be used.
 */
export function assertSameHzstd(
  meta: Pick<ModuleMetadata, "name" | "hzstdFingerprint">,
  current: string
) {
  if (meta.hzstdFingerprint === current) {
    return;
  }
  throw new GeneralError(
    `Module '${meta.name}' was compiled against a different version of hzstd ` +
      `(the Haze runtime) than this build uses` +
      (meta.hzstdFingerprint === null
        ? ` (its compiler did not record which one)`
        : ` (${meta.hzstdFingerprint.slice(0, 12)}, this build: ${current.slice(0, 12)})`) +
      `, so it cannot be used. Rebuild it from its source with this compiler.`
  );
}
