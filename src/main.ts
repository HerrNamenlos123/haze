import { ArgumentParser } from "argparse";
import { ModuleCompiler } from "./ModuleCompiler";
import { version } from "../package.json";
import { ConfigParser } from "./Program";
import { GeneralError } from "./Errors";

const HAZE_CONFIG_FILE = "haze.toml";

async function parseConfig() {
  try {
    const parser = new ConfigParser(HAZE_CONFIG_FILE);
    return await parser.parseConfig();
  } catch (e: unknown) {
    if (e instanceof GeneralError) {
      console.log(e.message);
    } else {
      console.error(e);
    }
    return false;
  }
}

async function main() {
  const parser = new ArgumentParser({
    description: "Haze Compiler",
    prog: "hz",
  });

  parser.add_argument("--version", {
    action: "store_true",
    help: "Show version information",
  });

  parser.add_argument("command", {
    choices: ["build", "run"],
    help: "Build or Run the project",
  });

  const args = parser.parse_args();

  if (args.version) {
    console.log(`Haze version ${version}`);
    process.exit(0);
  }

  if (args.command === "build") {
    try {
      const config = await parseConfig();
      if (!config) {
        process.exit(1);
      }
      const module = new ModuleCompiler(config);
      if (!(await module.build())) {
        process.exit(1);
      }
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  }

  if (args.command === "run") {
    try {
      const config = await parseConfig();
      if (!config) {
        process.exit(1);
      }
      const module = new ModuleCompiler(config);
      if (!(await module.build())) {
        process.exit(1);
      }
      const exitCode = await module.run();
      process.exit(exitCode);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  }

  process.exit(0);
}

await main();
