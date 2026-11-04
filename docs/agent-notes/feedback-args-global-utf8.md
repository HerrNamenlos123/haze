# Command-line args: `sys.args()`, UTF-8, main takes none

Haze `main` never takes arguments; command-line args come from the global `sys.args(): []str`, guaranteed valid UTF-8.

Verified 2026-11-04 against d35a505e.

- `sys.args()` (`stdlib/core/src/system.hz`) builds the array from `ffi.hzstd_arg_count()` / `hzstd_arg_at(i)` (`hzstd_platform.h`). Windows: wide command line converted to UTF-8; Linux: bytes validated. The same applies to any future process-level input (environment, executable path).
- Never add parameters to Haze `main`: passing argv through main is the C mindset, and the Windows ANSI argv mangles non-ASCII paths, which is exactly what file-association launches pass in.
- Older notes that call `sys.args()` a stub are stale.
