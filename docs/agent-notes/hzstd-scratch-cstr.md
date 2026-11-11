# hzstd: per-call C strings live on the stack, not the GC

Copies that only live inside one C function use `HZSTD_SCRATCH_CSTR` (stack up to 512 B, else malloc, auto-freed), never the GC.

Verified 2026-11-04 against d35a505e. (macro, header and test file checked; allocation counts are from the original measurement)

- `HZSTD_SCRATCH_CSTR(name, str)` (`stdlib/core/src/hzstd/include/hzstd_string.h`): stack buffer up to `HZSTD_SCRATCH_CSTR_INLINE` (512) bytes, exact malloc beyond, freed by `__attribute__((cleanup))` on every return path (clang, Linux and Windows). Use it for any path or C string an OS call needs only for the duration of the call; prefer length-delimited APIs where they exist.
- errno messages: `hzstd_fs_errno_message` (`hzstd_filesystem.c`) returns a view of glibc's immutable `strerrordesc_np` table, declared manually because hzstd is ONE unity TU (`_GNU_SOURCE` would come too late). `strerror()` views are unsafe.
- Linux spawn: argv and envp are one malloc block each, built before the pipes; output is read into an unscanned GC block grown by `GC_realloc`.
- Windows spawn: `stdlib/core/src/hzstd/src/hzstd_win_cmdline.h` (no windows.h, testable on Linux) measures then writes the whole command line in one malloc. No Windows compiler is available on the dev machine: keep Windows-only edits minimal.
- `fs.CopyOptions` and `ffi.hzstd_fs_copy_options_t` are value structs; the C copy/move functions take them by value.
- Tests: `testsuite/src/cases_runtime_scratch_strings.hz`. Remaining C-string clones and process-option allocations are tracked in the project's issue list.
