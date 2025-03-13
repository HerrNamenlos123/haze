import { ArgumentParser } from "argparse";
import { ModuleCompiler } from "./ModuleCompiler";
import { version } from "../package.json";
import { ConfigParser, ModuleType } from "./Program";
import { GeneralError } from "./Errors";
import { join } from "path";

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
      const module = new ModuleCompiler();
      await module.loadConfig();

      if (!module.projectConfig?.nostdlib) {
        const stdlib = new ModuleCompiler();
        await stdlib.loadConfig(join(__dirname, "../stdlib"));
        stdlib.projectConfig!.buildDir = module.projectConfig!.buildDir;
        if (!(await stdlib.build())) {
          process.exit(1);
        }
      }

      if (!(await module.build())) {
        process.exit(1);
      }
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  }

  // if (args.command === "run") {
  //   try {
  //     const stdlib = new ModuleCompiler();
  //     if (!(await stdlib.build())) {
  //       process.exit(1);
  //     }

  //     const module = new ModuleCompiler();
  //     if (!(await module.build())) {
  //       process.exit(1);
  //     }
  //     const exitCode = await module.run();
  //     process.exit(exitCode);
  //   } catch (err) {
  //     if (err instanceof GeneralError) {
  //       console.log(err.message);
  //     } else {
  //       console.error(err);
  //     }
  //     process.exit(1);
  //   }
  // }

  process.exit(0);
}

await main();
