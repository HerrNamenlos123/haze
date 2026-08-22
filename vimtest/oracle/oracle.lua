-- oracle.lua -- headless neovim ground-truth oracle for differential vim testing.
--
-- Usage:
--   ORACLE_JOB=/path/job.json ORACLE_OUT=/path/out.json \
--     nvim --headless -u NONE -i NONE --noplugin \
--          --cmd "lua dofile('/abs/path/oracle.lua')"
--
-- See ORACLE.md for the JSON schemas.

local uv = vim.uv or vim.loop

--------------------------------------------------------------------------------
-- IO helpers
--------------------------------------------------------------------------------

local function read_file(path)
  local fd = assert(uv.fs_open(path, "r", 438), "cannot open " .. tostring(path))
  local stat = assert(uv.fs_fstat(fd))
  local data = assert(uv.fs_read(fd, stat.size, 0))
  uv.fs_close(fd)
  return data
end

local function write_file(path, data)
  local fd = assert(uv.fs_open(path, "w", 420), "cannot write " .. tostring(path))
  uv.fs_write(fd, data, 0)
  uv.fs_close(fd)
end

--------------------------------------------------------------------------------
-- Fake clipboard provider (in-memory). Guarantees we NEVER touch the real
-- system clipboard, even when a case asks for clipboard=unnamedplus.
--------------------------------------------------------------------------------

-- reg -> { lines(table), regtype(string) }
local FAKE_CLIP = {
  ["+"] = { { "" }, "v" },
  ["*"] = { { "" }, "v" },
}

-- Returns the provider name actually in effect, so the caller can assert we are
-- NOT talking to wl-copy/xclip/pbcopy/etc.
local function install_fake_clipboard()
  _G.__oracle_clip_get = function(reg)
    local e = FAKE_CLIP[reg] or { { "" }, "v" }
    return { e[1], e[2] }
  end
  _G.__oracle_clip_set = function(lines, regtype, reg)
    FAKE_CLIP[reg] = { lines, regtype }
  end

  vim.g.clipboard = {
    name = "oracle-fake",
    copy = {
      ["+"] = function(lines, regtype) _G.__oracle_clip_set(lines, regtype, "+") end,
      ["*"] = function(lines, regtype) _G.__oracle_clip_set(lines, regtype, "*") end,
    },
    paste = {
      ["+"] = function() return _G.__oracle_clip_get("+") end,
      ["*"] = function() return _G.__oracle_clip_get("*") end,
    },
    cache_enabled = 0,
  }

  -- CRITICAL: autoload/provider/clipboard.vim early-returns if
  -- g:loaded_clipboard_provider already exists. If it was resolved before we
  -- set g:clipboard, nvim keeps the REAL system tool (wl-copy/xclip/...).
  -- Unlet + re-source forces it to pick up our fake provider.
  vim.g.loaded_clipboard_provider = nil
  pcall(vim.cmd, "runtime autoload/provider/clipboard.vim")

  local name = nil
  pcall(function() name = vim.fn["provider#clipboard#Executable"]() end)
  return name
end

-- Hard safety check: refuse to run if anything but our fake provider is active.
local function assert_fake_clipboard(name)
  if name ~= "oracle-fake" then
    error(("REFUSING TO RUN: clipboard provider is %q, not \"oracle-fake\". "
      .. "The real system clipboard would be touched."):format(tostring(name)))
  end
end

local function reset_fake_clipboard()
  FAKE_CLIP["+"] = { { "" }, "v" }
  FAKE_CLIP["*"] = { { "" }, "v" }
end

--------------------------------------------------------------------------------
-- Global deterministic settings
--------------------------------------------------------------------------------

-- IMPORTANT: every entry here is a DEVIATION from a stock `nvim -u NONE`
-- session, so every entry must be justified as "does not change editing
-- semantics, only determinism / noise". Options that DO change editing
-- semantics (cpoptions, autoindent, startofline, formatoptions, iskeyword,
-- selection, virtualedit, whichwrap, backspace, ...) must be left at, or
-- explicitly pinned to, the real nvim default -- otherwise the oracle stops
-- being ground truth. See ORACLE.md §5.10.
--
-- Regression that motivated this rule: cpoptions was pinned to "aABceFs",
-- silently dropping nvim's default `_` flag, which is precisely the flag that
-- makes `cw` behave like `ce`. The oracle reported `cw` on "hello world" at
-- col 2 as "heworld" instead of the correct "he world".
local DEFAULT_OPTS = {
  compatible      = false,
  clipboard       = "",     -- never unnamedplus unless a case asks
  hidden          = true,
  swapfile        = false,
  undofile        = false,
  backup          = false,
  writebackup     = false,
  shadafile       = "NONE",
  more            = false,
  showcmd         = false,
  ruler           = false,
  report          = 99999,
  shortmess       = "aoOtTIcF",
  belloff         = "all",
  lazyredraw      = false,
  timeout         = true,
  timeoutlen      = 50,     -- keep mapping ambiguity resolution fast+deterministic
  ttimeoutlen     = 0,
  updatetime      = 100000,
  scrolloff       = 0,
  sidescrolloff   = 0,
  wrap            = true,
  virtualedit     = "",
  selection       = "inclusive",
  whichwrap       = "b,s",
  -- SEMANTIC: nvim default is 'nostartofline'. Forcing it on changes the
  -- resulting cursor COLUMN of G, dd, <C-d>, <C-u>, <C-f>, <C-b>, gg, H/M/L.
  startofline     = false,
  -- SEMANTIC: nvim default is 'autoindent'. Forcing it off changes the text
  -- inserted by o/O/cc/S and by <CR> in insert mode inside indented lines.
  autoindent      = true,
  smartindent     = false,
  cindent         = false,
  expandtab       = false,
  tabstop         = 8,
  shiftwidth      = 8,
  softtabstop     = 0,
  textwidth       = 0,
  wrapscan        = true,
  ignorecase      = false,
  smartcase       = false,
  incsearch       = false,
  hlsearch        = false,
  gdefault        = false,
  magic           = true,
  iskeyword       = "@,48-57,_,192-255",
  backspace       = "indent,eol,start",
  joinspaces      = false,
  -- SEMANTIC, and the source of the `cw` bug: nvim's default is "aABceFs_".
  -- The `_` flag (see :h cpo-_) is what makes `cw` on a word NOT include the
  -- trailing whitespace, i.e. makes `cw` behave like `ce`. Dropping it turned
  -- `cw` into `dw`+insert. Keep this byte-identical to the nvim default.
  cpoptions       = "aABceFs_",
  matchpairs      = "(:),{:},[:]",
  keymodel        = "",
  mouse           = "",
  paste           = false,
  -- SEMANTIC: nvim default is "tcqj". The `j` flag makes J remove a comment
  -- leader when joining lines.
  formatoptions   = "tcqj",
  eventignore     = "",
  splitbelow      = false,
  fileformats     = "unix",
  encoding        = "utf-8",
  langremap       = false,
}

-- Options whose value changes what an editing command DOES (as opposed to how
-- it is displayed). For each of these the oracle must agree with a stock
-- `nvim -u NONE`, or the ground truth is silently wrong. Checked at startup
-- against the values nvim itself booted with, so this survives nvim version
-- upgrades that change a default (a hardcoded expected list would not).
local SEMANTIC_OPTS = {
  "cpoptions", "iskeyword", "selection", "virtualedit", "whichwrap",
  "startofline", "autoindent", "smartindent", "cindent", "formatoptions",
  "backspace", "joinspaces", "matchpairs", "keymodel", "wrapscan",
  "ignorecase", "smartcase", "magic", "gdefault", "expandtab", "tabstop",
  "shiftwidth", "softtabstop", "textwidth", "paste", "langremap",
}

-- Snapshot of nvim's own defaults, taken before we touch a single option.
local PRISTINE = {}
for _, k in ipairs(SEMANTIC_OPTS) do
  local ok, v = pcall(function() return vim.o[k] end)
  if ok then PRISTINE[k] = v end
end

-- Returns a list of "opt: oracle=X nvim_default=Y" strings, empty when clean.
local function semantic_option_drift()
  local drift = {}
  for _, k in ipairs(SEMANTIC_OPTS) do
    if PRISTINE[k] ~= nil then
      local ok, v = pcall(function() return vim.o[k] end)
      if ok and v ~= PRISTINE[k] then
        drift[#drift + 1] = ("%s: oracle=%q nvim_default=%q")
          :format(k, tostring(v), tostring(PRISTINE[k]))
      end
    end
  end
  return drift
end

local function apply_default_options()
  for k, v in pairs(DEFAULT_OPTS) do
    pcall(function() vim.o[k] = v end)
  end
  -- Fixed window geometry so topline/scroll behavior (zz, <C-d>, <C-u>) is
  -- reproducible. Headless nvim defaults to 80x24; we pin it explicitly.
  pcall(function() vim.o.lines = 24 end)
  pcall(function() vim.o.columns = 80 end)
end

--------------------------------------------------------------------------------
-- Buffer / window reset
--------------------------------------------------------------------------------

local scratch_buf = nil

local function fresh_buffer(lines, filetype)
  -- Create a brand new scratch buffer each case; wipe the previous one so that
  -- undo history, marks, jumplist entries and changelist do not leak across cases.
  --
  -- Quirk: a buffer with buftype="" that is 'modified' cannot be abandoned
  -- (E37 "No write since last change"), so we must clear 'modified' on the old
  -- buffer before switching windows, and set 'bufhidden=wipe' + 'buftype=nofile'
  -- is NOT usable because some commands behave differently in nofile buffers.
  -- We use buftype="" and reset 'modified' manually.
  local old = vim.api.nvim_get_current_buf()
  pcall(function() vim.bo[old].modified = false end)

  local new = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_set_option_value("buftype", "", { buf = new })
  vim.api.nvim_set_option_value("swapfile", false, { buf = new })
  vim.api.nvim_set_option_value("undofile", false, { buf = new })
  vim.api.nvim_set_option_value("undolevels", 1000, { buf = new })

  -- Set the contents *and* clear the undo history + 'modified' flag before the
  -- window switches, so that `u` in a test cannot undo "buffer creation".
  --
  -- Clearing the undo history: with 'undolevels' set to -1 a change is NOT
  -- undoable and is merged into the previous undo block, which collapses the
  -- whole history. We need a *real* buffer change while undolevels==-1.
  -- The classic `normal! a <BS><Esc>` trick mutates the text (it can eat a
  -- character and moves the cursor), so instead we do the equivalent with the
  -- API: write the lines a second time, identically, under undolevels==-1.
  vim.api.nvim_buf_set_lines(new, 0, -1, false, { "" })
  vim.api.nvim_buf_call(new, function()
    local ul = vim.bo[new].undolevels
    vim.bo[new].undolevels = -1
    vim.api.nvim_buf_set_lines(new, 0, -1, false, lines)
    vim.bo[new].undolevels = ul
    vim.bo[new].modified = false
    -- clear marks/jumps/changelist for this buffer
    pcall(vim.cmd, "silent! delmarks!")
    pcall(vim.cmd, "silent! clearjumps")
  end)

  vim.api.nvim_win_set_buf(0, new)

  -- Clear the jump list AFTER the window actually holds the new buffer.
  --
  -- The `clearjumps` inside nvim_buf_call above does not do it: the jump list
  -- is per-WINDOW, not per-buffer, and nvim_buf_call only swaps the buffer
  -- context. The window's real list therefore survived every case, which is
  -- invisible until a case actually uses <C-o>: the first such case works,
  -- and every later one jumps into a stale entry pointing at a DIFFERENT
  -- buffer (bufnr 1, the startup buffer, which is never wiped). The window
  -- then shows that buffer and capture_state reads ITS lines, so the case is
  -- compared against the wrong file.
  pcall(vim.cmd, "silent! clearjumps")

  if scratch_buf and scratch_buf ~= new and vim.api.nvim_buf_is_valid(scratch_buf) then
    pcall(function() vim.bo[scratch_buf].modified = false end)
    pcall(vim.api.nvim_buf_delete, scratch_buf, { force = true, unload = false })
  end
  scratch_buf = new

  if filetype and filetype ~= "" then
    vim.api.nvim_set_option_value("filetype", filetype, { buf = new })
  end
  return new
end

--------------------------------------------------------------------------------
-- Keymaps
--------------------------------------------------------------------------------

local applied_maps = {}

-- Neovim's OWN default mappings, snapshotted once before any case runs.
--
-- clear_maps() below wipes every global mapping in every mode as a
-- belt-and-braces reset between cases. That was written when nvim shipped
-- essentially no default mappings; since 0.10 it ships real ones -- most
-- importantly gc/gcc/gbc (commenting), but also gco/gcO and others. Wiping
-- them turns the oracle into an nvim that cannot comment, and a
-- differential test for gc then "passes" only when the engine under test
-- also does nothing. So the wipe is followed by putting these back.
local DEFAULT_MAPS = {}

local MAP_MODES = { "n", "i", "v", "x", "s", "o", "c", "t", "l" }

local function snapshot_default_maps()
  for _, mode in ipairs(MAP_MODES) do
    local ok, maps = pcall(vim.api.nvim_get_keymap, mode)
    DEFAULT_MAPS[mode] = ok and maps or {}
  end
end

local function restore_default_maps()
  for _, mode in ipairs(MAP_MODES) do
    for _, mp in ipairs(DEFAULT_MAPS[mode] or {}) do
      pcall(vim.fn.mapset, mode, false, mp)
    end
  end
end

snapshot_default_maps()

local function apply_maps(maps)
  applied_maps = {}
  if not maps then return end
  for _, m in ipairs(maps) do
    local modes = m.mode or "n"
    -- mode may be a string ("n"), a multi-char string ("nv"), or a list
    local modelist = {}
    if type(modes) == "table" then
      modelist = modes
    else
      if modes == "" then modes = " " end
      for ch in modes:gmatch(".") do modelist[#modelist + 1] = ch end
    end
    local opts = {
      noremap = (m.noremap ~= false),
      silent  = (m.silent ~= false),
      expr    = m.expr or false,
      nowait  = m.nowait or false,
      remap   = nil,
    }
    if m.noremap == false then
      opts.noremap = nil
      opts.remap = true
    end
    local ok, err = pcall(vim.keymap.set, modelist, m.lhs, m.rhs, opts)
    if ok then
      applied_maps[#applied_maps + 1] = { modes = modelist, lhs = m.lhs }
    else
      applied_maps[#applied_maps + 1] = { modes = modelist, lhs = m.lhs, err = tostring(err) }
    end
  end
end

local function clear_maps()
  for _, m in ipairs(applied_maps) do
    for _, mode in ipairs(m.modes) do
      pcall(vim.keymap.del, mode, m.lhs)
    end
  end
  applied_maps = {}
  -- Belt and braces: nuke any leftover global mappings from all common modes.
  for _, mode in ipairs({ "n", "i", "v", "x", "s", "o", "c", "t", "l" }) do
    local ok, maps = pcall(vim.api.nvim_get_keymap, mode)
    if ok then
      for _, mp in ipairs(maps) do
        pcall(vim.api.nvim_del_keymap, mode, mp.lhs)
      end
    end
  end
  -- ...and put nvim's own back, so each case starts from a stock nvim
  -- rather than one with its built-in commands removed.
  restore_default_maps()
end

--------------------------------------------------------------------------------
-- Register capture
--------------------------------------------------------------------------------

local function reg_state(name)
  local ok, contents = pcall(vim.fn.getreg, name, 1, true)
  if not ok then contents = { "" } end
  local ok2, rtype = pcall(vim.fn.getregtype, name)
  if not ok2 then rtype = "" end
  local kind = "unknown"
  if rtype == "v" then
    kind = "charwise"
  elseif rtype == "V" then
    kind = "linewise"
  elseif rtype:sub(1, 1) == "\022" then -- CTRL-V
    kind = "blockwise"
  elseif rtype == "" then
    kind = "empty"
  end
  return { lines = contents, regtype = rtype, kind = kind }
end

local function clear_registers()
  -- setreg(r, {}) truly empties a register so getregtype() returns "".
  for _, r in ipairs({ '"', "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
                       "-", "a", "b", "c", "d", "e", "f", "x", "y", "z",
                       "+", "*", "/" }) do
    pcall(vim.fn.setreg, r, {})
  end
end

--------------------------------------------------------------------------------
-- Mode helpers
--------------------------------------------------------------------------------

local MODE_NAMES = {
  ["n"]      = "normal",
  ["no"]     = "operator-pending",
  ["nov"]    = "operator-pending-forced-charwise",
  ["noV"]    = "operator-pending-forced-linewise",
  ["niI"]    = "normal-insert-ctrl-o",
  ["niR"]    = "normal-replace-ctrl-o",
  ["v"]      = "visual-char",
  ["V"]      = "visual-line",
  ["\022"]   = "visual-block",
  ["s"]      = "select-char",
  ["S"]      = "select-line",
  ["\019"]   = "select-block",
  ["i"]      = "insert",
  ["ic"]     = "insert-completion",
  ["R"]      = "replace",
  ["Rv"]     = "virtual-replace",
  ["c"]      = "cmdline",
  ["cv"]     = "ex",
  ["r"]      = "hit-enter-prompt",
  ["rm"]     = "more-prompt",
  ["!"]      = "shell",
  ["t"]      = "terminal",
}

local function is_visual(m)
  local c = m:sub(1, 1)
  return c == "v" or c == "V" or c == "\022"
end
local function is_select(m)
  local c = m:sub(1, 1)
  return c == "s" or c == "S" or c == "\019"
end

--------------------------------------------------------------------------------
-- State capture
--------------------------------------------------------------------------------

local function capture_state(want_regs)
  local buf = vim.api.nvim_get_current_buf()
  local mode_info = vim.api.nvim_get_mode()
  local mode = mode_info.mode
  local pos = vim.api.nvim_win_get_cursor(0) -- {1-based line, 0-based col (bytes)}
  local view = vim.fn.winsaveview()

  local st = {
    lines   = vim.api.nvim_buf_get_lines(buf, 0, -1, false),
    cursor  = { line = pos[1], col = pos[2] },
    -- getpos('.') is [bufnum, lnum(1-based), col(1-based byte), off]
    cursor1 = (function()
      local p = vim.fn.getpos(".")
      return { line = p[2], col = p[3], off = p[4] }
    end)(),
    mode          = mode,
    mode_name     = MODE_NAMES[mode] or ("unknown:" .. mode:gsub("%c", function(c)
                      return string.format("<0x%02x>", c:byte())
                    end)),
    blocking      = mode_info.blocking,
    visual        = false,
    topline       = view.topline,
    leftcol       = view.leftcol,
    curswant      = view.curswant,
    lnum          = view.lnum,
    modified      = vim.bo[buf].modified,
    changedtick   = vim.api.nvim_buf_get_changedtick(buf),
    line_count    = vim.api.nvim_buf_line_count(buf),
  }

  if is_visual(mode) or is_select(mode) then
    st.visual = true
    local v = vim.fn.getpos("v") -- anchor (the "other end" of the selection)
    st.vstart = { line = v[2], col = v[3], off = v[4] } -- col is 1-based bytes
    st.vkind = ({ v = "char", V = "line", ["\022"] = "block",
                  s = "char", S = "line", ["\019"] = "block" })[mode:sub(1, 1)]
  end

  if want_regs ~= false then
    st.registers = {
      unnamed  = reg_state('"'),
      yank0    = reg_state("0"),
      del1     = reg_state("1"),
      smalldel = reg_state("-"),
      plus     = reg_state("+"),
      star     = reg_state("*"),
    }
    -- The in-memory fake system clipboard, i.e. what an external application
    -- would see. NOTE this can differ from registers.plus: see ORACLE.md,
    -- "clipboard=unnamedplus does not push yanks to the provider".
    st.fake_clipboard = {
      ["+"] = { lines = FAKE_CLIP["+"][1], regtype = FAKE_CLIP["+"][2] },
      ["*"] = { lines = FAKE_CLIP["*"][1], regtype = FAKE_CLIP["*"][2] },
    }
  end

  return st
end

--------------------------------------------------------------------------------
-- Key feeding
--------------------------------------------------------------------------------

-- Feed keys and run them to completion.
--
-- feedkeys mode flags:
--   'x' : "Execute commands until typeahead is empty", like :normal!.
--         DOCUMENTED QUIRK (see :h feedkeys()): "when Vim ends in Insert mode
--         it will behave as if <Esc> is typed, to avoid getting stuck". So a
--         key sequence that legitimately ends in Insert mode is force-exited
--         and would be reported as mode="n" with the cursor shifted left by one.
--         We work around this by appending a <Cmd>...<CR> probe -- see below.
--   't' : treat as typed, so mappings/abbreviations apply and undo blocks
--         behave as if the user really typed the keys.
--   'n' : do NOT remap. We deliberately do NOT use it; mappings must apply.
--
-- The <Cmd> probe: <Cmd>lua ...<CR> executes a command from ANY mode without
-- changing the mode (unlike ':'), so appending it to the key sequence lets us
-- snapshot the true state (including mode="i" and the real insert cursor
-- column) before feedkeys' implicit <Esc> fires.
--
-- CAVEAT: some commands consume the *next literal character* (`f`/`t`/`F`/`T`,
-- `r`, `q`, `m`, `"`, and the pending half of `di`/`ci`/`g`...). If the key
-- sequence ends mid-way through one of those, our probe's leading <Cmd> byte is
-- eaten as that operand and the rest is typed as literal text, corrupting the
-- buffer. run_case() detects this (the probe never fired) and re-runs the case
-- verbatim without the probe.
local PROBE = "<Cmd>lua __oracle_snapshot()<CR>"

local function feed(keys, opts)
  opts = opts or {}
  local flags = opts.flags or "xt"
  local seq = keys
  if not opts.no_probe then seq = seq .. PROBE end
  local termcoded = vim.api.nvim_replace_termcodes(seq, true, false, true)
  vim.api.nvim_feedkeys(termcoded, flags, false)
end

-- Drain any remaining typeahead without injecting <Esc>.
local function drain()
  -- feeding an empty string with 'x' forces a flush of pending typeahead
  vim.api.nvim_feedkeys("", "x", false)
end

--------------------------------------------------------------------------------
-- Per-case runner
--------------------------------------------------------------------------------

local function hard_reset_editor_state()
  -- Leave whatever mode we're in, abort pending operators/cmdline.
  -- Multiple escapes because we might be in cmdline inside insert inside ...
  for _ = 1, 3 do
    pcall(vim.api.nvim_feedkeys,
      vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "x!", false)
  end
  -- If we somehow ended in insert/visual anyway, force normal mode.
  pcall(function()
    if vim.api.nvim_get_mode().mode ~= "n" then
      vim.cmd("stopinsert")
      vim.api.nvim_feedkeys(
        vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "x!", false)
    end
  end)
  vim.v.errmsg = ""
end

-- Put the editor into the case's declared starting state.
local function setup_case(case)
  apply_default_options()

  -- per-case option overrides
  if case.options then
    for k, v in pairs(case.options) do
      vim.o[k] = v
    end
  end

  reset_fake_clipboard()
  clear_registers()

  -- clipboard handling: only ever through the fake provider
  if case.clipboard and case.clipboard ~= "" then
    vim.o.clipboard = case.clipboard
  else
    vim.o.clipboard = ""
  end
  if case.clipboard_init then
    for reg, val in pairs(case.clipboard_init) do
      local lines = type(val) == "table" and (val.lines or val) or { val }
      local rtype = type(val) == "table" and (val.regtype or "v") or "v"
      FAKE_CLIP[reg] = { lines, rtype }
      -- Also seed nvim's *internal* register. Necessary because clear_registers()
      -- above emptied it, and nvim does not always re-read the provider before
      -- a paste (it will happily paste an empty internal register and error
      -- with E353 "Nothing in register").
      pcall(vim.fn.setreg, reg, lines, rtype)
    end
  end

  -- pre-seed registers
  if case.registers then
    for reg, val in pairs(case.registers) do
      local lines = type(val) == "table" and (val.lines or val) or { val }
      local rtype = type(val) == "table" and (val.regtype or "v") or "v"
      vim.fn.setreg(reg, lines, rtype)
    end
  end

  fresh_buffer(case.lines or { "" }, case.filetype)

  -- 'commentstring' is BUFFER-local, so it has to be set after the buffer
  -- exists -- case.options above is applied through vim.o before there is
  -- one. With -u NONE --noplugin there are no ftplugins to supply a
  -- default, so a case that exercises gc/gcc must state it explicitly.
  if case.commentstring then
    vim.bo.commentstring = case.commentstring
  end

  local cur = case.cursor or { line = 1, col = 0 }
  local lc = vim.api.nvim_buf_line_count(0)
  local l = math.max(1, math.min(cur.line or 1, lc))
  local linetext = vim.api.nvim_buf_get_lines(0, l - 1, l, false)[1] or ""
  local c = math.max(0, math.min(cur.col or 0, math.max(0, #linetext - 0)))
  vim.api.nvim_win_set_cursor(0, { l, c })

  if case.topline then
    vim.fn.winrestview({ topline = case.topline })
  end

  apply_maps(case.maps)
end

-- Feed the case's keys once. `no_probe` disables the in-band <Cmd> snapshot.
local function execute_case(case, result, no_probe)
  _G.__oracle_snapshot_result = nil
  _G.__oracle_snapshot_want_regs = case.want_registers
  _G.__oracle_snapshot = function()
    local sok, s = pcall(capture_state, _G.__oracle_snapshot_want_regs)
    if sok then _G.__oracle_snapshot_result = s end
  end

  -- Capture any messages nvim emits (they otherwise leak onto stderr in
  -- headless mode and pollute the caller's output).
  pcall(vim.cmd, "silent! messages clear")
  local feed_ok, feed_err = pcall(feed, case.keys or "",
    { flags = case.flags, no_probe = no_probe })
  if not feed_ok then
    result.feed_error = tostring(feed_err)
  end
  pcall(drain)

  result.errmsg = vim.v.errmsg or ""
  local mok, msgs = pcall(vim.fn.execute, "messages", "silent")
  if mok and type(msgs) == "string" then
    msgs = msgs:gsub("^%s+", ""):gsub("%s+$", "")
    if msgs ~= "" then result.messages = vim.split(msgs, "\n") end
  else
    result.messages = nil
  end
end

local function run_case(case)
  local result = { id = case.id, ok = true }

  local ok, err = pcall(function()
    setup_case(case)
    execute_case(case, result, false)

    if _G.__oracle_snapshot_result then
      -- Probe fired: this is the true state, Insert/operator-pending included.
      result.state = _G.__oracle_snapshot_result
      result.state_source = "probe"
      local pok, post = pcall(capture_state, false)
      if pok then
        result.post_state = { mode = post.mode, cursor = post.cursor, lines = post.lines }
      end
    else
      -- The probe was swallowed as an operand (unterminated f/t/r/q/m/"/g/di...).
      -- Its bytes may have been typed into the buffer, so that run is garbage:
      -- reset and replay the case verbatim with no probe.
      result.probe_swallowed = true
      pcall(hard_reset_editor_state)
      pcall(clear_maps)
      setup_case(case)
      execute_case(case, result, true)
      result.state = capture_state(case.want_registers)
      result.state_source = "post"
    end
  end)

  if not ok then
    result.ok = false
    result.error = tostring(err)
    pcall(function() result.state = capture_state(false) end)
  end

  -- cleanup for next case
  pcall(hard_reset_editor_state)
  pcall(clear_maps)

  return result
end

--------------------------------------------------------------------------------
-- Main
--------------------------------------------------------------------------------

local function main()
  local job_path = os.getenv("ORACLE_JOB")
  local out_path = os.getenv("ORACLE_OUT")
  if not job_path or not out_path then
    io.stderr:write("ORACLE_JOB and ORACLE_OUT must be set\n")
    vim.cmd("cquit 2")
    return
  end

  apply_default_options()

  -- Guard: our determinism knobs must not have moved any semantically
  -- load-bearing option off nvim's default. If they have, every result in the
  -- batch is suspect, so fail loudly rather than emit wrong ground truth.
  local drift = semantic_option_drift()
  if #drift > 0 then
    error("REFUSING TO RUN: oracle changed semantic option(s) away from the "
      .. "nvim default, results would not be ground truth: "
      .. table.concat(drift, "; "))
  end

  local provider = install_fake_clipboard()
  assert_fake_clipboard(provider)

  local raw = read_file(job_path)
  local job = vim.json.decode(raw)

  local cases = job
  if type(job) == "table" and job.cases then cases = job.cases end

  local results = {}
  for i, case in ipairs(cases) do
    case.id = case.id or ("case_" .. i)
    local r
    local ok, err = pcall(run_case, case)
    if ok then
      r = err ~= nil and err or { id = case.id, ok = false, error = "nil result" }
      if type(r) ~= "table" then r = { id = case.id, ok = false, error = "bad result" } end
    else
      r = { id = case.id, ok = false, error = "fatal: " .. tostring(err) }
      pcall(hard_reset_editor_state)
      pcall(clear_maps)
    end
    results[#results + 1] = r
  end

  local out = {
    nvim_version = vim.fn.execute("version"):match("NVIM v[^\n]*") or "unknown",
    clipboard_provider = provider, -- must always be "oracle-fake"
    count = #results,
    results = results,
  }
  write_file(out_path, vim.json.encode(out))
  vim.cmd("qall!")
end

local ok, err = pcall(main)
if not ok then
  io.stderr:write("ORACLE FATAL: " .. tostring(err) .. "\n")
  pcall(function()
    local out_path = os.getenv("ORACLE_OUT")
    if out_path then
      write_file(out_path, vim.json.encode({ fatal = tostring(err), results = {} }))
    end
  end)
  vim.cmd("cquit 3")
end
