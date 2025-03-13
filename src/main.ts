import { ArgumentParser } from "argparse";
import { ProjectCompiler } from "./ModuleCompiler";
import { version } from "../package.json";
import { GeneralError } from "./Errors";
import { join } from "path";

async function main() {
  const parser = new ArgumentParser({ add_help: false });
  parser.add_argument("--version", { action: "version", version: version });

  const main_parser = new ArgumentParser({ parents: [parser] });

  main_parser.add_argument("command", {
    choices: ["build", "run"],
    help: "Build or Run the project",
  });

  const args = main_parser.parse_args();

  if (args.version) {
    console.log(`Haze version ${version}`);
    process.exit(0);
  }

  if (args.command === "build" || args.command === "run") {
    try {
      const project = new ProjectCompiler();

      if (!(await project.build())) {
        process.exit(1);
      }

      if (args.command === "run") {
        const exitCode = await project.run();
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
  }

  process.exit(0);
}

await main();
