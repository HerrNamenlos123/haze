#!/usr/bin/env bun
/**
 * Builds and runs the fiber tests on every target this machine can reach, and prints one result
 * matrix. Nothing is skipped silently: a target or check that cannot run here is listed with
 * the reason. See ../README.md for what each check proves.
 *
 *   bun stdlib/core/src/fiber/tests/run.ts            the default suite
 *   bun stdlib/core/src/fiber/tests/run.ts --deep     + mutants, gdb, Valgrind, many seeds, scale
 *   options: --mutants (the default suite + mutants), --only=<target,...>, --jobs=N,
 *            --bdwgc=<dir> (BDWGC source; default ~/.haze/tmp/bdwgc-builddir),
 *            --out=<dir> (build directory; default <tmp>/haze-fiber-tests), --verbose
 *
 * Exit status 0 means every check that ran passed and every check this machine's target set
 * requires actually ran.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { cpus, homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import whichSync from "which";

// ---------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const DEEP = flag("deep");
const MUTANTS = DEEP || flag("mutants");
const VERBOSE = flag("verbose");
const ONLY = option("only")?.split(",");
const JOBS = Number(option("jobs") ?? Math.max(2, cpus().length));
const TESTS_DIR = import.meta.dir;
const LIB_DIR = dirname(TESTS_DIR);
const OUT = option("out") ?? join(tmpdir(), "haze-fiber-tests");
const HOST_OSES: Record<string, "win32" | "linux"> = {
  win32: "win32",
  linux: "linux",
};
const HOST_ARCHES: Record<string, "x64" | "arm64"> = {
  x64: "x64",
  arm64: "arm64",
};
const HOST_OS = HOST_OSES[process.platform] ?? null;
const HOST_ARCH = HOST_ARCHES[process.arch] ?? null;
const EXE = HOST_OS === "win32" ? ".exe" : "";
const HAZE_BIN = join(homedir(), ".haze", "global", "bin");
const BDWGC =
  option("bdwgc") ?? join(homedir(), ".haze", "tmp", "bdwgc-builddir");
const FAST_TIMEOUT = 300_000;
const MUTANT_TIMEOUT = 120_000;
const DEEP_TIMEOUT = 3_600_000;

const TARGET_NAMES = ["linux-x64", "linux-arm64", "win32-x64", "win32-arm64"];
const unknownTargets = (ONLY ?? []).filter((t) => !TARGET_NAMES.includes(t));
if (unknownTargets.length) {
  console.error(
    `--only: unknown target ${unknownTargets.join(", ")} (known: ${TARGET_NAMES.join(", ")})`
  );
  process.exit(2);
}
if (HOST_OS === null || HOST_ARCH === null) {
  console.error(
    `fiber tests: unsupported host ${process.platform}-${process.arch}`
  );
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------------------------

type RunResult = {
  code: number | null;
  signal: string | null;
  out: string;
  ms: number;
  timedOut: boolean;
};

async function run(
  cmd: string[],
  opts: { env?: Record<string, string>; timeout?: number; cwd?: string } = {}
) {
  const start = performance.now();
  if (VERBOSE) {
    console.log(
      "$ " + cmd.map((c) => (c.includes(" ") ? JSON.stringify(c) : c)).join(" ")
    );
  }
  // Never in the source tree, and no core dumps from the deliberate crashes (qemu writes them to cwd).
  const argv =
    HOST_OS === "linux"
      ? ["sh", "-c", 'ulimit -c 0; exec "$@"', "sh", ...cmd]
      : cmd;
  const proc = spawn(argv[0], argv.slice(1), {
    cwd: opts.cwd ?? OUT,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  proc.stdout.on("data", (chunk) => {
    out += chunk;
  });
  proc.stderr.on("data", (chunk) => {
    out += chunk;
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, opts.timeout ?? FAST_TIMEOUT);
  const [code, signal] = await new Promise<[number | null, string | null]>(
    (resolve) => {
      proc.on("error", (error) => {
        out += String(error);
        resolve([127, null]);
      });
      proc.on("close", (exitCode, exitSignal) =>
        resolve([exitCode, exitSignal])
      );
    }
  );
  clearTimeout(timer);
  const result: RunResult = {
    code: code,
    signal: signal,
    out: out,
    ms: performance.now() - start,
    timedOut: timedOut,
  };
  return result;
}

/** Runs `fns` with at most JOBS at a time. */
async function pool<T>(fns: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = new Array(fns.length);
  let next = 0;
  async function worker() {
    while (next < fns.length) {
      const i = next++;
      results[i] = await fns[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(JOBS, fns.length) }, worker));
  return results;
}

function which(name: string): string | null {
  return whichSync.sync(name, { nothrow: true });
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

type Status = "PASS" | "FAIL" | "NOT RUN";
const MARKS: Record<Status, string> = {
  PASS: "ok  ",
  FAIL: "FAIL",
  "NOT RUN": "--  ",
};
type Row = {
  target: string;
  check: string;
  status: Status;
  detail: string;
  ms: number;
};
const rows: Row[] = [];

function record(
  target: string,
  check: string,
  status: Status,
  detail = "",
  ms = 0
) {
  rows.push({
    target: target,
    check: check,
    status: status,
    detail: detail,
    ms: ms,
  });
  const mark = MARKS[status];
  console.log(
    `${mark} ${target.padEnd(12)} ${check}${detail ? `  (${detail.split("\n")[0]})` : ""}`
  );
  if (status === "FAIL" && detail.includes("\n")) {
    console.log(
      detail
        .split("\n")
        .slice(-25)
        .map((l) => "       | " + l)
        .join("\n")
    );
  }
}

function lastLines(text: string, n = 25) {
  return text.trimEnd().split("\n").slice(-n).join("\n");
}

// ---------------------------------------------------------------------------------------------
// Targets and toolchains
// ---------------------------------------------------------------------------------------------

type TargetName = "linux-x64" | "linux-arm64" | "win32-x64" | "win32-arm64";
const MACRO: Record<TargetName, string> = {
  "linux-x64": "FIBER_TARGET_LINUX_X64",
  "linux-arm64": "FIBER_TARGET_LINUX_ARM64",
  "win32-x64": "FIBER_TARGET_WIN32_X64",
  "win32-arm64": "FIBER_TARGET_WIN32_ARM64",
};

type Toolchain = {
  target: TargetName;
  name: string; // e.g. "clang-18"
  cc: string;
  cflags: string[]; // target selection, sysroot
  ldflags: string[];
  libs: string[]; // after the objects
  exe: string; // executable suffix
  obj: string; // object suffix
  /** How to run an executable, or null when this machine can only compile for the target. */
  runner: ((exe: string, args: string[]) => string[]) | null;
  runnerName: string; // "native", "qemu", "wine", "compile only"
  emulated: boolean;
  wine: boolean;
  msvc: boolean; // MSVC environment (SEH __try, exit codes are NTSTATUS)
  env: Record<string, string>;
};

const toolchains: Toolchain[] = [];
const unavailable: { target: TargetName; reason: string }[] = [];

function wanted(t: TargetName) {
  return !ONLY || ONLY.includes(t);
}

async function clangVersion(cc: string): Promise<string | null> {
  if (!existsSync(cc) && which(cc) === null) {
    return null;
  }
  const r = await run([cc, "--version"]);
  const m = r.out.match(/clang version (\d+)\.(\d+)/);
  return m ? `clang-${m[1]}` : null;
}

function findGlob(dir: string, test: (name: string) => boolean): string | null {
  if (!existsSync(dir)) {
    return null;
  }
  const names = readdirSync(dir).filter(test).sort();
  return names.length ? join(dir, names[names.length - 1]) : null;
}

async function discover() {
  const hazeClang = join(HAZE_BIN, "clang" + EXE);
  const compilers: { cc: string; name: string }[] = [];
  const hazeVersion = await clangVersion(hazeClang);
  if (hazeVersion) {
    compilers.push({ cc: hazeClang, name: `${hazeVersion} (Haze)` });
  }
  const systemClang = which("clang");
  if (systemClang) {
    const v = await clangVersion(systemClang);
    if (v && v !== hazeVersion) {
      compilers.push({ cc: systemClang, name: v });
    }
  }
  if (compilers.length === 0) {
    console.error(`no clang found (looked for ${hazeClang} and clang on PATH)`);
    process.exit(2);
  }
  const lld = existsSync(join(HAZE_BIN, "ld.lld" + EXE))
    ? join(HAZE_BIN, "ld.lld" + EXE)
    : which("ld.lld");

  if (HOST_OS === "linux") {
    // linux-x64 / linux-arm64 natively.
    const native: TargetName =
      HOST_ARCH === "x64" ? "linux-x64" : "linux-arm64";
    for (const c of compilers) {
      toolchains.push({
        target: native,
        name: c.name,
        cc: c.cc,
        cflags: [],
        ldflags: [],
        libs: ["-lpthread", "-ldl"],
        exe: "",
        obj: ".o",
        runner: (exe, a) => [exe, ...a],
        runnerName: "native",
        emulated: false,
        wine: false,
        msvc: false,
        env: {},
      });
    }
    // linux-arm64 on an x64 host: qemu-user, an aarch64 glibc sysroot and aarch64 libgcc.
    if (HOST_ARCH === "x64") {
      const qemu = which("qemu-aarch64-static") ?? which("qemu-aarch64");
      const sysroot = findGlob("/usr/aarch64-redhat-linux/sys-root", (n) =>
        n.startsWith("fc")
      );
      const gccLib = findGlob("/usr/lib/gcc/aarch64-linux-gnu", () => true);
      const missing = [
        !qemu && "qemu-user (Fedora: qemu-user-static-aarch64)",
        !sysroot &&
          "an aarch64 glibc sysroot (Fedora: sysroot-aarch64-fc*-glibc)",
        !gccLib && "aarch64 libgcc (Fedora: gcc-aarch64-linux-gnu)",
        !lld && "ld.lld",
      ].filter(Boolean);
      if (missing.length) {
        unavailable.push({
          target: "linux-arm64",
          reason: `needs ${missing.join(", ")}`,
        });
      } else {
        // glibc's static libc wants libgcc_eh for unwinding it never does here: an empty stand-in.
        const stub = join(OUT, "aarch64-stub");
        mkdirSync(stub, { recursive: true });
        const ar = existsSync(join(HAZE_BIN, "llvm-ar"))
          ? join(HAZE_BIN, "llvm-ar")
          : "ar";
        if (!existsSync(join(stub, "libgcc_eh.a"))) {
          await run([ar, "rc", join(stub, "libgcc_eh.a")]);
        }
        for (const c of compilers) {
          toolchains.push({
            target: "linux-arm64",
            name: c.name,
            cc: c.cc,
            cflags: ["--target=aarch64-linux-gnu", `--sysroot=${sysroot}`],
            ldflags: [
              "--target=aarch64-linux-gnu",
              `--sysroot=${sysroot}`,
              `-B${gccLib}`,
              `-L${gccLib}`,
              `-L${stub}`,
              `--ld-path=${lld}`,
              "-static",
            ],
            libs: ["-lpthread"],
            exe: "",
            obj: ".o",
            runner: (exe, a) => [qemu!, "-cpu", "max", exe, ...a],
            runnerName: "qemu",
            emulated: true,
            wine: false,
            msvc: false,
            env: {},
          });
        }
      }
    }
    // Windows via mingw-w64 headers and wine: a pre-filter, not a proof (README.md).
    const mingwRoot = "/usr/x86_64-w64-mingw32/sys-root/mingw";
    const mingwHeaders = existsSync(join(mingwRoot, "include", "windows.h"));
    const mingwGcc = findGlob("/usr/lib/gcc/x86_64-w64-mingw32", () => true);
    const wine = which("wine") ?? which("wine64");
    if (!mingwHeaders) {
      unavailable.push({
        target: "win32-x64",
        reason: "needs mingw-w64 headers (Fedora: mingw64-headers)",
      });
      unavailable.push({
        target: "win32-arm64",
        reason:
          "compile check needs mingw-w64 headers (Fedora: mingw64-headers)",
      });
    } else {
      const c = compilers[0];
      // C99 printf (%zu): mingw's default printf is msvcrt's.
      const common = [
        "-isystem",
        join(mingwRoot, "include"),
        "-D__USE_MINGW_ANSI_STDIO=1",
      ];
      if (!mingwGcc || !wine || !lld) {
        unavailable.push({
          target: "win32-x64",
          reason: `running needs ${[
            !mingwGcc && "mingw libgcc (Fedora: mingw64-gcc)",
            !wine && "wine",
            !lld && "ld.lld",
          ]
            .filter(Boolean)
            .join(", ")}; compile-checked only`,
        });
      }
      const winePrefix = join(OUT, "wineprefix");
      toolchains.push({
        target: "win32-x64",
        name: c.name + " mingw",
        cc: c.cc,
        cflags: ["--target=x86_64-w64-windows-gnu", ...common],
        ldflags: [
          "--target=x86_64-w64-windows-gnu",
          `--sysroot=${mingwRoot}`,
          `-L${join(mingwRoot, "lib")}`,
          ...(mingwGcc ? [`-B${mingwGcc}`, `-L${mingwGcc}`] : []),
          `--ld-path=${lld}`,
          "-static",
        ],
        libs: [],
        exe: ".exe",
        obj: ".o",
        runner: mingwGcc && wine && lld ? (exe, a) => [wine, exe, ...a] : null,
        runnerName: mingwGcc && wine && lld ? "wine" : "compile only",
        emulated: false,
        wine: true,
        msvc: false,
        env: {
          WINEPREFIX: winePrefix,
          WINEDEBUG: "-all",
          WINEDLLOVERRIDES: "mscoree,mshtml=",
        },
      });
      toolchains.push({
        target: "win32-arm64",
        name: c.name + " mingw",
        cc: c.cc,
        cflags: ["--target=aarch64-w64-windows-gnu", ...common],
        ldflags: [],
        libs: [],
        exe: ".exe",
        obj: ".o",
        runner: null,
        runnerName: "compile only",
        emulated: false,
        wine: false,
        msvc: false,
        env: {},
      });
      unavailable.push({
        target: "win32-arm64",
        reason: "runs only on ARM64 Windows; compile-checked here",
      });
    }
  } else {
    // Windows host: Haze's clang targets MSVC (Visual Studio's headers and libraries).
    const c = compilers.find((x) => x.cc === hazeClang) ?? compilers[0];
    const msvcCommon = ["-D_CRT_SECURE_NO_WARNINGS", "-fms-extensions"];
    for (const arch of ["x64", "arm64"] as const) {
      const target: TargetName = arch === "x64" ? "win32-x64" : "win32-arm64";
      const triple =
        arch === "x64" ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc";
      // ARM64 Windows runs x64 code too; x64 Windows cannot run ARM64 code.
      const canRun = arch === "x64" || HOST_ARCH === "arm64";
      toolchains.push({
        target: target,
        name: c.name,
        cc: c.cc,
        cflags: [`--target=${triple}`, ...msvcCommon],
        ldflags: [`--target=${triple}`, "-fuse-ld=lld"],
        libs: ["-lntdll", "-lkernel32", "-luser32", "-ladvapi32"], // what Haze links Windows programs with
        exe: ".exe",
        obj: ".obj",
        runner: canRun ? (exe, a) => [exe, ...a] : null,
        runnerName: canRun ? "native" : "compile only",
        emulated: false,
        wine: false,
        msvc: true,
        env: {},
      });
      if (!canRun) {
        unavailable.push({
          target: target,
          reason: "runs only on ARM64 Windows; compile-checked here",
        });
      }
    }
    unavailable.push({
      target: "linux-x64",
      reason: "Linux targets are tested on Linux",
    });
    unavailable.push({
      target: "linux-arm64",
      reason: "Linux targets are tested on Linux",
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Builds
// ---------------------------------------------------------------------------------------------

type Config = {
  id: string;
  cflags: string[];
  ldflags: string[];
  implFlags: string[];
  env: Record<string, string>;
};

function configsFor(tc: Toolchain): Config[] {
  const fp =
    tc.msvc || tc.wine || tc.target === "win32-arm64"
      ? []
      : ["-fno-omit-frame-pointer"];
  const strict = ["-std=c11"]; // what Haze compiles C with
  const configs: Config[] = [
    {
      id: "O2",
      cflags: ["-O2", "-g", ...fp],
      ldflags: [],
      implFlags: [],
      env: {},
    },
    {
      id: "O0",
      cflags: ["-O0", "-g", ...fp],
      ldflags: [],
      implFlags: [],
      env: {},
    },
  ];
  if (tc.target.startsWith("linux")) {
    // hzstd's own flags (stdlib haze.toml + ModuleCompiler): -O3 -fPIC -D_XOPEN_SOURCE=500.
    configs.push({
      id: "haze-flags",
      cflags: ["-O3", "-g", "-fPIC", ...fp],
      ldflags: [],
      implFlags: ["-D_XOPEN_SOURCE=500"],
      env: {},
    });
  } else if (tc.msvc) {
    configs.push({
      id: "haze-flags",
      cflags: ["-O3", "-g"],
      ldflags: [],
      implFlags: [],
      env: {},
    });
  }
  if (tc.target === "linux-x64") {
    configs.push({
      id: "cet-ibt",
      cflags: ["-O2", "-g", ...fp, "-fcf-protection=branch"],
      ldflags: [],
      implFlags: [],
      env: {},
    });
  }
  if (tc.target === "linux-arm64") {
    // Return-address signing and landing pads (qemu -cpu max checks the signatures).
    configs.push({
      id: "pac-bti",
      cflags: ["-O2", "-g", ...fp, "-mbranch-protection=pac-ret+bti"],
      ldflags: [],
      implFlags: [],
      env: {},
    });
  }
  if (tc.target === "linux-x64" && tc.runnerName === "native") {
    const san = ["-fsanitize=address,undefined", "-fno-sanitize-recover=all"];
    configs.push({
      id: "asan-ubsan",
      cflags: ["-O1", "-g", ...fp, ...san],
      ldflags: san,
      implFlags: [],
      env: {
        ASAN_OPTIONS:
          "detect_stack_use_after_return=1:detect_leaks=0:abort_on_error=0:allow_user_segv_handler=1",
        UBSAN_OPTIONS: "print_stacktrace=1:halt_on_error=1",
      },
    });
  }
  for (const c of configs) {
    c.implFlags = [...strict, ...c.implFlags];
  }
  return configs;
}

function dirFor(tc: Toolchain, config: string) {
  const dir = join(
    OUT,
    tc.target,
    tc.name.replace(/[^A-Za-z0-9.-]+/g, "_"),
    config
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function compile(
  tc: Toolchain,
  src: string,
  obj: string,
  flags: string[],
  werror = true
) {
  const warn = ["-Wall", "-Wextra", ...(werror ? ["-Werror"] : [])];
  const cmd = [
    tc.cc,
    ...tc.cflags,
    `-D${MACRO[tc.target]}`,
    ...warn,
    ...flags,
    "-c",
    src,
    "-o",
    obj,
  ];
  return run(cmd);
}

type Built = {
  ok: boolean;
  log: string;
  exe: string;
  dir: string;
  objs: Record<string, string>;
};

/** Builds fiber_test (and its objects) for one toolchain and config; `header` swaps fiber.h. */
async function buildFiberTest(
  tc: Toolchain,
  config: Config,
  header?: string,
  dirOverride?: string
): Promise<Built> {
  const dir = dirOverride ?? dirFor(tc, config.id);
  const objs: Record<string, string> = {};
  const units: [string, string[]][] = [
    [
      "fiber_impl.c",
      [
        ...config.implFlags,
        ...(header
          ? [`-DFIBER_TEST_HEADER="${header.replaceAll("\\", "/")}"`]
          : []),
      ],
    ],
    ["regs.c", ["-std=c11"]],
    ["fiber_test.c", ["-std=c11"]],
    // Linux: probe every page of large frames, as hzstd must (README.md). Windows always probes.
    [
      "clash.c",
      [
        "-std=c11",
        ...(tc.target.startsWith("linux") ? ["-fstack-clash-protection"] : []),
      ],
    ],
  ];
  const results = await Promise.all(
    units.map(async ([src, extra]) => {
      const obj = join(dir, src.replace(/\.c$/, tc.obj));
      objs[src] = obj;
      return compile(tc, join(TESTS_DIR, src), obj, [
        ...config.cflags,
        ...extra,
      ]);
    })
  );
  const failed = results.find((r) => r.code !== 0);
  const exe = join(dir, "fiber_test" + tc.exe);
  if (failed) {
    return { ok: false, log: failed.out, exe: exe, dir: dir, objs: objs };
  }
  if (tc.runner === null) {
    return { ok: true, log: "", exe: exe, dir: dir, objs: objs }; // compile-only target
  }
  const link = await run([
    tc.cc,
    ...tc.ldflags,
    ...config.ldflags,
    ...Object.values(objs),
    "-o",
    exe,
    ...tc.libs,
  ]);
  return { ok: link.code === 0, log: link.out, exe: exe, dir: dir, objs: objs };
}

function passed(r: RunResult) {
  return r.code === 0 && !r.timedOut && /all \d+ tests passed/.test(r.out);
}

function describe(r: RunResult) {
  if (r.timedOut) {
    return "timed out";
  }
  if (r.signal) {
    return `killed by ${r.signal}`;
  }
  // An NTSTATUS reads better in hex (0xc000001d).
  return r.code !== null && (r.code > 0xff || r.code < 0)
    ? `exit 0x${(r.code < 0 ? r.code + 2 ** 32 : r.code).toString(16)}`
    : `exit ${r.code}`;
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

async function checkSuite(tc: Toolchain, config: Config, built: Built) {
  const label = `${tc.name} ${config.id}`;
  if (!built.ok) {
    record(tc.target, `build ${label}`, "FAIL", lastLines(built.log));
    return;
  }
  if (tc.runner === null) {
    record(tc.target, `build ${label}`, "PASS", "compile only");
    return;
  }
  const base = tc.emulated ? ["--emulated"] : [];
  const seeds = DEEP ? [1, 2, 3, 4] : [0];
  for (const seed of seeds) {
    const a = [
      ...base,
      ...(seed ? ["--seed", String(seed * 7777), "--scale", "8"] : []),
    ];
    const r = await run(tc.runner(built.exe, a), {
      env: { ...tc.env, ...config.env },
      timeout: DEEP ? DEEP_TIMEOUT : FAST_TIMEOUT,
    });
    record(
      tc.target,
      `suite ${label}${seed ? ` seed ${seed * 7777} x8` : ""} [${tc.runnerName}]`,
      passed(r) ? "PASS" : "FAIL",
      passed(r)
        ? `${(r.ms / 1000).toFixed(1)} s`
        : `${describe(r)}\n${lastLines(r.out)}`,
      r.ms
    );
  }
}

/**
 * Scenarios that must stop the program, never continue into garbage: a returning entry function
 * and resuming a running or ended context each print the library's message and trap.
 */
const DEATHS: [string, RegExp][] = [
  ["entry-returns", /entry function returned/],
  ["resume-ended", /resumed a context that is running or has ended/],
  ["exit-to-ended", /resumed a context that is running or has ended/],
  ["resume-running", /resumed a context that is running or has ended/],
];

/** The trap: SIGILL (x86 ud2), SIGTRAP (AArch64 brk); NTSTATUS illegal instruction or breakpoint. */
function trapExpectation(tc: Toolchain): string {
  if (tc.target.startsWith("linux")) {
    return tc.target === "linux-x64" ? "SIGILL" : "SIGTRAP";
  }
  if (tc.wine) {
    return "low byte of 0xc000001d/0x80000003";
  }
  return "0xc000001d/0x80000003";
}

function trapped(tc: Toolchain, r: RunResult): boolean {
  // biome-ignore lint/suspicious/noBitwiseOperators: an exit code read as an unsigned NTSTATUS
  const code = r.code === null ? null : r.code >>> 0;
  if (tc.target.startsWith("linux")) {
    return (
      r.signal !== null &&
      (tc.target === "linux-x64" ? ["SIGILL"] : ["SIGTRAP", "SIGILL"]).includes(
        r.signal
      )
    );
  }
  if (tc.wine) {
    // biome-ignore lint/suspicious/noBitwiseOperators: wine keeps only the NTSTATUS's low byte
    return code !== null && [0x1d, 0x03].includes(code & 0xff);
  }
  return code !== null && [0xc0_00_00_1d, 0x80_00_00_03].includes(code);
}

/**
 * Windows hosts: Bun reports only the low byte of a Windows exit code (0xC000001D arrives as 29),
 * so commands whose NTSTATUS matters run under tests/exitcode.c, which prints the full code.
 * Built once, on first use; resolves to the executable, or to the build log on failure.
 */
let exitcodeBuild: Promise<{ exe: string | null; log: string }> | null = null;
function exitcodeLauncher(tc: Toolchain) {
  exitcodeBuild ??= (async () => {
    const exe = join(OUT, "exitcode.exe");
    const triple =
      HOST_ARCH === "x64" ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc";
    const r = await run([
      tc.cc,
      `--target=${triple}`,
      "-fuse-ld=lld",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-D_CRT_SECURE_NO_WARNINGS",
      join(TESTS_DIR, "exitcode.c"),
      "-o",
      exe,
    ]);
    return { exe: r.code === 0 ? exe : null, log: r.out };
  })();
  return exitcodeBuild;
}

/** Runs a test program; on a Windows host through the launcher, so `code` is the full NTSTATUS. */
async function runFullExitCode(
  tc: Toolchain,
  cmd: string[],
  opts: { env?: Record<string, string>; timeout?: number }
): Promise<RunResult> {
  if (!(HOST_OS === "win32" && tc.msvc)) {
    return run(cmd, opts);
  }
  const launcher = await exitcodeLauncher(tc);
  if (launcher.exe === null) {
    return {
      code: 255,
      signal: null,
      out: `could not build exitcode.c:\n${lastLines(launcher.log)}`,
      ms: 0,
      timedOut: false,
    };
  }
  const r = await run([launcher.exe, ...cmd], opts);
  // Not necessarily last: stdout and stderr are separate pipes, merged as the data arrives.
  const m = [...r.out.matchAll(/\r?\nexitcode: 0x([0-9A-F]{8})\r?\n/g)].pop();
  if (m) {
    const at = m.index ?? 0;
    r.code = Number.parseInt(m[1], 16);
    r.out = r.out.slice(0, at) + r.out.slice(at + m[0].length);
  }
  return r;
}

async function deathProblems(
  tc: Toolchain,
  exe: string,
  env: Record<string, string>
): Promise<string[]> {
  const problems: string[] = [];
  for (const [scenario, message] of DEATHS) {
    const r = await runFullExitCode(tc, tc.runner!(exe, ["--death", scenario]), {
      env: { ...tc.env, ...env },
      timeout: MUTANT_TIMEOUT,
    });
    if (
      r.code === 0 ||
      r.out.includes("survived") ||
      r.timedOut ||
      !message.test(r.out) ||
      !trapped(tc, r)
    ) {
      problems.push(`${scenario}: ${describe(r)} ${lastLines(r.out, 3)}`);
    }
  }
  return problems;
}

async function checkDeath(tc: Toolchain, built: Built) {
  if (!built.ok || tc.runner === null) {
    return;
  }
  const problems = await deathProblems(tc, built.exe, {});
  record(
    tc.target,
    `death tests: a returning entry and resuming a running/ended context print and trap (${trapExpectation(tc)})`,
    problems.length === 0 ? "PASS" : "FAIL",
    problems.join("\n")
  );
}

/** BDWGC built from source (extra/gc.c, one translation unit) with Haze's settings. */
async function buildGc(
  tc: Toolchain,
  config: Config,
  fiberBuilt: Built
): Promise<Built> {
  const dir = join(fiberBuilt.dir, "gc");
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, "gc_test" + tc.exe);
  if (!existsSync(join(BDWGC, "extra", "gc.c"))) {
    return {
      ok: false,
      log: `BDWGC source not found at ${BDWGC} (pass --bdwgc=<dir>)`,
      exe: exe,
      dir: dir,
      objs: {},
    };
  }
  const common = [
    "-DALL_INTERIOR_POINTERS",
    "-DENABLE_DISCLAIM",
    "-DGC_ATOMIC_UNCOLLECTABLE",
    "-DGC_BUILTIN_ATOMIC",
    "-DGC_GCJ_SUPPORT",
    "-DGC_NOT_DLL",
    "-DGC_THREADS",
    "-DJAVA_FINALIZATION",
    "-DNO_EXECUTE_PERMISSION",
    "-DPARALLEL_MARK",
    "-DTHREAD_LOCAL_ALLOC",
    "-DUSE_MUNMAP",
  ];
  const linux = [
    "-DGC_ENABLE_SUSPEND_THREAD",
    "-DGC_HAVE_PTHREAD_SIGMASK",
    "-DGC_REQUIRE_WCSDUP",
    "-DHANDLE_FORK",
    "-DHAVE_DLADDR",
    "-DHAVE_DL_ITERATE_PHDR",
    "-DHAVE_SYS_TYPES_H",
    "-DHAVE_UNISTD_H",
    "-DUSE_MMAP",
    "-D_REENTRANT",
  ];
  const defs = [...common, ...(tc.target.startsWith("linux") ? linux : [])];
  const gcObj = join(dir, "gc" + tc.obj);
  const include = join(BDWGC, "include");
  const gc = await run([
    tc.cc,
    ...tc.cflags,
    "-O2",
    "-g",
    ...defs,
    `-I${include}`,
    "-w",
    "-c",
    join(BDWGC, "extra", "gc.c"),
    "-o",
    gcObj,
  ]);
  if (gc.code !== 0) {
    return { ok: false, log: gc.out, exe: exe, dir: dir, objs: {} };
  }
  const testObj = join(dir, "gc_test" + tc.obj);
  const t = await compile(tc, join(TESTS_DIR, "gc_test.c"), testObj, [
    "-std=c11",
    ...config.cflags,
    `-I${include}`,
  ]);
  if (t.code !== 0) {
    return { ok: false, log: t.out, exe: exe, dir: dir, objs: {} };
  }
  if (tc.runner === null) {
    // Compile-only target, as in buildFiberTest: its libraries need not be installed here.
    return { ok: true, log: "", exe: exe, dir: dir, objs: {} };
  }
  const objs = [
    gcObj,
    testObj,
    fiberBuilt.objs["fiber_impl.c"],
    fiberBuilt.objs["regs.c"],
  ];
  const link = await run([
    tc.cc,
    ...tc.ldflags,
    ...config.ldflags,
    ...objs,
    "-o",
    exe,
    ...tc.libs,
  ]);
  return { ok: link.code === 0, log: link.out, exe: exe, dir: dir, objs: {} };
}

/** The GC test run GC_RUNS times: null if every run passed, else the first failure. */
async function gcRunsProblem(
  tc: Toolchain,
  exe: string,
  env: Record<string, string>
): Promise<string | null> {
  for (let i = 0; i < GC_RUNS; i++) {
    const r = await run(gcCommand(tc, exe, ["--scale", "1"]), {
      env: { ...tc.env, ...env },
      timeout: MUTANT_TIMEOUT,
    });
    if (!(r.code === 0 && r.out.includes("all gc tests passed"))) {
      return `run ${i + 1}: ${describe(r)} ${lastLines(r.out, 3)}`;
    }
  }
  return null;
}

/** qemu only stops between translated blocks; one instruction per block lets stops land mid-switch. */
function gcCommand(tc: Toolchain, exe: string, args: string[]): string[] {
  const cmd = tc.runner!(exe, args);
  return tc.runnerName === "qemu"
    ? [cmd[0], "-one-insn-per-tb", ...cmd.slice(1)]
    : cmd;
}

/** null if fiber__switch and fiber__exit start with endbr64 (IBT builds). */
async function endbrProblem(obj: string): Promise<string | null> {
  const objdump = existsSync(join(HAZE_BIN, "llvm-objdump"))
    ? join(HAZE_BIN, "llvm-objdump")
    : which("llvm-objdump");
  if (!objdump) {
    return null;
  }
  const r = await run([objdump, "-d", "--no-show-raw-insn", obj]);
  for (const fn of ["switch", "exit"]) {
    // objdump names the address after either symbol: fiber_switch is an alias of fiber__switch.
    const m = r.out.match(
      new RegExp(`<fiber__?${fn}>:\\n\\s*[0-9a-f]+:\\s*(\\S+)`)
    );
    if (!m || m[1] !== "endbr64") {
      return `${fn} does not start with endbr64 (${m ? m[1] : "not found"})`;
    }
  }
  return null;
}

async function checkGc(tc: Toolchain, config: Config, fiberBuilt: Built) {
  if (!fiberBuilt.ok) {
    return;
  }
  const built = await buildGc(tc, config, fiberBuilt);
  if (!built.ok) {
    record(
      tc.target,
      `gc build ${tc.name} ${config.id}`,
      "FAIL",
      lastLines(built.log)
    );
    return;
  }
  if (tc.runner === null) {
    record(
      tc.target,
      `gc build ${tc.name} ${config.id}`,
      "PASS",
      "compile only"
    );
    return;
  }
  const scale = DEEP ? "20" : "1";
  const r = await run(gcCommand(tc, built.exe, ["--scale", scale]), {
    env: { ...tc.env, ...config.env },
    timeout: DEEP ? DEEP_TIMEOUT : FAST_TIMEOUT,
  });
  // The collections must have stopped the thread inside a switch at least once (the test keeps
  // collecting until they did, up to a cap), or the mid-switch scenario proved nothing.
  const midSwitch = Number(
    r.out.match(/(\d+) stops caught a task mid-switch/)?.[1] ?? "0"
  );
  const ok =
    r.code === 0 && r.out.includes("all gc tests passed") && midSwitch > 0;
  record(
    tc.target,
    `gc BDWGC ${tc.name} ${config.id} x${scale}`,
    ok ? "PASS" : "FAIL",
    ok
      ? lastLines(r.out, 2).split("\n")[0].replace(/^ok /, "")
      : `${describe(r)}\n${lastLines(r.out)}`
  );
  const n = await run(tc.runner(built.exe, ["--negative-control"]), {
    env: { ...tc.env, ...config.env },
  });
  const nok =
    n.code === 0 &&
    /negative control: \d+ of \d+ objects collected/.test(n.out);
  record(
    tc.target,
    `gc negative control (no task roots: objects must be collected)`,
    nok ? "PASS" : "FAIL",
    nok
      ? n.out.trim().split("\n").pop()!
      : `${describe(n)}\n${lastLines(n.out)}`
  );
}

/** null if the trampoline's DWARF unwind info ends unwinding, else what is wrong (Linux). */
async function cfiProblem(tc: Toolchain, obj: string): Promise<string | null> {
  const dump = existsSync(join(HAZE_BIN, "llvm-dwarfdump"))
    ? join(HAZE_BIN, "llvm-dwarfdump")
    : which("llvm-dwarfdump");
  if (!dump) {
    return null;
  }
  const r = await run([dump, "--eh-frame", obj]);
  const reg =
    tc.target === "linux-x64"
      ? /DW_CFA_undefined:\s*(RIP|reg16)/
      : /DW_CFA_undefined:\s*(W30|X30|LR|reg30)/;
  return r.code === 0 && reg.test(r.out)
    ? null
    : "the trampoline's CFI does not mark the return address undefined";
}

async function checkCfi(tc: Toolchain, built: Built) {
  if (!built.ok) {
    return;
  }
  if (
    !existsSync(join(HAZE_BIN, "llvm-dwarfdump")) &&
    !which("llvm-dwarfdump")
  ) {
    record(
      tc.target,
      "CFI of the trampoline",
      "NOT RUN",
      "llvm-dwarfdump not found"
    );
    return;
  }
  const problem = await cfiProblem(tc, built.objs["fiber_impl.c"]);
  record(
    tc.target,
    `CFI: the trampoline's return address is undefined (${tc.name})`,
    problem === null ? "PASS" : "FAIL",
    problem ?? ""
  );
}

/** null if every assembly function has Windows unwind info of the right shape, else what is wrong. */
async function sehProblem(tc: Toolchain, obj: string): Promise<string | null> {
  const readobj = existsSync(join(HAZE_BIN, "llvm-readobj" + EXE))
    ? join(HAZE_BIN, "llvm-readobj" + EXE)
    : which("llvm-readobj");
  if (!readobj) {
    return null;
  }
  const r = await run([readobj, "--unwind", obj]);
  if (r.code !== 0) {
    return lastLines(r.out);
  }
  // One block per function: "StartAddress: name" (x64) or "Function: name" (ARM64).
  const blocks = new Map<string, string>();
  for (const part of r.out.split(/(?=(?:StartAddress|Function):\s)/)) {
    const m = part.match(/^(?:StartAddress|Function):\s*(\S+)/);
    if (m) {
      blocks.set(m[1], part);
    }
  }
  const need: [string, RegExp[]][] =
    tc.target === "win32-x64"
      ? [
          // 8 pushes, 200 bytes, xmm6-15: the whole frame, and nothing else.
          [
            "fiber__switch",
            [
              ...["RBP", "RBX", "RDI", "RSI", "R12", "R13", "R14", "R15"].map(
                (reg) => new RegExp(`PUSH_NONVOL reg=${reg}\\b`)
              ),
              /ALLOC_LARGE size=200/,
              ...[6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(
                (n) =>
                  new RegExp(
                    `SAVE_XMM128 reg=XMM${n}, offset=0x${((n - 6) * 16).toString(16).toUpperCase()}\\b`
                  )
              ),
            ],
          ],
          ["fiber__exit", [/ALLOC_SMALL size=40/]],
          ["fiber__trampoline", [/ALLOC_SMALL size=40/]],
        ]
      : [
          [
            "fiber__switch",
            [
              /sub sp, #208/,
              /stp x19, x20, \[sp, #0\]/,
              /stp x29, x30, \[sp, #80\]/,
              /stp d8, d9, \[sp, #96\]/,
              /stp d10, d11, \[sp, #112\]/,
              /stp d12, d13, \[sp, #128\]/,
              /stp d14, d15, \[sp, #144\]/,
              /EpilogueScopes: 1|EpiloguePacked: Yes/,
            ],
          ],
          ["fiber__exit", [/stp x29, x30, \[sp, #-16\]!/]],
          // Unwinding the trampoline reads fp and lr from the zero record: return address 0.
          ["fiber__trampoline", [/stp x29, x30, \[sp, #-16\]!/]],
        ];
  const problems: string[] = [];
  for (const [fn, patterns] of need) {
    const block = blocks.get(fn);
    if (!block) {
      problems.push(`no unwind info for ${fn}`);
      continue;
    }
    const missing = patterns.filter((p) => !p.test(block));
    if (missing.length) {
      problems.push(
        `${fn}: unwind info lacks ${missing.map(String).join(", ")}`
      );
    }
  }
  if (tc.target === "win32-arm64") {
    // x21-x28 may show as "save next" pairs: 4 of them between x19/x20 and x29/x30.
    const sw = blocks.get("fiber__switch") ?? "";
    const prologue = sw.split("EpilogueScopes [")[0];
    if (
      (prologue.match(/save next/g) ?? []).length !== 4 &&
      !/stp x21, x22/.test(prologue)
    ) {
      problems.push("fiber__switch: x21-x28 are not all in the prologue codes");
    }
  }
  return problems.length
    ? `${problems.join("; ")}\n${lastLines(r.out, 40)}`
    : null;
}

async function checkSehInfo(tc: Toolchain, built: Built) {
  if (!built.ok) {
    return;
  }
  if (
    !existsSync(join(HAZE_BIN, "llvm-readobj" + EXE)) &&
    !which("llvm-readobj")
  ) {
    record(tc.target, "SEH unwind info", "NOT RUN", "llvm-readobj not found");
    return;
  }
  const problem = await sehProblem(tc, built.objs["fiber_impl.c"]);
  record(
    tc.target,
    `SEH unwind info for the assembly (${tc.name})`,
    problem === null ? "PASS" : "FAIL",
    problem ?? ""
  );
}

/** The target checks in fiber.h stop wrong builds. */
async function checkCompileErrors(cc: string) {
  const header = join(LIB_DIR, "fiber.h");
  const src = join(OUT, "compile_check.c");
  writeFileSync(
    src,
    `#include "${header.replaceAll("\\", "/")}"\nint fiber_compile_check;\n`
  );
  const implSrc = join(OUT, "compile_check_impl.c");
  writeFileSync(
    implSrc,
    `#define FIBER_IMPLEMENTATION\n#include "${header.replaceAll("\\", "/")}"\n`
  );
  const cases: {
    name: string;
    argv: string[];
    file?: string;
    expect: RegExp;
  }[] = [
    {
      name: "no target macro",
      argv: ["--target=x86_64-linux-gnu"],
      expect: /define exactly one/,
    },
    {
      name: "two target macros",
      argv: [
        "--target=x86_64-linux-gnu",
        "-DFIBER_TARGET_LINUX_X64",
        "-DFIBER_TARGET_WIN32_X64",
      ],
      expect: /define exactly one/,
    },
    {
      name: "x64 macro, arm64 compiler",
      argv: ["--target=aarch64-linux-gnu", "-DFIBER_TARGET_LINUX_X64"],
      expect: /does not target 64-bit x86 Linux/,
    },
    {
      name: "arm64 macro, x64 compiler",
      argv: ["--target=x86_64-linux-gnu", "-DFIBER_TARGET_LINUX_ARM64"],
      expect: /does not target 64-bit ARM Linux/,
    },
    {
      name: "Linux macro, Windows compiler",
      argv: ["--target=x86_64-pc-windows-msvc", "-DFIBER_TARGET_LINUX_X64"],
      expect: /does not target 64-bit x86 Linux/,
    },
    {
      name: "Windows macro, Linux compiler",
      argv: ["--target=x86_64-linux-gnu", "-DFIBER_TARGET_WIN32_X64"],
      expect: /does not target x64 Windows/,
    },
    {
      name: "Windows ARM64 macro, x64 compiler",
      argv: ["--target=x86_64-pc-windows-msvc", "-DFIBER_TARGET_WIN32_ARM64"],
      expect: /does not target ARM64 Windows/,
    },
    {
      name: "macOS",
      argv: ["--target=arm64-apple-macos13", "-DFIBER_TARGET_LINUX_ARM64"],
      expect: /macOS is not supported/,
    },
    {
      name: "32-bit x86",
      argv: ["--target=i686-linux-gnu", "-DFIBER_TARGET_LINUX_X64"],
      expect: /does not target 64-bit x86 Linux/,
    },
    {
      name: "32-bit ARM",
      argv: ["--target=armv7-linux-gnueabihf", "-DFIBER_TARGET_LINUX_ARM64"],
      expect: /does not target 64-bit ARM Linux/,
    },
    {
      name: "x32 ABI",
      argv: ["--target=x86_64-linux-gnux32", "-DFIBER_TARGET_LINUX_X64"],
      expect: /does not target 64-bit x86 Linux/,
    },
    {
      name: "ARM64EC",
      argv: ["--target=arm64ec-pc-windows-msvc", "-DFIBER_TARGET_WIN32_X64"],
      expect: /does not target x64 Windows/,
    },
    {
      name: "x86 shadow stacks",
      argv: [
        "--target=x86_64-linux-gnu",
        "-DFIBER_TARGET_LINUX_X64",
        "-fcf-protection=full",
      ],
      file: implSrc,
      expect: /shadow stacks/,
    },
    {
      name: "ShadowCallStack",
      argv: [
        "--target=aarch64-linux-gnu",
        "-DFIBER_TARGET_LINUX_ARM64",
        "-ffixed-x18",
        "-fsanitize=shadow-call-stack",
      ],
      file: implSrc,
      expect: /ShadowCallStack/,
    },
  ];
  for (const c of cases) {
    const r = await run([
      cc,
      "-ffreestanding",
      "-fsyntax-only",
      ...c.argv,
      c.file ?? src,
    ]);
    const ok = r.code !== 0 && c.expect.test(r.out);
    record(
      "host",
      `compile error: ${c.name}`,
      ok ? "PASS" : "FAIL",
      ok ? "" : `exit ${r.code}\n${lastLines(r.out)}`
    );
  }
  // The implementation compiles and assembles for the MSVC targets (Haze's Windows compiler; no
  // __GNUC__ there), with a stub windows.h on machines without the SDK, and has unwind info.
  const stub = join(TESTS_DIR, "win32-stub");
  for (const [macro, triple, extra] of [
    ["FIBER_TARGET_WIN32_X64", "x86_64-pc-windows-msvc", []],
    ["FIBER_TARGET_WIN32_ARM64", "aarch64-pc-windows-msvc", []],
    [
      "FIBER_TARGET_WIN32_ARM64",
      "aarch64-pc-windows-msvc",
      ["-mbranch-protection=bti"],
    ],
  ] as [string, string, string[]][]) {
    const obj = join(OUT, `msvc-${triple}${extra.length ? "-bti" : ""}.obj`);
    const sdk = HOST_OS === "win32" ? [] : ["-ffreestanding", "-isystem", stub];
    const r = await run([
      cc,
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      `--target=${triple}`,
      `-D${macro}`,
      ...sdk,
      ...extra,
      "-c",
      implSrc,
      "-o",
      obj,
    ]);
    const fake = {
      target: macro === "FIBER_TARGET_WIN32_X64" ? "win32-x64" : "win32-arm64",
    } as Toolchain;
    const unwind = r.code === 0 ? await sehProblem(fake, obj) : null;
    const ok = r.code === 0 && unwind === null;
    record(
      "host",
      `the implementation builds for ${triple}${extra.length ? " " + extra.join(" ") : ""}, with unwind info`,
      ok ? "PASS" : "FAIL",
      ok ? "" : buildOrUnwindProblem(r, unwind)
    );
  }
  // Every test source compiles for both MSVC targets too (stub SDK here; the real one on Windows):
  // the _MSC_VER-only code (__try tests) is compiled nowhere else before a Windows run.
  if (HOST_OS !== "win32") {
    for (const [macro, triple] of [
      ["FIBER_TARGET_WIN32_X64", "x86_64-pc-windows-msvc"],
      ["FIBER_TARGET_WIN32_ARM64", "aarch64-pc-windows-msvc"],
    ]) {
      const problems: string[] = [];
      for (const opt of ["-O0", "-O2"]) {
        for (const src of [
          "fiber_impl.c",
          "regs.c",
          "fiber_test.c",
          "clash.c",
          "gc_test.c",
        ]) {
          const r = await run([
            cc,
            "-std=c11",
            "-fms-extensions",
            "-ffreestanding",
            "-isystem",
            stub,
            `-I${join(BDWGC, "include")}`,
            "-Wall",
            "-Wextra",
            "-Werror",
            opt,
            `--target=${triple}`,
            `-D${macro}`,
            "-c",
            join(TESTS_DIR, src),
            "-o",
            join(OUT, `msvc-check-${triple}${opt}-${src}.obj`),
          ]);
          if (r.code !== 0) {
            problems.push(`${src} ${opt}: ${lastLines(r.out, 6)}`);
          }
        }
      }
      record(
        "host",
        `every test source compiles for ${triple} (stub SDK), -O0 and -O2`,
        problems.length ? "FAIL" : "PASS",
        problems.join("\n")
      );
    }
  }
  if (HOST_OS === "linux") {
    for (const [name, argv, expect] of [
      [
        "AArch64 Guarded Control Stack",
        [
          "--target=aarch64-linux-gnu",
          "-DFIBER_TARGET_LINUX_ARM64",
          "-mbranch-protection=standard",
        ],
        /Guarded Control Stack/,
      ],
      [
        "ThreadSanitizer",
        [
          "--target=x86_64-linux-gnu",
          "-DFIBER_TARGET_LINUX_X64",
          "-fsanitize=thread",
        ],
        /ThreadSanitizer/,
      ],
    ] as [string, string[], RegExp][]) {
      const r = await run([
        cc,
        "-ffreestanding",
        "-fsyntax-only",
        ...argv,
        implSrc,
      ]);
      const ok = r.code !== 0 && expect.test(r.out);
      record(
        "host",
        `compile error: ${name}`,
        ok ? "PASS" : "FAIL",
        ok ? "" : `exit ${r.code}\n${lastLines(r.out)}`
      );
    }
    // The implementation as C++ (extern "C" users), with clang++ and g++.
    for (const cxx of [
      cc.replace(/clang(\.exe)?$/, "clang++$1"),
      which("g++"),
    ].filter((x): x is string => !!x && existsSync(x))) {
      const r = await run([
        cxx,
        "-x",
        "c++",
        "-std=c++17",
        "-fsyntax-only",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-DFIBER_TARGET_LINUX_X64",
        implSrc,
      ]);
      record(
        "host",
        `the implementation compiles as C++ (${cxx.split("/").pop()})`,
        r.code === 0 ? "PASS" : "FAIL",
        r.code === 0 ? "" : lastLines(r.out)
      );
    }
  }
  // The declarations are valid C++ too, and pedantic C11 for every target.
  const cxx = await run([
    cc,
    "-x",
    "c++",
    "-std=c++17",
    "-ffreestanding",
    "-fsyntax-only",
    "-Wall",
    "-Wextra",
    "-Werror",
    "--target=x86_64-linux-gnu",
    "-DFIBER_TARGET_LINUX_X64",
    src,
  ]);
  record(
    "host",
    "the declarations compile as C++",
    cxx.code === 0 ? "PASS" : "FAIL",
    cxx.code === 0 ? "" : lastLines(cxx.out)
  );
  for (const [t, triple] of [
    ["FIBER_TARGET_LINUX_X64", "x86_64-linux-gnu"],
    ["FIBER_TARGET_LINUX_ARM64", "aarch64-linux-gnu"],
    ["FIBER_TARGET_WIN32_X64", "x86_64-pc-windows-msvc"],
    ["FIBER_TARGET_WIN32_ARM64", "aarch64-pc-windows-msvc"],
  ]) {
    const r = await run([
      cc,
      "-std=c11",
      "-pedantic",
      "-ffreestanding",
      "-fsyntax-only",
      "-Wall",
      "-Wextra",
      "-Werror",
      `--target=${triple}`,
      `-D${t}`,
      src,
    ]);
    record(
      "host",
      `the declarations are clean C11 for ${triple}`,
      r.code === 0 ? "PASS" : "FAIL",
      r.code === 0 ? "" : lastLines(r.out)
    );
  }
}

/**
 * The implementation compiles inside the C file Haze generates for its standard library (hzstd's
 * unity build), with the exact command Haze recorded for it, when this checkout has built one.
 */
async function checkInsideStdlib() {
  const repo = join(LIB_DIR, "..", "..", "..", "..");
  const platform = `${HOST_OS}-${HOST_ARCH}`;
  const target = `${HOST_OS}-${HOST_ARCH}` as TargetName;
  const commands = join(repo, "__haze__", "compile_commands.json");
  const cFile = join(
    repo,
    "__haze__",
    "haze-stdlib",
    "build",
    `haze-stdlib-${platform}.c`
  );
  if (!existsSync(commands) || !existsSync(cFile)) {
    record(
      target,
      "compiles inside Haze's generated stdlib module",
      "NOT RUN",
      "no generated stdlib in __haze__ (build any Haze program in this checkout first)"
    );
    return;
  }
  let entry: { command: string; file: string } | undefined;
  try {
    entry = (
      JSON.parse(readFileSync(commands, "utf8")) as {
        command: string;
        file: string;
      }[]
    ).find((e) => e.file.endsWith(`haze-stdlib-${platform}.c`));
  } catch {
    entry = undefined;
  }
  if (!entry) {
    record(
      target,
      "compiles inside Haze's generated stdlib module",
      "NOT RUN",
      "no recorded compile command for the stdlib"
    );
    return;
  }
  const copy = join(OUT, `stdlib-with-fiber-${platform}.c`);
  writeFileSync(
    copy,
    readFileSync(cFile, "utf8") +
      `\n#define FIBER_IMPLEMENTATION\n#include "fiber/fiber.h"\n`
  );
  // The recorded command, with our copy as input and output, plus the macro the compiler now passes.
  // Shell-style words: quoted parts may sit inside a word (-I"C:\Program Files\..").
  const argv = (entry.command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map((a) =>
    a.replace(/"/g, "")
  );
  const out = join(OUT, `stdlib-with-fiber-${platform}.o`);
  // This checkout's stdlib (so its fiber.h is the one compiled), not the installed one.
  const stdlibSrc = dirname(LIB_DIR);
  const cmd = argv
    .map((a) => (a === entry!.file ? copy : a))
    .map((a, i, all) => (all[i - 1] === "-o" ? out : a))
    .map((a) =>
      /^-I.*[\\/]stdlib[\\/]core[\\/]src$/.test(a) ? `-I${stdlibSrc}` : a
    );
  const macro = `-D${MACRO[target]}`;
  // The control: the generated file alone must compile against this checkout's hzstd headers.
  // If it does not, it is older than they are (rebuild a Haze program), and nothing can be said
  // about fiber.h.
  const controlFiles: Record<string, string> = {
    [copy]: cFile,
    [out]: `${out}.control.o`,
  };
  const control = await run(cmd.map((a) => controlFiles[a] ?? a));
  if (control.code !== 0) {
    const firstError =
      control.out.split("\n").find((l) => /error:/.test(l))?.trim() ?? "";
    record(
      target,
      "compiles inside Haze's generated stdlib module",
      "NOT RUN",
      `the generated stdlib in __haze__ is stale: it does not compile against this checkout's headers even without fiber.h (build any Haze program in this checkout first): ${firstError}`
    );
    return;
  }
  for (const opt of ["", "-O3"]) {
    const r = await run([
      ...cmd,
      macro,
      ...(opt ? [opt] : []),
      "-Werror=implicit-function-declaration",
    ]);
    const fiberWarnings = r.out
      .split("\n")
      .filter((l) => /fiber/.test(l) && /warning|error/.test(l));
    const ok = r.code === 0 && fiberWarnings.length === 0;
    record(
      target,
      `compiles inside Haze's generated stdlib module, Haze's flags${opt ? " + " + opt : ""}`,
      ok ? "PASS" : "FAIL",
      ok ? "" : lastLines(r.out)
    );
  }
}

function buildOrUnwindProblem(r: RunResult, unwind: string | null): string {
  if (r.code !== 0) {
    return lastLines(r.out);
  }
  return unwind ?? "";
}

/** gdb's backtrace from inside a task ends at the trampoline, without complaints. */
async function checkGdb(tc: Toolchain, built: Built) {
  if (!built.ok || tc.runnerName !== "native" || tc.target !== "linux-x64") {
    return;
  }
  const gdb = which("gdb");
  if (!gdb) {
    record(tc.target, "gdb backtrace", "NOT RUN", "gdb not found");
    return;
  }
  const r = await run([
    gdb,
    "-batch",
    "-nx",
    "-iex",
    "set debuginfod enabled off",
    "-ex",
    "break fiber_test_gdb_breakpoint",
    "-ex",
    "run",
    "-ex",
    "bt",
    "--args",
    built.exe,
    "--gdb-target",
  ]);
  const frames = r.out.split("\n").filter((l) => /^#\d+ /.test(l));
  const last = frames[frames.length - 1] ?? "";
  // gdb prints "fiber__trampoline" as "fiber.trampoline" (it reads "__" as a scope separator).
  const ok =
    frames.length >= 5 &&
    /fiber(__|\.)trampoline/.test(last) &&
    !/Backtrace stopped|corrupt stack|previous frame inner/i.test(r.out);
  record(
    tc.target,
    `gdb backtrace from a task ends at the trampoline (${tc.name})`,
    ok ? "PASS" : "FAIL",
    ok ? `${frames.length} frames` : lastLines(r.out)
  );
}

/** Valgrind with the stack registration hooks: no errors, no "client switching stacks". */
async function checkValgrind(tc: Toolchain) {
  if (tc.target !== "linux-x64" || tc.runnerName !== "native") {
    return;
  }
  const valgrind = which("valgrind");
  const header = [
    "/usr/include/valgrind/valgrind.h",
    "/usr/local/include/valgrind/valgrind.h",
  ].find(existsSync);
  if (!valgrind || !header) {
    record(
      tc.target,
      `valgrind (${tc.name})`,
      "NOT RUN",
      !valgrind
        ? "valgrind not found"
        : "valgrind/valgrind.h not found (Fedora: valgrind-devel)"
    );
    return;
  }
  const config: Config = {
    id: "valgrind",
    cflags: ["-O1", "-g", "-DFIBER_VALGRIND=1"],
    ldflags: [],
    implFlags: ["-std=c11"],
    env: {},
  };
  const built = await buildFiberTest(tc, config);
  if (!built.ok) {
    record(
      tc.target,
      `valgrind build (${tc.name})`,
      "FAIL",
      lastLines(built.log)
    );
    return;
  }
  // Faulting tests are left out: Valgrind reports the deliberate guard hits as invalid accesses.
  const tests = [
    "layout",
    "pingpong",
    "self-switch",
    "entry-state",
    "registers",
    "fp-environment",
    "reuse",
    "deep-recursion",
    "big-frames",
    "trim",
    "backtrace",
  ];
  const r = await run(
    [valgrind, "--error-exitcode=99", "--quiet", built.exe, ...tests],
    { timeout: DEEP_TIMEOUT }
  );
  const ok = passed(r) && !/switching stacks/.test(r.out);
  record(
    tc.target,
    `valgrind memcheck with stack registration (${tc.name})`,
    ok ? "PASS" : "FAIL",
    ok ? `${(r.ms / 1000).toFixed(1)} s` : `${describe(r)}\n${lastLines(r.out)}`
  );
  // Without the registration Valgrind must notice: proves the hook does something.
  if (MUTANTS) {
    const mutant = writeMutant(tc, "valgrind-register");
    const m = await buildFiberTest(
      tc,
      config,
      mutant,
      join(built.dir, "mutant-valgrind-register")
    );
    const mr = m.ok
      ? await run(
          [valgrind, "--error-exitcode=99", "--quiet", m.exe, "registers"],
          { timeout: DEEP_TIMEOUT }
        )
      : null;
    const killed = !!mr && (!passed(mr) || /switching stacks/.test(mr.out));
    record(
      tc.target,
      `mutant valgrind-register (no stack registration)`,
      killed ? "PASS" : "FAIL",
      killed ? "killed" : "SURVIVED"
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Mutants
// ---------------------------------------------------------------------------------------------

type Mutant = {
  id: string;
  family: (
    | "sysv"
    | "win64"
    | "a64"
    | "win-a64"
    | "linux"
    | "windows"
    | "all"
    | "asan"
  )[];
  /** Rewrites one line carrying the "MUT <id>" marker; null deletes the instruction. */
  edit: ((line: string) => string) | null;
  /** If set, `fiber_test <test>` alone must fail and print this. */
  focus?: { test: string; expect: RegExp };
  /**
   * The register carries a new context's start arguments or the return address: without it every
   * context crashes as it starts, before anything can name the register. A crash of the focused
   * test counts as naming it.
   */
  crashOk?: boolean;
  /** Only observable on real hardware: emulators ignore what it changes. */
  emulationBlind?: boolean;
  /** The configs it is built in (default: O2). */
  configs?: string[];
  /**
   * Killed by the GC test (collections that stop the thread inside the switch), run GC_RUNS
   * times; the unmutated build must pass the same runs.
   */
  gcKill?: boolean;
  why: string;
};
const GC_RUNS = 5;

const MUTANT_PREFIX: Record<string, string> = {
  sysv: "sysv",
  win64: "win",
  a64: "a64",
};
const swap = (from: RegExp, to: string) => (line: string) =>
  line.replace(from, to);
const regMutant = (
  family: Mutant["family"][number],
  reg: string,
  scratch: string,
  slot: string
): Mutant => ({
  id: `${MUTANT_PREFIX[family]}-${reg}`,
  family: [family],
  edit: swap(new RegExp(`(%?)\\b${reg}\\b`), `$1${scratch}`),
  focus: { test: "registers", expect: new RegExp(`register ${slot}\\b`) },
  why: `${reg} not saved/restored`,
});

const startRegisters = new Set([
  "sysv-r12",
  "sysv-r13",
  "win-r12",
  "win-r13",
  "a64-x19",
  "a64-x20",
  "a64-x30",
]);

const MUTANTS_LIST: Mutant[] = [
  ...["rbx", "rbp", "r12", "r13", "r14", "r15"].map((r) =>
    regMutant("sysv", r, "rcx", r)
  ),
  {
    id: "sysv-mxcsr",
    family: ["sysv"],
    edit: null,
    focus: { test: "registers", expect: /mxcsr/ },
    why: "MXCSR not restored",
  },
  {
    id: "sysv-x87cw",
    family: ["sysv"],
    edit: null,
    focus: { test: "registers", expect: /x87 control word/ },
    why: "x87 CW not restored",
  },
  {
    id: "sysv-publish",
    family: ["sysv"],
    edit: null,
    why: "from->sp never written",
  },
  {
    id: "sysv-clear",
    family: ["sysv"],
    edit: null,
    why: "to->sp not cleared while running",
  },
  ...["rbx", "rbp", "rdi", "rsi", "r12", "r13", "r14", "r15"].map((r) =>
    regMutant("win64", r, "rcx", r)
  ),
  ...[6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((n) => ({
    ...regMutant("win64", `xmm${n}`, "xmm0", `xmm${n}`),
  })),
  {
    id: "win-mxcsr",
    family: ["win64"],
    edit: null,
    focus: { test: "registers", expect: /mxcsr/ },
    why: "MXCSR not restored",
  },
  {
    id: "win-x87cw",
    family: ["win64"],
    edit: null,
    focus: { test: "registers", expect: /x87 control word/ },
    why: "x87 CW not restored",
  },
  {
    id: "win-publish",
    family: ["win64"],
    edit: null,
    why: "from->sp never written",
  },
  { id: "win-clear", family: ["win64"], edit: null, why: "to->sp not cleared" },
  {
    id: "win-stackbase",
    family: ["win64", "win-a64"],
    edit: null,
    focus: { test: "registers", expect: /StackBase/ },
    why: "TEB StackBase not swapped",
  },
  {
    id: "win-stacklimit",
    family: ["win64", "win-a64"],
    edit: null,
    focus: { test: "registers", expect: /StackLimit/ },
    why: "TEB StackLimit not swapped",
  },
  {
    id: "win-dealloc",
    family: ["win64", "win-a64"],
    edit: null,
    focus: { test: "registers", expect: /DeallocationStack/ },
    why: "TEB DeallocationStack not swapped",
  },
  {
    id: "win-guarantee",
    family: ["win64", "win-a64"],
    edit: null,
    focus: { test: "registers", expect: /GuaranteedStackBytes/ },
    why: "TEB GuaranteedStackBytes not swapped",
  },
  {
    id: "init-teb-limit",
    family: ["windows"],
    edit: (l) =>
      l.replace(
        /\(uint64_t\)\(uintptr_t\)committed;/,
        "(uint64_t)(uintptr_t)s->limit;"
      ),
    why: "new context claims the whole stack is committed (StackLimit = limit)",
  },
  {
    id: "win-normalize",
    family: ["windows"],
    edit: (l) => l.replace(/fiber__win_shape\(s, committed\)/, "0"),
    why: "no growth guard restored after an overflow",
  },
  {
    id: "win-guardpage",
    family: ["windows"],
    edit: (l) => l.replace(/PAGE_READWRITE \| PAGE_GUARD/, "PAGE_READWRITE"),
    why: "no growth guard page",
  },
  ...[
    "x19",
    "x20",
    "x21",
    "x22",
    "x23",
    "x24",
    "x25",
    "x26",
    "x27",
    "x28",
    "x29",
    "x30",
  ].map((r) => regMutant("a64", r, "x16", r)),
  ...["d8", "d9", "d10", "d11", "d12", "d13", "d14", "d15"].map((r) =>
    regMutant("a64", r, "d16", r)
  ),
  {
    id: "a64-fpcr",
    family: ["a64"],
    edit: null,
    focus: { test: "registers", expect: /fpcr/ },
    why: "FPCR not restored",
  },
  {
    id: "a64-publish",
    family: ["a64"],
    edit: null,
    why: "from->sp never written",
  },
  { id: "a64-clear", family: ["a64"], edit: null, why: "to->sp not cleared" },
  {
    id: "init-fpctl",
    family: ["all"],
    edit: (l) => l.replace(/fiber__fp_control\(\)/, "0"),
    why: "new context does not inherit the FP control state",
  },
  {
    id: "init-align",
    family: ["all"],
    edit: (l) =>
      l.replace(/top - FIBER__INIT_WORDS/, "top - FIBER__INIT_WORDS - 1"),
    why: "new context starts misaligned",
  },
  {
    id: "trampoline-cfi",
    family: ["linux"],
    edit: null,
    why: "DWARF unwinding does not stop at the trampoline",
  },
  {
    id: "guard-prot",
    family: ["linux"],
    edit: (l) => l.replace(/mprotect\(base, guard, PROT_NONE\) != 0/, "0"),
    why: "guard stays accessible",
  },
  {
    id: "guard-contains",
    family: ["all"],
    edit: (l) =>
      l.replace(/a < \(uintptr_t\)s->limit/, "a <= (uintptr_t)s->limit"),
    why: "guard check off by one",
  },
  {
    id: "nohugepage",
    family: ["linux"],
    edit: (l) =>
      l
        .replace(/ \| MAP_STACK/, "")
        .replace(/\(void\)madvise\(base, total, MADV_NOHUGEPAGE\);/, ""),
    emulationBlind: true,
    why: "stacks may get huge pages",
  },
  {
    id: "trim-advice",
    family: ["linux"],
    edit: (l) =>
      l.replace(
        /madvise\(\(void \*\)limit, end - limit, MADV_DONTNEED\) != 0/,
        "0"
      ),
    why: "trim releases nothing",
  },
  {
    id: "asan-start",
    family: ["asan"],
    edit: null,
    why: "a new context does not finish ASan's switch",
  },
  {
    id: "asan-switch",
    family: ["asan"],
    edit: null,
    why: "fiber_switch does not tell ASan",
  },
  {
    id: "dead-check",
    family: ["all"],
    edit: null,
    why: "resuming a running/ended context is not caught",
  },
  {
    id: "init-zero",
    family: ["all"],
    edit: null,
    why: "a new context's frame is not zeroed (stale fp/return address)",
  },
  {
    id: "trim-all",
    family: ["linux"],
    edit: (l) =>
      l.replace(
        /madvise\(\(void \*\)limit, end - limit,/,
        "madvise((void *)limit, top - limit,"
      ),
    why: "trim releases the kept pages too",
  },
  {
    id: "trim-roundup",
    family: ["linux"],
    edit: (l) => l.replace(/\(top - keep\) & ~/, "(top - keep + page - 1) & ~"),
    why: "trim releases the page holding top - keep",
  },
  {
    id: "win-trim-rounddown",
    family: ["windows"],
    edit: (l) =>
      l.replace(
        /fiber__round_up\(keep < page \? page : keep, page, &overflow\)/,
        "((keep < page ? page : keep) & ~(page - 1))"
      ),
    why: "Windows trim releases the page holding top - keep",
  },
  {
    id: "endbr",
    family: ["sysv"],
    configs: ["cet-ibt"],
    edit: (l) => l.replace(/" {2}endbr64\\n"/, '""'),
    why: "no IBT landing pad",
  },
  {
    id: "bti",
    family: ["a64"],
    configs: ["pac-bti"],
    edit: (l) => l.replace(/" {2}bti c\\n"/, '""'),
    why: "no BTI landing pad",
  },
  {
    id: "sysv-clear-early",
    family: ["sysv"],
    edit: (l) =>
      l.replace(
        /" {2}movq %rcx, %rsp\\n"/,
        '"  movq $0, (%rdi)\\n  movq %rcx, %rsp\\n"'
      ),
    focus: { test: "gc-every-instruction", expect: /GC contract broken/ },
    why: "to->sp cleared before the stack pointer moves",
  },
  {
    id: "sysv-publish-late",
    family: ["sysv"],
    edit: (l) =>
      l
        .replace(
          /" {2}movq %rsp, \(%rdi\)\\n"/,
          '"  movq %rsp, %r11\\n  movq %rdi, %r10\\n"'
        )
        .replace(
          /" {2}movq %rcx, %rsp\\n"/,
          '"  movq %rcx, %rsp\\n  movq %r11, (%r10)\\n"'
        ),
    focus: { test: "gc-every-instruction", expect: /GC contract broken/ },
    why: "from->sp published after the stack pointer moves",
  },
  {
    id: "win-clear-early",
    family: ["win64"],
    edit: (l) =>
      l.replace(
        /" {2}movq %r9, %rsp\\n"/,
        '"  movq $0, (%rcx)\\n  movq %r9, %rsp\\n"'
      ),
    focus: { test: "gc-every-instruction", expect: /GC contract broken/ },
    why: "to->sp cleared before the stack pointer moves",
  },
  {
    id: "win-publish-late",
    family: ["win64"],
    edit: (l) =>
      l
        .replace(
          /" {2}movq %rsp, \(%rcx\)\\n"/,
          '"  movq %rsp, %r11\\n  movq %rcx, %r10\\n"'
        )
        .replace(
          /" {2}movq %r9, %rsp\\n"/,
          '"  movq %r9, %rsp\\n  movq %r11, (%r10)\\n"'
        ),
    focus: { test: "gc-every-instruction", expect: /GC contract broken/ },
    why: "from->sp published after the stack pointer moves",
  },
  {
    id: "a64-clear-early",
    family: ["a64"],
    edit: (l) =>
      l.replace(/" {2}mov sp, x9\\n"/, '"  str xzr, [x1]\\n  mov sp, x9\\n"'),
    gcKill: true,
    why: "to->sp cleared before the stack pointer moves",
  },
  {
    id: "a64-publish-late",
    family: ["a64"],
    edit: (l) =>
      l
        .replace(
          /" {2}str x9, \[x0\]\\n"/,
          '"  mov x11, x9\\n  mov x12, x0\\n"'
        )
        .replace(/" {2}mov sp, x9\\n"/, '"  mov sp, x9\\n  str x11, [x12]\\n"'),
    gcKill: true,
    why: "from->sp published after the stack pointer moves",
  },
  {
    id: "win-stacklimit-stale",
    family: ["win64"],
    edit: (l) =>
      l.replace(/" {2}movq %gs:0x10, %rax\\n"/, '"  movq 168(%rsp), %rax\\n"'),
    focus: { test: "registers", expect: /StackLimit/ },
    why: "TEB StackLimit not saved at suspend (a stale value comes back)",
  },
  {
    id: "win-guarantee-16",
    family: ["win64"],
    edit: (l) =>
      l
        .replace(
          /" {2}movl 184\(%rsp\), %edx\\n"/,
          '"  movw 184(%rsp), %dx\\n"'
        )
        .replace(
          /" {2}movl %edx, %gs:0x1748\\n"/,
          '"  movw %dx, %gs:0x1748\\n"'
        ),
    focus: { test: "registers", expect: /GuaranteedStackBytes/ },
    why: "TEB GuaranteedStackBytes restored as 16 bits",
  },
  {
    id: "a64-fpcr-rmode",
    family: ["a64"],
    edit: (l) =>
      l.replace(
        /" {2}msr fpcr, x9\\n"/,
        '"  bic x9, x9, #0x400000\\n  msr fpcr, x9\\n"'
      ),
    focus: { test: "registers", expect: /fpcr/ },
    why: "FPCR rounding-mode bit 22 lost",
  },
];
for (const m of MUTANTS_LIST) {
  m.crashOk = startRegisters.has(m.id);
}

function familiesOf(tc: Toolchain): Set<string> {
  const f = new Set<string>(["all"]);
  if (tc.target === "linux-x64") {
    f.add("sysv");
  }
  if (tc.target === "win32-x64") {
    f.add("win64");
  }
  if (tc.target.endsWith("arm64")) {
    f.add("a64");
  }
  if (tc.target === "win32-arm64") {
    f.add("win-a64");
  }
  f.add(tc.target.startsWith("linux") ? "linux" : "windows");
  return f;
}

function writeMutant(tc: Toolchain, id: string): string {
  const m = MUTANTS_LIST.find((x) => x.id === id) ?? {
    id: id,
    family: ["all"],
    edit: null,
    why: "",
  };
  const src = readFileSync(join(LIB_DIR, "fiber.h"), "utf8");
  // A Windows checkout (core.autocrlf) has CRLF: edit the lines without their "\r".
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  let changed = 0;
  const out = src
    .split(eol)
    .map((line) => {
      const marker = line.match(/MUT ([a-z0-9 -]+?) \*\//);
      if (!marker || !marker[1].split(" ").includes(id)) {
        return line;
      }
      changed++;
      let edited: string;
      if (m.edit === null) {
        // Drop the statement or instruction on this line, keep the line's string-literal shape.
        edited = /^\s*"/.test(line)
          ? line.replace(/"[^"]*\\n"/, '""')
          : line.replace(/^(\s*).*?(\/\*.*)$/, "$1$2");
      } else {
        edited = m.edit(line);
      }
      if (edited === line) {
        throw new Error(`mutant ${id}: the edit does not change its line: ${line}`);
      }
      return edited;
    })
    .join(eol);
  if (changed === 0) {
    throw new Error(`mutant ${id}: no line carries its marker`);
  }
  const dir = join(OUT, "mutants", tc.target, id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "fiber.h");
  writeFileSync(path, out);
  return path;
}

/** Why a mutant counts as killed, in order of strength, or why not. */
function killReason(
  r: RunResult,
  failedForReal: boolean,
  failedTest: string | undefined,
  staticFailure: string | null,
  deaths: string[],
  gcFailure: string | null
): string {
  if (failedForReal) {
    return failedTest ? `test ${failedTest}` : describe(r);
  }
  if (staticFailure !== null) {
    return `static check: ${staticFailure.split("\n")[0]}`;
  }
  if (deaths.length > 0) {
    return `death test: ${deaths[0].split(" ")[0]}`;
  }
  if (gcFailure !== null) {
    return `GC test: ${gcFailure.split("\n")[0]}`;
  }
  return r.timedOut ? "INCONCLUSIVE: the suite timed out" : "SURVIVED";
}

async function checkMutants(tc: Toolchain, config: Config, base: Built) {
  if (!base.ok || tc.runner === null) {
    return;
  }
  const fams = familiesOf(tc);
  if (config.id === "asan-ubsan") {
    fams.add("asan");
  }
  const list = MUTANTS_LIST.filter(
    (m) =>
      m.family.some((f) => fams.has(f)) &&
      (config.id === "asan-ubsan"
        ? m.family.includes("asan")
        : !m.family.includes("asan") &&
          (m.configs ?? ["O2"]).includes(config.id))
  );
  if (list.length === 0) {
    return;
  }
  // The unmutated build must pass everything a mutant is judged by, under the same conditions.
  const extraArgs = tc.emulated ? ["--emulated"] : [];
  const baseSuite = await run(tc.runner(base.exe, extraArgs), {
    env: { ...tc.env, ...config.env },
    timeout: MUTANT_TIMEOUT,
  });
  const baseDeaths = await deathProblems(tc, base.exe, config.env);
  const baseStatic = tc.target.startsWith("linux")
    ? await cfiProblem(tc, base.objs["fiber_impl.c"])
    : await sehProblem(tc, base.objs["fiber_impl.c"]);
  const baseEndbr =
    config.id === "cet-ibt"
      ? await endbrProblem(base.objs["fiber_impl.c"])
      : null;
  let baseGc: Built | null = null;
  let baseGcProblem: string | null = null;
  if (list.some((m) => m.gcKill)) {
    baseGc = await buildGc(tc, config, base);
    baseGcProblem = baseGc.ok
      ? await gcRunsProblem(tc, baseGc.exe, config.env)
      : `build: ${lastLines(baseGc.log, 3)}`;
  }
  if (
    !passed(baseSuite) ||
    baseDeaths.length ||
    baseStatic !== null ||
    baseEndbr !== null ||
    baseGcProblem !== null
  ) {
    record(
      tc.target,
      `mutants [${tc.name} ${config.id}]: not evaluated, the unmutated build fails`,
      "FAIL",
      [
        !passed(baseSuite) && `suite: ${describe(baseSuite)}`,
        ...baseDeaths,
        baseStatic,
        baseEndbr,
        baseGcProblem,
      ]
        .filter(Boolean)
        .join("\n")
    );
    return;
  }
  const outcomes = await pool(
    list.map((m) => async () => {
      const header = writeMutant(tc, m.id);
      const dir = join(base.dir, `mutant-${m.id}`);
      mkdirSync(dir, { recursive: true });
      // Only the implementation changes; the other objects are the base build's.
      const impl = join(dir, "fiber_impl" + tc.obj);
      if (tc.emulated && m.emulationBlind) {
        return {
          m: m,
          killed: false,
          how: `${tc.runnerName} cannot observe it`,
          focusOk: true,
          notRun: true,
        };
      }
      const c = await compile(
        tc,
        join(TESTS_DIR, "fiber_impl.c"),
        impl,
        [
          ...config.cflags,
          ...config.implFlags,
          `-DFIBER_TEST_HEADER="${header.replaceAll("\\", "/")}"`,
        ],
        false
      );
      if (c.code !== 0) {
        return {
          m: m,
          killed: false,
          how: `INVALID MUTANT: does not compile\n${lastLines(c.out)}`,
          focusOk: false,
        };
      }
      const exe = join(dir, "fiber_test" + tc.exe);
      const objs = [
        impl,
        base.objs["regs.c"],
        base.objs["fiber_test.c"],
        base.objs["clash.c"],
      ];
      const l = await run([
        tc.cc,
        ...tc.ldflags,
        ...config.ldflags,
        ...objs,
        "-o",
        exe,
        ...tc.libs,
      ]);
      if (l.code !== 0) {
        return {
          m: m,
          killed: false,
          how: `INVALID MUTANT: does not link\n${lastLines(l.out)}`,
          focusOk: false,
        };
      }
      const extra = tc.emulated ? ["--emulated"] : [];
      const r = await run(tc.runner!(exe, extra), {
        env: { ...tc.env, ...config.env },
        timeout: MUTANT_TIMEOUT,
      });
      // The static checks are part of the suite too.
      const staticFailure =
        (tc.target.startsWith("linux")
          ? await cfiProblem(tc, impl)
          : await sehProblem(tc, impl)) ??
        (config.id === "cet-ibt" ? await endbrProblem(impl) : null);
      const deaths =
        passed(r) && staticFailure === null
          ? await deathProblems(tc, exe, config.env)
          : [];
      let gcFailure: string | null = null;
      if (
        m.gcKill &&
        passed(r) &&
        staticFailure === null &&
        deaths.length === 0
      ) {
        const gc = await buildGc(tc, config, {
          ...base,
          objs: { ...base.objs, "fiber_impl.c": impl },
          dir: dir,
        });
        gcFailure = gc.ok
          ? await gcRunsProblem(tc, gc.exe, config.env)
          : `build: ${lastLines(gc.log, 3)}`;
      }
      // A timeout proves nothing by itself; only a named failure, a crash or a check does.
      const failedForReal = !passed(r) && !r.timedOut;
      const killed =
        failedForReal ||
        staticFailure !== null ||
        deaths.length > 0 ||
        gcFailure !== null;
      let focusOk = true;
      const failedTest = r.out.match(/FAIL \[([^\]]+)\]/)?.[1];
      let how = killReason(
        r,
        failedForReal,
        failedTest,
        staticFailure,
        deaths,
        gcFailure
      );
      if (m.focus && (killed || r.timedOut)) {
        // The full exit code: a crash must not pass for a test failure's exit 1.
        const f = await runFullExitCode(tc, tc.runner!(exe, [...extra, m.focus.test]), {
          env: { ...tc.env, ...config.env },
          timeout: MUTANT_TIMEOUT,
        });
        const named = !passed(f) && m.focus.expect.test(f.out);
        const crashed =
          !passed(f) &&
          (f.signal !== null ||
            (f.code !== null && f.code !== 1 && f.code !== 0));
        focusOk = named || (!!m.crashOk && crashed);
        if (!killed && named) {
          return {
            m: m,
            killed: true,
            how: `${how}; ${m.focus.test} names it`,
            focusOk: true,
          };
        }
        if (named) {
          how += `; ${m.focus.test} names it`;
        } else if (focusOk) {
          how += `; ${m.focus.test} crashes as a context starts (${describe(f)}): this register carries the start arguments`;
        } else {
          how += `; ${m.focus.test} does NOT name it: ${describe(f)} ${lastLines(f.out, 2)}`;
        }
      }
      return { m: m, killed: killed, how: how, focusOk: focusOk };
    })
  );
  for (const o of outcomes) {
    const ok = o.killed && o.focusOk;
    let status: Status = ok ? "PASS" : "FAIL";
    if ((o as { notRun?: boolean }).notRun) {
      status = "NOT RUN";
    }
    record(
      tc.target,
      `mutant ${o.m.id} (${o.m.why}) [${tc.name} ${config.id}]`,
      status,
      o.how
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

function runKind(): string {
  if (DEEP) {
    return "deep";
  }
  return MUTANTS ? "default + mutants" : "default";
}

async function main() {
  const start = performance.now();
  console.log(
    `fiber tests: host ${HOST_OS}-${HOST_ARCH}, ${runKind()} run, build dir ${OUT}`
  );
  await discover();
  const active = toolchains.filter((t) => wanted(t.target));
  for (const tc of active) {
    console.log(
      `  ${tc.target.padEnd(12)} ${tc.name.padEnd(22)} ${tc.runnerName}`
    );
  }

  const hostCc =
    active.find((t) => t.runnerName === "native")?.cc ?? active[0]?.cc;
  if (hostCc && !ONLY) {
    await checkCompileErrors(hostCc);
    await checkInsideStdlib();
  }

  // Build every toolchain x config in parallel, then run.
  const jobs: { tc: Toolchain; config: Config; built: Promise<Built> }[] = [];
  for (const tc of active) {
    for (const config of configsFor(tc)) {
      jobs.push({ tc: tc, config: config, built: buildFiberTest(tc, config) });
    }
  }
  const runs: (() => Promise<void>)[] = [];
  // Once-per-target checks run with the target's first toolchain (Haze's clang when present).
  const firstToolchain = new Map<string, Toolchain>();
  for (const tc of active) {
    if (!firstToolchain.has(tc.target)) {
      firstToolchain.set(tc.target, tc);
    }
  }
  for (const job of jobs) {
    const built = await job.built;
    const { tc, config } = job;
    const firstForTarget = firstToolchain.get(tc.target) === tc;
    runs.push(() => checkSuite(tc, config, built));
    if (config.id === "O2") {
      if (firstForTarget) {
        runs.push(() => checkDeath(tc, built));
        runs.push(() => checkGc(tc, config, built));
      }
      if (tc.target.startsWith("linux")) {
        runs.push(() => checkCfi(tc, built));
      }
      if (tc.target.startsWith("win32")) {
        runs.push(() => checkSehInfo(tc, built));
      }
      if (DEEP) {
        runs.push(() => checkGdb(tc, built));
        if (firstForTarget) {
          runs.push(() => checkValgrind(tc));
        }
      }
      if (MUTANTS && firstForTarget) {
        runs.push(() => checkMutants(tc, config, built));
      }
    }
    if (config.id === "O0" && DEEP && firstForTarget) {
      runs.push(() => checkGc(tc, config, built));
    }
    if (config.id === "asan-ubsan") {
      runs.push(() => checkGc(tc, config, built));
      if (MUTANTS) {
        runs.push(() => checkMutants(tc, config, built));
      }
    }
    if (config.id === "cet-ibt" || config.id === "pac-bti") {
      if (config.id === "cet-ibt") {
        runs.push(async () => {
          if (!built.ok) {
            return;
          }
          const problem = await endbrProblem(built.objs["fiber_impl.c"]);
          record(
            tc.target,
            `IBT: fiber__switch and fiber__exit start with endbr64 (${tc.name})`,
            problem === null ? "PASS" : "FAIL",
            problem ?? ""
          );
        });
      }
      if (MUTANTS && firstForTarget) {
        runs.push(() => checkMutants(tc, config, built));
      }
    }
  }
  await pool(runs);

  // Summary.
  console.log("\n" + "=".repeat(100));
  const byStatus = (s: Status) => rows.filter((r) => r.status === s);
  for (const t of [...new Set(rows.map((r) => r.target))]) {
    const mine = rows.filter((r) => r.target === t);
    console.log(
      `${t.padEnd(12)} ${String(mine.filter((r) => r.status === "PASS").length).padStart(4)} passed  ${String(mine.filter((r) => r.status === "FAIL").length).padStart(3)} failed  ${String(mine.filter((r) => r.status === "NOT RUN").length).padStart(3)} not run`
    );
  }
  const notRun = [
    ...unavailable.filter((u) => wanted(u.target)),
    ...byStatus("NOT RUN").map((r) => ({
      target: r.target as TargetName,
      reason: `${r.check}: ${r.detail}`,
    })),
  ];
  if (notRun.length) {
    console.log("\nNOT RUN on this machine:");
    for (const u of notRun) {
      console.log(`  ${u.target.padEnd(12)} ${u.reason}`);
    }
  }
  if (!MUTANTS) {
    console.log("\n(mutants not run: pass --mutants or --deep)");
  }
  if (byStatus("PASS").length === 0) {
    record(
      "host",
      "at least one check ran",
      "FAIL",
      "nothing ran on this machine for the selected targets"
    );
  }
  const failures = byStatus("FAIL");
  console.log(
    `\n${failures.length === 0 ? "ALL PASSED" : `${failures.length} FAILED`} in ${((performance.now() - start) / 1000).toFixed(1)} s`
  );
  for (const f of failures) {
    console.log(`  FAIL ${f.target} ${f.check}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

await main();
