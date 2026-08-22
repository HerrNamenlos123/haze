#!/usr/bin/env bun
/**
 * Differential test driver: Haze vim_behavior vs real headless Neovim.
 *
 * Generates a deterministic pseudo-random corpus of (buffer, cursor, keys)
 * cases, runs each through BOTH the nvim oracle (vimtest/oracle/oracle.lua)
 * and the Haze implementation (vimtest/), then diffs the resulting state.
 *
 * Determinism: the case generator is seeded (`--seed`), uses its own PRNG,
 * and never touches Math.random or the clock, so a failing run is exactly
 * reproducible by re-running with the same seed.
 *
 *   bun run scripts/vim-difftest.ts                     # default corpus
 *   bun run scripts/vim-difftest.ts --seed 7 --count 400
 *   bun run scripts/vim-difftest.ts --remaps            # with the vimrc remaps
 *   bun run scripts/vim-difftest.ts --keys dw --lines "a b c"   # one-off
 *
 * Exit code is non-zero if any case mismatches, so this works in CI.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORACLE = join(REPO, "vimtest", "oracle", "oracle.lua");
const WORK = join(REPO, "vimtest", ".work");

/** Mulberry32: tiny, fast, fully deterministic from a 32-bit seed. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The user's real vimrc subset. Only the mappings whose semantics are
 * fully modelled by the Haze implementation are enabled by default --
 * the `:m` line-move maps and the easymotion `s` map expand to ex
 * commands that the implementation deliberately does not implement, so
 * including them would compare unimplemented behavior rather than
 * finding real bugs.
 */
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

/** Buffer shapes chosen to exercise the edge cases vim is fussy about. */
const CORPORA: string[][] = [
  ["hello world"],
  ["hello world", "second line here", "third"],
  ["  indented text", "next", ""],
  ["foo bar baz", "qux quux", "one two three four"],
  ["a", "b", "c", "d", "e"],
  ["", "nonempty", ""],
  ["camelCase and snake_case", "punct: (a) [b] {c}", "trailing   "],
  ["one(two)three", "'quoted' and \"double\"", "x"],
  ["    deep indent here", "\ttab line", "end"],
  ["single"],
  ["a b", "c d", "e f", "g h", "i j", "k l"],
];

/**
 * Key sequences to fuzz. Kept to the subset the implementation targets:
 * basic + word motions, find, operators, visual, undo, paste, counts.
 * Each entry is a template; the generator picks and sometimes prefixes a
 * count.
 */
const MOTIONS = [
  "h", "j", "k", "l", "w", "W", "b", "B", "e", "E",
  "0", "^", "$", "gg", "G", "{", "}",
  "fo", "fa", "Fo", "to", "Ta", "fo;", "fo,",
];

const OPERATORS = ["d", "y", "c", ">", "<"];
const TEXTOBJECTS = ["iw", "aw", "i(", "a(", 'i"', "i'"];

const SIMPLE_COMMANDS = [
  "x", "X", "D", "C", "Y", "J", "~", "p", "P", "u",
  "dd", "yy", "cc", "S",
  "ddp", "yyp", "ddu", "xu",
  "v", "V", "vl", "vw", "vj", "Vj", "vlo",
  "vd", "vy", "Vd", "Vy", "vlld", "viwd", "viwy",
  "ix<Esc>", "ax<Esc>", "Ix<Esc>", "Ax<Esc>", "ox<Esc>", "Ox<Esc>",
  "cwbye<Esc>", "ciwX<Esc>", "ra", "rb",
];

interface Case {
  id: string;
  lines: string[];
  cursor: { line: number; col: number };
  keys: string;
  maps?: { mode: string; lhs: string; rhs: string; noremap: boolean }[];
  // vim's 'commentstring', for gc/gcc cases. Both sides need it: with
  // -u NONE --noplugin nvim has no ftplugin to supply one, and the engine
  // would otherwise use its own default.
  commentstring?: string;
}

function generateCases(seed: number, count: number, withRemaps: boolean): Case[] {
  const rng = makeRng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  const cases: Case[] = [];

  for (let i = 0; i < count; i++) {
    const lines = pick(CORPORA);
    const line = 1 + Math.floor(rng() * lines.length);
    const maxCol = Math.max(0, lines[line - 1].length - 1);
    const col = maxCol > 0 ? Math.floor(rng() * (maxCol + 1)) : 0;

    // Build a key sequence: either a bare command, or operator+motion /
    // operator+textobject, optionally with a count.
    let keys: string;
    const roll = rng();
    if (roll < 0.4) {
      keys = pick(SIMPLE_COMMANDS);
    } else if (roll < 0.75) {
      keys = pick(OPERATORS) + pick(MOTIONS);
    } else if (roll < 0.9) {
      keys = pick(OPERATORS) + pick(TEXTOBJECTS);
    } else {
      keys = pick(MOTIONS);
    }
    // A count before v/V means "reuse the last visual selection's size"
    // (:h v_count), which this implementation deliberately does not
    // model -- see the note in applyCommand. Don't generate those.
    if (rng() < 0.25 && !/^[vV]/.test(keys)) {
      keys = String(2 + Math.floor(rng() * 3)) + keys;
    }

    cases.push({
      id: `c${i}`,
      lines,
      cursor: { line, col },
      keys,
      maps: withRemaps ? VIMRC_REMAPS : [],
    });
  }
  return cases;
}

function runOracle(cases: Case[]): any {
  const jobPath = join(WORK, "oracle-job.json");
  const outPath = join(WORK, "oracle-out.json");
  writeFileSync(jobPath, JSON.stringify({ cases }));
  const res = spawnSync(
    "nvim",
    ["--headless", "-u", "NONE", "-i", "NONE", "--noplugin", "--cmd", `lua dofile('${ORACLE}')`],
    { env: { ...process.env, ORACLE_JOB: jobPath, ORACLE_OUT: outPath }, stdio: ["ignore", "ignore", "ignore"] },
  );
  if (res.status !== 0) {
    throw new Error(`oracle exited ${res.status}`);
  }
  return JSON.parse(readFileSync(outPath, "utf8"));
}

function runHaze(cases: Case[]): any {
  const jobPath = join(WORK, "haze-job.json");
  const outPath = join(WORK, "haze-out.json");
  // Haze's json.parse requires every declared field to be present, so
  // fill in the optional ones rather than relying on defaults.
  const full = cases.map((c) => ({
    id: c.id,
    lines: c.lines,
    cursor: c.cursor,
    keys: c.keys,
    maps: (c.maps ?? []).map((m) => ({
      mode: m.mode,
      lhs: m.lhs,
      rhs: m.rhs,
      noremap: m.noremap,
    })),
    clipboard: "",
    // Haze's json.parse requires every declared field to be present, so
    // this is always emitted; "" means "leave the engine's default".
    commentstring: c.commentstring ?? "",
  }));
  writeFileSync(jobPath, JSON.stringify({ cases: full }));
  const res = spawnSync(
    "bun",
    ["run", "src/main.ts", "run", "--quiet", "--dir", "vimtest"],
    {
      cwd: REPO,
      env: { ...process.env, HAZE_VIM_JOB: jobPath, HAZE_VIM_OUT: outPath },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (res.status !== 0) {
    throw new Error(`haze harness exited ${res.status}:\n${res.stderr}\n${res.stdout}`);
  }
  return JSON.parse(readFileSync(outPath, "utf8"));
}

/** nvim reports visual-block as a raw 0x16; the Haze side uses a marker. */
function normalizeMode(mode: string): string {
  return mode === "\x16" ? "CTRL-V" : mode;
}

interface Mismatch {
  id: string;
  keys: string;
  lines: string[];
  cursor: { line: number; col: number };
  fields: string[];
  nvim: any;
  haze: any;
}

function compare(cases: Case[], oracle: any, haze: any): Mismatch[] {
  const byId = new Map<string, any>();
  for (const r of haze.results) byId.set(r.id, r);
  const mismatches: Mismatch[] = [];

  for (let i = 0; i < oracle.results.length; i++) {
    const o = oracle.results[i];
    const h = byId.get(o.id);
    const spec = cases[i];
    if (!o.ok || !h) continue;

    // A case whose probe was swallowed reports the settled post-<Esc>
    // state; compare against that instead of the live state.
    const os = o.probe_swallowed && o.post_state ? { ...o.state, ...o.post_state } : o.state;
    const hs = h.state;
    const bad: string[] = [];

    if (JSON.stringify(os.lines) !== JSON.stringify(hs.lines)) bad.push("lines");
    if (os.cursor.line !== hs.cursor.line || os.cursor.col !== hs.cursor.col) bad.push("cursor");
    if (normalizeMode(os.mode) !== normalizeMode(hs.mode)) bad.push("mode");

    // Registers: compare content and charwise/linewise-ness, which is
    // the usual source of paste bugs.
    const oreg = os.registers?.unnamed;
    if (oreg && (oreg.lines?.length ?? 0) > 0) {
      // The oracle already normalises regtype to charwise/linewise/
      // blockwise; pass it through rather than collapsing everything
      // that is not linewise into "charwise" (which never matched a
      // blockwise yank).
      const okind = oreg.kind;
      if (
        JSON.stringify(oreg.lines) !== JSON.stringify(hs.registerLines) ||
        okind !== hs.registerKind
      ) {
        bad.push("register");
      }
    }

    if (bad.length > 0) {
      mismatches.push({
        id: o.id,
        keys: spec.keys,
        lines: spec.lines,
        cursor: spec.cursor,
        fields: bad,
        nvim: {
          lines: os.lines,
          cursor: os.cursor,
          mode: normalizeMode(os.mode),
          register: oreg?.lines,
          kind: oreg?.kind,
        },
        haze: {
          lines: hs.lines,
          cursor: hs.cursor,
          mode: normalizeMode(hs.mode),
          register: hs.registerLines,
          kind: hs.registerKind,
        },
      });
    }
  }
  return mismatches;
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string, dflt: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const seed = Number(arg("seed", "1"));
  const count = Number(arg("count", "300"));
  const withRemaps = argv.includes("--remaps");
  const showAll = argv.includes("--all");
  const limit = Number(arg("limit", "25"));

  mkdirSync(WORK, { recursive: true });

  let cases: Case[];
  const casesJson = arg("cases-json", "");
  const oneKeys = arg("keys", "");
  if (casesJson) {
    // A fixed corpus piped in on stdin (see scripts/vim-core-cases.ts).
    const raw = casesJson === "-" ? readFileSync(0, "utf8") : readFileSync(casesJson, "utf8");
    cases = JSON.parse(raw);
  } else if (oneKeys) {
    const lines = arg("lines", "hello world").split("|");
    cases = [{
      id: "manual",
      lines,
      cursor: { line: Number(arg("line", "1")), col: Number(arg("col", "0")) },
      keys: oneKeys,
      maps: withRemaps ? VIMRC_REMAPS : [],
    }];
  } else {
    cases = generateCases(seed, count, withRemaps);
  }

  console.log(
    `running ${cases.length} cases (seed=${seed}${withRemaps ? ", remaps=on" : ""})`,
  );

  const oracle = runOracle(cases);
  if (oracle.clipboard_provider !== "oracle-fake") {
    console.error(
      `REFUSING: oracle clipboard provider is '${oracle.clipboard_provider}', not the fake one.`,
    );
    process.exit(3);
  }
  const haze = runHaze(cases);
  const mismatches = compare(cases, oracle, haze);

  // Group by (keys-shape, failing fields) so 200 failures from one bug
  // read as one line instead of 200.
  const groups = new Map<string, Mismatch[]>();
  for (const m of mismatches) {
    const shape = m.keys.replace(/[0-9]+/g, "N").replace(/f./g, "f?");
    const key = `${shape} [${m.fields.join(",")}]`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [key, ms] of showAll ? sorted : sorted.slice(0, limit)) {
    const m = ms[0];
    console.log(`\n${"=".repeat(70)}`);
    console.log(`${key}  (${ms.length}x)`);
    console.log(`  buffer ${JSON.stringify(m.lines)} cursor ${m.cursor.line},${m.cursor.col} keys ${JSON.stringify(m.keys)}`);
    console.log(`  nvim: ${JSON.stringify(m.nvim)}`);
    console.log(`  haze: ${JSON.stringify(m.haze)}`);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${cases.length - mismatches.length}/${cases.length} match, ${mismatches.length} mismatched, ${groups.size} distinct failure shapes`);
  process.exit(mismatches.length > 0 ? 1 : 0);
}

main();
