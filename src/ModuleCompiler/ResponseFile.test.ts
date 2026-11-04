/**
 * Compile and link commands on Windows read their arguments from a response
 * file (see ResponseFile.ts: cmd.exe refuses command lines over 8191
 * characters, and those commands grow with every dependency). Checked
 * against clang itself: what it makes of the file must be what the command
 * line meant.
 *
 * Run with: bun test src/ModuleCompiler/ResponseFile.test.ts
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
// Entering the compiler's module graph anywhere but ModuleCompiler hits the
// Config <-> ModuleCompiler import cycle from the wrong side (Config.test.ts).
import { HAZE_GLOBAL_DIR } from "./ModuleCompiler";
import { Platform } from "../shared/HostPlatform";
import { clangCommand } from "./ResponseFile";

const EXE = process.platform === "win32" ? ".exe" : "";
const CLANG = join(HAZE_GLOBAL_DIR, "bin", `clang${EXE}`);

let dir: string;
// An input the link names: clang -### refuses inputs that do not exist (the
// other paths below are outputs and search directories, which it never checks).
let objectFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "haze-response-file-test-"));
  objectFile = join(dir, "obj dir", "app.obj");
  mkdirSync(join(dir, "obj dir"));
  writeFileSync(objectFile, "");
});

/** How clang -### prints an argument: quoted, backslashes doubled. */
function printed(arg: string): string {
  return `"${arg.replaceAll("\\", "\\\\")}"`;
}

/** The arguments clang passes to lld-link for `command` (clang -### prints the jobs, on stderr). */
function linkerJob(command: string): string {
  const out = execSync(
    `${command} --target=x86_64-pc-windows-msvc -fuse-ld=lld -### 2>&1`,
    { encoding: "utf8" }
  );
  const job = out
    .split("\n")
    .filter((line) => line.includes("lld-link"))
    .at(-1);
  expect(job).toBeDefined();
  return job ?? "";
}

describe("a clang command", () => {
  test("on Windows reads its arguments from the response file", () => {
    const file = join(dir, "windows.rsp");
    const args = `"C:\\obj dir\\app.obj" -o "C:\\out dir\\app.exe"`;
    expect(clangCommand(CLANG, args, file, Platform.Win32)).toBe(
      `"${CLANG}" --rsp-quoting=windows @"${file}"`
    );
    expect(readFileSync(file, "utf8")).toBe(args);
  });

  test("on Linux is the plain command line, with no file", () => {
    const file = join(dir, "linux.rsp");
    expect(clangCommand(CLANG, `"a.o" -o "app"`, file, Platform.Linux)).toBe(
      `"${CLANG}" "a.o" -o "app"`
    );
    expect(existsSync(file)).toBe(false);
  });

  test("means to clang exactly what the Windows command line meant", () => {
    // Backslashes, spaces and a quote opened in the middle of an argument:
    // how haze's own flags are written (-L"<dir>/").
    const args =
      `"${objectFile}" -o "C:\\out dir\\app.exe" ` +
      `-L"C:\\lib dir/" -Wl,/SUBSYSTEM:CONSOLE`;
    const job = linkerJob(
      clangCommand(CLANG, args, join(dir, "meaning.rsp"), Platform.Win32)
    );
    // clang -### prints each argument quoted, backslashes doubled.
    expect(job).toContain(`"-out:C:\\\\out dir\\\\app.exe"`);
    expect(job).toContain(`"-libpath:C:\\\\lib dir/"`);
    expect(job).toContain(printed(objectFile));
    expect(job).toContain(`"/SUBSYSTEM:CONSOLE"`);
  });

  test("has no length limit: far past cmd.exe's 8191 characters", () => {
    const dirs = Array.from(
      { length: 2000 },
      (_, i) =>
        `-L"C:\\Users\\someone\\Projects\\haze\\__haze__\\module_${i}\\bin\\lib/"`
    );
    const args = `"${objectFile}" -o "C:\\b\\app.exe" ${dirs.join(" ")}`;
    expect(args.length).toBeGreaterThan(100_000);
    const command = clangCommand(
      CLANG,
      args,
      join(dir, "long.rsp"),
      Platform.Win32
    );
    expect(command.length).toBeLessThan(1000);
    const job = linkerJob(command);
    expect(job).toContain(
      `"-libpath:C:\\\\Users\\\\someone\\\\Projects\\\\haze\\\\__haze__\\\\module_1999\\\\bin\\\\lib/"`
    );
  });
});
