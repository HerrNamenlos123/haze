import path, { join } from "node:path";
import { ArgumentParser, REMAINDER } from "argparse";
import pkg from "../package.json" with { type: "json" };
import { startLsp } from "./lsp";
import { getFile } from "./ModuleCompiler/ModuleCompiler";
import { ProjectCompiler } from "./ProjectCompiler/ProjectCompiler";
import { GeneralError, SilentError } from "./shared/Errors";
import { type ParserMode, setParserMode } from "./Parser/ParserMode";

const version = pkg.version;
const isLspMode = process.argv.includes("lsp");

// Whole-program profiling flags, shared by `run` and `exec` (the two commands
// that actually launch the program -- `build` has nothing to profile, and an
// already-built binary is profiled by setting these same variables directly,
// see profiling.beginAutoProfiling). `--profile`/`--perf` are aliases so either
// spelling works, matching how bun/node expose this.
function addProfilingArguments(subparser: ArgumentParser) {
  subparser.add_argument("--profile", "--perf", {
    action: "store_true",
    dest: "profile",
    help: "Profile the whole program and write a Chrome trace on exit",
  });
  subparser.add_argument("--profile-out", {
    dest: "profileOut",
    help: "Path for the profiling output (default 'trace.json'; a '.cpuprofile' extension writes a Chrome DevTools CPU profile instead of a trace)",
  });
  subparser.add_argument("--profile-sampling-rate", {
    dest: "profileSamplingRate",
    help: "Profiling sampling rate in Hz (default 10000; 0 means the maximum rate the kernel allows)",
  });
  subparser.add_argument("--no-profile-memory", {
    action: "store_false",
    dest: "profileMemory",
    help: "Disable memory-allocation instrumentation while profiling",
  });
  subparser.add_argument("--no-profile-memory-stacktraces", {
    action: "store_false",
    dest: "profileMemoryStacktraces",
    help: "Disable stack traces for instrumented allocations (cheaper than --no-profile-memory, still records sizes)",
  });
}

// Translates the CLI flags into the environment the profiled process reads on
// startup. Same variables a user can set by hand on an already-built binary --
// the flags are a convenience over this, not a second mechanism.
function profilingEnvFromArgs(args: any): Record<string, string> {
  if (!args.profile) {
    return {};
  }
  const env: Record<string, string> = { HAZE_PROFILE: "1" };
  if (args.profileOut) {
    env["HAZE_PROFILE_OUT"] = String(args.profileOut);
  }
  if (
    args.profileSamplingRate !== undefined &&
    args.profileSamplingRate !== null
  ) {
    env["HAZE_PROFILE_SAMPLING_RATE"] = String(args.profileSamplingRate);
  }
  // store_false dests default to true, so these only ever turn things off.
  if (args.profileMemory === false) {
    env["HAZE_PROFILE_MEMORY"] = "0";
  }
  if (args.profileMemoryStacktraces === false) {
    env["HAZE_PROFILE_MEMORY_STACKTRACES"] = "0";
  }
  return env;
}

async function main(): Promise<number> {
  const parser = new ArgumentParser({ add_help: false });
  parser.add_argument("--version", { action: "version", version: "1.0.0" });

  const main_parser = new ArgumentParser({ parents: [parser] });
  const subparsers = main_parser.add_subparsers({
    dest: "command",
    required: true,
  });

  const build_parser = subparsers.add_parser("build", {
    help: "Build the project",
  });
  build_parser.add_argument("--no-sourceloc", {
    action: "store_false",
    dest: "sourceloc",
    help: "Disable source location tracking",
  });
  build_parser.add_argument("--full-rebuild", {
    action: "store_true",
    dest: "fullRebuild",
    help: "Force a full rebuild of all modules",
  });
  build_parser.add_argument("--dir", {
    dest: "explicitDir",
    help: "Set a specific project directory",
  });
  build_parser.add_argument("--verbose", {
    action: "store_true",
    dest: "verbose",
    help: "Enable verbose compiler output",
  });
  build_parser.add_argument("--ignore-lock", {
    action: "store_true",
    dest: "ignoreLock",
    help: "Skip build lock acquisition (internal use)",
  });
  build_parser.add_argument("--strip", {
    action: "store_true",
    dest: "strip",
    help: "Strip the final executable after building",
  });
  build_parser.add_argument("--show-timing", {
    action: "store_true",
    dest: "showTiming",
    help: "Print per-phase timing for each module after the build",
  });
  build_parser.add_argument("--quiet", {
    action: "store_true",
    dest: "quiet",
    help: "Suppress progress bars; only print diagnostics",
  });
  build_parser.add_argument("--parser", {
    dest: "parser",
    choices: ["antlr", "native", "assert"],
    default: "antlr",
    help:
      "Which parser to use: 'antlr' (default), 'native' (the much faster " +
      "hand-written parser in compiler/haze-parser), or 'assert' (run both " +
      "and require identical ASTs)",
  });
  build_parser.add_argument("filename", {
    nargs: "?",
    help: "Single file to build without running it (no haze.toml needed)",
  });

  const get_parser = subparsers.add_parser("get", { help: "Download a file" });
  get_parser.add_argument("url", { help: "URL to download" });
  get_parser.add_argument("filename", { help: "Filename to save as" });

  const run_parser = subparsers.add_parser("run", {
    help: "Run the project",
  });
  run_parser.add_argument("args", {
    nargs: REMAINDER,
    help: "Arguments to pass to the running program",
  });
  run_parser.add_argument("--no-sourceloc", {
    action: "store_false",
    dest: "sourceloc",
    help: "Disable source location tracking",
  });
  run_parser.add_argument("--full-rebuild", {
    action: "store_true",
    dest: "fullRebuild",
    help: "Force a full rebuild of all modules",
  });
  run_parser.add_argument("--dir", {
    dest: "explicitDir",
    help: "Set a specific project directory",
  });
  run_parser.add_argument("--verbose", {
    action: "store_true",
    dest: "verbose",
    help: "Enable verbose compiler output",
  });
  run_parser.add_argument("--ignore-lock", {
    action: "store_true",
    dest: "ignoreLock",
    help: "Skip build lock acquisition (internal use)",
  });
  run_parser.add_argument("--strip", {
    action: "store_true",
    dest: "strip",
    help: "Strip the final executable after building",
  });
  run_parser.add_argument("--parser", {
    dest: "parser",
    choices: ["antlr", "native", "assert"],
    default: "antlr",
    help:
      "Which parser to use: 'antlr' (default), 'native' (the much faster " +
      "hand-written parser in compiler/haze-parser), or 'assert' (run both " +
      "and require identical ASTs)",
  });
  run_parser.add_argument("--show-timing", {
    action: "store_true",
    dest: "showTiming",
    help: "Print per-phase timing for each module after the build",
  });
  run_parser.add_argument("--quiet", {
    action: "store_true",
    dest: "quiet",
    help: "Suppress progress bars; only print diagnostics",
  });
  addProfilingArguments(run_parser);

  const exec_parser = subparsers.add_parser("exec", {
    help: "Run a single file immediately as a script",
  });
  exec_parser.add_argument("--no-sourceloc", {
    action: "store_false",
    dest: "sourceloc",
    help: "Disable source location tracking",
  });
  exec_parser.add_argument("--full-rebuild", {
    action: "store_true",
    dest: "fullRebuild",
    help: "Force a full rebuild of all modules",
  });
  exec_parser.add_argument("--dir", {
    dest: "explicitDir",
    help: "Set a specific project directory",
  });
  exec_parser.add_argument("--verbose", {
    action: "store_true",
    dest: "verbose",
    help: "Enable verbose compiler output",
  });
  exec_parser.add_argument("--ignore-lock", {
    action: "store_true",
    dest: "ignoreLock",
    help: "Skip build lock acquisition (internal use)",
  });
  exec_parser.add_argument("--strip", {
    action: "store_true",
    dest: "strip",
    help: "Strip the final executable after building",
  });
  exec_parser.add_argument("--show-timing", {
    action: "store_true",
    dest: "showTiming",
    help: "Print per-phase timing for each module after the build",
  });
  exec_parser.add_argument("--quiet", {
    action: "store_true",
    dest: "quiet",
    help: "Suppress progress bars; only print diagnostics",
  });
  addProfilingArguments(exec_parser);
  exec_parser.add_argument("filename", {
    nargs: "?",
    help: "File to run",
  });
  exec_parser.add_argument("args", {
    nargs: REMAINDER,
    help: "Arguments to pass to the script",
  });

  subparsers.add_parser("lsp", {
    help: "Run the Haze language server over stdio",
  });

  const args = main_parser.parse_args();

  if (args.version) {
    console.info(`Haze version ${version}`);
    return 0;
  }

  try {
    if (args.command === "lsp") {
      await startLsp();
      return 0;
    }
    if (
      args.command === "build" ||
      args.command === "run" ||
      args.command === "exec"
    ) {
      // Select the parser implementation for this invocation. `assert` runs
      // both and requires identical ASTs, which is how the two stay in sync.
      setParserMode((args.parser ?? "antlr") as ParserMode, process.cwd());

      const project = new ProjectCompiler(
        Boolean(args.verbose),
        Boolean(args.ignoreLock),
        Boolean(args.strip),
        Boolean(args.showTiming),
        Boolean(args.quiet)
      );

      if (
        !(await project.build(
          args.filename,
          args.explicitDir,
          args.sourceloc,
          args.fullRebuild
        ))
      ) {
        return 1;
      }
      if (args.command === "run" || args.command === "exec") {
        const exitCode = await project.run(
          args.filename,
          args.explicitDir,
          args.sourceloc,
          args.args,
          profilingEnvFromArgs(args)
        );
        return exitCode;
      }
    } else if (args.command === "wget") {
      if (path.isAbsolute(args.filename)) {
        await getFile(args.url, args.filename);
      } else {
        await getFile(args.url, join(process.cwd(), args.filename));
      }
    }
  } catch (err) {
    if (err instanceof GeneralError) {
      console.info(err.message);
    } else if (err instanceof SilentError) {
    } else {
      console.error(err);
    }
    return 1;
  }

  return 0;
}

if ((process.env as any).HAZE_EXEC_MODE === "profiling") {
  const url = "chrome://inspect";

  // ANSI helpers
  const reset = "\x1b[0m";
  const bold = "\x1b[1m";
  const fg = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
  const bg = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;

  console.log(
    `${bold}${fg(255, 255, 255)}${bg(255, 0, 200)}  OPEN CHROME INSPECT  ${reset}\n` +
      `${bold}${fg(0, 255, 255)}${url}${reset}`
  );

  async function runMain() {
    try {
      await main();
    } catch {
      // intentionally ignored for profiling
    }

    // setTimeout(() => {
    //   void runMain();
    // }, 5000);
  }

  void runMain();
} else {
  main()
    .then((exitCode) => {
      if (!isLspMode) {
        process.exit(exitCode);
      }
    })
    .catch(() => {});
}
