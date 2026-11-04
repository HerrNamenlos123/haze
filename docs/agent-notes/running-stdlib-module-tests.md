# Running stdlib module test programs

The .hz files under stdlib/<module>/tests/ are standalone programs; run one from a throwaway exe project, not with `haze exec`.

Verified 2026-11-04 against d35a505e. (single-file/dependency behaviour read in src/ProjectCompiler/ProjectCompiler.ts; example paths corrected)

- Each file is a standalone `fn main(): int` program (the header of each says how to run it). scripts/run-tests.sh drives testsuite/ (compiler cases) and tests/stdlib-paths/headless, not these.
- `haze exec <file>` cannot run them: dependency resolution is skipped for single-file mode (ProjectCompiler.ts: "Load explicit deps recursively (project builds only)"), so any `import ui_components` fails with H2007 "No such module".
- Recipe: make a throwaway exe project inside the repository, list the module's dependencies in its haze.toml by hand (check the module's own haze.toml for transitive needs), copy the test in as `src/main.hz`, and run `bun run src/main.ts run --dir <project>`. One project can be reused for every test of the same module. Dependency `path` values are joined onto the dependent's base directory (`join(depBaseDir, dep.path)`), so an absolute path is NOT usable; use a relative path such as `../stdlib/x`.
- codeeditor has its own headless suites: `CODEEDITOR_SELFTEST=1|fast|lsp` on the built binary or `run --dir codeeditor` (see codeeditor/src/*_selftest.hz).
