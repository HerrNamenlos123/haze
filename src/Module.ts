import * as child_process from "child_process";
import os from "os";
import path from "path";
import { mkdir } from "fs/promises";
import {
  assert,
  CmdFailed,
  CompilerError,
  GeneralError,
  ImpossibleSituation,
  InternalError,
  SilentError,
  SyntaxError,
  UnreachableCode,
} from "./shared/Errors";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { readdir, stat } from "fs/promises";
import { basename, dirname, extname, join } from "path";
import fs from "fs";
import { version } from "../package.json";
import {
  ConfigParser,
  EModuleFileDir,
  ModuleType,
  parseModuleMetadata,
  Platform,
  PLATFORM,
  PlatformStrings,
  type CompileCommands,
  type GeneratorConfig,
  type GeneratorFile,
  type GeneratorGraphNode,
  type ModuleConfig,
  type ModuleMetadata,
  type ScriptDef,
} from "./shared/Config";
import { Parser } from "./Parser/Parser";
import {
  Collect,
  CollectFile,
  CollectImmediate,
  ECollectionMode,
  makeCollectionContext,
  PrettyPrintCollected,
  type CollectionContext,
} from "./SymbolCollection/SymbolCollection";
import { generateCode } from "./Codegen/CodeGenerator";
import { LowerModule } from "./Lower/Lower";
import { ExportCollectedSymbols as ExportSymbols } from "./SymbolCollection/Export";
import { Semantic } from "./Semantic/Elaborate";
import { cwd, stdout } from "process";
import { spawnSync } from "child_process";
import archiver from "archiver";
import tarFs from "tar-fs";
import gunzip from "gunzip-maybe";
import { spawn } from "child_process";
import fg from "fast-glob";
import { writeFile, readFile } from "fs/promises";
import which from "which";

import { MultiBar, Presets, SingleBar } from "cli-progress";
import chalk from "chalk";
import { sleep } from "./main";
import { once } from "events";

export enum EModulePrintCompilerPhase {
  Parsing,
  Collecting,
  Analyzing,
  Lowering,
  Generating,
  CCompiling,
  Done,
}

export type ModulePrintInfo = {
  name: string;
  phase: EModulePrintCompilerPhase;
  startTime: Date;
  endTime?: Date;
  bar?: SingleBar;
  printer: CLIPrinter;
};

function copyFile(source: string, targetFolder: string) {
  const parent = dirname(targetFolder);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }

  fs.copyFileSync(source, targetFolder);
}

/**
 * Temporarily sets environment variables for an async callback.
 *
 * @param vars - object mapping env var names to values
 * @param fn - async callback to run with the temporary environment
 * @returns the value returned by fn
 */
export async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const oldValues: Record<string, string | undefined> = {};

  // Save old values and set new ones
  for (const key of Object.keys(vars)) {
    oldValues[key] = process.env[key];
    process.env[key] = vars[key];
  }

  try {
    return await fn();
  } finally {
    // Restore original values
    for (const key of Object.keys(vars)) {
      const old = oldValues[key];
      if (old === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = old;
      }
    }
  }
}

export class CLIPrinter {
  modules: ModulePrintInfo[] = [];
  multibar: MultiBar;
  updateInterval: NodeJS.Timeout | null = null;

  static spinnerIndex = 0; // synchronized

  static SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

  constructor() {
    this.multibar = new MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: (options, params, payload) => {
          return this.createCustomFormat(payload.module, payload.spinnerIndex);
        },
      },
      Presets.shades_classic,
    );
  }

  createCustomFormat(module: ModulePrintInfo, spinnerIndex: number) {
    const index = this.modules.findIndex((m) => m === module);
    const indexStr = chalk.gray(`[${index + 1}/${this.modules.length}]`);
    const actionStr = chalk.greenBright("Compiling");
    const nameStr = chalk.white(module.name.padEnd(14));
    const timeStr = chalk.gray(`${Date.now() - module.startTime.getTime()}ms`.padStart(7));
    const DONE_GLYPH = chalk.green("✔");

    let phaseBlock;

    if (module.endTime) {
      const doneText = `Done     ${DONE_GLYPH}`;
      phaseBlock = `[${doneText}]`;
    } else {
      // State: ACTIVE (Spinning)
      let text = "";
      switch (module.phase) {
        case EModulePrintCompilerPhase.Parsing:
          text = "Parsing      ";
          break;
        case EModulePrintCompilerPhase.Collecting:
          text = "Collecting   ";
          break;
        case EModulePrintCompilerPhase.Analyzing:
          text = "Analyzing    ";
          break;
        case EModulePrintCompilerPhase.Lowering:
          text = "Lowering     ";
          break;
        case EModulePrintCompilerPhase.Generating:
          text = "Generating C ";
          break;
        case EModulePrintCompilerPhase.CCompiling:
          text = "Compiling C  ";
          break;
      }
      phaseBlock = `[${chalk.cyan(text)}${chalk.cyan(CLIPrinter.SPINNER[spinnerIndex])}]`;
    }

    return `${indexStr} ${actionStr} ${nameStr} ${phaseBlock} ${timeStr}`;
  }

  log(message: string) {
    this.multibar.log(message + "\n");
  }

  loop() {
    CLIPrinter.spinnerIndex = (CLIPrinter.spinnerIndex + 1) % CLIPrinter.SPINNER.length;

    this.modules.forEach((m) => {
      // Update the bar using the custom payload and the new time
      m.bar?.update(0, {
        module: m,
        spinnerIndex: CLIPrinter.spinnerIndex,
      });
    });
  }

  start() {
    // if (this.updateInterval) return;
    // this.modules.forEach((m) => {
    //   if (m.bar) return;
    //   // The total value doesn't matter much since we are manually controlling the output,
    //   // but we set it up anyway.
    //   const total = 0; // Dont understand what total is
    //   m.bar = this.multibar.create(
    //     total,
    //     0,
    //     {
    //       module: m, // Attach the module state to the bar payload
    //       spinnerIndex: 0,
    //     },
    //     {}
    //   );
    // });
    // console.log("Starting");
    // this.loop();
    // this.updateInterval = setInterval(() => {
    //   this.loop();
    // }, 50);
  }

  stopAndFinishAll() {
    // if (this.updateInterval) {
    //   clearInterval(this.updateInterval);
    //   this.updateInterval = null;
    //   // this.loop();
    //   this.multibar.stop();
    //   console.log("Stopping");
    // }
  }
}

export const HAZE_DIR = os.homedir() + "/.haze";
export const HAZE_CACHE = HAZE_DIR + "/cache";
export const HAZE_TOOLCHAIN_INSTALLED_MARKER = HAZE_CACHE + "/toolchain-installed.json";
export const HAZE_GLOBAL_DIR = HAZE_DIR + "/global";
export const HAZE_TMP_DIR = HAZE_DIR + "/tmp";
export const HAZE_MUSL_SYSROOT = HAZE_DIR + "/sysroot";
export const HAZE_CMAKE_TOOLCHAIN = HAZE_DIR + "/musl-toolchain.cmake";

async function createTarGz(cwd: string, files: string[], outPath: string) {
  const output = fs.createWriteStream(outPath);
  const archive = archiver("tar", { gzip: true });

  archive.pipe(output);

  for (const file of files) {
    archive.file(path.join(cwd, file), { name: file });
  }

  await archive.finalize();
  await once(output, "close");
}

function extractTarGz(archivePath: string, destDir: string) {
  return new Promise<void>((resolve, reject) => {
    fs.createReadStream(archivePath)
      .pipe(gunzip())
      .pipe(tarFs.extract(destDir, {}))
      .on("finish", resolve)
      .on("error", reject);
  });
}

let LLVM_TOOLCHAIN_DOWNLOAD_URL: string;
if (PLATFORM === Platform.Win32) {
  LLVM_TOOLCHAIN_DOWNLOAD_URL =
    "https://github.com/llvm/llvm-project/releases/download/llvmorg-18.1.8/clang+llvm-18.1.8-x86_64-pc-windows-msvc.tar.xz";
} else {
  LLVM_TOOLCHAIN_DOWNLOAD_URL =
    "https://github.com/llvm/llvm-project/releases/download/llvmorg-18.1.8/clang+llvm-18.1.8-x86_64-linux-gnu-ubuntu-18.04.tar.xz";
  // LLVM_TOOLCHAIN_DOWNLOAD_URL =
  //   "https://github.com/llvm/llvm-project/releases/download/llvmorg-20.1.7/LLVM-20.1.7-Linux-X64.tar.xz";
}

export const HAZE_STDLIB_NAME = "haze-stdlib";

const HAZE_C_COMPILER =
  HAZE_GLOBAL_DIR + (PLATFORM === Platform.Linux ? "/bin/clang" : "/bin/clang.exe");
const HAZE_CXX_COMPILER =
  HAZE_GLOBAL_DIR + (PLATFORM === Platform.Linux ? "/bin/clang++" : "/bin/clang++.exe");
const ARCHIVE_TOOL = PLATFORM === Platform.Linux ? "ar" : HAZE_GLOBAL_DIR + "/bin/llvm-ar.exe";
const HAZE_CONFIG_FILE = "haze.toml";
const HAZE_LIB_IMPORT_FILE = "import.hz";

export async function getFile(url: string, outfile: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  await writeFile(outfile, new Uint8Array(buffer));
}

export async function getFileWithProgress(url: string, outfile: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

  const total = Number(response.headers.get("content-length")) || 0;
  const stream = response.body;
  if (!stream) throw new Error("No response body");

  const fileWriter = createWriteStream(outfile);
  let downloaded = 0;

  const reader = stream.getReader();

  function renderProgress(downloaded: number, total: number) {
    const width = 40;
    const percent = total ? downloaded / total : 0;
    const filled = Math.round(width * percent);
    const empty = width - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    stdout.write(`\r[${bar}] ${(percent * 100).toFixed(1)}%`);
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      downloaded += value.length;
      fileWriter.write(value);
      renderProgress(downloaded, total);
    }
  }

  fileWriter.end();
  stdout.write("\n"); // move to next line after progress bar
}

async function parseConfig(startDir?: string, sourceloc?: boolean) {
  const parser = new ConfigParser(HAZE_CONFIG_FILE, startDir);
  return await parser.parseConfig(sourceloc);
}

async function getStdlibDirectory() {
  if (process.env["NODE_ENV"] === "production") {
    let whichHz = null as string | null;
    try {
      whichHz = await which("haze");
    } catch {
      throw new GeneralError("Compiler not found in path");
    }
    const realHz = realpathSync(whichHz);
    return join(dirname(realHz), "stdlib/");
  } else {
    return join(__dirname, "../stdlib");
  }
}

async function getToolsDirectory() {
  if (process.env["NODE_ENV"] === "production") {
    let whichHz = null as string | null;
    try {
      whichHz = await which("haze");
    } catch {
      throw new GeneralError("Compiler not found in path");
    }
    const realHz = realpathSync(whichHz);
    return join(dirname(realHz), "tools/");
  } else {
    return join(__dirname, "../tools");
  }
}

async function catchErrors(fn: () => Promise<void>) {
  try {
    await fn();
    return true;
  } catch (e) {
    if (e instanceof GeneralError) {
      console.error(e.message);
    } else if (e instanceof InternalError) {
      console.error(e.stack);
      console.error(e.message);
    } else if (e instanceof CompilerError) {
      console.error(e.message);
    } else if (e instanceof UnreachableCode) {
      console.error(e.message);
    } else if (e instanceof SyntaxError) {
      return false;
    } else if (e instanceof CmdFailed) {
      console.error("Build failed");
      return false;
    } else {
      console.error(e);
    }
    return false;
  }
}

function commandExists(cmd: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn("command", ["-v", cmd], { shell: true });
    child.on("close", (code) => resolve(code === 0));
  });
}

async function detectPackageManager() {
  if (await commandExists("dnf")) return "fedora";
  if (await commandExists("yum")) return "rhel";
  if (await commandExists("zypper")) return "suse";
  if (await commandExists("apt-get")) return "debian";

  return "unknown";
}

type FileWatcherCache = Record<string, number>;
const FILE_WATCHER_FILENAME = "watcher.cache.json";
function loadCache(globalBuildDir: string): FileWatcherCache {
  try {
    return JSON.parse(fs.readFileSync(globalBuildDir + "/" + FILE_WATCHER_FILENAME, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache: FileWatcherCache, globalBuildDir: string) {
  fs.writeFileSync(globalBuildDir + "/" + FILE_WATCHER_FILENAME, JSON.stringify(cache), "utf8");
}

export function invalidateChangeCache(
  globs: string[],
  globalBuildDir: string,
  workingDir: string,
): string[] {
  const cache = loadCache(globalBuildDir);
  const changed: string[] = [];

  for (const pattern of globs) {
    const files = fg.sync(pattern, { cwd: workingDir, dot: true });
    for (const file of files) {
      const fullPath = path.join(workingDir, file);
      delete cache[fullPath];
    }
  }

  saveCache(cache, globalBuildDir);
  return changed;
}

export function checkForChanges(
  globs: string[],
  globalBuildDir: string,
  workingDir: string,
): string[] {
  const cache = loadCache(globalBuildDir);
  const changed: string[] = [];

  for (const pattern of globs) {
    const files = fg.sync(pattern, { cwd: workingDir, dot: true });
    for (const file of files) {
      const fullPath = path.join(workingDir, file);
      const stat = fs.statSync(fullPath);
      const mtime = stat.mtimeMs;

      if (!cache[fullPath] || cache[fullPath] < mtime) {
        changed.push(fullPath);
        cache[fullPath] = mtime;
      }
    }
  }

  if (changed.length > 0) {
    saveCache(cache, globalBuildDir);
  }

  return changed;
}

class Cache {
  filename?: string;
  data: Record<string, any> = {};

  constructor() {}

  async getFilesWithModificationDates(dir: string): Promise<{ file: string; modified: Date }[]> {
    const files: { file: string; modified: Date }[] = [];

    async function traverse(currentDir: string) {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await traverse(fullPath);
        } else {
          const fileStat = await stat(fullPath);
          files.push({ file: fullPath, modified: fileStat.mtime });
        }
      }
    }

    await traverse(dir);
    return files;
  }

  async getFileModificationDate(file: string): Promise<{ file: string; modified: Date }> {
    const fileStat = await stat(file);
    return { file: file, modified: fileStat.mtime };
  }

  async load(filename: string) {
    this.filename = filename;

    if (fs.existsSync(filename)) {
      const file = await readFile(filename, "utf-8");
      this.data = JSON.parse(file);
    }
  }

  async save() {
    if (!this.filename) {
      throw new ImpossibleSituation();
    } else {
      await writeFile(this.filename, JSON.stringify(this.data, undefined, 2));
    }
  }

  async compiledModule(name: string, moduleDir: string, configFile: string) {
    const files = [
      ...(await this.getFilesWithModificationDates(moduleDir)),
      await this.getFileModificationDate(configFile),
    ];
    if (!this.data[name]) {
      this.data[name] = {};
    }
    this.data[name]["files"] = files;
  }

  async hasModuleChanged(name: string, moduleDir: string, configFile: string) {
    const files = new Set(
      [
        ...(await this.getFilesWithModificationDates(moduleDir)),
        await this.getFileModificationDate(configFile),
      ].map((f) => `${f.file}=${new Date(f.modified).toISOString()}`),
    );
    if (!this.data[name]) {
      return true;
    }
    const foundFiles = new Set(
      this.data[name]["files"].map(
        (f: { file: string; modified: string }) =>
          `${f.file}=${new Date(f.modified).toISOString()}`,
      ),
    );
    if (foundFiles.difference(files).size !== 0) {
      return true;
    }
    return false;
  }
}

export type FileStamp = {
  mtimeMs: number;
};

export class FileChangeCache {
  private cacheFile: string;
  private data: Record<string, FileStamp> = {};
  private dirty = false;

  constructor(cacheFile: string) {
    this.cacheFile = cacheFile;
  }

  /* ------------------ lifecycle ------------------ */

  load(): void {
    if (!fs.existsSync(this.cacheFile)) {
      this.data = {};
      return;
    }

    const raw = fs.readFileSync(this.cacheFile, "utf8");
    this.data = JSON.parse(raw);
  }

  save(): void {
    if (!this.dirty) return;

    fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
    fs.writeFileSync(this.cacheFile, JSON.stringify(this.data, null, 2));
    this.dirty = false;
  }

  /* ------------------ primitives ------------------ */

  hasFileChanged(file: string): boolean {
    const abs = path.resolve(file);

    if (!fs.existsSync(abs)) {
      // missing file always counts as changed
      return true;
    }

    const stat = fs.statSync(abs);
    const prev = this.data[abs];

    return !prev || prev.mtimeMs < stat.mtimeMs;
  }

  updateFile(file: string): void {
    const abs = path.resolve(file);

    if (!fs.existsSync(abs)) {
      delete this.data[abs];
      this.dirty = true;
      console.log("del");
      return;
    }

    const stat = fs.statSync(abs);
    this.data[abs] = { mtimeMs: stat.mtimeMs };
    this.dirty = true;
  }

  /* ------------------ batch helpers ------------------ */

  haveAnyFilesChanged(files: string[]): boolean {
    for (const file of files) {
      if (this.hasFileChanged(file)) {
        return true;
      }
    }
    return false;
  }

  updateFiles(files: string[]): void {
    for (const file of files) {
      this.updateFile(file);
    }
  }
}

export function getCurrentPlatform() {
  if (PLATFORM === Platform.Linux) {
    return "linux-x64";
  } else {
    return "win32-x64";
  }
}

function toCIdentifier(str: string) {
  // Replace invalid characters with underscores
  let id = str.replace(/[^A-Za-z0-9_]/g, "_");

  // C identifiers cannot start with a digit
  if (/^[0-9]/.test(id)) {
    id = "_" + id;
  }

  // Ensure non-empty
  if (id.length === 0) {
    id = "_";
  }

  return id;
}

export class ProjectCompiler {
  cache: Cache = new Cache();
  globalBuildDir: string = "";

  constructor() {}

  async getConfig(singleFilename?: string, sourceloc?: boolean) {
    let config: ModuleConfig | undefined;
    if (!singleFilename) {
      config = await parseConfig(undefined, sourceloc);
    } else {
      config = {
        configFilePath: undefined,
        dependencies: [],
        linkerFlags: new PlatformStrings(),
        interfaceLinkerFlags: new PlatformStrings(),
        moduleType: ModuleType.Executable,
        nostdlib: false,
        platform: getCurrentPlatform(),
        name: toCIdentifier(basename(singleFilename)),
        version: "0.0.0",
        scripts: {
          any: [],
          linux: [],
          win32: [],
        },
        source: {
          type: "single-file",
          filepath: singleFilename,
        },
        authors: undefined,
        description: undefined,
        license: undefined,
        compilerFlags: new PlatformStrings(),
        includeDirs: new PlatformStrings(),
        macros: new PlatformStrings(),
        interfaceMacros: new PlatformStrings(),
        hzstdLocation: null,
        includeSourceloc: sourceloc ?? true,
        generators: [],
      };
    }
    return config;
  }

  setEnv(config: ModuleConfig) {
    const env = process.env as any;
    if (config.configFilePath) {
      env.HAZE_PROJECT_DIR = dirname(config.configFilePath);
    }
    env.HAZE_SYSROOT = HAZE_MUSL_SYSROOT;
    env.HAZE_CMAKE_TOOLCHAIN = HAZE_CMAKE_TOOLCHAIN;
  }

  async build(singleFilename?: string, sourceloc?: boolean) {
    if (!(await this.setupToolchain())) {
      return false;
    }

    const config = await this.getConfig(singleFilename, sourceloc);
    if (!config) {
      return false;
    }
    this.globalBuildDir = join(process.cwd(), "__haze__");
    this.setEnv(config);

    if (!singleFilename) {
      await this.cache.load(join(this.globalBuildDir, "cache.json"));
    }
    const mainModule = new ModuleCompiler(
      config,
      this.cache,
      this.globalBuildDir,
      join(this.globalBuildDir, config.name),
    );

    if (!mainModule.config.nostdlib) {
      const stdlibConfig = await parseConfig(join(await getStdlibDirectory(), "core"), sourceloc);
      if (!stdlibConfig) {
        return false;
      }
      const stdlibModule = new ModuleCompiler(
        stdlibConfig,
        this.cache,
        this.globalBuildDir,
        join(this.globalBuildDir, stdlibConfig.name),
      );

      const c = new CLIPrinter();
      c.modules.push({
        name: stdlibModule.config.name,
        phase: EModulePrintCompilerPhase.Analyzing,
        startTime: new Date(),
        printer: c,
      });
      stdlibModule.config.printerModule = c.modules[c.modules.length - 1];
      c.start();
      if (!(await stdlibModule.build(false))) {
        return false;
      }
      c.stopAndFinishAll();
    }

    if (!singleFilename) {
      const deps = mainModule.config.dependencies;
      for (const dep of deps) {
        const depdir = join(await getStdlibDirectory(), dep.path);

        const config = await parseConfig(depdir, sourceloc);
        if (!config) {
          return false;
        }

        const depModule = new ModuleCompiler(
          config,
          this.cache,
          this.globalBuildDir,
          join(this.globalBuildDir, config.name),
        );

        const c = new CLIPrinter();
        c.modules.push({
          name: depModule.config.name,
          phase: EModulePrintCompilerPhase.Analyzing,
          startTime: new Date(),
          printer: c,
        });
        depModule.config.printerModule = c.modules[c.modules.length - 1];
        c.start();
        if (!(await depModule.build(false))) {
          return false;
        }
        c.stopAndFinishAll();
      }
    }

    const c = new CLIPrinter();
    c.modules.push({
      name: mainModule.config.name,
      phase: EModulePrintCompilerPhase.Analyzing,
      startTime: new Date(),
      printer: c,
    });
    mainModule.config.printerModule = c.modules[c.modules.length - 1];
    c.start();

    if (!(await mainModule.build(true))) {
      return false;
    }

    c.stopAndFinishAll();

    if (!singleFilename) {
      await this.cache.save();
    }
    return true;
  }

  async run(singleFilename?: string, sourceloc?: boolean, args?: string[]): Promise<number> {
    try {
      const config = await this.getConfig(singleFilename, sourceloc);
      if (!config) {
        return -1;
      }
      this.setEnv(config);

      if (config?.moduleType === ModuleType.Library) {
        throw new GeneralError(
          `This module is a library and cannot be executed. Use 'haze build' to build it instead.`,
        );
      }

      let moduleExecutable = join(join(this.globalBuildDir, config.name, "bin"), config.name);
      if (PLATFORM === Platform.Win32) {
        moduleExecutable += ".exe";
      }
      child_process.execSync(`"${moduleExecutable}" ${args?.join(" ")}`, {
        stdio: "inherit",
        env: process.env,
      });
      return 0;
    } catch (e: any) {
      if (e instanceof GeneralError) {
        console.error(e.message);
      } else if (e instanceof InternalError) {
        console.error(e.stack);
        console.error(e.message);
      } else if (e instanceof CompilerError) {
        console.error(e.message);
      } else if (e instanceof UnreachableCode) {
        console.error(e.message);
      } else {
        console.error("Execution failed");
        return e.status as number;
      }
      return -1;
    }
  }

  markStepDone(marker: string) {
    writeFileSync(marker, "ok");
  }

  isStepDone(marker: string) {
    return existsSync(marker);
  }

  async setupToolchain() {
    return await catchErrors(async () => {
      if (!existsSync(HAZE_CACHE)) mkdirSync(HAZE_CACHE, { recursive: true });
      if (!existsSync(HAZE_TMP_DIR)) mkdirSync(HAZE_TMP_DIR, { recursive: true });
      if (!existsSync(HAZE_GLOBAL_DIR)) mkdirSync(HAZE_GLOBAL_DIR, { recursive: true });

      process.env["CC"] = HAZE_C_COMPILER;
      process.env["CXX"] = HAZE_CXX_COMPILER;

      const MARKERS = {
        download: HAZE_CACHE + "/01-download-marker",
        extract: HAZE_CACHE + "/02-extract-marker",
        finish: HAZE_CACHE + "/03-finish-marker",
        ncursesLib: HAZE_CACHE + "/ncurses-lib",
        musl: HAZE_CACHE + "/musl",
        winSDK: HAZE_CACHE + "/win-sdk",
        winNinja: HAZE_CACHE + "/win-ninja",
        linuxNinja: HAZE_CACHE + "/linux-ninja",
        libunwind: HAZE_CACHE + "/libunwind",
        cmakeToolchain: HAZE_CACHE + "/cmake-toolchain",
        bdwgc: HAZE_CACHE + "/bdgwc",
        regexEngine: HAZE_CACHE + "/regex-engine",
        regexCompiler: HAZE_CACHE + "/regex-compiler",
      };

      // Step 1: Download
      if (!this.isStepDone(MARKERS.download)) {
        console.info("Downloading LLVM toolchain...");
        await getFileWithProgress(LLVM_TOOLCHAIN_DOWNLOAD_URL, HAZE_TMP_DIR + "/llvm.tar.xz");
        this.markStepDone(MARKERS.download);
        console.info("Downloading LLVM toolchain... Done");
      }

      // Step 2: Extract
      if (!this.isStepDone(MARKERS.extract)) {
        console.info("Extracting LLVM toolchain...");
        exec(
          `tar -xf "${HAZE_TMP_DIR + "/llvm.tar.xz"}" -C "${HAZE_GLOBAL_DIR}" --strip-components=1`,
        );
        this.markStepDone(MARKERS.extract);
        console.info("Extracting LLVM toolchain... Done");
      }

      // Step 3: Finish
      if (!this.isStepDone(MARKERS.finish)) {
        this.markStepDone(MARKERS.finish);
        console.info("Toolchain setup finished.");
      }

      if (!this.isStepDone(MARKERS.ncursesLib) && PLATFORM === Platform.Linux) {
        console.info("Retrieving libtinfo.so.5...");
        mkdirSync(`${HAZE_TMP_DIR}/`, { recursive: true });
        const packageManager = await detectPackageManager();
        exec(`rm -f ${HAZE_GLOBAL_DIR}/lib/libtinfo.so.5`);
        if (packageManager === "debian") {
          exec(`rm -f ${HAZE_TMP_DIR}/libtinfo5_6.1-1ubuntu1_amd64.deb*`);
          exec(
            `cd ${HAZE_TMP_DIR} && wget http://archive.ubuntu.com/ubuntu/pool/main/n/ncurses/libtinfo5_6.1-1ubuntu1_amd64.deb`,
          );
          exec(`dpkg-deb -x ${HAZE_TMP_DIR}/libtinfo5_6.1-1ubuntu1_amd64.deb ${HAZE_GLOBAL_DIR}`);
          exec(
            `cd ${HAZE_GLOBAL_DIR + "/lib"} && ln -s x86_64-linux-gnu/libtinfo.so.5 libtinfo.so.5`,
          );
        } else if (packageManager === "fedora") {
          // await exec(`rm -f ${HAZE_TMP_DIR}ncurses-compat-libs*`);
          // await exec(
          //   `cd ${HAZE_TMP_DIR} && dnf download ncurses-compat-libs-6.1-7.20210102.fc35.x86_64`
          // );
          // await exec(
          //   `cd ${HAZE_TMP_DIR} && rpm2cpio ncurses-compat-libs-*.rpm | cpio -idmv -D ${HAZE_GLOBAL_DIR}`
          // );
          // await exec(
          //   `cd ${HAZE_GLOBAL_DIR + "/lib"} && ln -s ../usr/lib/libtinfo.so.5 libtinfo.so.5`
          // );
          exec(`rm -f ${HAZE_TMP_DIR}/libtinfo5_6.1-1ubuntu1_amd64.deb*`);
          exec(
            `cd ${HAZE_TMP_DIR} && wget http://archive.ubuntu.com/ubuntu/pool/main/n/ncurses/libtinfo5_6.1-1ubuntu1_amd64.deb`,
          );
          exec(`cd ${HAZE_TMP_DIR} && ar x libtinfo5_6.1-1ubuntu1_amd64.deb`);
          exec(`cd ${HAZE_TMP_DIR} && tar -xf data.tar.xz -C ${HAZE_GLOBAL_DIR}`);
          exec(
            `cd ${HAZE_GLOBAL_DIR + "/lib"} && ln -s x86_64-linux-gnu/libtinfo.so.5 libtinfo.so.5`,
          );
        } else {
          throw new CompilerError(
            "This Distro/Package Manager is not supported yet, please report",
            null,
          );
        }
        this.markStepDone(MARKERS.ncursesLib);
        console.info("Retrieving libtinfo.so.5... Done");
      }

      if (!this.isStepDone(MARKERS.winSDK) && PLATFORM === Platform.Win32) {
        console.info("Installing Windows SDK...");
        execInherit(
          `powershell -NoLogo -NoProfile -Command \\"if (-not (winget list --name 'Visual Studio Community 2022' | Select-String 'Visual Studio Community 2022')) { winget install 'Visual Studio Community 2022' --override '--add Microsoft.VisualStudio.Workload.NativeDesktop Microsoft.VisualStudio.ComponentGroup.WindowsAppSDK.Cpp' -s msstore } else { Write-Host 'Visual Studio already installed.' }\\"`,
        );
        this.markStepDone(MARKERS.winSDK);
        console.info("Installing Windows SDK... Done");
      }

      if (!this.isStepDone(MARKERS.winNinja) && PLATFORM === Platform.Win32) {
        console.info("Installing Ninja Build System...");
        execInherit(
          `powershell -NoLogo -NoProfile -Command "if (-not (winget list --id 'Ninja-build.Ninja' | Select-String 'Ninja-build.Ninja')) { winget install 'Ninja-build.Ninja' } else { Write-Host 'Ninja already installed.'; exit 0 }"`,
        );
        this.markStepDone(MARKERS.winNinja);
        console.info("Installing Ninja Build System... Done");
      }

      if (!this.isStepDone(MARKERS.linuxNinja) && PLATFORM === Platform.Linux) {
        console.info("Installing Ninja Build System...");
        switch (await detectPackageManager()) {
          case "debian":
            execInherit(`sudo apt-get update && sudo apt-get install ninja-build`);
            break;

          case "fedora":
            execInherit(`sudo dnf install ninja-build`);
            break;

          default:
            assert(false);
        }
        this.markStepDone(MARKERS.linuxNinja);
        console.info("Installing Ninja Build System... Done");
      }

      //       if (!this.isStepDone(MARKERS.musl)) {
      //         console.info("Building libmusl sysroot...");
      //         mkdirSync(`${HAZE_TMP_DIR}/`, { recursive: true });
      //         await exec(`rm -f ${HAZE_TMP_DIR}/musl-1.2.5.tar.gz*`);
      //         await exec(`cd ${HAZE_TMP_DIR} && wget https://musl.libc.org/releases/musl-1.2.5.tar.gz`);
      //         await exec(`cd ${HAZE_TMP_DIR} && tar -xzf musl-1.2.5.tar.gz`);
      //         await exec(
      //           `cd ${HAZE_TMP_DIR}/musl-1.2.5 && ./configure --prefix=$HOME/.haze/sysroot --disable-shared`
      //         );
      //         await exec(`cd ${HAZE_TMP_DIR}/musl-1.2.5 && make -j$(nproc)`);
      //         await exec(`cd ${HAZE_TMP_DIR}/musl-1.2.5 && make install`);
      //         this.markStepDone(MARKERS.musl);
      //         console.info("Building libmusl sysroot... Done");
      //       }

      //       if (!this.isStepDone(MARKERS.cmakeToolchain)) {
      //         console.info("Writing CMake toolchain...");
      //         mkdirSync(`${HAZE_TMP_DIR}/`, { recursive: true });
      //         const toolchain = `
      // set(CMAKE_SYSTEM_NAME Linux)
      // set(CMAKE_C_COMPILER ${HAZE_GLOBAL_DIR}/bin/clang)
      // set(CMAKE_CXX_COMPILER ${HAZE_GLOBAL_DIR}/bin/clang++)
      // set(CMAKE_SYSROOT ${HAZE_MUSL_SYSROOT})
      // set(CMAKE_FIND_ROOT_PATH ${HAZE_MUSL_SYSROOT})

      // # Tell CMake to search only in sysroot
      // set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
      // set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
      // set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)

      // set(CMAKE_C_FLAGS "-static -nostdlib -nostartfiles -isystem ${HAZE_MUSL_SYSROOT}/include -fno-pie \${CMAKE_C_FLAGS}")
      // set(CMAKE_CXX_FLAGS "-static -nostdlib -nostartfiles -isystem ${HAZE_MUSL_SYSROOT}/include \${CMAKE_CXX_FLAGS}")

      // set(CMAKE_C_LINK_EXECUTABLE
      //    "<CMAKE_C_COMPILER> <FLAGS> <OBJECTS>  <LINK_LIBRARIES> ${HAZE_MUSL_SYSROOT}/lib/crt1.o ${HAZE_MUSL_SYSROOT}/lib/crti.o ${HAZE_MUSL_SYSROOT}/lib/crtn.o -lc "
      // )
      // set(CMAKE_CXX_LINK_EXECUTABLE
      //    "<CMAKE_CXX_COMPILER> <FLAGS> <OBJECTS>  <LINK_LIBRARIES> ${HAZE_MUSL_SYSROOT}/lib/crt1.o ${HAZE_MUSL_SYSROOT}/lib/crti.o ${HAZE_MUSL_SYSROOT}/lib/crtn.o -lc "
      // )

      // set(THREADS_PREFER_PTHREAD_FLAG ON)
      // set(CMAKE_THREAD_LIBS_INIT "-lpthread")  # musl ignores it for static linking
      // set(THREADS_FOUND TRUE)`;
      //         await Bun.write(`${HAZE_DIR}/musl-toolchain.cmake`, toolchain);
      //         this.markStepDone(MARKERS.cmakeToolchain);
      //         console.info("Writing CMake toolchain... Done");
      //       }

      if (!this.isStepDone(MARKERS.libunwind) && PLATFORM === Platform.Linux) {
        const builddir = `${HAZE_TMP_DIR}/libunwind-builddir`;
        const outdir = `${HAZE_GLOBAL_DIR}/haze-libunwind`;
        const commitHash = "812a5305ff097c864d2786b577d2ca0bda76827f";
        console.info("Retrieving and building libunwind...");
        execInherit(`rm -rf ${builddir}`);
        execInherit(`rm -rf ${outdir}`);
        execInherit(`mkdir -p ${builddir}`);
        execInherit(
          `git clone https://github.com/libunwind/libunwind.git ${builddir} && cd ${builddir} && git checkout ${commitHash}`,
        );
        execInherit(`cd ${builddir} && autoreconf -i`);
        execInherit(
          `cd ${builddir} && CFLAGS="-fPIC" CXXFLAGS="-fPIC" ./configure --prefix=${outdir} -disable-tests -disable-shared`,
        );
        execInherit(`cd ${builddir} && make -j`);
        execInherit(`cd ${builddir} && make install`);
        this.markStepDone(MARKERS.libunwind);
        console.info("Retrieving and building libunwind... Done");
      }

      if (!this.isStepDone(MARKERS.bdwgc)) {
        const builddir = `${HAZE_TMP_DIR}/bdwgc-builddir`;
        const outdir = `${HAZE_GLOBAL_DIR}/haze-bdwgc`;
        const commitHash = "6d018a1f241a9d892e67f25cac1b5b119ae60a88"; // Latest release
        console.info("Retrieving and building bdwgc...");
        if (existsSync(builddir)) {
          rmSync(builddir, { recursive: true, force: true });
        }
        if (existsSync(outdir)) {
          rmSync(outdir, { recursive: true, force: true });
        }
        mkdirSync(builddir);
        execInherit(
          `git clone https://github.com/bdwgc/bdwgc.git "${builddir}" && cd "${builddir}" && git checkout ${commitHash}`,
        );
        execInherit(
          `cmake . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug -DGC_BUILD_SHARED_LIBS=OFF -DCMAKE_INSTALL_PREFIX="${outdir}" -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DBUILD_TESTING=OFF`,
          builddir,
        );
        execInherit(`cmake --build build -j`, builddir);
        execInherit(`cmake --build build --target=install`, builddir);
        this.markStepDone(MARKERS.bdwgc);
        console.info("Retrieving and building bdwgc... Done");
      }

      if (!this.isStepDone(MARKERS.regexEngine)) {
        const builddir = `${HAZE_TMP_DIR}/pcre2-build`;
        const outdir = `${HAZE_GLOBAL_DIR}/pcre2`;
        const commitHash = "pcre2-10.47";
        console.info("Retrieving and building Regex Engine...");
        if (existsSync(builddir)) {
          rmSync(builddir, { recursive: true, force: true });
        }
        if (existsSync(outdir)) {
          rmSync(outdir, { recursive: true, force: true });
        }
        mkdirSync(builddir);
        execInherit(
          `git clone https://github.com/PCRE2Project/pcre2.git "${builddir}" --branch ${commitHash} -c advice.detachedHead=false --depth 1`,
        );
        execInherit(`git submodule update --init`, builddir);
        execInherit(
          `cmake . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_BUILD_SHARED_LIBS=OFF -DPCRE2_SUPPORT_JIT=ON -DCMAKE_INSTALL_PREFIX="${outdir}" -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DBUILD_TESTING=OFF`,
          builddir,
        );
        execInherit(`cmake --build build -j`, builddir);
        execInherit(`cmake --build build --target=install`, builddir);
        this.markStepDone(MARKERS.regexEngine);
        console.info("Retrieving and building Regex Engine... Done");
      }

      if (!this.isStepDone(MARKERS.regexCompiler)) {
        console.info("Building Regex Compiler...");
        const outfile = `${HAZE_GLOBAL_DIR}/regex-compiler/haze-regex-compile${
          PLATFORM === Platform.Win32 ? ".exe" : ""
        }`;
        const toolsDir = await getToolsDirectory();
        const projDir = join(toolsDir, "regex-compiler");
        mkdirSync(dirname(outfile), { recursive: true });
        execInherit(
          `cmake . -B "${HAZE_TMP_DIR}/regex-compiler-build" -DHAZE_GLOBAL_DIR="${HAZE_GLOBAL_DIR}" -G Ninja -DCMAKE_C_COMPILER="${HAZE_C_COMPILER}" -DCMAKE_CXX_COMPILER="${HAZE_CXX_COMPILER}"`,
          projDir,
        );
        execInherit(`cmake --build "${HAZE_TMP_DIR}/regex-compiler-build"`, projDir);
        this.markStepDone(MARKERS.regexCompiler);
        console.info("Building Regex Compiler... Done");
      }
    });
  }
}

function exec(str: string) {
  try {
    child_process.execSync(str);
  } catch (e) {
    throw new CmdFailed();
  }
}

function execSync(cmd: string, args: string[], dir?: string) {
  if (dir) {
    fs.mkdirSync(dir, {
      recursive: true,
    });
  }
  const proc = spawnSync(cmd, args, {
    cwd: dir ?? ".",
    env: process.env,
    stdio: "inherit",
    shell: true, // <- important: lets it use the real shell
  });

  const code = proc.status;
  if (code !== 0) {
    throw new CmdFailed();
  }
}

function execInherit(str: string, dir?: string) {
  let shell = PLATFORM === Platform.Win32 ? "C:\\Windows\\System32\\cmd.exe" : "/bin/sh";
  const args = PLATFORM === Platform.Win32 ? ["/d", "/s", "/c", `${str}`] : ["-c", `"${str}"`];

  if (dir) {
    fs.mkdirSync(dir, {
      recursive: true,
    });
  }
  const cmd = `${shell} ${args.join(" ")}`;
  const proc = spawnSync(cmd, {
    cwd: dir ?? ".",
    env: process.env,
    stdio: "inherit",
    shell: true, // <- important: lets it use the real shell
  });

  const code = proc.status;
  if (code !== 0) {
    throw new CmdFailed();
  }
}

export class ModuleCompiler {
  cc: CollectionContext;
  currentModuleRootDir: string | null = null;

  constructor(
    public config: ModuleConfig,
    public cache: Cache,
    public hazeWorkspaceDirectory: string,
    public moduleDir: string,
  ) {
    this.cc = makeCollectionContext(this.config);
  }

  private makeUnit() {
    const [unit, unitId] = Collect.makeScope(this.cc, {
      variant: Collect.ENode.UnitScope,
      parentScope: this.cc.moduleScopeId,
      symbols: new Set(),
      scopes: new Set(),
    });
    const moduleScope = this.cc.scopeNodes.get(this.cc.moduleScopeId);
    assert(moduleScope.variant === Collect.ENode.ModuleScope);
    moduleScope.scopes.add(unitId);
    return [unit, unitId] as const;
  }

  async collectFileAsRoot(filepath: string, collectionMode: ECollectionMode) {
    const fileText = await readFile(filepath, "utf-8");
    const ast = Parser.parseTextToAST(this.config, fileText, filepath);
    CollectFile(
      this.cc,
      ast,
      this.cc.moduleScopeId,
      filepath,
      this.config.name,
      this.config.version,
      collectionMode,
    );
  }

  async collectFile(filepath: string, collectionMode: ECollectionMode) {
    const fileText = await readFile(filepath, "utf-8");
    const ast = Parser.parseTextToAST(this.config, fileText, filepath);
    CollectFile(
      this.cc,
      ast,
      collectionMode === ECollectionMode.WrapIntoModuleNamespace
        ? this.makeUnit()[1]
        : this.cc.moduleScopeId,
      filepath,
      this.config.name,
      this.config.version,
      collectionMode,
    );
  }

  async collectDirectory(dirpath: string, collectionMode: ECollectionMode) {
    for (const file of readdirSync(dirpath)) {
      const fullPath = join(dirpath, file);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        await this.collectDirectory(fullPath, collectionMode);
      } else {
        if (extname(fullPath) == ".hz") {
          await this.collectFile(fullPath, collectionMode);
        }
      }
    }
  }

  collectImmediate(
    sourceCode: string,
    args: {
      inScope: Collect.ScopeId;
    },
  ) {
    const ast = Parser.parseTextToAST(this.config, sourceCode, "internal");
    CollectImmediate(this.cc, ast, args.inScope);
  }

  async addProjectSourceFiles() {
    let mode = ECollectionMode.WrapIntoModuleNamespace;
    if (this.config.name === HAZE_STDLIB_NAME) {
      mode = ECollectionMode.ImportUnderRootDirectly;
    }

    if (this.config.source.type === "src-dir") {
      await this.collectDirectory(this.config.source.dirpath, mode);
    } else {
      await this.collectFile(this.config.source.filepath, mode);
    }

    // Possibly add the autogen directory
    const autogenDir = this.getModuleAutogenDir(this.config.name);
    if (existsSync(autogenDir)) {
      await this.collectDirectory(autogenDir, mode);
    }
  }

  generatorFileKey(file: GeneratorFile): string {
    if (file.type !== "module-file") {
      throw new Error("Cannot key placeholder generator file");
    }

    const normalizedPath = file.path.replace(/\\/g, "/");
    return `${file.module}::${file.dir}::${normalizedPath}`;
  }

  topoLayers(graph: Map<string, GeneratorGraphNode>): GeneratorGraphNode[][] {
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    // init
    for (const [name] of graph) {
      inDegree.set(name, 0);
      dependents.set(name, []);
    }

    // build inDegree + dependents
    for (const [name, node] of graph) {
      for (const dep of node.dependsOn) {
        inDegree.set(name, inDegree.get(name)! + 1);
        dependents.get(dep)!.push(name);
      }
    }

    const layers: GeneratorGraphNode[][] = [];
    let ready: string[] = [];

    for (const [name, degree] of inDegree) {
      if (degree === 0) ready.push(name);
    }

    let processed = 0;

    while (ready.length > 0) {
      const layer: GeneratorGraphNode[] = ready.map((n) => graph.get(n)!);
      layers.push(layer);
      processed += layer.length;

      const nextReady: string[] = [];

      for (const name of ready) {
        for (const dep of dependents.get(name)!) {
          const d = inDegree.get(dep)! - 1;
          inDegree.set(dep, d);
          if (d === 0) {
            nextReady.push(dep);
          }
        }
      }

      ready = nextReady;
    }

    if (processed !== graph.size) {
      throw new GeneralError("Generator dependency cycle detected");
    }

    return layers;
  }

  async runAllGenerators() {
    // Build a graph of all generators, indexed by name, so they can cross-refer to each other as dependents
    const generatorGraph = new Map<string, GeneratorGraphNode>();
    for (const gen of this.config.generators) {
      if (gen.type !== "exec") continue;

      generatorGraph.set(gen.name, {
        config: gen,
        dependsOn: [],
      });
    }

    // Build a hashed index of output files (unique across all generators), so we can infer dependencies
    const outputIndex = new Map<string, string>(); // key → generator name
    for (const node of generatorGraph.values()) {
      const gen = node.config;

      if (gen.type !== "exec") continue;

      for (const out of gen.outputs) {
        if (out.type !== "module-file") continue;

        const key = this.generatorFileKey(out);

        if (outputIndex.has(key)) {
          throw new GeneralError(
            `Output file '${out.path}' is produced by both ` +
              `'${outputIndex.get(key)}' and '${gen.name}'`,
          );
        }

        outputIndex.set(key, gen.name);
      }
    }

    // Now use the output file index to infer which generator depends on which other generators
    for (const node of generatorGraph.values()) {
      const gen = node.config;

      if (gen.type !== "exec") continue;

      for (const input of gen.inputs) {
        if (input.type !== "module-file") continue;

        const key = this.generatorFileKey(input);
        const producer = outputIndex.get(key);

        if (!producer) continue; // input comes from filesystem or other module

        if (producer === gen.name) {
          throw new GeneralError(
            `Generator '${gen.name}' lists its own output '${input.path}' as input`,
          );
        }

        node.dependsOn.push(producer);
      }
    }

    // Validate that all dependencies exist
    for (const node of generatorGraph.values()) {
      for (const dep of node.dependsOn) {
        if (!generatorGraph.has(dep)) {
          throw new GeneralError(
            `Generator '${node.config.name}' depends on unknown generator '${dep}'`,
          );
        }
      }
    }

    // Finally, topologically sort the generators in the correct order they need to be executed, batched
    const executionOrder = this.topoLayers(generatorGraph);

    const cache = new FileChangeCache(
      path.join(this.hazeWorkspaceDirectory, "generator.cache.json"),
    );
    cache.load();

    // And now actually run all of them (if required)
    for (const batch of executionOrder) {
      const toRun = [];

      // Decision phase: What generators to run now? (based on cache)
      cache.load();
      for (const gen of batch) {
        if (gen.config.type !== "exec") throw new Error("Not implemented");
        const inputPaths = gen.config.inputs.map((i) => this.resolveGeneratorFile(i));
        const outputPaths = gen.config.outputs.map((i) => this.resolveGeneratorFile(i));

        if (
          cache.haveAnyFilesChanged([
            this.resolveExec(gen.config.exec),
            ...inputPaths,
            ...outputPaths,
          ])
        ) {
          toRun.push({ gen, inputPaths, outputPaths });
        }
      }

      // Execution phase: Run generators (NO CACHE ACCESS)
      await Promise.all(toRun.map((item) => this.executeGenerator(item.gen.config)));

      // Commit phase: Batch is done and write result into cache
      for (const item of toRun) {
        assert(item.gen.config.type === "exec");
        cache.updateFiles([
          this.resolveExec(item.gen.config.exec),
          ...item.inputPaths,
          ...item.outputPaths,
        ]);
      }
      cache.save();
    }
  }

  resolveExec(exec: string) {
    assert(this.currentModuleRootDir);
    return join(this.currentModuleRootDir, exec);
  }

  resolveGeneratorFile(file: GeneratorFile) {
    if (file.type !== "module-file") throw new Error("Not implemented");

    let moduleName = file.module;
    if (moduleName === "this") {
      moduleName = this.config.name;
    }

    let dir = "";
    switch (file.dir) {
      case EModuleFileDir.BinaryDir:
        dir = this.getModuleBinaryDir(moduleName);
        break;
      case EModuleFileDir.AutogenDir:
        dir = this.getModuleAutogenDir(moduleName);
        break;
      case EModuleFileDir.SourceDir:
        assert(false);
      case EModuleFileDir.ModuleRootDir:
        assert(false);
      default:
        assert(false);
    }

    if (file.path.startsWith("/")) {
      throw new GeneralError("File paths are not supposed to have a leading slash");
    }
    return join(dir, file.path);
  }

  async executeGenerator(gen: GeneratorConfig) {
    if (gen.type !== "exec") throw new Error("Not implemented");

    assert(this.currentModuleRootDir);
    console.log(`>> Running generator ${gen.name}...`);
    const sourceloc = this.config.includeSourceloc;
    const project = new ProjectCompiler();
    if (!(await project.build(this.resolveExec(gen.exec), sourceloc))) {
      throw new GeneralError(`Build of generator step ${gen.name} failed`);
    }

    await withEnv(
      {
        HAZE_WORKSPACE_DIR: this.hazeWorkspaceDirectory,
        HAZE_MODULE_SOURCE_DIR: this.currentModuleRootDir,
        HAZE_MODULE_BUILD_DIR: this.moduleDir + "/build",
        HAZE_MODULE_BINARY_DIR: this.moduleDir + "/bin",
        HAZE_MODULE_TMP_DIR: this.moduleDir + "/tmp",
        HAZE_MODULE_AUTOGEN_DIR: this.moduleDir + "/autogen",
        HAZE_C_COMPILER: HAZE_C_COMPILER,
        HAZE_CXX_COMPILER: HAZE_CXX_COMPILER,
      },
      async () => {
        const exitCode = await project.run(this.resolveExec(gen.exec), sourceloc, []);
        if (exitCode !== 0) {
          throw new GeneralError(`Generator step ${gen.name} failed with exit code ${exitCode}`);
        }
      },
    );

    for (const file of gen.outputs) {
      const path = this.resolveGeneratorFile(file);
      if (!existsSync(path)) {
        throw new GeneralError(
          `Generator step ${gen.name} claims to generate file '${path}', but it was not generated`,
        );
      }
    }

    console.log(`>> Running generator ${gen.name}... Done`);
  }

  getModuleBinaryDir(moduleName: string) {
    return join(this.hazeWorkspaceDirectory, moduleName, "bin");
  }

  getModuleAutogenDir(moduleName: string) {
    return join(this.hazeWorkspaceDirectory, moduleName, "autogen");
  }

  getModuleBuildDir(moduleName: string) {
    return join(this.hazeWorkspaceDirectory, moduleName, "build");
  }

  async build(isTopLevelModule: boolean) {
    return await catchErrors(async () => {
      const log = (msg: string) => {
        assert(this.config.printerModule);
        this.config.printerModule.printer.log(msg);
      };

      // if (this.config.configFilePath) {
      //   if (
      //     !(await this.cache.hasModuleChanged(
      //       this.config.name,
      //       this.config.source,
      //       this.config.configFilePath
      //     ))
      //   ) {
      //     console.log(`Skipping module ${this.config.name}`);
      //     return;
      //   } else {
      //     console.log(`Building module ${this.config.name}`);
      //   }
      // }
      console.log(`Building module ${this.config.name}`);

      this.currentModuleRootDir = this.config.configFilePath
        ? dirname(this.config.configFilePath)
        : process.cwd();

      const env = process.env as any;
      env.HAZE_WORKSPACE_DIR = this.hazeWorkspaceDirectory;
      env.HAZE_MODULE_SOURCE_DIR = this.currentModuleRootDir;
      env.HAZE_MODULE_BUILD_DIR = this.moduleDir + "/build";
      env.HAZE_MODULE_BINARY_DIR = this.moduleDir + "/bin";
      env.HAZE_MODULE_TMP_DIR = this.moduleDir + "/tmp";
      env.HAZE_MODULE_AUTOGEN_DIR = this.moduleDir + "/autogen";
      env.CC = HAZE_C_COMPILER;
      env.CXX = HAZE_CXX_COMPILER;

      await this.runAllGenerators();

      await this.addInternalBuiltinSources();
      await this.collectImports();
      await this.addProjectSourceFiles();

      // PrettyPrintCollected(this.cc);

      const sr = Semantic.SemanticallyAnalyze(
        this,
        this.cc,
        this.config.moduleType === ModuleType.Library,
        this.config.name,
        this.config.version,
      );
      // Semantic.PrettyPrintAnalyzed(sr);
      const lowered = LowerModule(sr);

      const allModules: [string, string][] = [
        [this.config.name, this.config.version],
        ...(await this.loadDependencyModuleGraph()),
      ];

      const name = this.config.name;
      const platform = this.config.platform;
      const moduleCFile = join(this.moduleDir, `build/${name}-${platform}.c`);
      const moduleOFile = join(this.moduleDir, `build/${name}-${platform}.o`);
      const moduleAFile = join(this.moduleDir, `build/${name}-${platform}.a`);
      const moduleExecutable =
        join(this.moduleDir, `bin/${name}`) + (PLATFORM === Platform.Win32 ? ".exe" : "");

      const moduleMetadataFile = join(this.moduleDir, "build/metadata.json");
      const moduleOutputLib = join(this.moduleDir, "bin/" + this.config.name + ".hzlib");
      const importFilePath = join(this.moduleDir, "build", HAZE_LIB_IMPORT_FILE);

      await mkdir(join(this.moduleDir, "build/"), { recursive: true });
      await mkdir(join(this.moduleDir, "bin/"), { recursive: true });

      const code = generateCode(this.config, this.moduleDir, allModules, lowered);
      await writeFile(moduleCFile, code);

      const compilerFlags = this.config.compilerFlags;
      const linkerFlags = this.config.linkerFlags;
      const includeDirs = this.config.includeDirs;
      const interfaceMacros = this.config.interfaceMacros;
      const interfaceLinker = this.config.interfaceLinkerFlags;
      compilerFlags.addAll("-Wno-parentheses-equality");
      compilerFlags.addAll("-Wno-extra-tokens");

      interfaceMacros.addAll(`PCRE2_STATIC`);

      includeDirs.addAll(`${this.moduleDir}/bin/include`);
      includeDirs.addAll(`${HAZE_GLOBAL_DIR}/include`);
      compilerFlags.addAll(`-fno-omit-frame-pointer`);
      linkerFlags.addAll(`-L"${this.moduleDir}/bin/lib"`);
      linkerFlags.addAll(`-L"${this.moduleDir}/bin/lib64"`);

      includeDirs.addAll(`${HAZE_GLOBAL_DIR}`);
      linkerFlags.addLinux(`"${HAZE_GLOBAL_DIR}/haze-libunwind/lib/libunwind.a"`);
      linkerFlags.addLinux(`-llzma`);

      includeDirs.addAll(`${HAZE_GLOBAL_DIR}/haze-bdwgc/include`);
      linkerFlags.addAll(`-L"${HAZE_GLOBAL_DIR}/haze-bdwgc/lib64/"`);
      linkerFlags.addAll(`-L"${HAZE_GLOBAL_DIR}/haze-bdwgc/lib/"`);
      linkerFlags.addAll(`-lgc`);
      // linkerFlags.addWin32(`"${HAZE_GLOBAL_DIR}/haze-bdwgc/lib/gc.lib"`);

      includeDirs.addAll(`${HAZE_GLOBAL_DIR}/pcre2/include`);
      linkerFlags.addAll(`-L"${HAZE_GLOBAL_DIR}/pcre2/lib64/"`);
      linkerFlags.addAll(`-L"${HAZE_GLOBAL_DIR}/pcre2/lib/"`);
      linkerFlags.addAll(`-lpcre2-8`);
      // linkerFlags.addWin32(`"${HAZE_GLOBAL_DIR}/pcre2/lib/gc.lib"`);

      compilerFlags.addWin32(`-D_CRT_SECURE_NO_WARNINGS`);
      linkerFlags.addWin32(`-fuse-ld=lld`);
      linkerFlags.addWin32(`-lntdll`);
      linkerFlags.addWin32(`-lkernel32`);
      linkerFlags.addWin32(`-luser32`);
      linkerFlags.addWin32(`-ladvapi32`);

      compilerFlags.addWin32("-DHAZE_PLATFORM_WIN32");
      compilerFlags.addLinux("-DHAZE_PLATFORM_LINUX");

      compilerFlags.addLinux("-fPIC");

      const compileCommands: CompileCommands = await this.loadDependencyCompileCommands();
      const writeCompileCommands = async () => {
        if (isTopLevelModule) {
          // If Top Level, remove all previous dirty hacks and write one clean entry.

          const addedFiles = new Set<string>();
          const cleanedCommands: CompileCommands = [];
          for (const c of compileCommands) {
            if (!addedFiles.has(c.file)) {
              addedFiles.add(c.file);
              cleanedCommands.push(c);
            }
          }

          await writeFile(
            `${this.hazeWorkspaceDirectory}/compile_commands.json`,
            JSON.stringify(cleanedCommands, null, 2),
          );
        } else {
          // Not top level module, so do a best effort of appending currently known commands, to at least get partial compile commands.

          const addedFiles = new Set<string>();
          let currentCommands: CompileCommands;
          let cleanedCommands: CompileCommands = [];
          try {
            currentCommands = JSON.parse(
              await readFile(`${this.hazeWorkspaceDirectory}/compile_commands.json`, "utf-8"),
            );
            for (const c of currentCommands) {
              if (!addedFiles.has(c.file)) {
                addedFiles.add(c.file);
                cleanedCommands.push(c);
              }
            }
          } catch (e) {}

          for (const c of compileCommands) {
            if (!addedFiles.has(c.file)) {
              addedFiles.add(c.file);
              cleanedCommands.push(c);
            }
          }

          await writeFile(
            `${this.hazeWorkspaceDirectory}/compile_commands.json`,
            JSON.stringify(cleanedCommands, null, 2),
          );
        }
      };

      const debug = true;
      if (debug) {
        compilerFlags.addAll("-g");
      }

      if (this.config.source.type === "src-dir") {
        includeDirs.addAll(this.config.source.dirpath);
      } else {
        includeDirs.addAll(dirname(this.config.source.filepath));
      }

      compilerFlags.addAll("-std=c11");

      const [
        archives,
        dependencyLinkerFlags,
        dependencyIncludeDirs,
        dependencyInterfaceMacros,
        dependencyInterfaceLinker,
      ] = await this.loadDependencyBinaries();

      linkerFlags.merge(dependencyLinkerFlags);
      includeDirs.merge(dependencyIncludeDirs);
      interfaceMacros.merge(dependencyInterfaceMacros);
      interfaceLinker.merge(dependencyInterfaceLinker);

      if (this.config.moduleType === ModuleType.Executable) {
        compilerFlags.addAll(archives.map((l) => `"${l}"`));
      }

      compilerFlags.addAll(this.config.macros.getAll().map((dir) => `-D${dir}`));
      compilerFlags.addLinux(this.config.macros.getLinux().map((dir) => `-D${dir}`));
      compilerFlags.addWin32(this.config.macros.getWin32().map((dir) => `-D${dir}`));
      compilerFlags.addAll(interfaceMacros.getAll().map((dir) => `-D${dir}`));
      compilerFlags.addLinux(interfaceMacros.getLinux().map((dir) => `-D${dir}`));
      compilerFlags.addWin32(interfaceMacros.getWin32().map((dir) => `-D${dir}`));
      linkerFlags.addWin32(interfaceLinker.getWin32().map((dir) => `${dir}`));

      compilerFlags.addAll(includeDirs.getAll().map((dir) => `-I"${dir}"`));
      compilerFlags.addLinux(includeDirs.getLinux().map((dir) => `-I"${dir}"`));
      compilerFlags.addWin32(includeDirs.getWin32().map((dir) => `-I"${dir}"`));

      const platformCompilerFlags = compilerFlags.combineForPlatform();
      const platformLinkerFlags = linkerFlags.combineForPlatform();
      // console.log(this.config.name, linkerFlags);

      if (this.config.moduleType === ModuleType.Executable) {
        const flags = `${platformCompilerFlags.join(" ")} ${platformLinkerFlags.join(" ")}`;
        const filePreamble = `// clang-format off\n\n`;
        const filePostamble = `\n// clang-format on\n`;
        await writeFile(moduleCFile, filePreamble + (await readFile(moduleCFile)) + filePostamble);

        const cmd = `"${HAZE_C_COMPILER}" "${moduleCFile}" -o "${moduleExecutable}" ${flags}`;
        // log(cmd);
        // console.log(cmd);

        compileCommands.push({
          directory: cwd(),
          file: moduleCFile,
          command: cmd,
          output: moduleExecutable,
        });
        await writeCompileCommands();

        exec(cmd);
      } else {
        const flags = `${platformCompilerFlags.join(" ")}`;
        const filePreamble = `// clang-format off\n\n`;
        const filePostamble = `\n// clang-format on\n`;
        await writeFile(moduleCFile, filePreamble + (await readFile(moduleCFile)) + filePostamble);

        const cmd = `"${HAZE_C_COMPILER}" "${moduleCFile}" -c -o "${moduleOFile}" ${flags}`;
        // log(cmd);
        // console.log(cmd);

        compileCommands.push({
          directory: cwd(),
          file: moduleCFile,
          command: cmd,
          output: moduleOFile,
        });
        await writeCompileCommands();

        exec(cmd);

        // if (fs.existsSync(moduleAFile)) {
        //   await exec(`rm ${moduleAFile}`);
        // }

        if (PLATFORM === Platform.Linux) {
          exec(`"${ARCHIVE_TOOL}" r "${moduleAFile}" "${moduleOFile}" > /dev/null`);
        } else {
          exec(`"${ARCHIVE_TOOL}" r "${moduleAFile}" "${moduleOFile}" > NUL 2>&1`);
        }

        const makerel = (absolute: string) => {
          return absolute
            .replaceAll("\\", "/")
            .replace(this.moduleDir.replaceAll("\\", "/") + "/build/", "");
        };

        const moduleMetadata: ModuleMetadata = {
          compilerVersion: version,
          fileformatVersion: 1,
          name: this.config.name,
          version: this.config.version,
          libs: [
            {
              filename: makerel(moduleAFile),
              platform: this.config.platform,
              type: "static",
            },
          ],
          linkerFlags: this.config.linkerFlags,
          interfaceLinkerFlags: this.config.interfaceLinkerFlags,
          includeDirs: includeDirs,
          interfaceMacros: interfaceMacros,
          compileCommands: compileCommands,
          fullModuleGraph: allModules,
          importFile: HAZE_LIB_IMPORT_FILE,
        };
        const moduleMetadataSerialized = {
          ...moduleMetadata,
          linkerFlags: {
            all: moduleMetadata.linkerFlags.getAll(),
            linux: moduleMetadata.linkerFlags.getLinux(),
            win32: moduleMetadata.linkerFlags.getWin32(),
          },
          interfaceLinkerFlags: {
            all: moduleMetadata.linkerFlags.getAll(),
            linux: moduleMetadata.linkerFlags.getLinux(),
            win32: moduleMetadata.linkerFlags.getWin32(),
          },
          includeDirs: {
            all: moduleMetadata.includeDirs.getAll(),
            linux: moduleMetadata.includeDirs.getLinux(),
            win32: moduleMetadata.includeDirs.getWin32(),
          },
          interfaceMacros: {
            all: moduleMetadata.interfaceMacros.getAll(),
            linux: moduleMetadata.interfaceMacros.getLinux(),
            win32: moduleMetadata.interfaceMacros.getWin32(),
          },
        };
        await writeFile(moduleMetadataFile, JSON.stringify(moduleMetadataSerialized, undefined, 2));

        const importFile = ExportSymbols(sr);
        await writeFile(importFilePath, importFile);

        if (fs.existsSync(moduleOutputLib)) {
          fs.unlinkSync(moduleOutputLib);
        }

        await createTarGz(
          `${this.moduleDir}/build`,
          [makerel(moduleAFile), makerel(importFilePath), makerel(moduleMetadataFile)],
          moduleOutputLib,
        );
      }
      if (this.config.configFilePath) {
        // await this.cache.compiledModule(
        //   this.module.moduleConfig.projectName,
        //   this.module.moduleConfig.srcDirectory,
        //   this.module.moduleConfig.configFilePath,
        // );
      }
    });
  }

  private async loadDependencyModuleGraph() {
    const metadata = await this.loadDependenciesMetadata();

    const modules: [string, string][] = [];

    metadata.forEach((meta) => {
      modules.push(...meta.fullModuleGraph);
    });

    return modules;
  }

  private async loadDependencyBinaries() {
    const metadata = await this.loadDependenciesMetadata();

    const archives: string[] = [];
    const linkerFlags = new PlatformStrings();
    const includeDirs = new PlatformStrings();
    const interfaceMacros = new PlatformStrings();
    const interfaceLinker = new PlatformStrings();

    metadata.forEach((meta) => {
      const lib = meta.libs.find((l) => l.platform === this.config.platform);
      if (!lib) {
        throw new GeneralError(
          `Lib ${meta.name} does not provide platform ${this.config.platform}`,
        );
      }

      const tempdir = join(this.moduleDir, "__deps", meta.name);
      const archiveFile = join(tempdir, lib.filename);
      archives.push(archiveFile);
      linkerFlags.merge(meta.linkerFlags);
      includeDirs.merge(meta.includeDirs);
      interfaceMacros.merge(meta.interfaceMacros);
      interfaceLinker.merge(meta.interfaceLinkerFlags);
    });

    return [archives, linkerFlags, includeDirs, interfaceMacros, interfaceLinker] as const;
  }

  private async loadDependencyCompileCommands() {
    const metadata = await this.loadDependenciesMetadata();
    return (
      metadata
        .map((meta) => {
          return meta.compileCommands;
        })
        .flat() ?? []
    );
  }

  private async loadDependenciesMetadata() {
    const deps = [...this.config.dependencies];
    if (this.config.name !== HAZE_STDLIB_NAME && !this.config.nostdlib) {
      deps.push({
        name: HAZE_STDLIB_NAME,
        path: HAZE_STDLIB_NAME,
      });
    }

    return await Promise.all(
      deps.map(async (dep) => {
        const libpath = join(
          join(this.hazeWorkspaceDirectory, dep.name),
          "bin",
          dep.name + ".hzlib",
        );
        const metadata = await this.loadSingleDependencyMetadata(libpath, dep.name);
        return metadata;
      }),
    );
  }

  private async loadSingleDependencyMetadata(libpath: string, libname: string) {
    const tempdir = join(this.moduleDir, "__deps", libname);
    fs.mkdirSync(tempdir, { recursive: true });
    await extractTarGz(libpath, tempdir);
    return parseModuleMetadata(await readFile(join(tempdir, "metadata.json"), "utf-8"));
  }

  private async collectImports() {
    const deps = [...this.config.dependencies];
    if (this.config.name !== HAZE_STDLIB_NAME && !this.config.nostdlib) {
      deps.push({
        name: HAZE_STDLIB_NAME,
        path: HAZE_STDLIB_NAME,
      });
    }

    for (const dep of deps) {
      const libpath = join(join(this.hazeWorkspaceDirectory, dep.name), "bin", dep.name + ".hzlib");
      // WARNING: For some weird reason this is required
      const _ = await this.loadSingleDependencyMetadata(libpath, dep.name);
      await this.collectDirectory(
        join(this.moduleDir, "__deps", dep.name),
        ECollectionMode.ImportUnderRootDirectly,
      );
    }
  }

  private async addInternalBuiltinSources() {
    await this.collectDirectory(
      join(await getStdlibDirectory(), "internal"),
      ECollectionMode.ImportUnderRootDirectly,
    );
    this.config.hzstdLocation = join(await getStdlibDirectory(), "core", "src");
    this.config.includeDirs.addAll(this.config.hzstdLocation);
  }
}
