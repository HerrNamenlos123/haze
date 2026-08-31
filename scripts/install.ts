/**
 * Deploy the compiler and everything it needs to run outside this checkout.
 *
 *   bun run install [--prefix <dir>] [--no-verify] [--regen-antlr]
 *
 * What "everything it needs" means is defined by src/shared/InstallPaths.ts:
 * the compiler binary finds its payload by looking next to itself, so the
 * layout below is a contract, not a convention.
 *
 *   <prefix>/bin/haze              compiled compiler (Bun standalone binary)
 *   <prefix>/libexec/haze-parser   native Haze parser (the fast parse path)
 *   <prefix>/stdlib/...            standard library sources
 *   <prefix>/tools/...             build-time tools (regex-compiler)
 *   <prefix>/resources/...         bundled fonts and images
 *   <prefix>/install-manifest.json what was installed, from where, when
 *
 * The payload is staged in full and swapped in at the end, so an interrupted or
 * failed install never leaves a half-updated compiler behind.
 */

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { stampNativeParser } from "../src/Parser/NativeParser";
import { version } from "../package.json";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IS_WINDOWS = process.platform === "win32";
const EXE = IS_WINDOWS ? ".exe" : "";

// Everything the deployed compiler reads at runtime. Build outputs are skipped:
// the vendored Rust crates under stdlib/ rebuild themselves on first use, and a
// copied `target/` would be 80+ MB of stale objects.
const PAYLOAD_EXCLUDES = new Set([
  "__haze__",
  "target",
  "node_modules",
  ".git",
]);

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

let step = 0;
function heading(text: string): void {
  step++;
  console.info(chalk.bold.cyan(`\n[${step}] ${text}`));
}
function info(text: string): void {
  console.info(`    ${text}`);
}
function ok(text: string): void {
  console.info(chalk.green(`    ✓ ${text}`));
}
function warn(text: string): void {
  console.warn(chalk.yellow(`    ! ${text}`));
}
function fail(text: string): never {
  console.error(chalk.red(`\n✗ ${text}\n`));
  process.exit(1);
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; quiet?: boolean } = {}
): boolean {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    stdio: options.quiet ? "pipe" : "inherit",
    env: { ...process.env, ...options.env },
    encoding: "utf8",
  });
  return result.status === 0;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * A Windows virus scanner holds a freshly written .exe open for a moment, and
 * the next link into that same path dies with "permission denied" — which looks
 * exactly like a compile error but clears itself in under a second. Give the
 * lock a few chances to disappear before concluding the build is broken.
 */
function runWithRetry(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; quiet?: boolean } = {},
  attempts = 3
): boolean {
  for (let attempt = 1; ; attempt++) {
    if (run(command, args, options)) {
      return true;
    }
    if (attempt >= attempts) {
      return false;
    }
    const delay = 500 * attempt;
    warn(`build failed; retrying in ${delay}ms (${attempt + 1}/${attempts})`);
    sleepSync(delay);
  }
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

type Options = {
  prefix: string;
  verify: boolean;
  regenAntlr: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    prefix: process.env["HAZE_PREFIX"] ?? join(homedir(), ".haze"),
    verify: true,
    regenAntlr: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prefix") {
      const value = argv[++i];
      if (!value) {
        fail("--prefix needs a directory");
      }
      options.prefix = resolve(value);
    } else if (arg === "--no-verify") {
      options.verify = false;
    } else if (arg === "--regen-antlr") {
      options.regenAntlr = true;
    } else if (arg === "--help" || arg === "-h") {
      console.info(
        "Usage: bun run install [--prefix <dir>] [--no-verify] [--regen-antlr]"
      );
      process.exit(0);
    } else {
      fail(`Unknown argument '${arg}'`);
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * The ANTLR parser is only the fallback path now, but it is compiled into the
 * binary, so a missing autogen/ breaks the bundle outright. It is generated on
 * demand rather than every time: regeneration needs a JVM, and a checkout that
 * already has a current autogen/ should not depend on one.
 */
function ensureAntlrParser(options: Options): void {
  heading("ANTLR parser sources");
  const generated = join(
    REPO_ROOT,
    "src/Parser/grammar/autogen/HazeParser.ts"
  );
  if (existsSync(generated) && !options.regenAntlr) {
    ok("autogen/ present (pass --regen-antlr to rebuild it)");
    return;
  }
  info("running antlr4ng-cli...");
  if (run("bun", ["run", "generate-parser"])) {
    ok("generated");
    return;
  }
  if (existsSync(generated)) {
    warn("regeneration failed; keeping the existing autogen/");
    return;
  }
  fail(
    "The ANTLR parser sources are missing and could not be generated.\n" +
      "  'bun run generate-parser' needs a working Java runtime."
  );
}

/**
 * The native parser is a Haze program, so it is built by the compiler running
 * from source. `--parser native` reuses the existing binary to build its own
 * successor; the ANTLR path is the bootstrap for when there is none.
 */
function buildNativeParser(): string {
  heading("Native Haze parser");
  const binary = join(
    REPO_ROOT,
    "__haze__/haze-parser/bin",
    `haze-parser${EXE}`
  );

  const args = ["run", "src/main.ts", "build", "--dir", "compiler/haze-parser"];
  const env = { NODE_ENV: "development" };

  let built = false;
  if (existsSync(binary)) {
    info("building with the existing native parser...");
    built = runWithRetry("bun", [...args, "--parser", "native"], { env });
  }
  if (!built) {
    info("bootstrapping through the ANTLR parser...");
    built = runWithRetry("bun", [...args, "--parser", "antlr"], { env });
  }
  if (!(built && existsSync(binary))) {
    fail("Could not build the native Haze parser (compiler/haze-parser).");
  }

  // Keep the source-hash stamp in step, so builds from this checkout do not
  // decide the parser is stale and rebuild it again.
  stampNativeParser(REPO_ROOT);
  ok(binary.replace(`${REPO_ROOT}/`, ""));
  return binary;
}

function compileCompiler(stagingBin: string): void {
  heading("Compiler binary");
  mkdirSync(dirname(stagingBin), { recursive: true });
  const built = run(
    "bun",
    [
      "build",
      "--production",
      "--compile",
      "./src/main.ts",
      "--outfile",
      stagingBin,
    ],
    { env: { NODE_ENV: "production" } }
  );
  if (!(built && existsSync(stagingBin))) {
    fail("Could not compile the compiler binary.");
  }
  chmodSync(stagingBin, 0o755);
  ok(stagingBin);
}

function copyPayload(staging: string, parserBinary: string): void {
  heading("Payload (stdlib, tools, resources, parser)");

  for (const dir of ["stdlib", "tools", "resources"]) {
    const source = join(REPO_ROOT, dir);
    if (!existsSync(source)) {
      fail(`Missing '${dir}/' in the checkout — nothing to install.`);
    }
    cpSync(source, join(staging, dir), {
      recursive: true,
      dereference: true,
      filter: (src) => !PAYLOAD_EXCLUDES.has(basename(src)),
    });
    ok(`${dir}/`);
  }

  const libexec = join(staging, "libexec");
  mkdirSync(libexec, { recursive: true });
  const installedParser = join(libexec, `haze-parser${EXE}`);
  cpSync(parserBinary, installedParser);
  chmodSync(installedParser, 0o755);
  ok(`libexec/haze-parser${EXE}`);
}

function gitCommit(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

/**
 * Replace the installed payload with the staged one.
 *
 * Only the directories this installer owns are touched: a prefix of ~/.haze
 * also holds the downloaded C toolchain (global/), the build cache (cache/) and
 * tmp/, and wiping those would force a multi-minute re-download.
 */
function swapIn(staging: string, prefix: string): void {
  heading("Installing");
  mkdirSync(prefix, { recursive: true });
  const trash = join(prefix, `.trash-${process.pid}`);

  for (const dir of ["bin", "libexec", "stdlib", "tools", "resources"]) {
    const target = join(prefix, dir);
    if (existsSync(target)) {
      mkdirSync(trash, { recursive: true });
      renameSync(target, join(trash, dir));
    }
    renameSync(join(staging, dir), target);
  }
  rmSync(trash, { recursive: true, force: true });
  rmSync(staging, { recursive: true, force: true });

  writeFileSync(
    join(prefix, "install-manifest.json"),
    `${JSON.stringify(
      {
        version: version,
        commit: gitCommit(),
        installedAt: new Date().toISOString(),
        installedFrom: REPO_ROOT,
        platform: `${process.platform}-${process.arch}`,
      },
      null,
      2
    )}\n`
  );
  ok(prefix);
}

/**
 * Put `<prefix>/bin` on the user's PATH.
 *
 * There is deliberately no `haze` link in ~/.local/bin. The compiler finds its
 * payload through `realpathSync(process.execPath)` (src/shared/InstallPaths.ts),
 * so whatever the shell runs has to resolve back into `<prefix>/bin`: a copy
 * resolves to its own directory and finds no stdlib beside it, and a hardlink
 * does the same, having no original to resolve to. Only a symlink survives that
 * resolution — and creating one on Windows needs SeCreateSymbolicLinkPrivilege,
 * which an ordinary user account does not have. So the real directory goes on
 * PATH instead, the way rustup and bun do it.
 */
function ensureOnPath(prefix: string): string {
  heading("PATH");
  const binDir = join(prefix, "bin");
  if (IS_WINDOWS) {
    addToWindowsPath(binDir);
  } else {
    addToUnixPath(binDir);
  }
  return binDir;
}

// Read/modify/write HKCU\Environment directly. `setx` truncates PATH at 1024
// characters, and $env:PATH is the machine and user values already merged —
// writing that back would copy every machine entry into the user's PATH. The
// registry value is the only safe source. Its type is preserved so a PATH
// containing %USERPROFILE% stays expandable, and the WM_SETTINGCHANGE broadcast
// lets Explorer pick the change up without a logout.
const WINDOWS_PATH_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$dir = $env:HAZE_BIN_DIR
$key = Get-Item 'HKCU:\Environment'
$current = $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames')
if ($null -eq $current) { $current = ''; $kind = 'ExpandString' } else { $kind = $key.GetValueKind('Path') }
$entries = @($current -split ';' | Where-Object { $_ -ne '' })
if ($entries -contains $dir) { Write-Output 'present'; exit 0 }
$updated = ($entries + $dir) -join ';'
New-ItemProperty -Path 'HKCU:\Environment' -Name Path -Value $updated -PropertyType $kind -Force | Out-Null
Add-Type -Namespace HazeInstall -Name Native -MemberDefinition @'
[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
$result = [UIntPtr]::Zero
[HazeInstall.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result) | Out-Null
Write-Output 'added'
`;

function addToWindowsPath(binDir: string): void {
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_PATH_SCRIPT],
    { env: { ...process.env, HAZE_BIN_DIR: binDir }, encoding: "utf8" }
  );
  if (result.status !== 0) {
    warn(
      `could not update your PATH automatically:\n` +
        `      ${(result.stderr ?? "").trim()}\n` +
        `      Add this directory to your PATH by hand: ${binDir}`
    );
    return;
  }
  if ((result.stdout ?? "").trim().endsWith("present")) {
    ok(`${binDir} is already on your PATH`);
    return;
  }
  ok(`added ${binDir} to your user PATH`);
  info("open a new shell to pick it up");
}

// One guarded block per startup file, keyed off the directory itself so that
// reinstalling does not stack up duplicate exports.
function addToUnixPath(binDir: string): void {
  const block = `\n# added by haze install\nexport PATH="${binDir}:$PATH"\n`;
  const startupFiles = [".profile", ".bashrc", ".zshrc"]
    .map((name) => join(homedir(), name))
    .filter((file) => existsSync(file));

  if (startupFiles.length === 0) {
    warn(
      `no shell startup file found. Add this to yours by hand:\n` +
        `      export PATH="${binDir}:$PATH"`
    );
    return;
  }

  let touched = false;
  for (const file of startupFiles) {
    if (readFileSync(file, "utf8").includes(binDir)) {
      continue;
    }
    appendFileSync(file, block);
    ok(`added ${binDir} to ${file}`);
    touched = true;
  }
  if (touched) {
    info("open a new shell to pick it up");
  } else {
    ok(`${binDir} is already in your shell startup files`);
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Remove the `bun link` symlink from an earlier install.
 *
 * ~/.bun/bin comes before ~/.local/bin in a typical PATH, so a leftover link
 * there silently wins over everything installed here — and it points into
 * whichever checkout last ran `bun run build`, which may not even be this one.
 */
function removeBunLink(): void {
  const link = join(homedir(), ".bun/bin", `haze${EXE}`);
  if (!existsSync(link) && !isSymlink(link)) {
    return;
  }
  if (!isSymlink(link)) {
    warn(`${link} exists and is not a symlink — leaving it, it may shadow the install`);
    return;
  }
  const pointedAt = readlinkSync(link);
  unlinkSync(link);
  ok(`removed stale bun link ${link} (pointed at ${pointedAt})`);
}

/** Whatever `haze` a shell would actually run, by walking PATH in order. */
function firstHazeOnPath(): string | null {
  for (const entry of (process.env["PATH"] ?? "").split(delimiter)) {
    if (!entry) {
      continue;
    }
    const candidate = join(entry.replace(/^~/, homedir()), `haze${EXE}`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function checkShadowing(binDir: string, prefix: string): void {
  const found = firstHazeOnPath();
  if (!found) {
    // Expected after a first install: this process inherited its PATH before
    // the entry existed, so only a new shell can see it.
    info("'haze' is not on this shell's PATH yet — open a new shell");
    return;
  }
  const expected = realpathSync(join(prefix, "bin", `haze${EXE}`));
  if (realpathSync(found) !== expected) {
    warn(
      `'haze' on your PATH resolves to ${found}, not the new install.\n` +
        `      Remove it, or put ${binDir} earlier in PATH.`
    );
    return;
  }
  ok(`'haze' resolves to the new install (${found})`);
}

/**
 * Build and run a hello-world outside the checkout.
 *
 * This is the only check that proves the point of the whole install: the binary
 * has to find its stdlib with no repo, no cwd and no environment to help it.
 */
function verifyInstall(prefix: string): void {
  heading("Verifying");
  const haze = join(prefix, "bin", `haze${EXE}`);

  const versionResult = spawnSync(haze, ["--version"], { encoding: "utf8" });
  if (versionResult.status !== 0) {
    fail(`'${haze} --version' failed:\n${versionResult.stderr}`);
  }
  ok(`${haze} --version -> ${versionResult.stdout.trim()}`);

  const projectDir = mkdtempSync(join(tmpdir(), "haze-install-smoketest-"));
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(
    join(projectDir, "haze.toml"),
    [
      'name = "install_smoketest"',
      'version = "0.1.0"',
      'description = "Verifies an installed Haze compiler"',
      'license = "MIT"',
      "authors = []",
      'src = "src"',
      'type = "exe"',
      "",
    ].join("\n")
  );
  writeFileSync(
    join(projectDir, "src", "main.hz"),
    'fn main(): int {\n  fmt.println("haze install ok");\n  return 0;\n}\n'
  );

  info("compiling a hello-world outside the checkout (this can take a while)...");
  const runResult = spawnSync(haze, ["run"], {
    cwd: projectDir,
    encoding: "utf8",
    // A clean environment: no HAZE_STDLIB_DIR, no NODE_ENV, nothing pointing
    // back at the checkout. If this works, an install anywhere works.
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: homedir(),
      ...(process.env["TERM"] ? { TERM: process.env["TERM"] } : {}),
    },
  });
  if (runResult.status !== 0 || !runResult.stdout.includes("haze install ok")) {
    console.error(runResult.stdout);
    console.error(runResult.stderr);
    fail("The installed compiler could not build and run a hello-world.");
  }
  rmSync(projectDir, { recursive: true, force: true });
  ok("built and ran a project outside the checkout");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  // `install` is also an npm/bun lifecycle hook, so `bun install` would
  // otherwise trigger a full compiler deploy. Only an explicit `bun run install`
  // sets npm_command=run-script.
  if (process.env["npm_command"] !== "run-script") {
    console.info(
      chalk.dim(
        "haze: skipping compiler install (dependency install). Run 'bun run install' to deploy the compiler."
      )
    );
    return;
  }

  const options = parseArgs(process.argv.slice(2));
  console.info(
    chalk.bold(`Installing Haze ${version} from ${REPO_ROOT} to ${options.prefix}`)
  );

  const staging = join(options.prefix, `.staging-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });

  try {
    ensureAntlrParser(options);
    const parserBinary = buildNativeParser();
    compileCompiler(join(staging, "bin", `haze${EXE}`));
    copyPayload(staging, parserBinary);
    swapIn(staging, options.prefix);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  const binDir = ensureOnPath(options.prefix);
  removeBunLink();
  checkShadowing(binDir, options.prefix);

  if (options.verify) {
    verifyInstall(options.prefix);
  }

  console.info(chalk.bold.green("\n✓ Haze installed. Try: haze --version\n"));
}

main();
