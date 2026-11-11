# File locks (fs.tryLockFile, fs.lockFile)

An exclusive lock on a file that the system drops when its holder dies, however it dies; for programs that share a file.

Verified 2026-11-11 against d341d7f0 plus the uncommitted startup work (stdlib/core/tests/filelock-tests.hz, Linux only).

- API (`stdlib/core/src/filesystem.hz`): `fs.tryLockFile(path): Result<fs.FileLock, fs.Error>` (never waits; `fs.Error.Busy` when held), `fs.lockFile(path, timeoutSeconds)` (retries every 1 ms, Busy after the timeout: a stopped holder keeps it), `FileLock.unlock()` (idempotent), `held()`. `FileLock` is a ref struct: copies are the same lock. The file is created empty, with its folders.
- C (`hzstd_filesystem.c` `hzstd_file_lock` / `hzstd_file_unlock`): Linux `open(O_RDWR|O_CREAT|O_CLOEXEC)` + `flock(LOCK_EX[|LOCK_NB])`, EINTR retried; Windows `CreateFileW` (UTF-8 path, NULL security attributes = not inheritable) + `LockFileEx` on byte 0. The lock belongs to the open file description / handle, so process death releases it. Windows path NOT run yet.
- Only other locks are excluded; reading and writing the file are not. Two locks in one process exclude each other (own descriptor each).
- Never delete a lock file: a holder that unlinked it lets the next holder lock a new inode of the same name while a third still waits on the old one.
- Without O_CLOEXEC a child started while holding keeps the lock alive after the parent unlocks; the test for it fails then (checked by dropping the flag).
- Tests: `scripts/run-stdlib-test.sh stdlib/core/tests/filelock-tests.hz`: in-process exclusion and timeout, a child that unlocks, panics, or is killed holding it, and a child started while holding.
