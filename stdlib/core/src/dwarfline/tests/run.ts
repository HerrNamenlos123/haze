#!/usr/bin/env bun
/**
 * Tests the DWARF line-table reader (../dwarfline.h) and compares it with LLVM. See ../README.md.
 *
 *   bun stdlib/core/src/dwarfline/tests/run.ts                      unit tests + fixtures + every
 *                                                                   ELF executable in __haze__
 *   options: --executables=<dir,...>  where to look for real ELF executables (default: the
 *                                     repository's __haze__ and testsuite/.work)
 *            --no-executables         unit tests and fixtures only
 *            --jobs=N, --out=<dir>, --verbose
 *
 * Every check compares with the pinned LLVM (~/.haze/global/bin): llvm-dwarfdump --debug-line for
 * every unit, directory, file and row, llvm-symbolizer for the resolved file paths. Exit status 0
 * means every check passed. Nothing is skipped silently: what cannot run here is printed.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { cpus, homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const VERBOSE = flag("verbose");
const JOBS = Number(option("jobs") ?? Math.max(2, Math.min(8, cpus().length)));
const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const LIB_DIR = dirname(TESTS_DIR);
const REPO = resolve(LIB_DIR, "../../../..");
const OUT = option("out") ?? join(tmpdir(), "haze-dwarfline-tests");
const WINDOWS = process.platform === "win32";
const EXE = WINDOWS ? ".exe" : "";
const BIN = join(homedir(), ".haze", "global", "bin");
const CLANG = join(BIN, `clang${EXE}`);
const DWARFDUMP = join(BIN, `llvm-dwarfdump${EXE}`);
const SYMBOLIZER = join(BIN, `llvm-symbolizer${EXE}`);

let failures = 0;
const notRun: string[] = [];
const fail = (what: string, detail: string) => {
  failures++;
  console.log(`FAIL ${what}\n${detail}`);
};
const pass = (what: string) => console.log(`ok   ${what}`);

for (const tool of [CLANG, DWARFDUMP, SYMBOLIZER]) {
  if (!existsSync(tool)) {
    console.error(
      `missing ${tool}: build any Haze project once so the toolchain is downloaded`
    );
    process.exit(2);
  }
}

function run(cmd: string, argv: string[], input?: string) {
  const r = spawnSync(cmd, argv, {
    encoding: "utf8",
    input: input,
    maxBuffer: 1024 * 1024 * 1024,
  });
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function runAsync(
  cmd: string,
  argv: string[]
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const p = spawn(cmd, argv);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("close", (code) =>
      res({
        status: code ?? -1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      })
    );
  });
}

// ---------------------------------------------------------------------------------------------
// The host tools
// ---------------------------------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const hostFlags = ["-std=c11", "-Wall", "-Wextra", "-Werror", "-g"];
if (WINDOWS) {
  hostFlags.push("-D_CRT_SECURE_NO_WARNINGS");
} else {
  // Every read the library makes is checked against its bounds; the sanitizers prove it.
  hostFlags.push("-fsanitize=address,undefined", "-fno-sanitize-recover=all");
}
const DUMP = join(OUT, `dwarfline-dump${EXE}`);
const UNIT = join(OUT, `dwarfline-test${EXE}`);
for (const [src, out] of [
  ["dump.c", DUMP],
  ["dwarfline_test.c", UNIT],
] as const) {
  const r = run(CLANG, [...hostFlags, join(TESTS_DIR, src), "-o", out]);
  if (r.status !== 0) {
    console.error(`cannot build ${src}:\n${r.stdout}${r.stderr}`);
    process.exit(1);
  }
}
if (WINDOWS) {
  notRun.push("the sanitizers (ASan+UBSan) run on Linux only here");
}

{
  const r = run(UNIT, []);
  if (r.status === 0) {
    pass(`unit tests (${r.stdout.trim().split("\n").at(-1)})`);
  } else {
    fail("unit tests", r.stdout + r.stderr);
  }
}

// ---------------------------------------------------------------------------------------------
// llvm-dwarfdump --debug-line, in dump.c's line format
// ---------------------------------------------------------------------------------------------

function unescape(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|.)/g, (_, e: string) => {
    if (e[0] === "x") {
      return String.fromCharCode(Number.parseInt(e.slice(1), 16));
    }
    return { n: "\n", t: "\t", r: "\r", "0": "\0" }[e] ?? e;
  });
}

/** llvm-dwarfdump's output as dump.c prints it. */
function fromDwarfdump(text: string): string[] {
  const out: string[] = [];
  let unit: {
    offset: string;
    version: string;
    format: string;
    addressSize: string;
  } | null = null;
  let file: { index: string; name: string; dir: string; md5: string } | null =
    null;
  const flushFile = () => {
    if (file) {
      out.push(
        `file ${file.index} "${file.name}" dir ${file.dir}${file.md5 ? ` md5 ${file.md5}` : ""}`
      );
      file = null;
    }
  };
  const flushUnit = () => {
    if (unit) {
      const size =
        Number(unit.version) >= 5 ? ` address_size ${unit.addressSize}` : "";
      out.push(
        `unit ${unit.offset} version ${unit.version} ${unit.format}${size}`
      );
      unit = null;
    }
  };
  const flagOrder = [
    "is_stmt",
    "basic_block",
    "prologue_end",
    "epilogue_begin",
    "end_sequence",
  ];
  // Each rule: what a line looks like, and what it means; false when it does
  // not apply here (a unit or file field outside a unit or file).
  const unitField =
    (key: "format" | "version" | "addressSize") => (m: RegExpMatchArray) => {
      if (unit === null) {
        return false;
      }
      unit[key] = m[1];
      return true;
    };
  const fileField =
    (key: "name" | "dir" | "md5", convert: (v: string) => string) =>
    (m: RegExpMatchArray) => {
      if (file === null) {
        return false;
      }
      file[key] = convert(m[1]);
      return true;
    };
  const rules: [RegExp, (m: RegExpMatchArray) => boolean][] = [
    [
      /^debug_line\[(0x[0-9a-f]+)\]/,
      (m) => {
        flushFile();
        unit = { offset: m[1], version: "", format: "", addressSize: "" };
        return true;
      },
    ],
    [/^\s+format: (DWARF\d+)/, unitField("format")],
    [/^\s+version: (\d+)/, unitField("version")],
    [/^\s*address_size: (\d+)/, unitField("addressSize")],
    [
      /^include_directories\[\s*(\d+)\] = "(.*)"$/,
      (m) => {
        flushUnit();
        out.push(`dir ${m[1]} "${unescape(m[2])}"`);
        return true;
      },
    ],
    [
      /^file_names\[\s*(\d+)\]:/,
      (m) => {
        flushUnit();
        flushFile();
        file = { index: m[1], name: "", dir: "", md5: "" };
        return true;
      },
    ],
    [/^\s+name: "(.*)"$/, fileField("name", unescape)],
    [/^\s+dir_index: (\d+)/, fileField("dir", (v) => v)],
    [/^\s+md5_checksum: ([0-9a-f]+)/, fileField("md5", (v) => v)],
    [
      /^(0x[0-9a-f]{16})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/,
      (m) => {
        flushUnit();
        flushFile();
        const flags = m[8].trim().split(/\s+/).filter(Boolean);
        flags.sort((a, b) => flagOrder.indexOf(a) - flagOrder.indexOf(b));
        out.push(["row", ...m.slice(1, 8), ...flags].join(" "));
        return true;
      },
    ],
    [
      /^Address\s+Line/,
      () => {
        flushUnit();
        flushFile();
        return true;
      },
    ],
  ];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    for (const [pattern, apply] of rules) {
      const m = line.match(pattern);
      if (m && apply(m)) {
        break;
      }
    }
  }
  flushFile();
  flushUnit();
  return out;
}

const PATH_LINE = /^path /;

/** Compares one ELF file; returns null when identical, else what differs. */
async function compare(elf: string): Promise<string | null> {
  const [mine, theirs] = await Promise.all([
    runAsync(DUMP, [elf, "--paths"]),
    runAsync(DWARFDUMP, ["--debug-line", elf]),
  ]);
  if (mine.status !== 0) {
    return `dwarfline-dump failed (${mine.status}): ${mine.stdout.split("\n").at(-2) ?? ""}${mine.stderr}`;
  }
  if (theirs.status !== 0 || /warning|error/i.test(theirs.stderr)) {
    return `llvm-dwarfdump: ${theirs.stderr.trim()}`;
  }
  const mineLines = mine.stdout
    .split(/\r?\n/)
    .filter((l) => l && !PATH_LINE.test(l));
  const theirLines = fromDwarfdump(theirs.stdout);
  const n = Math.max(mineLines.length, theirLines.length);
  for (let i = 0; i < n; i++) {
    if (mineLines[i] !== theirLines[i]) {
      return `line ${i + 1} of ${n}:\n  dwarfline: ${mineLines[i] ?? "(nothing)"}\n  llvm:      ${theirLines[i] ?? "(nothing)"}`;
    }
  }
  return comparePaths(elf, mine.stdout);
}

/**
 * The resolved paths, against llvm-symbolizer: for rows whose address no other row of the same
 * unit has (so both pick the same row), in DWARF 5 units (before 5, directory 0 is the
 * compilation directory, which only .debug_info names: see README.md).
 */
async function comparePaths(elf: string, dump: string): Promise<string | null> {
  const queries: { address: string; expected: string }[] = [];
  let version = 0;
  let paths = new Map<string, string>();
  let rows: string[][] = [];
  const flush = () => {
    if (version >= 5) {
      const count = new Map<string, number>();
      for (const r of rows) {
        count.set(r[1], (count.get(r[1]) ?? 0) + 1);
      }
      const seen = new Set<string>();
      for (const r of rows) {
        if (
          count.get(r[1]) !== 1 ||
          r.includes("end_sequence") ||
          r[2] === "0" ||
          seen.has(r[1])
        ) {
          continue;
        }
        seen.add(r[1]);
        const path = paths.get(r[4]);
        if (path !== undefined) {
          queries.push({ address: r[1], expected: `${path}:${r[2]}:${r[3]}` });
        }
      }
    }
    paths = new Map();
    rows = [];
  };
  for (const line of dump.split(/\r?\n/)) {
    const unitLine = line.match(/^unit \S+ version (\d+)/);
    const pathLine = line.match(/^path (\d+) "(.*)"$/);
    if (unitLine) {
      flush();
      version = Number(unitLine[1]);
    } else if (pathLine) {
      paths.set(pathLine[1], pathLine[2]);
    } else if (line.startsWith("row ")) {
      rows.push(line.split(" "));
    }
  }
  flush();
  if (queries.length === 0) {
    return null;
  }
  const sample =
    queries.length > 2000
      ? queries.filter((_, i) => i % Math.ceil(queries.length / 2000) === 0)
      : queries;
  const r = run(
    SYMBOLIZER,
    [`--obj=${elf}`, "--no-inlines", "--functions=none"],
    sample.map((q) => q.address).join("\n")
  );
  if (r.status !== 0) {
    return `llvm-symbolizer failed: ${r.stderr}`;
  }
  const answers = r.stdout
    .split(/\r?\n\r?\n/)
    .map((a) => a.trim())
    .filter(Boolean);
  const norm = (p: string) => (WINDOWS ? p.replaceAll("\\", "/") : p);
  for (let i = 0; i < sample.length; i++) {
    if (norm(answers[i] ?? "") !== norm(sample[i].expected)) {
      return `path of ${sample[i].address}:\n  dwarfline: ${sample[i].expected}\n  llvm:      ${answers[i]}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Fixtures: ELF executables built here, for every layout the reader claims to cover
// ---------------------------------------------------------------------------------------------

const FIXTURES = ["fixture_a.c", "fixture_b.c"].map((f) =>
  join(TESTS_DIR, "fixtures", f)
);
const TARGETS = [
  { triple: "x86_64-linux-gnu", what: "ELF64 little endian" },
  { triple: "aarch64-linux-gnu", what: "ELF64 little endian" },
  { triple: "i386-linux-gnu", what: "ELF32 little endian" },
  { triple: "powerpc64-linux-gnu", what: "ELF64 big endian" },
  { triple: "powerpc-linux-gnu", what: "ELF32 big endian" },
];
const DWARF = [
  ["-gdwarf-5"],
  ["-gdwarf-5", "-gdwarf64"],
  ["-gdwarf-4"],
  ["-gdwarf-3"],
  ["-gdwarf-2"],
];
const OPT = ["-O0", "-O2"];

const fixtureJobs: { name: string; elf: string; argv: string[] }[] = [];
for (const t of TARGETS) {
  for (const d of DWARF) {
    for (const o of OPT) {
      if (
        d.includes("-gdwarf64") &&
        (t.triple.startsWith("i386") || t.triple === "powerpc-linux-gnu")
      ) {
        continue; // DWARF64 needs a 64-bit target
      }
      const name = `${t.triple} ${d.join(" ")} ${o}`;
      const elf = join(OUT, `${t.triple}${d.join("")}${o}.elf`);
      fixtureJobs.push({
        name: name,
        elf: elf,
        argv: [
          `--target=${t.triple}`,
          ...d,
          o,
          "-ffreestanding",
          "-nostdlib",
          "-static",
          "-fuse-ld=lld",
          "-Wl,-e,fixture_start",
          ...FIXTURES,
          "-o",
          elf,
        ],
      });
    }
  }
}

async function pool<T>(items: T[], fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(JOBS, items.length) }, async () => {
      while (next < items.length) {
        await fn(items[next++]);
      }
    })
  );
}

await pool(fixtureJobs, async (job) => {
  const built = await runAsync(CLANG, job.argv);
  if (built.status !== 0) {
    fail(`fixture ${job.name}: build`, built.stderr);
    return;
  }
  const diff = await compare(job.elf);
  if (diff === null) {
    if (VERBOSE) {
      pass(`fixture ${job.name}`);
    }
  } else {
    fail(`fixture ${job.name}`, diff);
  }
});
if (failures === 0) {
  pass(
    `fixtures: ${fixtureJobs.length} built and compared (${TARGETS.length} targets, DWARF 2 to 5, DWARF64, -O0/-O2)`
  );
}

// ---------------------------------------------------------------------------------------------
// Every real ELF executable this checkout has built
// ---------------------------------------------------------------------------------------------

function isElfExecutable(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return false;
  }
  const head = Buffer.alloc(18);
  const n = readSync(fd, head, 0, 18, 0);
  closeSync(fd);
  if (n < 18 || head.readUInt32BE(0) !== 0x7f_45_4c_46) {
    return false;
  }
  const type = head[5] === 2 ? head.readUInt16BE(16) : head.readUInt16LE(16);
  return type === 2 || type === 3;
}

function findElf(dir: string, found: string[]) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      findElf(p, found);
    } else if (st.isFile() && st.size > 64 && isElfExecutable(p)) {
      found.push(p);
    }
  }
}

if (!flag("no-executables")) {
  const dirs = option("executables")?.split(",") ?? [
    join(REPO, "__haze__"),
    join(REPO, "testsuite", ".work"),
  ];
  const found: string[] = [];
  for (const d of dirs) {
    findElf(d, found);
  }
  const unique = found;
  let compared = 0;
  let withoutLines = 0;
  await pool(unique, async (elf) => {
    const mine = await runAsync(DUMP, [elf]);
    if (mine.status !== 0 && mine.stdout.startsWith("error -5 ")) {
      withoutLines++; // no .debug_line at all: nothing to compare (a stripped or non-debug build)
      return;
    }
    const diff = await compare(elf);
    compared++;
    if (diff !== null) {
      fail(`executable ${elf}`, diff);
    } else if (VERBOSE) {
      pass(`executable ${elf}`);
    }
  });
  if (unique.length === 0) {
    notRun.push(
      `real executables: no ELF executable under ${dirs.join(", ")} (Windows builds PE files)`
    );
  } else {
    pass(
      `real executables: ${compared} compared, ${withoutLines} without .debug_line`
    );
  }
} else {
  notRun.push("real executables (--no-executables)");
}

for (const n of notRun) {
  console.log(`NOT RUN ${n}`);
}
console.log(failures === 0 ? "ALL PASSED" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
