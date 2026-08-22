// Writes a V8 CPU profile of a real compiler run to <root>/*.cpuprofile and
// opens it in VS Code.
//
// Runs the esbuild bundle under `node --cpu-prof` rather than under Bun on
// purpose: Bun has no --cpu-prof (the flag does not exist anywhere in the
// binary) and silently ignores unknown flags, so a Bun-based profile produces
// no file and no error. See scripts/debug.js for the live-debugger equivalent.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.dirname(require.resolve("../package.json"));
const bundlePath = path.join(root, "dist", "bundle.js");
const stdlibDir = path.join(root, "stdlib");
const cwd = process.env.INIT_CWD || process.cwd();

// The subcommand is required by argparse, so a bare `run profile` would exit(2)
// before doing any work and leave an empty profile behind.
const args = process.argv.slice(2);
const commandArgs = args.length > 0 ? args : ["build"];

if (!fs.existsSync(bundlePath)) {
  console.error(`No bundle at ${bundlePath} - run \`node scripts/build.js\` first.`);
  process.exit(1);
}

for (const file of fs.readdirSync(root)) {
  if (file.endsWith(".cpuprofile")) {
    fs.rmSync(path.join(root, file));
  }
}

console.log(`Profiling: ${commandArgs.join(" ")}`);

const result = spawnSync(
  process.execPath,
  ["--cpu-prof", "--cpu-prof-dir", root, bundlePath, ...commandArgs],
  {
    cwd: cwd,
    stdio: "inherit",
    env: { ...process.env, HAZE_EXEC_MODE: "profiling", HAZE_STDLIB_DIR: stdlibDir },
  }
);

const profile = fs.readdirSync(root).find((f) => f.endsWith(".cpuprofile"));
if (profile) {
  console.log(`\nProfile written: ${profile}`);
  spawnSync("code", [`"${path.join(root, profile)}"`], { stdio: "inherit", shell: true });
} else {
  console.error("\nNo .cpuprofile was written.");
}

process.exit(result.status ?? 1);
