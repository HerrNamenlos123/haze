import { ArgumentParser, REMAINDER } from "argparse";
import { GeneralError, SilentError } from "./shared/Errors";
import { join } from "path";
import path from "node:path";
import { getFile, ProjectCompiler } from "./Module";
import { startLsp } from "./lsp";

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

  const exec_parser = subparsers.add_parser("exec", {
    help: "Run a single file immediately as a script",
  });
  exec_parser.add_argument("--no-sourceloc", {
    action: "store_false",
    dest: "sourceloc",
    help: "Disable source location tracking",
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
      const project = new ProjectCompiler();
      if (!(await project.build(args.filename, args.sourceloc))) {
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

if (true) {
  main()
    .then((exitCode) => {
      if (!isLspMode) {
        process.exit(exitCode);
      }
    })
    .catch(() => {});
} else {
  setInterval(() => {
    main().catch(() => {});
  }, 15000);
}

export function sleep(ms: number) {
  return new Promise<void>((res, _rej) => {
    setTimeout(() => {
      res();
    }, ms);
  });
}
