// The desktop entry of an executable that declares an [app] table: what the
// Linux desktop lists and launches. It is written next to the binary, together
// with the icon, so installing the app is copying those files:
//
//   bin/<name>            -> ~/.local/bin/
//   bin/<appId>.desktop   -> ~/.local/share/applications/
//   bin/<appId>.<ext>     -> ~/.local/share/icons/hicolor/<size>/apps/
//
// Exec names the binary instead of a path, because where it gets copied to is
// not known here: it is found on PATH like any other installed program.

import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { ModuleConfig } from "../shared/Config";
import { GeneralError } from "../shared/Errors";

// Escapes for a desktop entry string value.
function escapeValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t")
    .replaceAll("\r", "\\r");
}

export function writeDesktopEntry(config: ModuleConfig, binDir: string): void {
  const app = config.app;
  if (!app) {
    return;
  }

  const lines = [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${escapeValue(app.displayName)}`,
  ];
  if (config.description) {
    lines.push(`Comment=${escapeValue(config.description)}`);
  }
  lines.push(`Exec=${config.name}`);

  if (app.icon !== undefined) {
    if (!existsSync(app.icon)) {
      throw new GeneralError(
        `The icon of app '${app.appId}' does not exist: ${app.icon}`
      );
    }
    // Named after the app, which is how Icon= finds it once it is in an icon
    // theme directory.
    copyFileSync(app.icon, join(binDir, app.appId + extname(app.icon)));
    lines.push(`Icon=${app.appId}`);
  }

  lines.push("Terminal=false");
  if (app.categories.length > 0) {
    lines.push(`Categories=${app.categories.map(escapeValue).join(";")};`);
  }
  // Nothing sets a window app id yet, so SDL uses the executable's name; this
  // is what lets the desktop match the running window back to this entry.
  lines.push(`StartupWMClass=${config.name}`);

  writeFileSync(join(binDir, `${app.appId}.desktop`), lines.join("\n") + "\n");
}
