// How an [app] executable is linked on Windows.
//
// Windows knows two kinds of programs. A GUI-subsystem program never gets a
// console: started from a terminal it is not attached to it, everything it
// prints is dropped, and the shell does not even wait for it. A
// console-subsystem program behaves like a program on Linux in a terminal,
// but started from Explorer, autostart or a parent without a console it gets
// a console window of its own. An app needs both: no console window when it
// is opened like an app, and working output, waiting and exit codes when it
// runs from a terminal or is called by another program (a credential helper
// that prints a token, a script).
//
// Windows 11 24H2 (build 26100) and later have exactly that: a
// console-subsystem program whose manifest sets consoleAllocationPolicy to
// "detached" is given the terminal it starts in, and no console when there is
// none. https://learn.microsoft.com/en-us/windows/console/console-allocation-policy
// (Older Windows ignore the setting; there such an app opens a console window
// when started from Explorer.)
//
// So every [app] executable is linked as a console program with that
// manifest, and a module must not pick a subsystem of its own (Config.ts
// refuses it). Never "fix" missing output by linking an app as a GUI program:
// that is the bug this file removes.
//
// The manifest is embedded as a resource. The compiler writes the resource
// file itself, so a Windows build needs no resource compiler or manifest tool;
// lld-link turns a .res file it is given into the executable's resource
// section. The bytes are what llvm-rc writes for `1 24 "app.manifest"`
// (WindowsAppManifest.test.ts compares them).

import type { ModuleConfig } from "../shared/Config";
import { ModuleType } from "../shared/Config";

export const APP_MANIFEST_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <application>
    <windowsSettings>
      <consoleAllocationPolicy xmlns="http://schemas.microsoft.com/SMI/2024/WindowsSettings">detached</consoleAllocationPolicy>
    </windowsSettings>
  </application>
</assembly>
`;

const RT_MANIFEST = 24;
// The manifest Windows reads when it creates the process of an executable.
const CREATEPROCESS_MANIFEST_RESOURCE_ID = 1;
// What llvm-rc and rc.exe write by default: MOVEABLE | PURE, US English.
const MEMORY_FLAGS = 0x00_30;
const LANGUAGE_EN_US = 0x04_09;

export type Resource = {
  type: number;
  id: number;
  data: Uint8Array;
};

const HEADER_SIZE = 32;

function alignToDword(n: number): number {
  return Math.ceil(n / 4) * 4;
}

// One RESOURCEHEADER (numeric type and name, so a fixed 32 bytes), followed by
// the data, padded to a DWORD boundary.
function writeEntry(
  out: Buffer,
  offset: number,
  type: number,
  id: number,
  data: Uint8Array,
  memoryFlags: number,
  language: number
): number {
  out.writeUInt32LE(data.length, offset); // DataSize
  out.writeUInt32LE(HEADER_SIZE, offset + 4); // HeaderSize
  out.writeUInt16LE(0xff_ff, offset + 8); // TYPE is a number...
  out.writeUInt16LE(type, offset + 10);
  out.writeUInt16LE(0xff_ff, offset + 12); // ...and so is NAME
  out.writeUInt16LE(id, offset + 14);
  out.writeUInt32LE(0, offset + 16); // DataVersion
  out.writeUInt16LE(memoryFlags, offset + 20);
  out.writeUInt16LE(language, offset + 22);
  out.writeUInt32LE(0, offset + 24); // Version
  out.writeUInt32LE(0, offset + 28); // Characteristics
  out.set(data, offset + HEADER_SIZE);
  return offset + HEADER_SIZE + alignToDword(data.length);
}

/** A .res file holding `resources`, after the empty entry every .res starts with. */
export function resourceFile(resources: Resource[]): Buffer {
  const size = resources.reduce(
    (total, r) => total + HEADER_SIZE + alignToDword(r.data.length),
    HEADER_SIZE
  );
  const out = Buffer.alloc(size);
  let offset = writeEntry(out, 0, 0, 0, new Uint8Array(0), 0, 0);
  for (const r of resources) {
    offset = writeEntry(
      out,
      offset,
      r.type,
      r.id,
      r.data,
      MEMORY_FLAGS,
      LANGUAGE_EN_US
    );
  }
  return out;
}

/** The .res file that embeds APP_MANIFEST_XML as the process manifest. */
export function appManifestResource(): Buffer {
  return resourceFile([
    {
      type: RT_MANIFEST,
      id: CREATEPROCESS_MANIFEST_RESOURCE_ID,
      data: Buffer.from(APP_MANIFEST_XML, "utf8"),
    },
  ]);
}

/** Is this module linked as an app (see above) when built on Windows? */
export function isWindowsApp(
  config: Pick<ModuleConfig, "moduleType" | "app">
): boolean {
  return (
    config.moduleType === ModuleType.Executable && config.app !== undefined
  );
}

/** What an app's link adds on Windows, given where its .res file is. */
export function windowsAppLinkFlags(resourcePath: string): string[] {
  return [`"${resourcePath}"`, "-Wl,/SUBSYSTEM:CONSOLE"];
}

/** A linker flag that would choose the Windows subsystem itself. */
export function isSubsystemFlag(flag: string): boolean {
  return /\/subsystem:/i.test(flag);
}
