# Building Haze projects in extra git worktrees

A fresh worktree lacks gitignored build inputs; reflink-copy them from the main checkout to avoid a cold multi-minute wgpu/SDL build.

Verified 2026-11-04 against d35a505e. (existence of the paths checked; timings and the CMake detail were observed on 2026-10-01 and not re-run)

A worktree lacks everything gitignored that the dev compiler needs:
- `node_modules`: a symlink to the main checkout's is enough.
- `src/Parser/grammar/autogen` (and `.antlr`): without it, `Cannot find module './grammar/autogen/HazeLexer'`.
- `stdlib/tesselate/lyon/target`: the Rust build output.
- `__haze__`: ~3.5 GB; a cold one re-clones and builds wgpu-native and SDL.

Recipe (main checkout = the repo root):
1. `git worktree add --detach .claude/worktrees/<name> HEAD`.
2. Copy each directory above with `cp -a --reflink=always` (btrfs: instant, no extra space); symlink node_modules.
3. `rm -rf __haze__/sdl/bin/SDL/build` in the copy: its CMakeCache.txt holds the main checkout's absolute paths and makes the SDL generator fail ("CMakeCache.txt directory ... is different"); the first build then reconfigures SDL once. wgpu needed nothing.
4. Build from the worktree root with the dev compiler: `bun run src/main.ts build --dir <project> --quiet` (not the installed `haze` binary). A separate cwd also avoids [[shared-haze-workspace-rebuild-pingpong]]. A haze-notes build then took 29 s.

Collect uncommitted work: `git -C <wt> diff HEAD` plus `git -C <wt> ls-files --others --exclude-standard`. Remove with `git worktree remove --force` (the copied caches are untracked).
- Trap (2026-11-11): the dev compiler writes a project's binary to `<repo>/__haze__/<project>/bin/<project>`. A `<project>/__haze__/<project>/bin/` (haze-notes has one in the main checkout, from the installed `haze build` run inside the project) is NOT rebuilt by it; reflinked into a worktree it is a stale binary that looks current. Run the binary from the repo-root `__haze__`, and delete the copied `<project>/__haze__/<project>` in a worktree.
