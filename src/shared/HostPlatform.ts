/**
 * The platform Haze compiles for: always the machine it runs on. Linux and Windows, each on
 * x86-64 and 64-bit ARM. Everything else is refused here, before any build starts.
 */

export enum Platform {
  Win32 = 0,
  Linux = 1,
}

export enum Arch {
  X64 = 0,
  Arm64 = 1,
}

export type HostPlatform = { platform: Platform; arch: Arch };

export class UnsupportedHostError extends Error {}

/** Maps Node's process.platform / process.arch to a supported host, or throws a clear error. */
export function detectHost(platform: string, arch: string): HostPlatform {
  const supported =
    "Haze supports Linux and Windows on x86-64 and on 64-bit ARM (AArch64).";
  let p: Platform;
  if (platform === "linux") {
    p = Platform.Linux;
  } else if (platform === "win32") {
    p = Platform.Win32;
  } else if (platform === "darwin") {
    throw new UnsupportedHostError(`${supported} macOS is not supported yet.`);
  } else {
    throw new UnsupportedHostError(
      `${supported} This machine runs '${platform}', which is not supported.`
    );
  }
  let a: Arch;
  if (arch === "x64") {
    a = Arch.X64;
  } else if (arch === "arm64") {
    a = Arch.Arm64;
  } else {
    const what =
      arch === "ia32" || arch === "arm"
        ? `a 32-bit CPU ('${arch}')`
        : `a '${arch}' CPU`;
    throw new UnsupportedHostError(
      `${supported} This machine has ${what}, which is not supported.`
    );
  }
  return { platform: p, arch: a };
}

/** The name builds use for a host, e.g. in output file names and library metadata. */
export function platformName(host: HostPlatform) {
  const os = host.platform === Platform.Linux ? "linux" : "win32";
  const cpu = host.arch === Arch.X64 ? "x64" : "arm64";
  return `${os}-${cpu}` as
    | "linux-x64"
    | "linux-arm64"
    | "win32-x64"
    | "win32-arm64";
}

/**
 * The macro that selects the implementation of stdlib/core/src/fiber/fiber.h. The library takes
 * its target only from this, never from compiler predefines (it cross-checks them).
 */
export function fiberTargetMacro(host: HostPlatform) {
  const os = host.platform === Platform.Linux ? "LINUX" : "WIN32";
  const cpu = host.arch === Arch.X64 ? "X64" : "ARM64";
  return `FIBER_TARGET_${os}_${cpu}`;
}
