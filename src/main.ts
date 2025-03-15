import { ArgumentParser } from "argparse";
import { ProjectCompiler } from "./ModuleCompiler";
import { version } from "../package.json";
import { GeneralError } from "./Errors";
import { join } from "path";

async function getFile(url: string, outfile: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

  const file = Bun.file(outfile);
  await Bun.write(file, response);
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
    help: "Run the project or a single file",
  });
  run_parser.add_argument("filename", {
    nargs: "?",
    help: "File to run",
  });

  const args = main_parser.parse_args();

  if (args.version) {
    console.log(`Haze version ${version}`);
    process.exit(0);
  }

  if (args.command === "build" || args.command === "run") {
    try {
      const project = new ProjectCompiler();

      if (!(await project.build(args.filename))) {
        process.exit(1);
      }

      if (args.command === "run") {
        const exitCode = await project.run(args.filename);
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
    if (args.command === "get") {
      await getFile(args.url, join(process.cwd(), args.filename));
    }
  }

  process.exit(0);
}

await main();
