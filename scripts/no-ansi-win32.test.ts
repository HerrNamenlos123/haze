// Every Win32 call in the repo's own C is the UTF-16 (...W) variant. Haze text
// is UTF-8, and an ANSI (...A) call reads it in the system's ANSI code page,
// which names a different file, or garbles an argument, for anything outside
// it. Windows builds define UNICODE (src/ModuleCompiler/ModuleCompiler.ts), so a
// macro name (CreateEvent, MessageBox) already is the ...W function; what that
// cannot catch is an ANSI name written out, which is what this looks for:
// FooA(...), dbghelp's ANSI functions (they carry no A), the ANSI structs, and
// conversions through the ANSI code page. Runs on every platform: it only
// reads the sources.

import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

const ANSI = [
  // CreateFileA(, GetModuleHandleA(: a capitalized name ending in a lower-case
  // letter or digit and then A, called.
  /\b[A-Z][A-Za-z0-9]*[a-z0-9]A\s*\(/,
  /\b(SymInitialize|SymFromAddr|SymFromName|SymGetLineFromAddr|SymGetLineFromAddr64|SymLoadModule64|SymLoadModuleEx|SymGetModuleInfo64|SymGetSymFromAddr64|SymSetSearchPath|SymGetSearchPath|UnDecorateSymbolName)\s*\(/,
  /\b(STARTUPINFOA|WIN32_FIND_DATAA|SYMBOL_INFO|PSYMBOL_INFO|IMAGEHLP_LINE64|PIMAGEHLP_LINE64)\b/,
  /\bCP_ACP\b/,
];

test("no ANSI Win32 call is written in the repo's own C", () => {
  const files = execFileSync("git", ["ls-files", "*.c", "*.h"], { cwd: repoRoot, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((file) => file.length > 0);
  expect(files.length).toBeGreaterThan(0);
  const hits: string[] = [];
  for (const file of files) {
    const lines = readFileSync(path.join(repoRoot, file), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (ANSI.some((pattern) => pattern.test(line))) {
        hits.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  expect(hits).toEqual([]);
});
