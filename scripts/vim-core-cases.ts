#!/usr/bin/env bun
/**
 * The CORE case list: every editing operation the user actually asked to
 * be rock solid -- "basic motions, word motions, finding, select, line
 * select, centering the cursor on every motion, copy, paste, undo, jump
 * back, comment" -- exercised over several buffer shapes and cursor
 * positions.
 *
 * Unlike the fuzzer (scripts/vim-difftest.ts) this list is fixed and
 * exhaustive over the supported surface rather than random, so it is the
 * regression gate: it must stay at 100%.
 *
 *   bun run scripts/vim-core-cases.ts            # core subset
 *   bun run scripts/vim-core-cases.ts --remaps   # same, with the vimrc
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const BUFFERS: string[][] = [
  ["hello world"],
  ["hello world", "second line here", "third"],
  ["  indented text", "next", ""],
  ["foo bar baz", "qux quux", "one two three four"],
  ["a", "b", "c", "d", "e"],
  ["one(two)three", "'quoted' and \"double\"", "x"],
];

// Cursor positions probed on every buffer: start, middle, end of line.
const POSITIONS = [
  { line: 1, col: 0 },
  { line: 1, col: 3 },
  { line: 2, col: 0 },
  { line: 2, col: 2 },
];

/** Every command in the supported subset. */
const CORE_KEYS = [
  // basic motions
  "h", "l", "j", "k", "0", "^", "$", "gg", "G", "2j", "3l", "2k",
  // word motions
  "w", "W", "b", "B", "e", "E", "2w", "3w", "2b", "2e",
  // find
  "fo", "Fo", "to", "To", "fo;", "fo,", "2fo",
  // paragraph
  "{", "}",
  // select (visual) + line select + block select
  "v", "V", "vl", "vw", "vj", "Vj", "vlo", "viw", "vaw",
  "Vk", "Vjd", "Vjy", "VjD", "Vj>", "Vj<", "VyjP", "Vp",
  // A count before a visual-mode `>`/`<` is a number of INDENT LEVELS,
  // not a number of lines the way `3>>` is in normal mode. It used to be
  // dropped entirely, so `V3>` indented once.
  "V2>", "V3>", "Vj2>", "vj3>", "V2<", "V3<", "Vj2<",
  "<C-v>", "<C-v>jl", "<C-v>jld", "<C-v>jly", "<C-v>jjl", "<C-v>l", "<C-v>jd",
  // operators over motions
  "dw", "dW", "de", "db", "d$", "d0", "dj", "dk", "diw", "daw", "di(", 'di"',
  "yw", "ye", "yiw", "yaw", "y$", "yy", "2yy",
  "cw", "ce", "ciw", "caw", "c$",
  // line operators
  "dd", "2dd", "3dd", "D", "C", "S", "Y",
  // simple edits
  "x", "X", "3x", "J", "~", "rz", "2rz",
  // copy / paste
  "yyp", "yyP", "ddp", "ddP", "yiwP", "diwp",
  // undo / redo -- including chains, since an insert session must undo
  // as ONE step (vim groups it) and multi-step chains exposed real bugs
  "ddu", "xu", "dwu", "ddup", "xu<C-r>",
  "xxu", "xxuu", "xxuuu", "xxxxxuuuuu", "dddduu", "ddjddu",
  "xu<C-r>", "xxuu<C-r><C-r>", "cwXYZ<Esc>u", "oNEW<Esc>u", "oNEW<Esc>u<C-r>",
  "Ju", "yyjpu", "3ddu", "Vjdu", "ihello<Esc>u", "ia<Esc>ib<Esc>uu",
  // insert-mode entry and exit
  "iX<Esc>", "aX<Esc>", "IX<Esc>", "AX<Esc>", "oX<Esc>", "OX<Esc>",
  "cwX<Esc>", "ciwX<Esc>", "2iX<Esc>",
  // indent
  ">>", "<<", ">j", ">iw",
];

interface Case {
  id: string;
  lines: string[];
  cursor: { line: number; col: number };
  keys: string;
  maps: { mode: string; lhs: string; rhs: string; noremap: boolean }[];
}

const VIMRC_REMAPS = [
  { mode: "i", lhs: "jk", rhs: "<Esc>", noremap: true },
  { mode: "n", lhs: "j", rhs: "jzz", noremap: true },
  { mode: "n", lhs: "k", rhs: "kzz", noremap: true },
  { mode: "n", lhs: "<space>aa", rhs: "ggVG", noremap: true },
  { mode: "v", lhs: "p", rhs: "P", noremap: true },
  { mode: "n", lhs: "<C-d>", rhs: "<C-d>zz", noremap: true },
  { mode: "n", lhs: "<C-u>", rhs: "<C-u>zz", noremap: true },
  { mode: "n", lhs: "<C-o>", rhs: "<C-o>zz", noremap: true },
  { mode: "n", lhs: "n", rhs: "nzzzv", noremap: true },
  { mode: "n", lhs: "N", rhs: "Nzzzv", noremap: true },
];

function main() {
  const withRemaps = process.argv.includes("--remaps");
  const cases: Case[] = [];
  let n = 0;
  for (const lines of BUFFERS) {
    for (const pos of POSITIONS) {
      if (pos.line > lines.length) continue;
      if (pos.col > Math.max(0, lines[pos.line - 1].length - 1)) continue;
      for (const keys of CORE_KEYS) {
        cases.push({
          id: `core${n++}`,
          lines,
          cursor: pos,
          keys,
          maps: withRemaps ? VIMRC_REMAPS : [],
        });
      }
    }
  }

  // Reuse the fuzz driver's oracle/haze/compare plumbing by handing it
  // this fixed corpus through a temp module-level hook.
  const res = spawnSync(
    "bun",
    ["run", join(REPO, "scripts", "vim-difftest.ts"), "--cases-json", "-", ...(withRemaps ? ["--remaps"] : [])],
    { cwd: REPO, input: JSON.stringify(cases), stdio: ["pipe", "inherit", "inherit"] },
  );
  process.exit(res.status ?? 1);
}

main();
