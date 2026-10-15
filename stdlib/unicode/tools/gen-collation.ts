// Generates src/ffi/haze_collation_data.h, the table behind unicode.collate()
// and unicode.collationKey(), from CLDR's root collation data.
//
//   bun run stdlib/unicode/tools/gen-collation.ts <allkeys_CLDR.txt>
//
// allkeys_CLDR.txt is the CLDR root collation in DUCET's text format: it is
// what ICU's root (and so its "de", "en", ... standard) order is built from.
// Get it from the CLDR release that matches the Unicode version of the
// vendored utf8proc (which normalizes the input), e.g. for Unicode 16:
//   https://raw.githubusercontent.com/unicode-org/cldr/release-47/common/uca/allkeys_CLDR.txt
//
// Run it with a JavaScript engine of the same Unicode version too: the
// Unified_Ideograph ranges and the NFD test below come from the engine.
//
// What the table holds, and what it leaves out on purpose:
//   - One entry per code point that is its own NFD. haze_collation.c turns
//     its input into NFD first (as UCA requires), so a precomposed letter
//     never reaches the table -- its decomposition does, and DUCET gives
//     both the same weights.
//   - Contractions (sequences with their own weights, e.g. Thai prevowels).
//   - Nothing for Hangul syllables (NFD turns them into jamo) or for code
//     points UCA weighs by formula (CJK ideographs, unassigned ones): those
//     get "implicit weights", computed in haze_collation.c from the ranges
//     emitted here.

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const source = process.argv[2];
if (!source) {
  console.error("usage: bun run gen-collation.ts <allkeys_CLDR.txt>");
  process.exit(1);
}
const outPath = join(import.meta.dir, "..", "src", "ffi", "haze_collation_data.h");

type CE = [number, number, number];
const singles = new Map<number, CE[]>();
const contractions: { cps: number[]; ces: CE[] }[] = [];
let version = "";

for (const raw of readFileSync(source, "utf8").split("\n")) {
  const line = raw.split("#")[0].trim();
  if (line.startsWith("@version")) {
    version = line.split(/\s+/)[1];
    continue;
  }
  if (!line || line.startsWith("@")) continue;
  const [cpsPart, cesPart] = line.split(";");
  const cps = cpsPart.trim().split(/\s+/).map((h) => parseInt(h, 16));
  const ces = [...cesPart.matchAll(/\[[.*]([0-9A-F]{4})\.([0-9A-F]{4})\.([0-9A-F]{4})\]/g)].map(
    (m) => [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] as CE,
  );
  if (ces.length === 0) throw new Error(`no collation elements in: ${raw}`);
  if (cps.length === 1) singles.set(cps[0], ces);
  else contractions.push({ cps, ces });
}
if (!version) throw new Error("no @version line");

const isNfd = (cp: number) => {
  const s = String.fromCodePoint(cp);
  return s.normalize("NFD") === s;
};

// A CE packs into 32 bits: primary 16, secondary 9, tertiary 5.
// haze_collation.c writes a primary below 0x100 with a first byte of 0x01,
// which is only order-preserving while no primary starts with 0x01.
const pack = ([p, s, t]: CE) => {
  if (p > 0xffff || s > 0x1ff || t > 0x1f) throw new Error(`weight out of range: ${p} ${s} ${t}`);
  if (p >= 0x100 && p < 0x200) throw new Error(`primary ${p.toString(16)} collides with the low-primary encoding`);
  return ((p << 16) | (s << 5) | t) >>> 0;
};

const ces: number[] = [];

// stage1: per block of 256 code points, 0 for a block with no entries, else
// 1 + its index into stage2. stage2: per block, where each code point's CEs
// start in `ces`, plus one more for where the last one's end -- so a code
// point's CE count is the difference of two neighbours, and 0 means "not in
// the table".
const blockCount = 0x110000 >> 8;
const stage1: number[] = new Array(blockCount).fill(0);
const stage2: number[][] = [];
for (let block = 0; block < blockCount; block++) {
  let any = false;
  for (let low = 0; low < 256 && !any; low++) {
    const cp = (block << 8) | low;
    any = singles.has(cp) && isNfd(cp);
  }
  if (!any) continue;
  const starts: number[] = [];
  for (let low = 0; low < 256; low++) {
    const cp = (block << 8) | low;
    starts.push(ces.length);
    const entry = singles.get(cp);
    if (entry && isNfd(cp)) for (const ce of entry) ces.push(pack(ce));
  }
  starts.push(ces.length);
  stage2.push(starts);
  stage1[block] = stage2.length;
}

// Contractions whose code points are all NFD (the input is NFD, so no other
// spelling can occur), sorted so the C side can binary-search by the first
// code point and then try the longest match.
const usable = contractions
  .filter((c) => c.cps.every(isNfd))
  .sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      const x = a.cps[i] ?? -1;
      const y = b.cps[i] ?? -1;
      if (x !== y) return x - y;
    }
    return 0;
  });
const contractionRows: string[] = [];
for (const c of usable) {
  if (c.cps.length > 3) throw new Error(`contraction longer than 3: ${c.cps}`);
  const start = ces.length;
  for (const ce of c.ces) ces.push(pack(ce));
  const cps = [...c.cps, 0, 0].slice(0, 3);
  contractionRows.push(`  { { 0x${cps.map((x) => x.toString(16).toUpperCase()).join(", 0x")} }, ${c.cps.length}, ${start}, ${c.ces.length} },`);
}
if (ces.length > 0xffff) throw new Error(`too many collation elements for 16-bit offsets: ${ces.length}`);

// The code points that start a contraction, for a cheap "can a contraction
// start here" test before any search.
const contractionStarters = [...new Set(usable.map((c) => c.cps[0]))].sort((a, b) => a - b);

// Unified_Ideograph ranges, split the way UCA's implicit weights need them:
// those in the CJK Unified Ideographs / CJK Compatibility Ideographs blocks
// get base FB40, every other one FB80.
const ideographRanges: [number, number, number][] = [];
for (let cp = 0; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  if (!/\p{Unified_Ideograph}/u.test(String.fromCodePoint(cp))) continue;
  const core = (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff);
  const base = core ? 0xfb40 : 0xfb80;
  const last = ideographRanges[ideographRanges.length - 1];
  if (last && last[1] === cp - 1 && last[2] === base) last[1] = cp;
  else ideographRanges.push([cp, cp, base]);
}

const digitZero = singles.get(0x30)!;
if (digitZero.length !== 1) throw new Error("DIGIT ZERO must have exactly one CE");
for (let d = 0; d <= 9; d++) {
  const e = singles.get(0x30 + d)!;
  if (e.length !== 1 || e[0][0] !== digitZero[0][0] + d) throw new Error("digits must have consecutive primaries");
}

const hex = (n: number, w = 4) => "0x" + n.toString(16).toUpperCase().padStart(w, "0");
// Unpadded: the tables are large, and this keeps the header at half the size.
const rows = (values: number[], format: (n: number) => string, perLine: number) => {
  const out: string[] = [];
  for (let i = 0; i < values.length; i += perLine) {
    out.push("  " + values.slice(i, i + perLine).map(format).join(",") + ",");
  }
  return out.join("\n");
};
const dec = (n: number) => n.toString();
const shortHex = (n: number) => "0x" + n.toString(16).toUpperCase();

const text = `// GENERATED by stdlib/unicode/tools/gen-collation.ts from CLDR's
// allkeys_CLDR.txt (UCA ${version}). Do not edit; regenerate instead.
// See haze_collation.c for how the tables are used.

#ifndef HAZE_COLLATION_DATA_H
#define HAZE_COLLATION_DATA_H

#include <stdint.h>

#define HAZE_COLLATION_UCA_VERSION "${version}"

// The primary weight of DIGIT ZERO; digits 1-9 follow it consecutively.
#define HAZE_COLLATION_DIGIT_ZERO_PRIMARY ${hex(digitZero[0][0])}

#define HAZE_COLLATION_BLOCK_COUNT ${stage2.length}
#define HAZE_COLLATION_CONTRACTION_COUNT ${usable.length}
#define HAZE_COLLATION_CONTRACTION_STARTER_COUNT ${contractionStarters.length}
#define HAZE_COLLATION_IDEOGRAPH_RANGE_COUNT ${ideographRanges.length}

typedef struct {
  uint32_t codepoints[3];
  uint8_t length;
  uint16_t ce_start;
  uint8_t ce_count;
} haze_collation_contraction_t;

typedef struct {
  uint32_t first;
  uint32_t last;
  uint16_t base;
} haze_collation_ideograph_range_t;

static const uint16_t haze_collation_stage1[${blockCount}] = {
${rows(stage1, dec, 32)}
};

static const uint16_t haze_collation_stage2[${stage2.length}][257] = {
${stage2.map((s) => "  {\n" + rows(s, dec, 32).replace(/^ {2}/gm, "    ") + "\n  },").join("\n")}
};

// primary << 16 | secondary << 5 | tertiary
static const uint32_t haze_collation_ces[${ces.length}] = {
${rows(ces, shortHex, 12)}
};

static const haze_collation_contraction_t haze_collation_contractions[${usable.length}] = {
${contractionRows.join("\n")}
};

static const uint32_t haze_collation_contraction_starters[${contractionStarters.length}] = {
${rows(contractionStarters, shortHex, 12)}
};

static const haze_collation_ideograph_range_t haze_collation_ideograph_ranges[${ideographRanges.length}] = {
${ideographRanges.map(([a, b, base]) => `  { ${hex(a, 5)}, ${hex(b, 5)}, ${hex(base)} },`).join("\n")}
};

#endif // HAZE_COLLATION_DATA_H
`;
writeFileSync(outPath, text);
console.log(`wrote ${outPath}: ${stage2.length} blocks, ${ces.length} CEs, ${usable.length} contractions, ${ideographRanges.length} ideograph ranges`);
