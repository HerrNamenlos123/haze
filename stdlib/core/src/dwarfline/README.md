# dwarfline: DWARF line tables, read by hzstd itself

`dwarfline.h` reads the line tables (`.debug_line`) of an ELF image in memory: for every
instruction address the program states, its file, line and column. hzstd's profiler uses it on
Linux to name the source location of every sampled frame (`hzstd_profiling.c`,
`hzstd_profiling_dwarf_build_line_table`). Windows reads PDBs through dbghelp instead.

It replaces libdwarf (2026-11-23). libdwarf came from the distribution, unpinned, and its API
differs between versions: Ubuntu 22.04's libdwarf 20210528 has another `dwarf_init_path` than the
0.x series, so hzstd did not compile there. It also pulled in zlib and zstd. This library is part
of the repository, so its version is the commit's, and it needs nothing but a C11 compiler.

## Contract

* Single header like `fiber.h`: include it for the declarations; define `DWARFLINE_IMPLEMENTATION`
  in exactly one translation unit for the code (hzstd does it in `hzstd_profiling.c`).
* Freestanding C11 (`stdint.h`, `stddef.h`, `stdbool.h`, `string.h`). It never allocates and only
  reads inside the image it is given: every read is bounds checked, so a truncated or corrupt
  image gives an error code, never a crash.
* Errors are negative codes (`DWARFLINE_E_*`), each with one meaning; nothing is guessed.
* The rows are exactly what the line-number program states, in program order, with the register
  widths LLVM uses (`DWARFDebugLine::Row`): line 32 bits, column and file 16, ISA and op index 8.
* `dwarfline_file_path` joins a file's directory and name the way the program refers to it: an
  absolute name as it is, else its directory with it, a relative directory other than 0 itself
  joined to directory 0 (the compilation directory in DWARF 5), with `/` unless the part before
  ends in a separator.

## What is covered

* ELF64 and ELF32, little and big endian, executables and shared objects.
* `.debug_line` versions 2 to 5, 32- and 64-bit DWARF.
* Every standard and extended opcode of DWARF 5. Unknown standard opcodes are skipped by their
  declared operand count, unknown extended ones by their length, as the standard says.
* DWARF 5 entry formats with the forms `string`, `line_strp`, `strp`, `udata`, `sdata`,
  `data1/2/4/8/16` and the `block` forms; content types path, directory index and MD5 are read,
  the others skipped by their form.

## What is not covered

Each of these is reported as an error, never answered wrongly:

* Compressed sections (`SHF_COMPRESSED`, from `-gz`): `DWARFLINE_E_UNSUPPORTED`. Haze does not
  compress its debug info.
* The `strx` forms (they need `.debug_str_offsets`): `DWARFLINE_E_UNSUPPORTED`. No compiler emits
  them in line tables today.
* Relocatable objects (`.o`): `DWARFLINE_E_UNSUPPORTED`, their addresses are not final.
* Before DWARF 5, directory 0 is the compilation directory, which only `.debug_info` names. A file
  in it comes back as its bare name. Haze compiles with clang 18, which writes DWARF 5; only
  prebuilt objects such as the C runtime's start files can be older.

## Tests

```
bun stdlib/core/src/dwarfline/tests/run.ts          unit tests + fixtures + every ELF executable
bun stdlib/core/src/dwarfline/tests/run.ts --no-executables
```

Part of `scripts/run-tests.sh`, after the test suite, so it also sees every case it built. The
oracle is the pinned LLVM (`~/.haze/global/bin`), the same version on every machine.

* **Unit tests** (`tests/dwarfline_test.c`): hand-built line tables and ELF images. Every opcode,
  versions 2 to 5, DWARF64, VLIW operation indices, big endian, unknown opcodes, every error code,
  path joining, a `SHT_NOBITS` section outside the image, and every truncated prefix of every
  image (an error code, never a read past it; on Linux built with ASan and UBSan).
* **Fixtures** (`tests/fixtures/`): built here with the pinned clang for x86-64, AArch64, i386,
  PowerPC64 and PowerPC (ELF64 and ELF32, both byte orders), DWARF 2 to 5 and DWARF64, `-O0` and
  `-O2`, with `#line` directives like Haze's. Every unit, directory, file and row is compared with
  `llvm-dwarfdump --debug-line`, and the resolved paths with `llvm-symbolizer`.
* **Real executables**: every ELF executable under `__haze__` and `testsuite/.work`, compared the
  same way. On Windows there are none (it builds PE files), and the runner says so.

`tests/dump.c` prints what the library reads in the line format the runner also derives from
`llvm-dwarfdump`, so a difference names the first line that differs.
