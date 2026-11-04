// The command that runs clang with `args`.
//
// On Windows every command haze runs goes through cmd.exe (execAsync spawns
// with shell: true), and cmd.exe refuses a command line over 8191 characters
// ("The command line is too long"). A module's compile and link commands grow
// with every dependency: an include directory, two library directories and an
// archive per module (claude-account-switcher's release link was 6.3K
// characters on Linux, and more on Windows). So on Windows the arguments go
// into a response file, which clang reads itself: no length limit at all.
// --rsp-quoting=windows makes clang split the file by the rules it splits its
// Windows command line by, so every argument means exactly what it meant on
// the command line; clang's default for a response file (also on Windows) is
// GNU quoting, which drops the backslashes of Windows paths.
//
// Linux has no such limit (ARG_MAX is megabytes) and keeps the plain command.
// compile_commands.json always gets the plain command: editors read it.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Platform } from "../shared/HostPlatform";

/** Writes `responseFile` on Windows, where the command reads `args` from it. */
export function clangCommand(
  clang: string,
  args: string,
  responseFile: string,
  platform: Platform
): string {
  if (platform !== Platform.Win32) {
    return `"${clang}" ${args}`;
  }
  mkdirSync(dirname(responseFile), { recursive: true });
  writeFileSync(responseFile, args);
  return `"${clang}" --rsp-quoting=windows @"${responseFile}"`;
}
