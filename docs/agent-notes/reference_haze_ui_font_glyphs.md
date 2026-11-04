# The text renderer has no glyph fallback

A character the inherited font does not cover is drawn as a tofu box; check font coverage for every non-ASCII literal that reaches `ui.text`/`label:`.

Verified 2026-11-04 against d35a505e. (font registration checked in codeeditor/src/main.hz; glyph lists are from the original cmap inspection and were not re-run)

- codeeditor registers `test/Roboto-Regular.ttf` (896 glyphs) as the `"default"` font, which the title bar, tab strip and menus inherit, and `JetBrainsMonoNerdFont-Regular.ttf` (9861 glyphs), which only the editor body sets.
- Roboto lacks, among others, U+25CF, U+25CB, U+2713, U+2714, U+2705, U+25AA, U+2023, U+2192. It has U+2022, U+00B7, U+00D7, U+00BB, U+221A, U+2039/U+203A, U+2020. The unsaved-tab marker (stdlib/tabs) and the dropdown current-item marker (stdlib/ui_widgets) therefore use U+2022.
- U+0009 TAB has no glyph in any font and the renderer does not expand it, so a literal tab draws as tofu. That is why codeeditor indents with spaces (`indentString()` in codeeditor/src/settings.hz sets `vim.indentUnit`). Visual tab expansion is not implemented, so a file containing tabs shows boxes.
- Check coverage by parsing the font's cmap directly (format 4 for Roboto, format 12 for the Nerd Font); there is no CLI for it. Find candidates with `grep -nP '(text|label|shortcut)\s*:\s*f?"[^"]*[^\x00-\x7F]' --include=*.hz -r`.
