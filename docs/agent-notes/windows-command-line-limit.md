# Windows: compile and link run from response files

On Windows a module's compile and link commands pass their arguments in a response file
(`build-*/<name>-<platform>.compile.rsp` / `.link.rsp`), because every command haze runs goes
through cmd.exe, which refuses more than 8191 characters ("The command line is too long" /
"Die Befehlszeile ist zu lang").

Verified 2026-11-04 against db3dfe2a plus the change that added
`src/ModuleCompiler/ResponseFile.ts` (clang's own parse checked in `ResponseFile.test.ts`).

- `execAsync` spawns with `shell: true`, i.e. `cmd.exe /d /s /c "..."` on Windows.
- The commands grow with every dependency: one `-I` per module in the compile, two `-L` and
  one archive per module in the link. claude-account-switcher's release link was 100
  arguments and 6.3K characters on Linux (27 modules); Windows paths and system libraries
  pushed it past the limit.
- clang reads `@file` itself; `--rsp-quoting=windows` is required: clang's default for a
  response file is GNU quoting (also on a Windows host), which treats backslashes as escapes
  and turns `C:\out dir\app.exe` into `C:out dirapp.exe`. With Windows quoting the file means
  exactly what the command line meant. clang hands lld-link its own response file when needed.
- Linux keeps the plain command (no such limit). `compile_commands.json` always holds the
  plain command, for editors.
