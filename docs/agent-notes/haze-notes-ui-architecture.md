# haze-notes UI architecture

Theme tokens, component list, the flat virtualized FileTree, keyed Workspace per vault, vault index rules, sidebar persistence, screenshot recipe.

Verified 2026-11-04 against d35a505e. (symbols checked; numbers are from the 2026-10-15 build)

- Theme (`theme.hz`): `struct Theme` of semantic role tokens; ONE palette `appTheme()` (charcoal chrome #2E2F33, desk #4D4E53, surface #393A3F, amber accent), read via `theme()`. Components write `bg-[theme().chrome]`, never colours. No theme switch, no light theme. Pages get an on-screen shadow (`render.hz` `drawPageShadow`).
- Components: UI (root, vault sessions) to AppBar (+WindowControls) / WelcomeScreen (+RecentVaultRow) / Workspace to Sidebar (+FileTree to FileTreeRow, EmptyState) + Splitter overlay + DocumentView (+Toolbar, SelectionToolbar, PenMenu, Surface, ColorSwatch, PenSizeButton, Divider, ProgressBar). IconButton is the app's own button.
- FileTree is a flat virtualized list (`filetree.hz`: flattenTree / treeWindow / folderChainTo; tests in `haze-notes/tests/filetree-tests.hz`). Rows are keyed by WINDOW SLOT (`key=[i]` in `FileTree.hzui`), not list position: the vendored Clay 0.13 never frees its 8192-entry element-id map, so position keys ran it full after ~790 rows scrolled past and the tree went blank (upstream prunes it in Clay_EndLayout; our fork has local patches: idAlias, CSS translate). Rows are exactly 28 px with no margin (a margin made scroll height depend on the window and flickered). A pre-watch on the exact content height calls `scroll.setMetrics` so a shrink clamps before the frame.
- Vault index (`vault.hz`): technicalsketcher.web's readVault rules: files whose name ends in `noteExtension` = ".hznote" (dot-files included; until 2026-11-11 technicalsketcher.web's rule, names CONTAINING ".tsk"), folders not starting with ".", empty folders pruned, in tsk's order (`compareVaultOrder`; in-place `array.sort` exists, do not add another sort). Still synchronous on the UI thread.
- Sessions: `Workspace for=[s in sessions] key=[s.id]`; the same dir keeps the same session. Replaced sessions get `CacheFile.close()` (unwatches); Workspace `onUnmount` saves, releases GPU resources and disarms its `onExit`.
- Sidebar: width/open in `VaultCache` (`sidepanelWidth` px, `sidepanelOpen`), width committed on Splitter's `end` emit, hidden (not unmounted) when collapsed, Ctrl+B. Keys are handled at the Workspace root (focusable).
- Cache path (`UI.hzui`): `$XDG_CACHE_HOME`, else `$HOME/.cache`, else `%LOCALAPPDATA%`, plus `/haze-notes/cache.json`.
- Screenshot sandbox: run the built binary with `XDG_CACHE_HOME=<scratch>/cache SDL_VIDEODRIVER=x11` and a scratch vault, never a real cache/vault (an exiting instance saves the open note).
- Related: [[hit-geometry-rules]], [[hzui-large-trees-and-recursion]], [[haze-notes-never-freeze-architecture]].
