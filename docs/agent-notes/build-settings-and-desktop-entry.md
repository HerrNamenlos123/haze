# Build settings, [app] desktop entry, [scripts]

`--release` is a preset over independent build settings; the compiler exposes them to Haze code, writes a `.desktop` entry for `[app]`, and runs `[scripts]` entries.

Verified 2026-11-04 against d35a505e.

- `src/shared/BuildSettings.ts`: independent `optimize` (-O3), `debug` (debug features), `debugInfo` (-g). `--release` only presets optimize on, debug off, debugInfo off (and `main.ts` strips). Each part is overridable (`--debug`, `--debug-info`, `--no-debug-info`, `--no-strip`, ...). Code must test the specific setting (`build.debug`), never "is release".
- Exposure: the compiler writes `build_settings.hz` (`BUILD_SETTINGS_FILENAME`) into every module's build directory, unexported, because a module's interface carries no constants to its dependents. `embed.watchTextIf(build.debug, ...)` and `if comptime build.debug` work.
- `[app]` table: `getApp` in `src/shared/Config.ts`; `src/ProjectCompiler/DesktopEntry.ts` writes the desktop entry next to the Linux binary.
- `[scripts]`: `src/ProjectCompiler/Scripts.ts`; `haze <name>` for a non-built-in name runs the shell command in the project dir. `HAZE_SCRIPT_STACK` guards self-recursion.
- TOML parsing (`Config.ts`) needs j-toml `joiner: "\n"`, or multi-line TOML strings fail.
- A stripped release binary's panic trace has empty frame names (the message still prints).
