# haze-notes: create notes/folders, keep rule, show-all, trash

Mouse/pen creation of notes and folders, the `.hznotekeep` rule, show-all-files ghosts, delete to trash and the "not a note" check.

Verified 2026-11-04 against d35a505e. (symbols checked in `haze-notes/src`; sizes/timings are from the original build)

- Index rule (`vault.hz` `VaultWalk(root, everything, usage)`, `KEEP_FILE = ".hznotekeep"`; re-checked 2026-11-11 against d341d7f0 plus the uncommitted startup work): a folder is shown iff it holds a note at any depth OR a direct `.hznotekeep` FILE. Dot-folders stay hidden even in show-all; keep files are never listed. Show-all marks the rest ghost (`IndexEntry.ghost`); an `everything` walk gives both `index(true)` and `index(false)`, which equals the notes index (tests), so a show-all refresh walks once and the cached index never has ghosts.
- Create: `createNote` uses `fs.createBinary` (O_EXCL, never overwrites), content `newNoteBytes()` (an .hznote). `createFolder` errors if the folder is already shown, else mkdir + keep file. Names are trimmed; rejected: `/ \ < > : " | ? *`, control chars, "." "..", a folder name starting or ending with "."; ".hznote" is appended unless present; Windows device names and the bare name ".hznote" are refused (`entryNameError`). Entry paths split at "/" only (`entryName`). Creating in a folder deleted outside the app is an error (`missingFolderError`), never a recreate.
- UI: ContextMenu / MenuRow / NameDialog / DeleteDialog are each their own root over Workspace (not slots). Header: new-file, new-folder, eye toggle (`VaultCache.showAllFiles`, persisted), collapse, refresh. Workspace swallows editor keys while a menu/dialog is open; Escape closes.
- Delete: confirm dialog, then `currentDocumentPath := none` and an onFrame waits until `controls.isUsing(path)` is false (open, loading, saving) before `fs.moveToTrash` (freedesktop trash / Recycle Bin, never deletes for good).
- Not a note: `DocumentLoad` reads `fs.readHead(path, 16)` first; `isHznote` (`hznote.hz`) = the 8-byte magic. Not a note: "This file is not a note"; magic present but decoding fails: the `binfile.Error.problem` picks the hint (newer Haze Notes / incompatible / damaged, with `describe()`). Load failures say why (`DocumentLoad.hint`).
- `hzstd_file_open_read` (FileReader, `readHead`) opens O_NONBLOCK and keeps only regular files (a FIFO listed in show-all froze the UI).
- Pen right click = tip contact with the barrel held, reported as button Right by `app.PenContacts`.
- Tests: `haze-notes/tests` (vault-create, filetree, document-load), `stdlib/app/tests/pen-contacts-tests.hz`, `testsuite` cases_fs_file_ops / cases_fs_trash.
- Open (original note): a palm resting 0.5 s on the tree opens the menu and the dismissing press eats the next pen stroke.
