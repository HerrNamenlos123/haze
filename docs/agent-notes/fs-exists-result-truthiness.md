# fs.exists returns a Result: its truthiness is Ok-ness

`if fs.exists(p)` tests only that the call succeeded, never the bool inside: it is true for a path that does not exist.

Verified 2026-11-04 against d35a505e. (probe: `bun run src/main.ts exec` on `if fs.exists("/definitely/not/here.txt")` took the true branch)

`fs.exists` returns `Result<bool, Error>` (`stdlib/core/src/filesystem.hz`). Extract the bool the way `readText` is unwrapped:

```haze
fn pathExists(path: str): bool {
    let result = fs.exists(path);
    return result ? result as bool : false;
}
```

Found in `codeeditor/src/workspace.hz` (the helper is there as `pathExists`; its guard had never fired before). Same shape to watch for on any other `Result<bool, E>` API.
