# Windows apps: console program, detached console

haze links every executable with an `[app]` table on Windows as a console-subsystem program
with an embedded manifest that sets `consoleAllocationPolicy` to `detached`
(`src/ModuleCompiler/WindowsAppManifest.ts`). A GUI-subsystem build cannot print, and the
shell never waits for it.

Verified 2026-11-04 against 3c9c77d4 plus the change that added WindowsAppManifest.ts (the
resource bytes against llvm-rc, a PE linked through clang/lld-link against llvm-readobj, in
`WindowsAppManifest.test.ts`). The runtime behaviour on Windows is Microsoft's documented
semantics; it is not testable under Wine.

- Why not GUI subsystem (`-Wl,/SUBSYSTEM:WINDOWS`, what quick-todo and
  claude-account-switcher used before): such a process started from a terminal is not
  attached to it. `hzstd_print_str_stdout` is a plain `fwrite(..., stdout)`, so every write is
  dropped silently, also under a debugger. cmd, PowerShell and Windows Terminal do not wait
  for it and report success at once. Only explicitly passed handles work (`app.exe > out.txt`,
  a pipe such as Claude Code's apiKeyHelper capture).
- The manifest: `<consoleAllocationPolicy xmlns="http://schemas.microsoft.com/SMI/2024/WindowsSettings">detached</consoleAllocationPolicy>`
  in `<application><windowsSettings>`. With the console subsystem the shell waits and the
  program gets the terminal it starts in; the manifest stops Windows from creating a console
  window when there is none (Explorer, autostart, a parent without a console). Needs Windows
  11 24H2 (build 26100); older Windows ignore it and open a console window from Explorer.
  https://learn.microsoft.com/en-us/windows/console/console-allocation-policy
- How it is embedded: the compiler writes `<name>-<platform>.res` (RT_MANIFEST, id 1) next to
  the object file before the link check, and passes it plus `-Wl,/SUBSYSTEM:CONSOLE` to the
  link; lld-link converts a `.res` input itself, no rc.exe, mt.exe or libxml2 needed. The file
  is a link input, so a change relinks; identical bytes do not.
- `Config.ts` refuses a `/SUBSYSTEM:` linker flag in a module that declares `[app]`: haze owns
  that choice. A module without `[app]` (a CLI tool) stays a plain console program, which is
  what a CLI double-clicked in Explorer needs.
- Check a binary: the PE optional header's Subsystem field (2 = GUI, 3 = console);
  `llvm-readobj --coff-resources app.exe` lists the MANIFEST resource.
