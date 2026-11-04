# Build result can depend on file order and project name (eager struct method elaboration)

Generic struct instantiations reached at the root elaborate every non-generic method eagerly, so an unserialisable instantiation can break a build depending on elaboration order.

Verified 2026-11-04 against d35a505e. (mechanism read at src/Semantic/Elaborate.ts ~6258; found 2026-09-29, not known fixed)

- `instantiateAndElaborateStruct` runs `elaborateMethodsAndTypedefsOfStruct` (every non-generic method) when an instantiation is first reached or cache-hit with an empty `elaborationRecursiveStructStack`; reached as a member type it stays lazy. Which one happens depends on elaboration order.
- That order depends on `readdir()` order (`collectDirectory` in src/ModuleCompiler/ModuleCompiler.ts uses unsorted `readdirSync`) and, as observed, on the project's name/id: byte-identical haze-notes sources in the same file order failed as project `hntest_tmp` and built as `haze-notes`. An unrelated edit can flip a build.
- `LinearMap<K,V>.toJson()` unconditionally instantiates `json.encodeToJsonNode<V>`; eager elaboration for a V that cannot be serialised (`LinearMap<str, mut Tile>` reaches wgpu enums) fails with H7015 although nothing serialises it. `[[json.ignore]]` does not help: toJson on the map type itself is the problem.
- Candidate fix (not implemented): the C++ template rule, elaborating non-operator methods of generic INSTANTIATIONS only on use. Named methods and constructors already resolve on demand from the collected scope; operator overloads scan the elaborated `.methods` list (`ensureOperatorOverloadsElaborated` exists for subscript only), so operators would stay eager.
- `static_assert` failures throw without an elaboration backtrace.
- Harness workaround: build a copy under haze-notes' real name/id from a separate cwd so it gets its own `__haze__` (not /tmp): `<repo>/.hnbuild_tmp/` with a `compiler` symlink, copied `__haze__/haze-parser/{.source-hash,bin/haze-parser}`, absolute stdlib paths in haze.toml, files created in haze-notes' `ls -U` order (btrfs lists in creation order, tmpfs in reverse).
