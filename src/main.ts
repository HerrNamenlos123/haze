import { ArgumentParser, REMAINDER } from "argparse";
import { GeneralError, SilentError } from "./shared/Errors";
import { join } from "path";
import path from "node:path";
import { getFile, ProjectCompiler } from "./Module";
import { startLsp } from "./lsp";
import open from "open";

import pkg from "../package.json" with { type: "json" };
const version = pkg.version;
const isLspMode = process.argv.includes("lsp");

async function main(): Promise<number> {
  const parser = new ArgumentParser({ add_help: false });
  parser.add_argument("--version", { action: "version", version: "1.0.0" });

  const main_parser = new ArgumentParser({ parents: [parser] });
  const subparsers = main_parser.add_subparsers({
    dest: "command",
    required: true,
  });

  const build_parser = subparsers.add_parser("build", { help: "Build the project" });
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
    if (args.command === "build" || args.command === "run" || args.command === "exec") {
      const project = new ProjectCompiler(
        Boolean(args.verbose),
        Boolean(args.ignoreLock),
        Boolean(args.strip),
      );

      if (!(await project.build(args.filename, args.sourceloc, args.fullRebuild))) {
        return 1;
      }
      if (args.command === "run" || args.command === "exec") {
        const exitCode = await project.run(args.filename, args.sourceloc, args.args);
        return exitCode;
      }
    } else {
      if (args.command === "wget") {
        if (path.isAbsolute(args.filename)) {
          await getFile(args.url, args.filename);
        } else {
          await getFile(args.url, join(process.cwd(), args.filename));
        }
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
      `${bold}${fg(0, 255, 255)}${url}${reset}`,
  );

  async function runMain() {
    try {
      await main();
    } catch {
      // intentionally ignored for profiling
    }

    setTimeout(() => {
      void runMain();
    }, 5000);
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

export function sleep(ms: number) {
  return new Promise<void>((res, _rej) => {
    setTimeout(() => {
      res();
    }, ms);
  });
}
