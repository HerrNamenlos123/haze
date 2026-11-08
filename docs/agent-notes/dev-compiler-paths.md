# Dev compiler: run from the repo root; embed paths

The dev compiler finds its native parser relative to the current directory, and `embed.*` paths resolve against the module's root, not the source file.

Verified 2026-11-04 against 3165b22f.

- **Run from the repo root.** `src/main.ts:352` passes `process.cwd()` to `setParserMode()` as the repo root, and src/Parser/NativeParser.ts locates `compiler/haze-parser` and its `__haze__/haze-parser/.source-hash` stamp under that root. From a subdirectory the parser is not found. Build a project with `NODE_ENV=development bun run src/main.ts build --dir <project> --quiet` from the repo root.
- **`embed.*("path")` resolves against the module root.** `resolveEmbedArgumentPath()` (src/Semantic/Elaborate.ts:1245) resolves the literal against `currentModuleRootDir`, which `build()` sets to the directory of the module's config file, its `haze.toml` (src/ModuleCompiler/ModuleCompiler.ts:2391; the cwd when there is none). A path written relative to the `.hz` file is wrong unless that file sits next to `haze.toml`.
