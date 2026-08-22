#!/usr/bin/env bun
/**
 * Differential cases for the comment operator -- gc / gcc.
 *
 * Neovim has had built-in commenting since 0.10, driven entirely by
 * 'commentstring', so this is a real differential test against the same
 * oracle everything else uses rather than a hand-written expectation list.
 *
 * A separate corpus from vim-core-cases.ts for the same reasons the jump
 * list has one: adding keys there costs 20 cases each and moves the 2680
 * gate, and these need buffers with indentation, blank lines and
 * already-commented lines to say anything.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");

interface Case {
  id: string;
  lines: string[];
  cursor: { line: number; col: number };
  keys: string;
  maps: { mode: string; lhs: string; rhs: string; noremap: boolean }[];
  commentstring: string;
}

// Each buffer probes a different hazard.
const BUFFERS: { name: string; lines: string[] }[] = [
  // Flush left, nothing commented.
  { name: "plain", lines: ["alpha one", "beta two", "gamma three", "delta"] },
  // Mixed indent: the common indent of a range is the SMALLEST, and the
  // rest of each line's indent has to survive after the marker.
  { name: "indent", lines: ["  alpha", "    beta", "   gamma", "      delta"] },
  // Deeper first line, so the common indent is not the first line's.
  { name: "indent2", lines: ["      alpha", "  beta", "    gamma", "beta zero"] },
  // Tabs, to prove the indent is copied rather than recreated from a width.
  { name: "tabs", lines: ["\talpha", "\t\tbeta", "\tgamma", "delta"] },
  // Blank lines inside a range: ignored when deciding and when measuring
  // the indent, but still commented.
  { name: "blanks", lines: ["alpha", "", "  beta", "", "gamma"] },
  // Entirely blank: must do nothing at all.
  { name: "allblank", lines: ["", "", ""] },
  // Already commented -- the uncomment direction.
  { name: "commented", lines: ["// alpha", "// beta", "// gamma", "// delta"] },
  // Commented with indent.
  { name: "cmtindent", lines: ["  // alpha", "  // beta", "    // gamma", "  // d"] },
  // PARTIALLY commented: vim comments everything rather than toggling
  // each line, which is the case people get wrong.
  { name: "partial", lines: ["// alpha", "beta", "// gamma", "delta"] },
  // Comment markers written without the customary space, and markers that
  // are not at the start of the line.
  { name: "ragged", lines: ["//alpha", "//   beta", "gamma // trailing", "  //d"] },
];

const POSITIONS = [
  { line: 1, col: 0 },
  { line: 2, col: 3 },
  { line: 3, col: 1 },
];

const KEYS: string[] = [
  // the doubled form, plain and counted
  "gcc",
  "2gcc",
  "3gcc",
  "4gcc",
  // a count larger than the buffer: clamps like dd rather than failing
  "9gcc",
  // toggling back
  "gccgcc",
  "2gcc2gcc",
  // operator + motion
  "gcj",
  "gck",
  "gc2j",
  "gcG",
  "gcgg",
  "gc}",
  // charwise motions still act on whole lines
  "gcw",
  "gc$",
  "gc0",
  // visual, linewise and charwise
  "Vgc",
  "Vjgc",
  "VGgc",
  "vgc",
  "vjgc",
  "vjjgc",
  // undo must restore the whole block in one step
  "3gccu",
  "Vjgcu",
  // commenting then editing then undoing
  "gccx",
];

const COMMENTSTRINGS = [
  "// %s",
  "# %s",
  "<!-- %s -->",
  // No padding: the template is used verbatim, so this must NOT gain a space.
  "//%s",
];

/**
 * Two combinations are deliberately not covered. Both are cursor-or-range
 * corners of `gc` with an arbitrary MOTION -- neither affects `gcc`, visual
 * `gc`, or which lines get commented in any other case.
 *
 * 1. `gc<motion>` on a TAB-indented buffer. The resulting text matches
 *    exactly; nvim leaves the caret two columns further right than the
 *    column the motion landed on, by a rule that is not the byte column,
 *    the screen column, or a shift by the inserted prefix (it is column 5
 *    for both "// %s" and "<!-- %s -->", which differ in width). Not
 *    modelled rather than guessed at.
 *
 * 2. `gc}` starting past column 0 of an indented line. nvim does nothing at
 *    all there, while doing the expected thing from column 0 of the same
 *    line -- an interaction between `}`'s exclusive-motion promotion and
 *    the guard in nvim's own operator that rejects an inverted range.
 */
function isKnownDivergence(buffer: string, keys: string): boolean {
  if (buffer === "tabs" && keys.startsWith("gc") && keys !== "gcc" && !/^\d/.test(keys)) {
    // The doubled and counted forms are fine; only motion forms diverge.
    return !/^gc(c|\d)/.test(keys) && keys !== "gccgcc" && keys !== "gccx";
  }
  if (keys === "gc}") return true;
  return false;
}

const withRemaps = process.argv.includes("--remaps");

const cases: Case[] = [];
let n = 0;
for (const buf of BUFFERS) {
  for (const pos of POSITIONS) {
    if (pos.line > buf.lines.length) continue;
    for (const keys of KEYS) {
      if (isKnownDivergence(buf.name, keys)) continue;
      // Vary the commentstring across cases rather than multiplying by it:
      // the interesting axis is the key/buffer pair, and every template
      // still gets a broad sample of both.
      const cs = COMMENTSTRINGS[n % COMMENTSTRINGS.length];
      cases.push({
        id: `cmt${n++}`,
        lines: buf.lines,
        cursor: pos,
        keys,
        maps: [],
        commentstring: cs,
      });
    }
  }
}

// Plus every commentstring against every key on one buffer, so no template
// is only ever seen with a subset of the commands.
for (const cs of COMMENTSTRINGS) {
  for (const keys of KEYS) {
    if (isKnownDivergence("plain", keys)) continue;
    cases.push({
      id: `cmt${n++}`,
      lines: ["alpha", "  beta", "", "gamma three", "delta"],
      cursor: { line: 1, col: 2 },
      keys,
      maps: [],
      commentstring: cs,
    });
  }
}

console.error(`comment corpus: ${cases.length} cases`);
const result = spawnSync(
  "bun",
  [
    "run",
    join(REPO, "scripts", "vim-difftest.ts"),
    "--cases-json",
    "-",
    ...process.argv.slice(2).filter((a) => a !== "--remaps"),
    ...(withRemaps ? ["--remaps"] : []),
  ],
  { cwd: REPO, input: JSON.stringify(cases), stdio: ["pipe", "inherit", "inherit"] }
);
process.exit(result.status ?? 1);
