const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.dirname(require.resolve("../package.json"));
const bundlePath = path.join(root, "dist", "bundle.js");
const stdlibDir = path.join(root, "stdlib");
const cwd = process.env.INIT_CWD || process.cwd();
const args = process.argv.slice(2);

const result = spawnSync(
  process.execPath,
  ["--cpu-prof", "--cpu-prof-dir", root, bundlePath, ...args],
  {
    cwd: cwd,
    stdio: "inherit",
    env: { ...process.env, HAZE_EXEC_MODE: "profiling", HAZE_STDLIB_DIR: stdlibDir },
  }
);

process.exit(result.status ?? 1);
