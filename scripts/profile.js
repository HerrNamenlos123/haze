const { spawnSync } = require("node:child_process");
const path = require("node:path");

const bundlePath = path.join(__dirname, "..", "dist", "bundle.js");
const stdlibDir = path.join(__dirname, "..", "stdlib");
const cwd = process.env.INIT_CWD || process.cwd();
const args = process.argv.slice(2);

const result = spawnSync(process.execPath, ["--inspect", bundlePath, ...args], {
  cwd: cwd,
  stdio: "inherit",
  env: { ...process.env, HAZE_EXEC_MODE: "profiling", HAZE_STDLIB_DIR: stdlibDir },
});

process.exit(result.status ?? 1);
