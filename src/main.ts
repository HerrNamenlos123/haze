import { ArgumentParser, REMAINDER } from "argparse";
import { version } from "../package.json";
import { GeneralError } from "./shared/Errors";
import { join } from "path";
import path from "node:path";
import { ProjectCompiler } from "./Module";

async function getFile(url: string, outfile: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  await Bun.write(outfile, new Uint8Array(buffer));
}

async function main() {
  const parser = new ArgumentParser({ add_help: false });
  parser.add_argument("--version", { action: "version", version: "1.0.0" });

  const main_parser = new ArgumentParser({ parents: [parser] });
  const subparsers = main_parser.add_subparsers({
    dest: "command",
    required: true,
  });

  subparsers.add_parser("build", { help: "Build the project" });

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

  const exec_parser = subparsers.add_parser("exec", {
    help: "Run a single file immediately as a script",
  });
  exec_parser.add_argument("filename", {
    nargs: "?",
    help: "File to run",
  });
  exec_parser.add_argument("args", {
    nargs: REMAINDER,
    help: "Arguments to pass to the script",
  });

  const args = main_parser.parse_args();

  if (args.version) {
    console.log(`Haze version ${version}`);
    process.exit(0);
  }

  if (args.command === "build" || args.command === "run" || args.command === "exec") {
    try {
      const project = new ProjectCompiler();
      if (!(await project.build(args.filename))) {
        process.exit(1);
      }
      if (args.command === "run" || args.command === "exec") {
        const exitCode = await project.run(args.filename, args.args);
        process.exit(exitCode);
      }
    } catch (err) {
      if (err instanceof GeneralError) {
        console.log(err.message);
      } else {
        console.error(err);
      }
      process.exit(1);
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

  process.exit(0);
}

await main();
