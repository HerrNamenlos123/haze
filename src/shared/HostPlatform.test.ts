import { describe, expect, test } from "bun:test";
import {
  Arch,
  detectHost,
  fiberTargetMacro,
  Platform,
  platformName,
  UnsupportedHostError,
} from "./HostPlatform";

describe("detectHost", () => {
  test("the four supported hosts", () => {
    expect(detectHost("linux", "x64")).toEqual({
      platform: Platform.Linux,
      arch: Arch.X64,
    });
    expect(detectHost("linux", "arm64")).toEqual({
      platform: Platform.Linux,
      arch: Arch.Arm64,
    });
    expect(detectHost("win32", "x64")).toEqual({
      platform: Platform.Win32,
      arch: Arch.X64,
    });
    expect(detectHost("win32", "arm64")).toEqual({
      platform: Platform.Win32,
      arch: Arch.Arm64,
    });
  });

  test("everything else is refused with a clear message", () => {
    const refused: [string, string, RegExp][] = [
      ["darwin", "arm64", /macOS is not supported/],
      ["darwin", "x64", /macOS is not supported/],
      ["freebsd", "x64", /runs 'freebsd'/],
      ["linux", "ia32", /32-bit CPU \('ia32'\)/],
      ["linux", "arm", /32-bit CPU \('arm'\)/],
      ["win32", "ia32", /32-bit CPU/],
      ["linux", "riscv64", /'riscv64' CPU/],
      ["linux", "ppc64", /'ppc64' CPU/],
    ];
    for (const [platform, arch, message] of refused) {
      expect(() => detectHost(platform, arch)).toThrow(UnsupportedHostError);
      expect(() => detectHost(platform, arch)).toThrow(message);
      expect(() => detectHost(platform, arch)).toThrow(
        /Linux and Windows on x86-64 and on 64-bit ARM/
      );
    }
  });
});

test("platform names", () => {
  expect(platformName(detectHost("linux", "x64"))).toBe("linux-x64");
  expect(platformName(detectHost("linux", "arm64"))).toBe("linux-arm64");
  expect(platformName(detectHost("win32", "x64"))).toBe("win32-x64");
  expect(platformName(detectHost("win32", "arm64"))).toBe("win32-arm64");
});

test("fiber.h target macros", () => {
  expect(fiberTargetMacro(detectHost("linux", "x64"))).toBe(
    "FIBER_TARGET_LINUX_X64"
  );
  expect(fiberTargetMacro(detectHost("linux", "arm64"))).toBe(
    "FIBER_TARGET_LINUX_ARM64"
  );
  expect(fiberTargetMacro(detectHost("win32", "x64"))).toBe(
    "FIBER_TARGET_WIN32_X64"
  );
  expect(fiberTargetMacro(detectHost("win32", "arm64"))).toBe(
    "FIBER_TARGET_WIN32_ARM64"
  );
});
