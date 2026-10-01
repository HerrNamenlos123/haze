// `haze <name>` runs the project's [scripts] entry of that name.
//
// A script is a shell command, run in the project's directory (where its
// haze.toml is), so relative paths in it mean the same thing no matter where
// `haze` was invoked from. An entry under [scripts.linux] / [scripts.win32]
// wins over the plain [scripts] entry of the same name on that platform.
//
// main.ts only gets here for names that are not built-in commands, so a script
// named like one (`build = "haze build"`) is never reached this way.

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { parseConfig } from "../ModuleCompiler/ModuleCompiler";
import { PLATFORM, Platform } from "../shared/Config";
import { GeneralError } from "../shared/Errors";

// The scripts already running in this process tree, outermost first. A script
// that runs `haze <itself>` would otherwise recurse until the machine gives up.
const SCRIPT_STACK_ENV = "HAZE_SCRIPT_STACK";

export async function runScript(
  name: string,
  args: string[],
  builtinCommands: string[]
): Promise<number> {
  let explicitDir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && i + 1 < args.length) {
      explicitDir = args[++i];
    } else {
      throw new GeneralError(
        `Unexpected argument '${args[i]}': a script only takes --dir <project directory>`
      );
    }
  }

  const notACommand = `'${name}' is not a command (${builtinCommands.join(", ")})`;
  let config: Awaited<ReturnType<typeof parseConfig>>;
  try {
    config = await parseConfig(undefined, explicitDir);
  } catch (err) {
    if (err instanceof GeneralError) {
      const where = explicitDir
        ? `in ${explicitDir}`
        : "in this directory or any parent";
      throw new GeneralError(
        `${notACommand}, and there is no haze.toml ${where} to find a script of that name in`
      );
    }
    throw err;
  }
  if (!config.configFilePath) {
    throw new GeneralError(notACommand);
  }

  const platformScripts =
    PLATFORM === Platform.Linux ? config.scripts.linux : config.scripts.win32;
  const script =
    platformScripts.find((s) => s.name === name) ??
    config.scripts.any.find((s) => s.name === name);
  if (!script) {
    const available = [
      ...new Set(
        [...platformScripts, ...config.scripts.any].map((s) => s.name)
      ),
    ];
    throw new GeneralError(
      `${notACommand}, nor a script in ${config.configFilePath}` +
        (available.length > 0
          ? ` (scripts: ${available.join(", ")})`
          : " (it has no [scripts])")
    );
  }

  const stack = (process.env[SCRIPT_STACK_ENV] ?? "")
    .split(",")
    .filter((s) => s !== "");
  if (stack.includes(name)) {
    throw new GeneralError(
      `Script '${name}' runs itself: ${[...stack, name].join(" -> ")}`
    );
  }

  const result = spawnSync(script.command, {
    shell: true,
    stdio: "inherit",
    cwd: dirname(config.configFilePath),
    env: {
      ...process.env,
      HAZE_PROJECT_DIR: dirname(config.configFilePath),
      [SCRIPT_STACK_ENV]: [...stack, name].join(","),
    },
  });
  if (result.error) {
    throw new GeneralError(
      `Script '${name}' could not be started: ${result.error.message}`
    );
  }
  return result.status ?? 1;
}
