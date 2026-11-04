/**
 * The Windows side of an [app] executable: a console-subsystem program that
 * carries a manifest whose consoleAllocationPolicy is "detached" (see
 * WindowsAppManifest.ts for why). Checked against independent tools from the
 * toolchain: the resource file against what llvm-rc writes for the same
 * input, and an executable linked the way haze links an [app] against
 * llvm-readobj and its own PE header.
 *
 * Run with: bun test src/ModuleCompiler/WindowsAppManifest.test.ts
 */

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
// Entering the compiler's module graph anywhere but ModuleCompiler hits the
// Config <-> ModuleCompiler import cycle from the wrong side (Config.test.ts).
import { HAZE_GLOBAL_DIR } from "./ModuleCompiler";
import { ModuleType } from "../shared/Config";
import {
  APP_MANIFEST_XML,
  appManifestResource,
  isWindowsApp,
  resourceFile,
  windowsAppLinkFlags,
} from "./WindowsAppManifest";

const EXE = process.platform === "win32" ? ".exe" : "";
const tool = (name: string) => `"${join(HAZE_GLOBAL_DIR, "bin", name + EXE)}"`;

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "haze-windows-app-test-"));
});

/** What llvm-rc makes of `rc`, with `files` next to it. */
function llvmRc(
  name: string,
  rc: string,
  files: Record<string, string | Uint8Array>
): Buffer {
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content);
  }
  writeFileSync(join(dir, `${name}.rc`), rc);
  const out = join(dir, `${name}.res`);
  execSync(`${tool("llvm-rc")} /fo "${out}" "${join(dir, `${name}.rc`)}"`, {
    cwd: dir,
  });
  return readFileSync(out);
}

/** The Subsystem field of a PE file's optional header. */
function peSubsystem(file: string): number {
  const image = readFileSync(file);
  const pe = image.readUInt32LE(0x3c);
  expect(image.subarray(pe, pe + 4)).toEqual(Buffer.from("PE\0\0", "latin1"));
  return image.readUInt16LE(pe + 24 + 68);
}

describe("the resource file", () => {
  test("the app manifest resource is byte-identical to llvm-rc's", () => {
    const expected = llvmRc("manifest", `1 24 "app.manifest"\n`, {
      "app.manifest": APP_MANIFEST_XML,
    });
    expect(Buffer.from(appManifestResource())).toEqual(expected);
  });

  test("data that is not a whole number of DWORDs is padded like llvm-rc pads it", () => {
    const data = new Uint8Array([1, 2, 3]);
    const expected = llvmRc("three", `1 24 "three.bin"\n`, {
      "three.bin": data,
    });
    expect(
      Buffer.from(resourceFile([{ type: 24, id: 1, data: data }]))
    ).toEqual(expected);
  });
});

describe("an [app] executable on Windows", () => {
  test("links as a console program carrying exactly the detached-console manifest", () => {
    const res = join(dir, "app.res");
    writeFileSync(res, appManifestResource());
    writeFileSync(
      join(dir, "tiny.c"),
      "int mainCRTStartup(void) { return 0; }\n"
    );
    const target = "--target=x86_64-pc-windows-msvc";
    execSync(`${tool("clang")} ${target} -c tiny.c -o tiny.obj`, { cwd: dir });
    // The way prepareCCompile links an [app]: the object, then these flags.
    // No C runtime here, so the entry point is named; haze's real links get
    // it from the CRT.
    execSync(
      `${tool("clang")} ${target} -fuse-ld=lld -nostdlib tiny.obj -o tiny.exe ` +
        `-Wl,/entry:mainCRTStartup ${windowsAppLinkFlags(res).join(" ")}`,
      { cwd: dir }
    );
    const exe = join(dir, "tiny.exe");

    const IMAGE_SUBSYSTEM_WINDOWS_CUI = 3;
    expect(peSubsystem(exe)).toBe(IMAGE_SUBSYSTEM_WINDOWS_CUI);

    const resources = execSync(
      `${tool("llvm-readobj")} --coff-resources "${exe}"`,
      {
        encoding: "utf8",
      }
    );
    expect(resources).toContain("Total Number of Resources: 1");
    expect(resources).toContain("Type: MANIFEST (ID 24)");
    expect(resources).toContain("Name: (ID 1)");
    expect(resources).toContain(
      `DataSize: ${Buffer.byteLength(APP_MANIFEST_XML)}`
    );
    expect(readFileSync(exe).includes(Buffer.from(APP_MANIFEST_XML))).toBe(
      true
    );
  });

  test("is exactly an executable that declares an [app] table", () => {
    const app = { appId: "io.example.App", displayName: "App", categories: [] };
    expect(isWindowsApp({ moduleType: ModuleType.Executable, app: app })).toBe(
      true
    );
    expect(
      isWindowsApp({ moduleType: ModuleType.Executable, app: undefined })
    ).toBe(false);
    expect(isWindowsApp({ moduleType: ModuleType.Library, app: app })).toBe(
      false
    );
  });
});
