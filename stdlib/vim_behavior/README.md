# Text editing: engine + behaviors

Two modules, plus a differential test harness that validates them against
real Neovim.

```
        UI (rendering, mouse, keyboard, IME, clipboard)
                          │  raw keys / committed text
                          ▼
        ┌──────────────────────────────────┐
        │  Behavior   (vim_behavior, ...)  │  modes, keymaps, operators
        └──────────────────────────────────┘
                          │  semantic commands
                          ▼
        ┌──────────────────────────────────┐
        │  Engine     (textedit_behavior)  │  text, selections, motions,
        └──────────────────────────────────┘  transactions, undo
```

`textedit_behavior` is the **editing engine**. It owns the text, the
selections, the motions, undo and the notion that modes exist. It owns no
keybindings: it does not know what `w` means, whether `d` waits for
another key, or that Vim exists at all.

`vim_behavior` is one **behavior** built on those primitives. It owns
modes, operator-pending state, counts, registers and keymaps. It is
entirely optional — the engine without it is an ordinary textbox.

Neither module renders anything. The engine exposes queries
(`cursorPosition`, `selectionRangeForLine`, `mode`, `scrollIntent`) and
the host draws whatever it likes.

## Using it

Plain textbox — no behavior, insert mode forever:

```haze
let ctx = textedit_behavior.Context({
    getLineLength: (i: int) => doc.lines[i].length(),
    getLine:       (i: int) => doc.lines[i],
    getLineCount:  () => doc.lines.length,
    getTimeInSeconds: () => ui.now(),
    replaceRange:  applyReplaceRange,
});
ctx.insertText(String("hello"));
```

The same engine with Vim on top:

```haze
let ctx = textedit_behavior.Context({ ...,
    initialMode: textedit_behavior.Mode.Normal });

let vim = vim_behavior.Vim(ctx);
vim.install();
vim_behavior.applyRemaps(vim, vim_behavior.defaultVimrc());

// The host funnels input in; the behavior decides what it means.
ctx.handleTextInput(event.text);          // printable characters
ctx.handleKey("<Esc>");                   // named / modified keys
```

`replaceRange(start, end, text)` is the single mutation primitive the
host must provide, and it must apply **synchronously** — the engine reads
the document back immediately afterwards.

### Remaps

Remaps are data, so they can come from a config file, a settings UI, or a
literal list. The mode letters and `<>` key notation are Vim's, so a real
vimrc translates line for line:

```haze
vim.addRemap("n", "j", "jzz");            // nnoremap j jzz
vim.addRemap("i", "jk", "<Esc>");         // inoremap jk <Esc>
vim.addRemap("n", "<space>aa", "ggVG");   // nnoremap <space>aa ggVG
```

The RHS is a full key sequence, not a single action, and `noremap`
(the default) stops it being re-expanded — which is what makes
`nnoremap j jzz` terminate instead of looping.

`defaultVimrc()` returns the maintainer's mappings as a ready-made
preset; it is also the exact configuration the test suite validates.

### Commenting

`gc` is a real operator, so `gcw`, `gcj`, `gc}`, `gcG`, visual `gc` and the
doubled `gcc` all work, and all take counts. It follows Neovim's own
built-in commenting exactly (Neovim 0.10+), including the parts that are
easy to get wrong: a range is *uncommented* only when every non-blank line
in it is already commented, the marker goes at the range's SMALLEST indent
so a block stays aligned, blank lines are ignored when deciding and when
measuring that indent but are still commented, and a range that is entirely
blank is left alone.

The syntax comes from `commentString`, which is Vim's `'commentstring'`:
one template with `%s` where the line goes. That single form covers line
comments and languages that only have block comments:

```haze
vim.commentString = "// %s";          // TypeScript, C, Haze
vim.commentString = "# %s";           // Python, YAML
vim.commentString = "<!-- %s -->";    // HTML, Vue templates
```

The padding is part of the template — `"//%s"` genuinely produces `//text`.
Uncommenting accepts either form, so a comment someone wrote as `//x` still
comes apart.

### Go to definition

`gd` calls `onGoToDefinition`, a host hook, and records a jump first so
`<C-o>` comes back. The engine has no idea what a language server is;
stock Vim's `gd` (a backwards search for the identifier) is not
implemented, because any host that can answer the question properly should.

### The jump list

`<C-o>` and `<C-i>` implement Vim's algorithm rather than an approximation
of it. Notably Vim does **not** truncate forward history on a new jump: it
appends and then removes entries whose *line* appears again later, keeping
the newest. The two produce different lists — after `5G 10G <C-o> 15G` Vim
holds `[1, 10, 5]` where truncation would give `[1, 5]` — and the
difference is visible through `<C-o>`. Entries are capped at 100, and an
entry for the line the cursor is already on is dropped when the index is at
the end of the list.

### Scrolling

The engine cannot scroll — it has no idea how tall the viewport is. `zz`
and friends record an *intent* (`ScrollIntent.Center`, `Top`, `Bottom`)
that the host reads and applies, then clears with `clearScrollRequest()`.

### Mouse selection

Word snapping is a *document* operation — it has to look at what the
characters are — so a host holding only pixel coordinates cannot do it.
The engine owns it instead, behind two calls:

```haze
// The press. `detail` is the click count (see
// ui_components.PointerEvent.detail); the mapping is 1 -> Character,
// 2 -> Word, 3 -> Line.
ctx.beginSelection(pos, textedit_behavior.granularityForClickCount(detail));

// Every subsequent drag frame, and a shift+click too.
ctx.extendSelectionTo(pos);
```

That is the whole host-side API. `extendSelectionTo` is one call for all
three granularities because the engine remembers what the press
established, so a host never branches on "was this a double click".

The rule it implements is Chrome's, and it is the answer to why a drag
sometimes snaps to whole words and sometimes does not:

| press | selects on the press | the drag after it extends by |
|---|---|---|
| single | nothing (a bare caret) | characters |
| double | the word under it | **whole words** |
| triple | the line under it | whole lines |

The granularity is decided **once**, by the press that starts the gesture,
and then governs everything that gesture does. Nothing about the drag —
its speed, its length, its direction — changes it.

Two consequences worth knowing:

- **It survives the release.** A shift+click after a double click still
  extends by whole words. Blink does the same (`SelectionController::`
  `HandleMousePressEventSingleClick` reads back `FrameSelection`'s current
  granularity when extending). Any ordinary caret move — a plain click, an
  arrow key, a programmatic `moveTo` — resets it to Character.
- **The anchor chunk stays whole.** Dragging backwards past the word a
  double click selected flips the selection's direction without ever eating
  into that word, which is Blink's
  `SelectionAdjuster::AdjustSelectionRespectingGranularity`.

A "word" here is a maximal run of one character class (see `charClassAt`):
letters/digits/underscore, whitespace, or punctuation. So `foo.bar`
double-clicks as `foo`, then the dot alone, then `bar`; a gap between words
selects as one whitespace chunk; and a word never swallows the space after
it (Blink appends trailing whitespace for *touch* selection only, never for
the mouse). `wordRangeAt`/`lineRangeAt` expose the ranges directly for a
host that wants them for something else.

The two selection models are reconciled inside the engine: a textbox
selection runs *between* characters, while Vim's visual modes put the caret
*on* the last selected character (see `selectionRangeForLine`). The same
word range therefore lands the caret in a different place depending on the
active mode, and callers do not have to know that.

## Testing against real Neovim

Correctness here is not "looks right", it is "byte-identical to Neovim".
Five suites, all driving a headless `nvim` as the oracle:

```bash
bun run scripts/vim-core-cases.ts             # the supported subset
bun run scripts/vim-core-cases.ts --remaps    # ...again, with the vimrc
bun run scripts/vim-jumplist-cases.ts         # <C-o> / <C-i>
bun run scripts/vim-comment-cases.ts          # gc / gcc
bun run scripts/vim-difftest.ts --seed 3 --count 300   # random fuzz
```

The jump-list and comment suites are separate corpora rather than extra
entries in the core one, because the core corpus is a cross product (every
key against every buffer/cursor pair): one added key costs 20 cases and
moves the 2680 figure below. They also need buffers the core corpus does
not have — tall ones with paragraph breaks for jumps, indented and
part-commented ones for `gc`.

Each runs every case through both real Neovim and the Haze
implementation and compares buffer text, cursor position, mode, visual
anchor and register contents (including charwise/linewise-ness).

| Suite | Result |
| --- | --- |
| Core subset, no remaps | **2680 / 2680** |
| Core subset, vimrc remaps | **2680 / 2680** |
| Jump list, no remaps | **204 / 204** |
| Jump list, vimrc remaps | **204 / 204** |
| Comment operator | **798 / 798** |
| Random fuzz (6 seeds × 150) | ~92% |

The core, jump-list and comment suites are the regression gate and must
stay at 100%. The fuzzer
generates arbitrary key soup — including combinations well outside the
supported subset — so its remaining ~8% is a long tail of one-off
edge cases (mostly `>`/`<` cursor placement with exotic motions), not a
systematic defect. Every failure it reports is real, so it is useful for
finding the *next* bug rather than as a pass/fail gate.

The fuzzer is seeded and deterministic: a failing run reproduces exactly
with the same `--seed`. Single cases can be probed directly:

```bash
bun run scripts/vim-difftest.ts --keys "d2w" --lines "one two three" --col 0
```

See `vimtest/oracle/ORACLE.md` for the oracle's JSON schema and for the
Neovim quirks it pins down — including the `cpoptions` `_` flag that
makes `cw` behave like `ce`, and the fact that Neovim ships
`startofline` off (so `G`, `dd` and `<C-d>` keep the cursor column).

## Supported subset

Deliberately not all of Vim. What is covered, and verified:

- **Motions** `h j k l w W b B e E 0 ^ $ gg G { }`, with counts
- **Find** `f F t T ; ,`
- **Operators** `d y c > <` over any motion or text object, plus the
  doubled forms `dd yy cc >> <<` and `D C S Y`
- **Text objects** `iw aw iW aW i( a( i[ a[ i{ a{ i" i'`
- **Visual** `v` (charwise), `V` (linewise), `<C-v>` (blockwise), `o` to
  swap ends, operators over the selection, `p`/`P` to paste over it, and
  the linewise `D C X S Y` forms
- **Edits** `x X r J ~ p P i a I A o O`
- **Undo/redo** `u <C-r>`. Modelled on neovim's `u_save`: an undo entry
  stores the LINE RANGE it replaced plus the old lines, never a copy of
  the document, so the engine stays storage-agnostic and a keystroke
  costs O(edit) rather than O(document). A whole insert session
  (`ihello<Esc>`) is one undo step, as in vim.
- **Jumps** `<C-o> <C-i>`, `<C-d> <C-u>`
- **Registers** the unnamed register, charwise and linewise, optionally
  routed through the system clipboard (`clipboard=unnamedplus`)
- **Command line** `:` — the LINE only. This module collects the text
  (with `<BS>`, `<Esc>` and `<CR>`), keeps normal-mode remaps off it, and
  hands the finished command to the host through `onExCommand`. It parses
  and executes nothing: `:w` is a file write and `:q` closes a tab, and an
  editing engine can know about neither. Query it for rendering with
  `commandLineOpen()` / `commandLineText()`.

  Command-line mode is deliberately NOT a `textedit_behavior.Mode`. A Mode
  decides how the caret clamps and whether a selection tracks it, and
  neither changes while a `:` line is being typed.

Not implemented: named registers, macros, marks, ex command HISTORY and
ranges (`:'<,'>`, `:%s`), search
(`/`, `?`, `n`, `N`), blockwise INSERT (`<C-v>I`/`<C-v>A`, which types the
same text on every row), `gu`/`gU`/`g~`. A count
before `v`/`V` (":h v_count", reuse the last selection's size) is parsed
but ignored.

## Adding another behavior

A Helix or Emacs behavior is a new module next to `vim_behavior` that
builds a `textedit_behavior.Behavior` from three callbacks:

```haze
let behavior = textedit_behavior.Behavior {
    onKey:       (key: str) => myBehavior.handleKey(key),
    onTextInput: (text: String) => myBehavior.handleTextInput(text),
};
ctx.setBehavior(behavior);
```

Everything it needs is already public on the engine: pure motions
(`targetWordLeft`, `firstNonBlank`, `charClassAt`), range-based editing
(`deleteRange`, `replaceRangeWith`, `textInRange`), selection control
(`setSelectionAnchor`, `swapSelectionEnds`, `selectionAsRange`), pointer
selection (`beginSelection`, `extendSelectionTo`, `wordRangeAt`), modes
and transactions. Nothing in the engine needs to change.
