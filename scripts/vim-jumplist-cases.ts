#!/usr/bin/env bun
/**
 * Differential cases for the jump list -- <C-o> / <C-i>.
 *
 * A separate corpus rather than new entries in vim-core-cases.ts, for two
 * reasons. The core corpus is a cross product (every key against every
 * buffer/cursor pair), so one added key costs 20 cases and moves the 2680
 * figure the README pins as the regression gate. And the core buffers are
 * one to five lines long, where G, gg, { and } barely move -- a jump list
 * needs somewhere to jump.
 *
 * Only jumps vim and this engine agree on are used: G, gg, { and }. Real
 * vim also jumps on H M L ( ) % ' ` / ? n N, none of which this engine
 * implements, and <C-d>/<C-u> are excluded because the engine hardcodes a
 * 10-line half page while the oracle's window is 24 lines -- their cursor
 * displacement would mismatch for reasons that have nothing to do with
 * jumping.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");

// Tall enough that G/gg/{/} land far apart, with paragraph breaks so { and }
// have something to find, and varying indent/length so a restored COLUMN is
// distinguishable from a reset one.
const BUFFER: string[] = [
  "alpha one",
  "    beta two three",
  "gamma",
  "",
  "delta four",
  "  epsilon",
  "zeta six seven eight",
  "",
  "eta nine",
  "theta",
  "    iota ten eleven",
  "kappa",
  "",
  "lambda twelve",
  "mu thirteen fourteen",
  "nu",
  "",
  "xi fifteen",
  "omicron sixteen",
  "pi seventeen eighteen",
];

const POSITIONS = [
  { line: 1, col: 0 },
  { line: 7, col: 4 },
  { line: 11, col: 2 },
  { line: 15, col: 9 },
];

const KEYS: string[] = [
  // --- nothing to jump back to -------------------------------------
  "<C-o>",
  "<C-i>",
  "<C-o><C-o>",
  "<C-i><C-i>",
  // --- one jump, there and back ------------------------------------
  "G<C-o>",
  "G<C-o><C-i>",
  "G<C-o><C-i><C-o>",
  "gg<C-o>",
  "gg<C-o><C-i>",
  "}<C-o>",
  "{<C-o>",
  "}<C-o><C-i>",
  // --- several jumps, walking the list -----------------------------
  "gg G <C-o>".replace(/ /g, ""),
  "ggG<C-o><C-o>",
  "ggG<C-o><C-o><C-i>",
  "ggG<C-o><C-o><C-i><C-i>",
  "5G10G<C-o>",
  "5G10G<C-o><C-o>",
  "5G10G<C-o><C-o><C-i>",
  "5G10G15G<C-o><C-o><C-o>",
  "}}}<C-o><C-o>",
  "}}}<C-o><C-o><C-i>",
  "{{<C-o>",
  // --- walking off either end is a no-op, not a clamp --------------
  "5G<C-o><C-o><C-o><C-o>",
  "5G10G<C-i>",
  "5G10G<C-o><C-i><C-i>",
  // --- counts -------------------------------------------------------
  "5G10G15G2<C-o>",
  "5G10G15G3<C-o>",
  // 4 back with only 3 entries: vim does NOTHING rather than clamping.
  "5G10G15G4<C-o>",
  "5G10G15G3<C-o>2<C-i>",
  "5G10G15G2<C-o>2<C-i>",
  // --- a new jump while part-way back ------------------------------
  //     The case that separates vim's append+dedup from truncation.
  "5G10G<C-o>15G",
  "5G10G<C-o>15G<C-i>",
  "5G10G<C-o>15G<C-o>",
  "5G10G<C-o>15G<C-o><C-o>",
  "ggG<C-o>5G<C-o>",
  // --- duplicate lines collapse ------------------------------------
  "5G10G5G<C-o>",
  "5G10G5G<C-o><C-o>",
  "5G5G5G<C-o>",
  "ggggG<C-o>",
  // --- the column is restored, not reset ---------------------------
  "5G$10G<C-o>",
  "5G$10G<C-o><C-i>",
  "$G<C-o>",
  // --- non-jumps must not touch the list ---------------------------
  "5Gjjj<C-o>",
  "5Gw w w<C-o>".replace(/ /g, ""),
  "10Gkk<C-o>",
  // --- jumps mixed with edits --------------------------------------
  "GxggP<C-o>",
  "Gdd<C-o>",
  "ggdd G<C-o>".replace(/ /g, ""),
  // --- from visual mode --------------------------------------------
  "Gv<C-o>",
  "GV<C-o>",
];

interface Case {
  id: string;
  lines: string[];
  cursor: { line: number; col: number };
  keys: string;
  maps: { mode: string; lhs: string; rhs: string; noremap: boolean }[];
}

const withRemaps = process.argv.includes("--remaps");
// Same subset vim-core-cases.ts uses; <C-o> is remapped to <C-o>zz there, so
// running with --remaps also proves the remap layer does not disturb it.
const VIMRC_REMAPS = [
  { mode: "i", lhs: "jk", rhs: "<Esc>", noremap: true },
  { mode: "n", lhs: "j", rhs: "jzz", noremap: true },
  { mode: "n", lhs: "k", rhs: "kzz", noremap: true },
  { mode: "n", lhs: "<C-o>", rhs: "<C-o>zz", noremap: true },
  { mode: "n", lhs: "<C-d>", rhs: "<C-d>zz", noremap: true },
  { mode: "n", lhs: "<C-u>", rhs: "<C-u>zz", noremap: true },
  { mode: "v", lhs: "p", rhs: "P", noremap: true },
];

const cases: Case[] = [];
let n = 0;
for (const pos of POSITIONS) {
  for (const keys of KEYS) {
    cases.push({
      id: `jump${n++}`,
      lines: BUFFER,
      cursor: pos,
      keys,
      maps: withRemaps ? VIMRC_REMAPS : [],
    });
  }
}

console.error(`jumplist corpus: ${cases.length} cases`);
const result = spawnSync(
  "bun",
  [
    "run",
    join(REPO, "scripts", "vim-difftest.ts"),
    "--cases-json",
    "-",
    ...(withRemaps ? ["--remaps"] : []),
    ...process.argv.slice(2).filter((a) => a !== "--remaps"),
  ],
  { cwd: REPO, input: JSON.stringify(cases), stdio: ["pipe", "inherit", "inherit"] }
);
process.exit(result.status ?? 1);
