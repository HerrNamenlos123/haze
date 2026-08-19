// Runs a real compiler run under the Node inspector and waits for a debugger
// to attach, so chrome://inspect can drive it live (breakpoints, the Memory
// tab, and manual Performance recordings).
//
// Node is used rather than Bun because Bun speaks the JavaScriptCore inspector
// protocol on ws://localhost:6499 and never registers a CDP target, so
// chrome://inspect cannot see a Bun process at all. Node does register, which
// is what the banner in src/main.ts refers to.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.dirname(require.resolve("../package.json"));
const bundlePath = path.join(root, "dist", "bundle.js");
const stdlibDir = path.join(root, "stdlib");
const cwd = process.env.INIT_CWD || process.cwd();

// argparse requires a subcommand; without one the process exits before the
// debugger has any chance to attach.
const args = process.argv.slice(2);
const commandArgs = args.length > 0 ? args : ["build"];

if (!fs.existsSync(bundlePath)) {
  console.error(`No bundle at ${bundlePath} - run \`node scripts/build.js\` first.`);
  process.exit(1);
}

// --inspect-brk rather than --inspect: a compile finishes in well under the
// time it takes to click through to the inspector, so without breaking on the
// first line there is nothing left to attach to.
const result = spawnSync(
  process.execPath,
  ["--inspect-brk", bundlePath, ...commandArgs],
  {
    cwd: cwd,
    stdio: "inherit",
    env: { ...process.env, HAZE_EXEC_MODE: "debug", HAZE_STDLIB_DIR: stdlibDir },
  }
);

process.exit(result.status ?? 1);
