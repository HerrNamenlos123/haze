# Vim Oracle

A headless-Neovim "oracle" that produces **ground truth** editor state for differential
testing of a from-scratch Vim implementation.

You hand it a batch of cases — starting buffer, starting cursor, a key sequence, and
optionally some remaps — and it hands back the exact resulting buffer, cursor, mode,
visual anchor, registers and scroll position that real Neovim produces.

* Script: `oracle.lua`
* Verified against: **NVIM v0.11.4** (`/usr/bin/nvim`, AppImage build, LuaJIT 2.1)

---

## 1. Invocation

```bash
ORACLE_JOB=/abs/path/job.json \
ORACLE_OUT=/abs/path/out.json \
nvim --headless -u NONE -i NONE --noplugin \
     --cmd "lua dofile('/home/fzachs/Projects/haze2/vimtest/oracle/oracle.lua')"
```

Both env vars are **required**; the script exits non-zero (`cquit 2`) without them.
It always ends by writing `ORACLE_OUT` and calling `qall!`, so it never hangs waiting
for input.

One invocation processes an entire **batch** of cases. Do that — nvim startup dominates
the runtime, and per-case reset inside a single process is exact (see §5.1).

Flags and why each matters:

| Flag | Why |
| --- | --- |
| `--headless` | no UI, no TTY |
| `-u NONE` | skip every vimrc, including the user's |
| `-i NONE` | no shada file, so registers/marks/jumps do not persist between runs |
| `--noplugin` | skip plugin loading |

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | batch completed; results in `ORACLE_OUT` |
| 2 | `ORACLE_JOB` / `ORACLE_OUT` not set |
| 3 | fatal error; `ORACLE_OUT` contains `{"fatal": "...", "results": []}` |

A single bad case never aborts the batch — every case runs under `pcall` and reports
`ok: false` with an `error` string.

---

## 2. Input schema (`ORACLE_JOB`)

Either a bare array of cases, or an object with a `cases` key:

```jsonc
{
  "cases": [
    {
      // ---- required-ish ----
      "id":     "dw_basic",              // string; auto-filled as "case_<N>" if omitted
      "lines":  ["hello world", "two"],  // string[]; buffer contents. Default [""]
      "cursor": { "line": 1, "col": 0 }, // line 1-based, col 0-based BYTES (nvim convention)
      "keys":   "dw",                    // key sequence, <> notation allowed (see below)

      // ---- optional ----
      "maps": [
        { "mode": "n", "lhs": "j", "rhs": "jzz", "noremap": true }
      ],
      "registers":      { "a": { "lines": ["x"], "regtype": "v" } },
      "clipboard":      "unnamedplus",   // "" (default) | "unnamed" | "unnamedplus"
      "clipboard_init": { "+": { "lines": ["FROMCLIP"], "regtype": "V" } },
      "options":        { "expandtab": true, "shiftwidth": 2 },
      "filetype":       "lua",
      "topline":        25,              // initial scroll position (winrestview)
      "want_registers": true,            // false => omit the registers block
      "flags":          "xt"             // feedkeys flags; leave alone unless you know why
    }
  ]
}
```

### `keys`

Passed through `nvim_replace_termcodes(keys, true, false, true)`, so `<Esc>`, `<CR>`,
`<C-d>`, `<C-v>`, `<space>`, `<leader>`-free `<>` notation all work. A literal `<`
must be written `<lt>`.

### `cursor`

`line` is 1-based, `col` is **0-based and counted in bytes** — the `nvim_win_get_cursor`
convention. Out-of-range values are clamped to the buffer.

Note the input convention differs from `getpos()`, which is 1-based in both. The output
reports both (`cursor` and `cursor1`) so you never have to guess.

### `maps`

| Field | Meaning |
| --- | --- |
| `mode` | `"n"`, `"i"`, `"v"`, `"x"`, `"o"`, `"s"`, `"c"`; a multi-char string like `"nv"` means both; a list works too |
| `lhs` / `rhs` | as written in a vimrc |
| `noremap` | `true` (default) = `:nnoremap`; `false` = `:nmap` |
| `silent`, `expr`, `nowait` | optional, default `silent: true` |

Maps are set with `vim.keymap.set` before the keys are fed and **all** global maps are
deleted afterwards, so cases never leak mappings into each other.

### `clipboard` / `clipboard_init`

See §4. The real system clipboard is **never** touched, in any configuration.

---

## 3. Output schema (`ORACLE_OUT`)

```jsonc
{
  "nvim_version": "NVIM v0.11.4",
  "clipboard_provider": "oracle-fake",   // MUST be this; see §4
  "count": 3,
  "results": [
    {
      "id": "dw_basic",
      "ok": true,                 // false only on an internal oracle error
      "error": "...",             // present iff ok == false
      "errmsg": "",               // v:errmsg after the keys ran
      "messages": ["..."],        // :messages output, if any
      "state_source": "probe",    // "probe" | "post"  -- see §5.2
      "probe_swallowed": true,    // present iff the case was replayed; see §5.2
      "feed_error": "...",        // present iff nvim_feedkeys itself threw

      "state": {
        "lines":   ["world", "two"],
        "cursor":  { "line": 1, "col": 0 },          // 1-based line, 0-BASED byte col
        "cursor1": { "line": 1, "col": 1, "off": 0 },// getpos('.'): 1-based BOTH
        "mode":      "n",         // raw nvim_get_mode().mode
        "mode_name": "normal",    // human-readable
        "blocking":  false,
        "visual":    false,
        "vstart":    { "line": 1, "col": 1, "off": 0 }, // only when visual/select
        "vkind":     "char",                            // "char" | "line" | "block"
        "topline":   1,           // winsaveview().topline -- first visible line
        "leftcol":   0,
        "curswant":  0,           // "desired column" that survives j/k
        "lnum":      1,
        "modified":     true,
        "changedtick":  4,
        "line_count":   2,
        "registers": {
          "unnamed":  { "lines": ["hello "], "regtype": "v", "kind": "charwise" },
          "yank0":    { ... },   // register 0 (last yank)
          "del1":     { ... },   // register 1 (last big delete)
          "smalldel": { ... },   // register - (last small delete)
          "plus":     { ... },   // register +
          "star":     { ... }    // register *
        },
        "fake_clipboard": {       // what an EXTERNAL app would see
          "+": { "lines": [""], "regtype": "v" },
          "*": { "lines": [""], "regtype": "v" }
        }
      },

      "post_state": {             // state AFTER feedkeys' implicit <Esc>; see §5.2
        "mode": "n",
        "cursor": { "line": 1, "col": 2 },
        "lines": ["byeworld"]
      }
    }
  ]
}
```

### `regtype` → `kind`

| `regtype` | `kind` | Meaning |
| --- | --- | --- |
| `"v"` | `charwise` | characterwise |
| `"V"` | `linewise` | linewise |
| `"<width>"` (CTRL-V) | `blockwise` | blockwise, width suffixed |
| `""` | `empty` | register never set |

---

## 4. Clipboard: emulation and safety

**Tests must never touch the real system clipboard.** The oracle guarantees this in
three layers:

1. `clipboard` defaults to `""` for every case.
2. A **fake in-memory provider** is installed as `g:clipboard` at startup, with Lua
   `copy`/`paste` functions that read and write a plain Lua table. There is no external
   process, so `wl-copy`/`xclip`/`pbcopy` are never spawned.
3. A **hard assertion** at startup: if `provider#clipboard#Executable()` returns
   anything other than `"oracle-fake"`, the oracle refuses to run and exits 3. The
   effective name is echoed in the output as `clipboard_provider`, so a test harness
   can assert on it too.

### The reload trap (important)

`autoload/provider/clipboard.vim` begins with:

```vim
if exists('g:loaded_clipboard_provider')
  finish
endif
```

So if the provider is resolved **before** `g:clipboard` is assigned, Neovim silently
keeps the real system tool and your fake provider is ignored — on this machine it
resolved to `wl-copy`. Setting `vim.g.clipboard` alone is **not** sufficient. You must
force a re-source:

```lua
vim.g.clipboard = { name = "oracle-fake", copy = {...}, paste = {...}, cache_enabled = 0 }
vim.g.loaded_clipboard_provider = nil        -- <-- without this the real tool wins
vim.cmd("runtime autoload/provider/clipboard.vim")
assert(vim.fn["provider#clipboard#Executable"]() == "oracle-fake")
```

Verified with a sentinel: `wl-paste` returns byte-identical content before and after a
full batch that yanks and pastes through `"+` and `"*`.

### Confirmed asymmetry: `clipboard=unnamedplus` yanks do NOT reach the provider

This is the single most surprising clipboard finding, and it is **real Neovim behavior
in headless mode**, not an artifact of the fake provider:

| Operation | Reaches the provider? |
| --- | --- |
| `"+yy` / `"*yy` (explicit register) | **yes** — `copy` callback fires |
| `"+p` (explicit register) | **yes** — `paste` callback fires |
| `p` with `clipboard=unnamedplus` | **yes** — `paste` callback fires |
| `yy` with `clipboard=unnamedplus` | **no** — `copy` never fires, `+` unchanged |

Observed:

```
clip_unp_yank    lines=['hello'] unnamed=['hello'] plus_reg=[] FAKE+={'lines': [], 'regtype': 'v'}
clip_explicit_yank lines=['hello','world'] unnamed=['world'] plus_reg=['world'] FAKE+={'lines': ['world',''], 'regtype': 'V'}
```

A `TextYankPost` autocmd confirms the cause: `v:event.regname` is `""` for the
`unnamedplus` yank — the implicit clipboard sync is not attributed to `+` at all. This
reproduces with the **real** `wl-copy` provider too, and across `-u NONE`, `-u NORC`,
with/without `--noplugin`, and with `cache_enabled` 0 or 1.

**Consequence for differential testing:** do not assert that `yy` under `unnamedplus`
populates `+`. Assert on `registers.unnamed`, or use explicit `"+` registers. The
oracle reports both `registers.plus` (nvim's internal register) and `fake_clipboard["+"]`
(what an external app would see) precisely so you can tell them apart.

Also note `clipboard_init` seeds **both** the fake provider and nvim's internal
register. Seeding only the provider makes `p` fail with `E353: Nothing in register`,
because nvim does not always re-read the provider before pasting.

---

## 5. Quirks a reimplementation will get wrong

### 5.1 Per-case isolation requires deliberate work

Reusing one nvim process is fast but leaky. The oracle resets, per case:

* **A brand-new buffer**, with the old one force-deleted.
* **Undo history wiped.** Without this, `u` as the first key of a case undoes *the
  buffer being created*. The oracle sets the lines to `[""]`, then rewrites the real
  lines while `undolevels == -1` (a change made at `undolevels=-1` is not undoable and
  collapses the history), then restores `undolevels` and clears `modified`.

  The folklore trick `:set undolevels=-1 | exe "normal a \<BS>\<Esc>"` is **wrong here**:
  it mutates the buffer. It silently ate a leading space, turning `"  hello"` into
  `" hello"`, until it was replaced with the API-based approach.

  Verified: `u` on an untouched fresh buffer is now a no-op, while `ddu` restores.
* `delmarks!` + `clearjumps`, all registers emptied with `setreg(r, {})`, all global
  mappings deleted, `v:errmsg` cleared, and up to 3 `<Esc>` fed to abort any pending
  state.

**E37 trap:** a buffer with `buftype=""` that is `modified` cannot be abandoned —
switching windows to a new buffer fails with `E37: No write since last change`. The
oracle clears `modified` on the outgoing buffer first.

The options pinned for determinism are a separate hazard: getting one of them wrong
corrupts every case in the batch identically, which looks like a bug in *your*
implementation rather than in the oracle. See §5.10.

### 5.2 `feedkeys` with `x` force-exits Insert mode — the `<Cmd>` probe

`:h feedkeys()` states plainly:

> `'x'` Execute commands until typeahead is empty. … **Note that when Vim ends in
> Insert mode it will behave as if `<Esc>` is typed**, to avoid getting stuck.

So a naive `feedkeys(keys, "xt")` reports `cw` as ending in **normal** mode with the
cursor one column left of the truth. That is a bad oracle.

The fix: append `<Cmd>lua __oracle_snapshot()<CR>` to the key sequence. `<Cmd>` runs a
command from **any** mode without changing the mode (unlike `:`), so the snapshot is
taken while still genuinely in Insert / operator-pending / cmdline mode.

Real difference this makes:

| case | keys | `state` (probe) | `post_state` (after implicit Esc) |
| --- | --- | --- | --- |
| `cw` | `cwbye` | `mode='i'` cur=(1,3) | `mode='n'` cur=(1,2) |
| `ciw` | `ciwXY` | `mode='i'` cur=(1,2) | `mode='n'` cur=(1,1) |
| `insert_mode` | `iXY` | `mode='i'` cur=(1,2) | `mode='n'` cur=(1,1) |
| `pending_d` | `d` | `mode='no'` (operator-pending) | `mode='n'` |
| `open_cmdline` | `:set` | `mode='c'` | `mode='n'` |

Both are reported. Compare against `state` for "what the editor really is"; compare
against `post_state` if your implementation only models settled normal-mode states.

**Probe swallowing.** Commands that consume the *next literal character* — `f t F T`,
`r`, `q`, `m`, `"`, and the pending half of `di` / `ci` / `g` — eat the probe's leading
`<Cmd>` byte as their operand, and the rest gets typed as literal text, corrupting the
buffer (`"hello"` became `"he __oracle_snapshot()"`). The oracle detects this (the probe
never fired), **resets and replays the case verbatim without the probe**, and flags it
with `probe_swallowed: true` and `state_source: "post"`. Such cases report the settled
post-`<Esc>` state, which for a dangling `f`/`r` is the correct answer anyway.

Do not use flags `x!t`: the `!` makes feedkeys **block waiting for more input** and the
process hangs (observed: a 2-minute timeout).

### 5.3 Cursor column conventions

Three different conventions appear, which is a classic source of off-by-one bugs:

| Source | Line | Column |
| --- | --- | --- |
| input `cursor`, output `cursor` | 1-based | **0-based**, bytes |
| output `cursor1` (`getpos('.')`) | 1-based | **1-based**, bytes |
| output `vstart` (`getpos('v')`) | 1-based | **1-based**, bytes |

Note the asymmetry inside a single visual selection: `cursor.col` is 0-based but
`vstart.col` is 1-based. In `visual_v` (`vlll` on `"hello world"`) the result is
`cursor=(1,3)` and `vstart=(1,1)` — both describe a selection from column 0 to column 3
in 0-based terms.

`vstart` is the **anchor** (where visual mode started), `cursor` is the moving end. After
`o` they swap: `visual_o` (`vlllo`) reports `cursor=(1,2)`, `vstart=(1,6)` — the anchor
is now to the *right* of the cursor. A reimplementation must not assume `vstart <= cursor`.

### 5.4 Mode strings

`nvim_get_mode().mode` values actually observed:

| Raw | `mode_name` | Produced by |
| --- | --- | --- |
| `"n"` | normal | settled normal mode |
| `"no"` | operator-pending | `d`, `c`, `y` with no motion yet |
| `"i"` | insert | `i`, `cw`, `ciw` |
| `"v"` | visual-char | `v` |
| `"V"` | visual-line | `V`, `<space>aa` → `ggVG` |
| `""` | visual-block | `<C-v>` — a raw **CTRL-V byte (0x16)**, not the string `"C-v"` |
| `"c"` | cmdline | `:set`, `/xy` left open |

Beware `""` when round-tripping JSON. Select mode (`s`/`S`/``) is handled but
was not exercised.

`counts` do **not** appear in the mode string: after feeding `12`, mode is plain `"n"`.
The pending count is invisible to `nvim_get_mode()`.

### 5.5 Motions and operators — confirmed values

Cases a reimplementation commonly gets wrong, with real observed output:

* **`e` is inclusive and stops on the last char**: `ee` on `"foo bar baz"` from col 0 →
  col 6 (the `r` of `bar`), not col 7.
* **`t` then `;` does not stand still**: `tc` on `"abcabcabc"` → col 1; `tc;` → col 4.
  (Vim's `;` after `t` skips the adjacent match rather than getting stuck. A naive
  implementation returns col 1 again.)
* **`,` reverses**: `fc;,` → back to col 2.
* **`^` respects indent, `0` does not**: on `"  hello"`, `0` → col 0, `^` → col 2.
* **`gg` keeps the column under nvim's default `'nostartofline'`**: `Ggg` on
  `["  aa","b","ccc"]` → `(1,0)`. It moves to the first non-blank — `(1,2)` — only
  when `'startofline'` is on, which is *not* the nvim default. An earlier revision of
  this document claimed `(1,2)` because the oracle was wrongly forcing `startofline`;
  see §5.10. The same correction applies to the column after `G`, `dd`, `<C-d>` and
  `<C-u>`.
* **`$` sets `curswant` to "end of line" and it sticks across `j`**: `$jj` on
  `["hello world","hi","longer line"]` → `(3,10)`. The cursor snaps to the end of each
  line, and crucially the *short* middle line does not clamp the desired column
  permanently. `curswant` is reported so this is testable.
* **`cw` behaves like `ce`, not `dwi`**: `cwbye` on `"hello world"` → `"bye world"` —
  the trailing space is **not** consumed, and the register is `"hello"` *without* the
  space. (`dw` on the same input does consume it → `"world"`, register `"hello "`.)
  From col 2, `cw` → `"he world"` and `ce` → `"he world"`: identical, which is the
  point. This is governed by the `_` flag in `'cpoptions'` — see §5.10.
* **Counts multiply, they do not concatenate**: `d2w` on `"one two three four"` →
  `"three four"`, register `"one two "`. `2dd` on `["a","b","c","d"]` → `["c","d"]`.
* **`x` at end of line moves the cursor left**: `x` on `"abc"` at col 2 → `"ab"`, cursor
  col 1 (clamped back onto the shortened line).
* **Blockwise yank regtype carries a width**: `<C-v>jjld` on `["abcd","efgh","ijkl"]` →
  `["ad","eh","il"]`, register `["bc","fg","jk"]` with `kind: "blockwise"`.

### 5.6 Registers

* `dd` / `V`-delete set `regtype` `"V"` (linewise); the register lines have **no**
  trailing empty element.
* Yanking into `"+` via `"+yy` stores `["world", ""]` in the *provider* (trailing empty
  string, linewise convention) while `getreg("+")` returns `["world"]`. The oracle
  reports both.
* **`v_p` swaps the register.** Default `p` in visual mode puts the register *and* loads
  the replaced text into the unnamed register. With `yiwwviwp` on `"hello world"`:
  * default: buffer `"hello hello"`, unnamed register becomes **`"world"`**
  * with `vnoremap p P`: buffer `"hello hello"`, unnamed register stays **`"hello"`**

  Identical buffers, different registers — exactly why the remap exists, and an easy
  thing to get wrong. Test the register, not just the text.

### 5.7 Scrolling, `zz`, and the user's vimrc remaps

Window geometry is pinned to **24 lines × 80 columns** and `scrolloff=0` so `topline`
is reproducible. If your implementation uses a different viewport height, `<C-d>` /
`<C-u>` / `zz` results will legitimately differ — set the same geometry.

`zz` **only scrolls**. It changes `topline` and leaves the cursor line alone:

```
scroll_zz_only   cur=(30,0) top=20     # started cur=(30,0) top=25
```

With a 24-line window and the cursor on line 30, centering puts `topline` at 20.

The user's vimrc subset, verified end to end:

| Map | Case | Result |
| --- | --- | --- |
| `inoremap jk <Esc>` | `iXYjk` | `mode='n'` cur=(1,1), buffer `"XYabc"` |
| *(unmapped control)* | `iXYjk` | `mode='i'` cur=(1,4), buffer `"XYjkabc"` |
| `nnoremap j jzz` | `j` from (30, top=25) | cur=(31,0) **top=21** (plain `j`: top stays 25) |
| `nnoremap k kzz` | `k` from (30, top=25) | cur=(29,0) **top=19** |
| `nnoremap <space>aa ggVG` | `<space>aa` | `mode='V'` cur=(3,0) vstart=(1,1) — whole buffer |
| … then `d` | `<space>aad` | buffer `[""]`, register `["aa","bb","cc"]` linewise |
| `vnoremap p P` | `yiwwviwp` | buffer `"hello hello"`, unnamed **`"hello"`** (vs `"world"` unmapped) |
| `nnoremap <C-d> <C-d>zz` | `<C-d>` from (1, top=1) | cur=(12,0) **top=2** (plain: top=12) |
| `nnoremap <C-u> <C-u>zz` | `<C-u>` from (40, top=30) | cur=(29,0) **top=19** |
| `nnoremap n nzzzv` | `/line3<CR>nn` | cur=(31,0) top=21 |
| `nnoremap N Nzzzv` | `/line3<CR>nnN` | cur=(30,0) top=20 |

**`zz` does affect reported `topline` but never the cursor line** — compare
`scroll_plain_j` (top=25) with `scroll_map_j` (top=21); both land the cursor on line 31.

**Counts apply to the whole mapping, once.** With `nnoremap j jzz`, feeding `5j` from
line 10 gives cur=(15,0), top=5 — the count is consumed by the mapping as a unit, not
re-applied to each `j` inside the RHS. A reimplementation that expands the RHS naively
and re-applies the count will land on the wrong line.

### 5.8 Mapping timeout

`timeoutlen` is pinned to 50 ms so ambiguous prefixes resolve fast and deterministically.
A partial mapping is resolved as a timeout, not left pending: with `inoremap jk <Esc>`,
feeding `ij` yields buffer `"jabc"` and `mode='i'` — the lone `j` was inserted literally.

### 5.9 Messages leak to stderr

In headless mode nvim writes informational messages (`"1 more line; before #2"`,
`"Already at oldest change"`, search echoes) straight to **stderr**, interleaved and
without newlines. They are noise, not errors. The oracle clears `:messages` before each
case and reports them per-case in `messages`, but some still escape to stderr during
`feedkeys` itself. **Redirect stderr** (`2>/dev/null`) and read only `ORACLE_OUT`.

### 5.10 The oracle's own option defaults must not change semantics

**This section exists because of a real bug that made the oracle emit wrong ground
truth for `cw`.**

#### The bug

`cw` on `"hello world"` with the cursor at 0-based col 2 must produce `"he world"`
(the trailing space survives — `cw` acts like `ce`). The oracle reported `"heworld"`,
with register `"llo "` instead of `"llo"` — i.e. it silently turned `cw` into `dw`.
It was not the probe-swallow path: `state_source` was `"probe"` and
`probe_swallowed` was unset. It reproduced with a single case in the batch, so it
was not cross-case leakage either.

#### Root cause

The oracle pins a table of options (`DEFAULT_OPTS`) for determinism. That table
contained:

```lua
cpoptions = "aABceFs",   -- WRONG
```

Neovim's actual default is **`aABceFs_`**. The dropped `_` is exactly the flag that
governs this behavior (`:h cpo-_`):

> `_`  When using |cw| on a word, do not include the whitespace following the word
> in the motion.

Neovim ships `_` **on** by default, which is why `cw` acts like `ce`. By writing a
hand-copied `cpoptions` string that omitted it, the oracle switched `cw` to
Vi-compatible "change to start of next word" semantics for every single case.
Verified in isolation:

```
cpo=aABceFs_ → line=[he world]     # nvim default, correct
cpo=aABceFs  → line=[heworld]      # what the oracle was doing
```

The scratch-buffer / `nofile` / `undolevels` / window-geometry hypotheses were all
ruled out — none of them affect `cw`. It was purely the option string.

#### Two more of the same class, found by the same audit

Diffing every `DEFAULT_OPTS` entry against a stock `nvim -u NONE` turned up two
further semantic deviations, fixed at the same time:

| Option | Oracle had | nvim default | What it silently changed |
| --- | --- | --- | --- |
| `cpoptions` | `aABceFs` | `aABceFs_` | `cw` consumed the trailing space |
| `startofline` | `true` | `false` | cursor **column** after `G`, `dd`, `<C-d>`, `<C-u>`, `<C-f>`, `<C-b>`, `H`/`M`/`L` |
| `autoindent` | `false` | `true` | text inserted by `o`, `O`, `cc`, `S`, and `<CR>` in insert |
| `formatoptions` | `tcq` | `tcqj` | `J` no longer removed a comment leader when joining |

Concretely: `G` from `(2,5)` on `["aaa","    bbb","ccc"]` gave `(3,0)` instead of
the correct `(3,2)`; `oX<Esc>` on a tab-indented line produced `"X"` instead of
`"\tX"`.

#### The fix, and the guard that keeps it fixed

The four values above now match nvim's defaults. More importantly, hand-maintaining
a list of "correct" defaults is what caused the bug, so correctness no longer depends
on the list being right. `oracle.lua` now:

1. Snapshots nvim's **own** boot-time values for a set of `SEMANTIC_OPTS` —
   the options that change what a command *does*, as opposed to how it looks —
   **before** touching any option.
2. After `apply_default_options()`, compares the live values against that snapshot.
3. **Refuses to run the batch** (exit 3, `fatal` in `ORACLE_OUT`) if any of them
   drifted, naming the offending options:

```
ORACLE FATAL: REFUSING TO RUN: oracle changed semantic option(s) away from the
nvim default, results would not be ground truth:
cpoptions: oracle="aABceFs" nvim_default="aABceFs_"
```

Because the baseline is captured from the running nvim rather than hardcoded, this
also survives a Neovim upgrade that changes a default.

**The rule for editing `DEFAULT_OPTS`:** every entry is a deviation from stock nvim
and must be justifiable as *determinism or noise suppression only* — `swapfile`,
`shortmess`, `belloff`, `report`, `timeoutlen`, `hlsearch`, window geometry. Anything
that alters editing semantics belongs at nvim's default. The guard enforces this, so
adding such an option will fail the batch loudly rather than quietly corrupt results.

Per-case `options` overrides are deliberately **not** subject to the guard — a case
may legitimately ask for `{"cpoptions": "aABceFs"}` to test non-default behavior, and
that still yields `"heworld"` as it should.

---

## 6. Suggested comparison strategy

1. Assert `clipboard_provider == "oracle-fake"` before trusting any result.
2. Compare `state.lines` first — the cheapest, highest-signal check.
3. Compare `state.cursor` (0-based col) against your cursor, minding §5.3.
4. Compare `state.mode`; use `state` (not `post_state`) if you model insert and
   operator-pending mode, `post_state` if you only model settled states.
5. For visual cases, normalise `vstart.col` to 0-based (subtract 1) before comparing,
   and compare the *unordered pair* {anchor, cursor} unless you also model `o`.
6. Compare `registers.unnamed.lines` **and** `.kind` — charwise/linewise confusion is
   the most common paste bug.
7. Only compare `topline` if you model a viewport with the same 24×80 geometry.
8. Treat `probe_swallowed: true` cases as post-`<Esc>` states.
