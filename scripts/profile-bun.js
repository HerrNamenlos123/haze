// Writes a CPU profile of a real compiler run using Bun's sampling profiler
// and opens it in VS Code.
//
// Bun's --cpu-prof needs >= Bun 1.3; older versions silently ignore unknown
// flags, so on 1.2.x this produced no file and no error at all.
//
// It also drops the profile silently when it grows too large: a full cold build
// at the default 1000us sampling interval produces roughly 20MB and simply
// writes nothing. Hence the coarser default interval below, and the explicit
// check for the file afterwards rather than trusting the exit code.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.dirname(require.resolve("../package.json"));
// Bun writes no profile at all - silently - when either the entry or
// --cpu-prof-dir is given as an absolute path. Both must stay relative, so the
// run is anchored at the repo root and the profile lands there.
const entry = "src/main.ts";
const cwd = root;

// Microseconds between samples. Lower is more detailed but risks the size
// limit above; raise it if a build produces no profile.
const interval = process.env.HAZE_PROF_INTERVAL || "10000";

// argparse declares the subcommand required, so a bare run would exit(2)
// before doing any work.
const args = process.argv.slice(2);
const commandArgs = args.length > 0 ? args : ["build"];

const markdown = process.env.HAZE_PROF_MD === "1";

for (const file of fs.readdirSync(cwd)) {
  if (file.endsWith(".cpuprofile") || file.endsWith(".cpuprofile.md")) {
    fs.rmSync(path.join(cwd, file));
  }
}

// --cpu-prof-dir is passed as "." rather than an absolute path: given an
// absolute Windows path Bun silently writes no profile at all. The profile
// therefore lands in the spawn cwd, which is where we look for it below.
const bunArgs = ["--cpu-prof", "--cpu-prof-dir=.", `--cpu-prof-interval=${interval}`];
if (markdown) {
  bunArgs.push("--cpu-prof-md");
}

console.log(`Profiling \`${commandArgs.join(" ")}\` at ${interval}us sampling`);

const result = spawnSync("bun", [...bunArgs, entry, ...commandArgs], {
  cwd: cwd,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NODE_ENV: "development", HAZE_EXEC_MODE: "profiling" },
});

const profile = fs
  .readdirSync(cwd)
  .find((f) => f.endsWith(".cpuprofile") || f.endsWith(".cpuprofile.md"));

if (profile) {
  const mb = (fs.statSync(path.join(cwd, profile)).size / 1e6).toFixed(1);
  console.log(`\nProfile written: ${profile} (${mb} MB)`);
  spawnSync("code", [`"${path.join(cwd, profile)}"`], { stdio: "inherit", shell: true });
} else {
  console.error(
    `\nBun wrote no profile. It discards oversized profiles without reporting an` +
      ` error, so retry with a coarser interval:\n` +
      `  HAZE_PROF_INTERVAL=${Number(interval) * 2} bun run profile`
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
