# dwarfline: hzstd's own DWARF line-table reader

The profiler's file:line per frame on Linux comes from `stdlib/core/src/dwarfline/dwarfline.h`, a single-header reader tested against llvm-dwarfdump; libdwarf, zlib and zstd are no longer linked.

Verified 2026-11-23 against main 9f6dcca4 plus the uncommitted change (Windows only; the Linux run is pending).

- Contract, coverage and gaps: `stdlib/core/src/dwarfline/README.md`. Single header like fiber.h; `DWARFLINE_IMPLEMENTATION` is defined in `hzstd_profiling.c` (Linux block), the only user (`hzstd_profiling_dwarf_build_line_table`: mmap of /proc/self/exe, file paths resolved once per unit, rows into the same sorted table libdwarf used to fill).
- Tests: `bun stdlib/core/src/dwarfline/tests/run.ts`, in `scripts/run-tests.sh` after the suite so it sees every case executable. Oracle: the pinned LLVM's llvm-dwarfdump (every unit, directory, file, row) and llvm-symbolizer (resolved paths, DWARF 5 units, rows with a unique address). Fixtures are cross-built with the pinned clang (`-ffreestanding -nostdlib -static -fuse-ld=lld`), so they run on Windows too; real ELF executables only exist on Linux.
- Traps found building it: a `SHT_NOBITS` section (`.relro_padding` on PowerPC) has an offset and size past the end of the file, so only the sections actually read may be bounds checked; llvm-dwarfdump prints `address_size` only for version 5 units; llvm-symbolizer 18 has no `--relative-address`.
- libunwind is built with `--disable-zlibdebuginfo` (marker `libunwind-v2`): with zlib gone from the link, an auto-enabled zlib path in libunwind would no longer link. `-llzma` (libunwind's `.gnu_debugdata` names) stays a system library by the user's decision.
