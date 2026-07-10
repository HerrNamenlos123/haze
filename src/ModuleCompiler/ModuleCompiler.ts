import * as child_process from "node:child_process";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs, {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path, { basename, dirname, extname, join } from "node:path";
import { cwd, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import archiver from "archiver";
import fg from "fast-glob";
import gunzip from "gunzip-maybe";
import tarFs from "tar-fs";
import which from "which";
import { version } from "../../package.json";
import { generateCode } from "../Codegen/CodeGenerator";
import { LowerModule } from "../Lower/Lower";
import { Parser } from "../Parser/Parser";
import type { ASTRoot } from "../shared/AST";
import { Semantic } from "../Semantic/SemanticTypes";
import { ExportCollectedSymbols as ExportSymbols } from "../SymbolCollection/Export";
import {
  Collect,
  CollectFile,
  CollectImmediate,
  type CollectionContext,
  makeCollectionContext,
} from "../SymbolCollection/SymbolCollection";
import {
  type CompileCommands,
  ConfigParser,
  ECollectionMode,
  EModuleFileDir,
  type GeneratorConfig,
  type GeneratorFile,
  type GeneratorFilePlatform,
  type GeneratorGraphNode,
  type ModuleConfig,
  type ModuleMetadata,
  ModuleType,
  PLATFORM,
  Platform,
  PlatformStrings,
  parseModuleMetadata,
} from "../shared/Config";
import {
  assert,
  CmdFailed,
  CompilerError,
  GeneralError,
  ImpossibleSituation,
  InternalError,
  SyntaxError,
  UnreachableCode,
} from "../shared/Errors";
import { ProjectCompiler } from "../ProjectCompiler/ProjectCompiler";
import {
  type CLIPrinter,
  EModulePrintCompilerPhase,
  type ModuleHandle,
  printLine,
  printLineWarning,
} from "./CLIPrinter";

/**
 * Temporarily sets environment variables for an async callback.
 *
 * @param vars - object mapping env var names to values
 * @param fn - async callback to run with the temporary environment
 * @returns the value returned by fn
 */
export async function withEnv<T>(
  vars: Record<string, string>,
  fn: () => Promise<T>
): Promise<T> {
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

export const HAZE_DIR = os.homedir() + "/.haze";
export const HAZE_CACHE = HAZE_DIR + "/cache";
export const HAZE_TOOLCHAIN_INSTALLED_MARKER =
  HAZE_CACHE + "/toolchain-installed.json";
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

export const HAZE_STDLIB_NAME = "haze-stdlib";

export const HAZE_C_COMPILER =
  HAZE_GLOBAL_DIR +
  (PLATFORM === Platform.Linux ? "/bin/clang" : "/bin/clang.exe");
export const HAZE_CXX_COMPILER =
  HAZE_GLOBAL_DIR +
  (PLATFORM === Platform.Linux ? "/bin/clang++" : "/bin/clang++.exe");
const ARCHIVE_TOOL =
  PLATFORM === Platform.Linux ? "ar" : HAZE_GLOBAL_DIR + "/bin/llvm-ar.exe";
const HAZE_CONFIG_FILE = "haze.toml";
const HAZE_LIB_IMPORT_FILE = "import.hz";

export async function getFile(url: string, outfile: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  await writeFile(outfile, new Uint8Array(buffer));
}

export async function getFileWithProgress(url: string, outfile: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.statusText}`);
  }

  const total = Number(response.headers.get("content-length")) || 0;
  const stream = response.body;
  if (!stream) {
    throw new Error("No response body");
  }

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
    if (done) {
      break;
    }
    if (value) {
      downloaded += value.length;
      fileWriter.write(value);
      renderProgress(downloaded, total);
    }
  }

  fileWriter.end();
  stdout.write("\n"); // move to next line after progress bar
}

export async function parseConfig(
  startDir?: string,
  explicitDir?: string,
  sourceloc?: boolean
) {
  const parser = new ConfigParser(HAZE_CONFIG_FILE, startDir, explicitDir);
  return await parser.parseConfig(sourceloc);
}

export async function getStdlibDirectory() {
  if (process.env["HAZE_STDLIB_DIR"]) {
    return process.env["HAZE_STDLIB_DIR"];
  }
  if (process.env["NODE_ENV"] === "production") {
    let whichHz = null as string | null;
    try {
      whichHz = await which("haze");
    } catch {
      throw new GeneralError("Compiler not found in path");
    }
    const realHz = realpathSync(whichHz);
    return join(dirname(realHz), "stdlib/");
  }
  return join(dirname(fileURLToPath(import.meta.url)), "../../stdlib");
}

export async function getToolsDirectory() {
  if (process.env["NODE_ENV"] === "production") {
    let whichHz = null as string | null;
    try {
      whichHz = await which("haze");
    } catch {
      throw new GeneralError("Compiler not found in path");
    }
    const realHz = realpathSync(whichHz);
    return join(dirname(realHz), "tools/");
  }
  return join(dirname(fileURLToPath(import.meta.url)), "../../tools");
}

export async function catchErrors(fn: () => Promise<void>) {
  try {
    await fn();
    return true;
  } catch (e) {
    let msg: string;
    if (e instanceof GeneralError) {
      msg = e.message;
    } else if (e instanceof InternalError) {
      msg = e.message;
      const stack = e.stack?.split("\n").slice(1).join("\n");
      if (stack) {
        msg += "\n" + stack;
      }
    } else if (e instanceof CompilerError) {
      msg = e.message;
    } else if (e instanceof UnreachableCode) {
      msg = e.message;
    } else if (e instanceof SyntaxError) {
      msg = e.message;
    } else if (e instanceof CmdFailed) {
      return false;
    } else {
      msg = String(e);
    }
    try {
      printLine(msg);
    } catch {
      process.stderr.write(msg + "\n");
    }
    return false;
  }
}

type FileWatcherCache = Record<string, number>;
const FILE_WATCHER_FILENAME = "watcher.cache.json";
function loadCache(globalBuildDir: string): FileWatcherCache {
  try {
    return JSON.parse(
      fs.readFileSync(globalBuildDir + "/" + FILE_WATCHER_FILENAME, "utf8")
    );
  } catch {
    return {};
  }
}

function saveCache(cache: FileWatcherCache, globalBuildDir: string) {
  fs.writeFileSync(
    globalBuildDir + "/" + FILE_WATCHER_FILENAME,
    JSON.stringify(cache),
    "utf8"
  );
}

export function invalidateChangeCache(
  globs: string[],
  globalBuildDir: string,
  workingDir: string
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
  workingDir: string
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

export class Cache {
  filename?: string;
  data: Record<string, any> = {};

  constructor() {}

  async getFilesWithModificationDates(
    dir: string
  ): Promise<{ file: string; modified: Date }[]> {
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

  async getFileModificationDate(
    file: string
  ): Promise<{ file: string; modified: Date }> {
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
    }
    await writeFile(this.filename, JSON.stringify(this.data, undefined, 2));
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
      ].map((f) => `${f.file}=${new Date(f.modified).toISOString()}`)
    );
    if (!this.data[name]) {
      return true;
    }
    const foundFiles = new Set(
      this.data[name]["files"].map(
        (f: { file: string; modified: string }) =>
          `${f.file}=${new Date(f.modified).toISOString()}`
      )
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
    if (!this.dirty) {
      return;
    }

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

type ModuleBuildCacheEntry = {
  files: Record<string, FileStamp>;
  compilerKey?: string;
};

type ModuleBuildCacheData = Record<string, ModuleBuildCacheEntry>;

type LegacyModuleBuildCacheData = Record<string, Record<string, FileStamp>>;

export class ModuleBuildCache {
  private cacheFile: string;
  private data: ModuleBuildCacheData = {};
  private dirty = false;

  constructor(cacheFile: string) {
    this.cacheFile = cacheFile;
  }

  load(): void {
    if (!fs.existsSync(this.cacheFile)) {
      this.data = {};
      return;
    }

    const raw = fs.readFileSync(this.cacheFile, "utf8");
    const parsed = JSON.parse(raw) as
      | ModuleBuildCacheData
      | LegacyModuleBuildCacheData;

    const legacyEntry = Object.values(parsed)[0];
    if (legacyEntry && !(legacyEntry as ModuleBuildCacheEntry).files) {
      const legacy = parsed as LegacyModuleBuildCacheData;
      const migrated: ModuleBuildCacheData = {};
      for (const [moduleName, files] of Object.entries(legacy)) {
        migrated[moduleName] = { files: files };
      }
      this.data = migrated;
      this.dirty = true;
      return;
    }

    this.data = parsed as ModuleBuildCacheData;
  }

  save(): void {
    if (!this.dirty) {
      return;
    }

    fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
    fs.writeFileSync(this.cacheFile, JSON.stringify(this.data, null, 2));
    this.dirty = false;
  }

  getModuleCompilerKey(moduleName: string): string | undefined {
    return this.data[moduleName]?.compilerKey;
  }

  // Every absolute path tracked for this module as of the last successful
  // build, including any embed_file_text/embed_file_binary'd resource files
  // discovered during that build's analysis phase (see ModuleCompiler.build:
  // those aren't known until analysis runs, so this is how a later build's
  // pre-analysis "did anything change" check can still notice one of them
  // was touched, without having to re-analyze just to find out).
  getModuleTrackedFiles(moduleName: string): string[] {
    return Object.keys(this.data[moduleName]?.files ?? {});
  }

  hasModuleChanged(
    moduleName: string,
    files: string[],
    compilerKey?: string
  ): boolean {
    const normalized = new Set(files.map((f) => path.resolve(f)));
    const entry = this.data[moduleName];

    if (!entry) {
      return true;
    }
    if (compilerKey && entry.compilerKey !== compilerKey) {
      return true;
    }

    const prev = entry.files ?? {};

    for (const file of normalized) {
      if (!fs.existsSync(file)) {
        return true;
      }
      const stat = fs.statSync(file);
      const prevStamp = prev[file];
      if (!prevStamp || prevStamp.mtimeMs < stat.mtimeMs) {
        return true;
      }
    }

    for (const prevFile of Object.keys(prev)) {
      if (!normalized.has(prevFile)) {
        return true;
      }
    }

    return false;
  }

  updateModule(
    moduleName: string,
    files: string[],
    compilerKey?: string
  ): void {
    const normalized = files.map((f) => path.resolve(f));
    const next: Record<string, FileStamp> = {};

    for (const file of normalized) {
      if (!fs.existsSync(file)) {
        continue;
      }
      const stat = fs.statSync(file);
      next[file] = { mtimeMs: stat.mtimeMs };
    }

    this.data[moduleName] = {
      files: next,
      compilerKey: compilerKey,
    };
    this.dirty = true;
  }
}

export function getCurrentPlatform() {
  if (PLATFORM === Platform.Linux) {
    return "linux-x64";
  }
  return "win32-x64";
}

// ---------------------------------------------------------------------------
// ImportASTCache — shared across all ModuleCompiler instances in one build.
//
// Two layers:
//   1. In-memory: avoids re-parsing the same dep within a parallel build.
//   2. On-disk:   avoids re-parsing across consecutive builds when nothing
//                 has changed in a .hzlib dependency.
//
// Cache key: (depName, libMtimeMs, relPath) where relPath is the path of
// the .hz file relative to the dep's extracted directory.  Using the
// .hzlib mtime rather than the extracted file mtime means the key is
// stable across modules that each maintain their own __deps copy.
// ---------------------------------------------------------------------------

type ASTCacheEntry = {
  libMtimeMs: number;
  files: Record<string, ASTRoot>;
};

export class ImportASTCache {
  private memory = new Map<string, ASTRoot>();

  constructor(private readonly diskCacheDir: string) {}

  private memKey(depName: string, libMtimeMs: number, relPath: string) {
    return `${depName}:${libMtimeMs}:${relPath}`;
  }

  get(
    depName: string,
    libMtimeMs: number,
    relPath: string
  ): ASTRoot | undefined {
    const key = this.memKey(depName, libMtimeMs, relPath);
    if (this.memory.has(key)) {
      return this.memory.get(key);
    }

    const diskPath = path.join(this.diskCacheDir, `${depName}.json`);
    if (!fs.existsSync(diskPath)) {
      return;
    }
    try {
      const entry = JSON.parse(
        fs.readFileSync(diskPath, "utf8")
      ) as ASTCacheEntry;
      if (entry.libMtimeMs !== libMtimeMs) {
        return;
      }
      // Warm the in-memory cache with everything from this disk entry.
      for (const [rel, ast] of Object.entries(entry.files)) {
        this.memory.set(this.memKey(depName, libMtimeMs, rel), ast);
      }
      return this.memory.get(key);
    } catch {
      return;
    }
  }

  set(
    depName: string,
    libMtimeMs: number,
    relPath: string,
    ast: ASTRoot
  ): void {
    const key = this.memKey(depName, libMtimeMs, relPath);
    this.memory.set(key, ast);

    // Persist to disk, merging with any other files already stored for this dep.
    const diskPath = path.join(this.diskCacheDir, `${depName}.json`);
    let entry: ASTCacheEntry = { libMtimeMs: libMtimeMs, files: {} };
    if (fs.existsSync(diskPath)) {
      try {
        const prev = JSON.parse(
          fs.readFileSync(diskPath, "utf8")
        ) as ASTCacheEntry;
        if (prev.libMtimeMs === libMtimeMs) {
          entry = prev;
        }
      } catch {
        // Corrupt or stale — start fresh.
      }
    }
    entry.files[relPath] = ast;

    try {
      fs.mkdirSync(this.diskCacheDir, { recursive: true });
      fs.writeFileSync(diskPath, JSON.stringify(entry), "utf8");
    } catch {
      // Non-fatal: in-memory cache still works.
    }
  }
}

// ProjectCompiler has moved to src/ProjectCompiler/ProjectCompiler.ts

export function exec(str: string) {
  const proc = child_process.spawnSync(str, {
    stdio: ["inherit", "inherit", "pipe"],
    shell: true,
    env: process.env,
  });
  const stderr = proc.stderr?.toString() ?? "";
  if (proc.status !== 0) {
    if (stderr.trim()) {
      printLine(stderr.trimEnd());
    }
    throw new CmdFailed();
  }
  if (stderr.trim()) {
    printLineWarning(stderr.trimEnd());
  }
}

export function execAsync(str: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = child_process.spawn(str, {
      stdio: ["inherit", "pipe", "pipe"],
      shell: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code: number | null) => {
      if (code === 0) {
        if (stderr.trim()) {
          printLineWarning(stderr.trimEnd());
        }
        resolve();
      } else {
        if (stdout.trim()) {
          printLine(stdout.trimEnd());
        }
        if (stderr.trim()) {
          printLine(stderr.trimEnd());
        }
        reject(new CmdFailed());
      }
    });

    proc.on("error", reject);
  });
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

export function execInherit(str: string, dir?: string) {
  const shell =
    PLATFORM === Platform.Win32 ? "C:\\Windows\\System32\\cmd.exe" : "/bin/sh";
  const args =
    PLATFORM === Platform.Win32
      ? ["/d", "/s", "/c", `${str}`]
      : ["-c", `"${str}"`];

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
  currentUnitScope: Collect.ScopeId | null = null;
  private cachedDependencyMetadata: ModuleMetadata[] | null = null;
  private collectedDepModules: Set<string> = new Set();
  private printer: CLIPrinter | null = null;
  private printerHandle: ModuleHandle | null = null;
  importASTCache: ImportASTCache | null = null;

  constructor(
    public config: ModuleConfig,
    public cache: Cache,
    public hazeWorkspaceDirectory: string,
    public moduleDir: string,
    public verbose: boolean,
    public strip: boolean
  ) {
    this.cc = makeCollectionContext(this.config);
    this.cc.moduleCompiler = this;
  }

  // -------------------------------------------------------------------------
  // Extraction stamp helpers — track the mtime of each dep's .hzlib at the
  // time it was last extracted so we can skip re-extraction when unchanged.
  // Stamps are stored per-module in __deps/.stamps.json.
  // -------------------------------------------------------------------------

  private get extractionStampsPath() {
    return path.join(this.moduleDir, "__deps", ".stamps.json");
  }

  private loadExtractionStamps(): Record<string, number> {
    try {
      return JSON.parse(fs.readFileSync(this.extractionStampsPath, "utf8"));
    } catch {
      return {};
    }
  }

  private isExtractionCurrent(depName: string, libMtimeMs: number): boolean {
    const depDir = path.join(this.moduleDir, "__deps", depName);
    if (!fs.existsSync(depDir)) {
      return false;
    }
    const stamps = this.loadExtractionStamps();
    return stamps[depName] === libMtimeMs;
  }

  private saveExtractionStamp(depName: string, libMtimeMs: number): void {
    const stamps = this.loadExtractionStamps();
    stamps[depName] = libMtimeMs;
    try {
      fs.mkdirSync(path.dirname(this.extractionStampsPath), {
        recursive: true,
      });
      fs.writeFileSync(
        this.extractionStampsPath,
        JSON.stringify(stamps),
        "utf8"
      );
    } catch {
      // Non-fatal.
    }
  }

  setPrinter(printer: CLIPrinter, handle: ModuleHandle) {
    this.printer = printer;
    this.printerHandle = handle;
  }

  private advancePhase(phase: EModulePrintCompilerPhase) {
    if (this.printer && this.printerHandle) {
      this.printer.setPhase(this.printerHandle, phase);
    }
  }

  private markBuildStart() {
    if (this.printer && this.printerHandle) {
      this.printer.beginModule(this.printerHandle);
    }
  }

  private printCmd(cmd: string) {
    if (this.printer) {
      this.printer.logInfo(`\n  $ ${cmd}\n`);
    } else {
      process.stdout.write(`\n  $ ${cmd}\n\n`);
    }
  }

  private get effectiveDependencies() {
    const deps = [...this.config.dependencies];
    if (this.config.name !== HAZE_STDLIB_NAME && !this.config.nostdlib) {
      deps.push({ name: HAZE_STDLIB_NAME, path: HAZE_STDLIB_NAME });
    }
    return deps;
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
      this.config.id,
      collectionMode
    );
  }

  async collectFile(filepath: string, collectionMode: ECollectionMode) {
    const fileText = await readFile(filepath, "utf-8");
    const ast = Parser.parseTextToAST(this.config, fileText, filepath);

    // Determine parent scope based on collection mode
    let parentScopeId: Collect.ScopeId;
    if (collectionMode === ECollectionMode.WrapIntoModuleNamespace) {
      // Create unit scope once and reuse it for all files in this collection session
      if (this.currentUnitScope === null) {
        this.currentUnitScope = this.makeUnit()[1];
      }
      parentScopeId = this.currentUnitScope;
    } else {
      parentScopeId = this.cc.moduleScopeId;
    }

    CollectFile(
      this.cc,
      ast,
      parentScopeId,
      filepath,
      this.config.name,
      this.config.version,
      this.config.id,
      collectionMode
    );
  }

  async collectDirectory(dirpath: string, collectionMode: ECollectionMode) {
    for (const file of readdirSync(dirpath)) {
      if (file === "__haze__") {
        continue;
      }
      const fullPath = join(dirpath, file);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        const isDepModule = basename(dirpath) === "__deps";
        if (isDepModule) {
          if (this.collectedDepModules.has(file)) {
            continue;
          }
          this.collectedDepModules.add(file);
        }
        await this.collectDirectory(fullPath, collectionMode);
      } else if (extname(fullPath) === ".hz") {
        await this.collectFile(fullPath, collectionMode);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Dep-import collection — mirrors collectDirectory/collectFile but uses the
  // ImportASTCache so that ANTLR is only invoked when the dep's .hzlib has
  // actually changed.
  // -------------------------------------------------------------------------

  private async collectDepDirectory(
    dirpath: string,
    depName: string,
    libMtimeMs: number
  ) {
    for (const file of readdirSync(dirpath)) {
      if (file === "__haze__") {
        continue;
      }
      const fullPath = join(dirpath, file);
      if (statSync(fullPath).isDirectory()) {
        await this.collectDepDirectory(fullPath, depName, libMtimeMs);
      } else if (extname(fullPath) === ".hz") {
        await this.collectDepFile(fullPath, depName, libMtimeMs);
      }
    }
  }

  private async collectDepFile(
    filepath: string,
    depName: string,
    libMtimeMs: number
  ) {
    const depDir = join(this.moduleDir, "__deps", depName);
    const relPath = path.relative(depDir, filepath);

    const cached = this.importASTCache?.get(depName, libMtimeMs, relPath);
    let ast: ASTRoot;
    if (cached) {
      ast = cached;
    } else {
      const fileText = await readFile(filepath, "utf-8");
      ast = Parser.parseTextToAST(this.config, fileText, filepath);
      this.importASTCache?.set(depName, libMtimeMs, relPath, ast);
    }

    CollectFile(
      this.cc,
      ast,
      this.cc.moduleScopeId,
      filepath,
      this.config.name,
      this.config.version,
      this.config.id,
      ECollectionMode.ImportUnderRootDirectly
    );
  }

  collectImmediate(
    sourceCode: string,
    args: {
      inScope: Collect.ScopeId;
    }
  ) {
    const ast = Parser.parseTextToAST(this.config, sourceCode, "internal");
    CollectImmediate(this.cc, ast, args.inScope);
  }

  async scanProjectSourceFiles() {
    const files = new Set<string>();

    const addDir = async (dirpath: string) => {
      if (!existsSync(dirpath)) {
        return;
      }
      for (const file of readdirSync(dirpath)) {
        const fullPath = join(dirpath, file);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          await addDir(fullPath);
        } else if (extname(fullPath) === ".hz") {
          files.add(fullPath);
        } else if (extname(fullPath) === ".c") {
          files.add(fullPath);
        } else if (extname(fullPath) === ".h") {
          files.add(fullPath);
        }
      }
    };

    if (this.config.source.type === "src-dir") {
      await addDir(this.config.source.dirpath);
    } else {
      files.add(this.config.source.filepath);
    }

    const autogenDir = this.getModuleAutogenDir(this.config.name);
    if (existsSync(autogenDir)) {
      await addDir(autogenDir);
    }

    return files;
  }

  private buildGeneratorGraph(): Map<string, GeneratorGraphNode> {
    const generatorGraph = new Map<string, GeneratorGraphNode>();
    for (const gen of this.config.generators) {
      if (gen.type !== "exec") {
        continue;
      }

      generatorGraph.set(gen.name, {
        config: gen,
        dependsOn: [],
      });
    }

    const outputIndex = new Map<string, string>();
    for (const node of generatorGraph.values()) {
      const gen = node.config;

      if (gen.type !== "exec") {
        continue;
      }

      for (const out of gen.outputs) {
        if (out.type !== "module-file") {
          continue;
        }
        if (!this.isFileForCurrentPlatform(out)) {
          continue;
        }

        const key = this.generatorFileKey(out);

        if (outputIndex.has(key)) {
          throw new GeneralError(
            `Output file '${out.path}' is produced by both ` +
              `'${outputIndex.get(key)}' and '${gen.name}'`
          );
        }

        outputIndex.set(key, gen.name);
      }
    }

    for (const node of generatorGraph.values()) {
      const gen = node.config;

      if (gen.type !== "exec") {
        continue;
      }

      for (const input of gen.inputs) {
        if (input.type !== "module-file") {
          continue;
        }
        if (!this.isFileForCurrentPlatform(input)) {
          continue;
        }

        const key = this.generatorFileKey(input);
        const producer = outputIndex.get(key);

        if (!producer) {
          continue;
        }

        if (producer === gen.name) {
          throw new GeneralError(
            `Generator '${gen.name}' lists its own output '${input.path}' as input`
          );
        }

        node.dependsOn.push(producer);
      }
    }

    for (const node of generatorGraph.values()) {
      for (const dep of node.dependsOn) {
        if (!generatorGraph.has(dep)) {
          throw new GeneralError(
            `Generator '${node.config.name}' depends on unknown generator '${dep}'`
          );
        }
      }
    }

    return generatorGraph;
  }

  private getGeneratorsToRun(
    batch: GeneratorGraphNode[],
    cache: FileChangeCache,
    force: boolean
  ): {
    gen: GeneratorGraphNode;
    inputPaths: string[];
    outputPaths: string[];
  }[] {
    const toRun: {
      gen: GeneratorGraphNode;
      inputPaths: string[];
      outputPaths: string[];
    }[] = [];
    for (const gen of batch) {
      if (gen.config.type !== "exec") {
        throw new Error("Not implemented");
      }
      const inputPaths = gen.config.inputs
        .filter((i) => this.isFileForCurrentPlatform(i))
        .map((i) => this.resolveGeneratorFile(i));
      const outputPaths = gen.config.outputs
        .filter((i) => this.isFileForCurrentPlatform(i))
        .map((i) => this.resolveGeneratorFile(i));

      if (
        force ||
        cache.haveAnyFilesChanged([
          this.resolveExec(gen.config.exec),
          ...inputPaths,
          ...outputPaths,
        ])
      ) {
        toRun.push({
          gen: gen,
          inputPaths: inputPaths,
          outputPaths: outputPaths,
        });
      }
    }

    return toRun;
  }

  private generatorsNeedRun(): boolean {
    const generatorGraph = this.buildGeneratorGraph();
    const executionOrder = this.topoLayers(generatorGraph);

    const cache = new FileChangeCache(
      path.join(this.hazeWorkspaceDirectory, "generator.cache.json")
    );
    cache.load();

    for (const batch of executionOrder) {
      const toRun = this.getGeneratorsToRun(batch, cache, false);
      if (toRun.length > 0) {
        return true;
      }
    }

    return false;
  }

  private computeCompilerFingerprint(): string | undefined {
    if (process.env["NODE_ENV"] === "production") {
      return;
    }

    const compilerRootDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../.."
    );
    const compilerSrcDir = join(compilerRootDir, "src");
    if (!existsSync(compilerSrcDir)) {
      return "missing-src";
    }

    const hash = createHash("sha256");

    const visit = (dir: string) => {
      const entries = readdirSync(dir).sort();
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          visit(fullPath);
        } else {
          hash.update(fullPath);
          hash.update(String(stats.mtimeMs));
          hash.update(String(stats.size));
        }
      }
    };

    visit(compilerSrcDir);
    return hash.digest("hex");
  }

  private getDependencyLibPaths() {
    return this.effectiveDependencies.map((dep) =>
      join(
        join(this.hazeWorkspaceDirectory, dep.name),
        "bin",
        dep.name + ".hzlib"
      )
    );
  }

  private async gatherModuleRelevantFiles(): Promise<string[]> {
    const files = new Set<string>();

    if (this.config.configFilePath) {
      files.add(this.config.configFilePath);
    }

    const sourceFiles = await this.scanProjectSourceFiles();
    sourceFiles.forEach((f) => files.add(f));

    const depLibs = this.getDependencyLibPaths();
    depLibs.forEach((f) => files.add(f));

    for (const gen of this.config.generators) {
      if (gen.type !== "exec") {
        continue;
      }
      files.add(this.resolveExec(gen.exec));
      for (const input of gen.inputs) {
        if (
          input.type !== "module-file" ||
          !this.isFileForCurrentPlatform(input)
        ) {
          continue;
        }
        files.add(this.resolveGeneratorFile(input));
      }
      for (const output of gen.outputs) {
        if (
          output.type !== "module-file" ||
          !this.isFileForCurrentPlatform(output)
        ) {
          continue;
        }
        files.add(this.resolveGeneratorFile(output));
      }
    }

    return [...files];
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

  private isFileForCurrentPlatform(file: GeneratorFile): boolean {
    if (file.type !== "module-file") {
      return true;
    }
    if (!file.platform) {
      return true;
    }
    const platformMap: Record<GeneratorFilePlatform, Platform> = {
      linux: Platform.Linux,
      win32: Platform.Win32,
    };
    return PLATFORM === platformMap[file.platform];
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
      if (degree === 0) {
        ready.push(name);
      }
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

  async runAllGenerators(force = false) {
    const generatorGraph = this.buildGeneratorGraph();
    const executionOrder = this.topoLayers(generatorGraph);

    const cache = new FileChangeCache(
      path.join(this.hazeWorkspaceDirectory, "generator.cache.json")
    );
    cache.load();

    let ranAny = false;

    for (const batch of executionOrder) {
      cache.load();
      const toRun = this.getGeneratorsToRun(batch, cache, force);

      if (toRun.length > 0) {
        ranAny = true;
      }

      await Promise.all(
        toRun.map((item) => this.executeGenerator(item.gen.config))
      );

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

    return ranAny;
  }

  resolveExec(exec: string) {
    assert(this.currentModuleRootDir);
    return join(this.currentModuleRootDir, exec);
  }

  resolveGeneratorFile(file: GeneratorFile) {
    if (file.type !== "module-file") {
      throw new Error("Not implemented");
    }

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
        dir = this.getModuleSourceDir(moduleName);
        break;

      case EModuleFileDir.ModuleRootDir:
        dir = this.getModuleRootDir(moduleName);
        break;

      default:
        assert(false);
        throw new Error();
    }

    if (file.path.startsWith("/")) {
      throw new GeneralError(
        "File paths are not supposed to have a leading slash"
      );
    }
    return join(dir, file.path);
  }

  async executeGenerator(gen: GeneratorConfig) {
    if (gen.type !== "exec") {
      throw new Error("Not implemented");
    }

    assert(this.currentModuleRootDir);
    const sourceloc = this.config.includeSourceloc;

    const logsDir = join(this.moduleDir, "logs");
    mkdirSync(logsDir, { recursive: true });
    const logPath = join(logsDir, `${gen.name}.log`);

    const genHandle = this.printer?.beginGenerator(this.config.name, gen.name);
    const logChunks: string[] = [];
    const project = new ProjectCompiler(false, true, false, false, true);
    let buildOk = false;
    let runResult: { exitCode: number; output: string } | null = null;

    // Capture generator build output to a buffer so it stays off the terminal.
    // The captured log is written to disk and shown only on failure.
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (
      chunk: Buffer | string,
      _encodingOrCb?: unknown,
      _cb?: unknown
    ): boolean => {
      logChunks.push(
        Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)
      );
      return true;
    };

    try {
      buildOk = await project.build(
        this.resolveExec(gen.exec),
        undefined,
        sourceloc,
        false
      );

      if (buildOk) {
        runResult = await withEnv(
          {
            HAZE_WORKSPACE_DIR: this.hazeWorkspaceDirectory,
            HAZE_MODULE_SOURCE_DIR: this.currentModuleRootDir,
            HAZE_MODULE_BUILD_DIR: this.moduleDir + "/build",
            HAZE_MODULE_BINARY_DIR: this.moduleDir + "/bin",
            HAZE_MODULE_TMP_DIR: this.moduleDir + "/tmp",
            HAZE_MODULE_AUTOGEN_DIR: this.moduleDir + "/autogen",
            HAZE_GLOBAL_DIR: HAZE_GLOBAL_DIR,
            HAZE_C_COMPILER: HAZE_C_COMPILER,
            HAZE_CXX_COMPILER: HAZE_CXX_COMPILER,
          },
          () =>
            project.runCaptured(
              this.resolveExec(gen.exec),
              undefined,
              sourceloc,
              []
            )
        );
        logChunks.push(runResult.output);
      }
    } finally {
      (process.stdout as any).write = origWrite;
      if (genHandle) {
        this.printer?.endGenerator(genHandle);
      }
    }

    // Strip ANSI escape codes before writing to the log file so it is
    // readable in any text editor.
    const rawLog = logChunks.join("");
    const ESC = String.fromCharCode(27);
    const ansiPattern = new RegExp(ESC + "[[0-9;]*[mGKJHF]", "g");
    const cleanLog = rawLog.replace(ansiPattern, "");
    writeFileSync(logPath, cleanLog, "utf8");

    if (!buildOk) {
      process.stdout.write(cleanLog);
      throw new GeneralError(
        `Generator "${gen.name}" failed to build — see ${logPath}`
      );
    }

    if (runResult && runResult.exitCode !== 0) {
      process.stdout.write(cleanLog);
      throw new GeneralError(
        `Generator "${gen.name}" failed with exit code ${runResult.exitCode} — see ${logPath}`
      );
    }

    for (const file of gen.outputs) {
      if (!this.isFileForCurrentPlatform(file)) {
        continue;
      }
      const resolvedPath = this.resolveGeneratorFile(file);
      if (!existsSync(resolvedPath)) {
        process.stdout.write(cleanLog);
        throw new GeneralError(
          `Generator "${gen.name}" did not produce expected file "${resolvedPath}" — see ${logPath}`
        );
      }
    }
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

  getModuleRootDir(moduleName: string) {
    if (moduleName !== this.config.name) {
      throw new GeneralError(
        `dir="root" is only supported for module="this", not "${moduleName}"`
      );
    }
    assert(this.currentModuleRootDir);
    return this.currentModuleRootDir;
  }

  getModuleSourceDir(moduleName: string) {
    return join(this.getModuleRootDir(moduleName), "src");
  }

  private maybeStripExecutable() {
    if (!this.strip) {
      return;
    }
    if (this.config.moduleType !== ModuleType.Executable) {
      return;
    }
    if (PLATFORM !== Platform.Linux) {
      return;
    }
    const moduleExecutable = join(this.moduleDir, `bin/${this.config.name}`);
    if (!existsSync(moduleExecutable)) {
      return;
    }
    exec(`strip --strip-unneeded "${moduleExecutable}"`);
  }

  private computeBuildPaths() {
    const name = this.config.name;
    const platform = this.config.platform;
    return {
      moduleCFile: join(this.moduleDir, `build/${name}-${platform}.c`),
      moduleOFile: join(this.moduleDir, `build/${name}-${platform}.o`),
      moduleAFile: join(this.moduleDir, `build/${name}-${platform}.a`),
      moduleExecutable:
        join(this.moduleDir, `bin/${name}`) +
        (PLATFORM === Platform.Win32 ? ".exe" : ""),
      moduleMetadataFile: join(this.moduleDir, "build/metadata.json"),
      moduleOutputLib: join(
        this.moduleDir,
        "bin/" + this.config.name + ".hzlib"
      ),
      importFilePath: join(this.moduleDir, "build", HAZE_LIB_IMPORT_FILE),
    };
  }

  private async phaseCollect() {
    await this.addInternalBuiltinSources();
    await this.collectImports();
    await this.addProjectSourceFiles();
  }

  private phaseAnalyze() {
    return Semantic.SemanticallyAnalyze(
      this,
      this.cc,
      this.config.moduleType === ModuleType.Library,
      this.config.name,
      this.config.version
    );
  }

  private phaseLower(sr: ReturnType<ModuleCompiler["phaseAnalyze"]>) {
    return LowerModule(sr);
  }

  private async phaseGenerate(
    lowered: ReturnType<ModuleCompiler["phaseLower"]>,
    allModules: [string, string, string][],
    paths: ReturnType<ModuleCompiler["computeBuildPaths"]>
  ) {
    await mkdir(join(this.moduleDir, "build/"), { recursive: true });
    await mkdir(join(this.moduleDir, "bin/"), { recursive: true });
    const code = generateCode(this.config, this.moduleDir, allModules, lowered);
    await writeFile(paths.moduleCFile, code);
  }

  private async phaseCCompile(
    sr: ReturnType<ModuleCompiler["phaseAnalyze"]>,
    paths: ReturnType<ModuleCompiler["computeBuildPaths"]>,
    allModules: [string, string, string][],
    isTopLevelModule: boolean
  ) {
    const compilerFlags = this.config.compilerFlags;
    const linkerFlags = this.config.linkerFlags;
    const includeDirs = this.config.includeDirs;
    const interfaceMacros = this.config.interfaceMacros;
    const interfaceLinker = this.config.interfaceLinkerFlags;
    compilerFlags.addAll("-Wno-parentheses-equality");
    compilerFlags.addAll("-Wno-extra-tokens");

    interfaceMacros.addAll("PCRE2_STATIC");

    includeDirs.addAll(`${this.moduleDir}/bin/include`);
    includeDirs.addAll(`${HAZE_GLOBAL_DIR}/include`);
    compilerFlags.addAll("-fno-omit-frame-pointer");
    linkerFlags.addAll(`-L"${this.moduleDir}/bin/lib"`);
    linkerFlags.addAll(`-L"${this.moduleDir}/bin/lib64"`);

    includeDirs.addAll(`${HAZE_GLOBAL_DIR}`);
    linkerFlags.addLinux(`"${HAZE_GLOBAL_DIR}/haze-libunwind/lib/libunwind.a"`);
    linkerFlags.addLinux("-llzma");

    // Used by the profiler to resolve source locations (file/line) from instruction pointers by
    // reading .debug_line directly, in-process, instead of shelling out to addr2line.
    includeDirs.addLinux("/usr/include/libdwarf-0");
    linkerFlags.addLinux("-ldwarf");

    includeDirs.addAll(`${HAZE_GLOBAL_DIR}/haze-bdwgc/include`);
    linkerFlags.addAll(`-L"${HAZE_GLOBAL_DIR}/haze-bdwgc/lib64/"`);
    linkerFlags.addAll(`-L"${HAZE_GLOBAL_DIR}/haze-bdwgc/lib/"`);
    linkerFlags.addAll("-lgc");
    // linkerFlags.addWin32(`"${HAZE_GLOBAL_DIR}/haze-bdwgc/lib/gc.lib"`);

    includeDirs.addAll(`${HAZE_GLOBAL_DIR}/pcre2/include`);
    linkerFlags.addAll(`-L"${HAZE_GLOBAL_DIR}/pcre2/lib64/"`);
    linkerFlags.addAll(`-L"${HAZE_GLOBAL_DIR}/pcre2/lib/"`);
    linkerFlags.addAll("-lpcre2-8");
    // linkerFlags.addWin32(`"${HAZE_GLOBAL_DIR}/pcre2/lib/gc.lib"`);

    compilerFlags.addWin32("-D_CRT_SECURE_NO_WARNINGS");
    linkerFlags.addWin32("-fuse-ld=lld");
    linkerFlags.addWin32("-lntdll");
    linkerFlags.addWin32("-lkernel32");
    linkerFlags.addWin32("-luser32");
    linkerFlags.addWin32("-ladvapi32");

    compilerFlags.addWin32("-DHAZE_PLATFORM_WIN32");
    compilerFlags.addLinux("-DHAZE_PLATFORM_LINUX");

    compilerFlags.addLinux("-fPIC");

    const compileCommands: CompileCommands =
      await this.loadDependencyCompileCommands();
    if (this.config.source.type === "src-dir") {
      includeDirs.addAll(this.config.source.dirpath);
    } else {
      includeDirs.addAll(dirname(this.config.source.filepath));
    }

    compilerFlags.addAll("-std=c11");
    compilerFlags.addAll("-g");

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

    compilerFlags.addAll(this.config.macros.getAll().map((dir) => `-D${dir}`));
    compilerFlags.addLinux(
      this.config.macros.getLinux().map((dir) => `-D${dir}`)
    );
    compilerFlags.addWin32(
      this.config.macros.getWin32().map((dir) => `-D${dir}`)
    );
    compilerFlags.addAll(interfaceMacros.getAll().map((dir) => `-D${dir}`));
    compilerFlags.addLinux(interfaceMacros.getLinux().map((dir) => `-D${dir}`));
    compilerFlags.addWin32(interfaceMacros.getWin32().map((dir) => `-D${dir}`));
    linkerFlags.addWin32(interfaceLinker.getWin32().map((dir) => `${dir}`));

    linkerFlags.addWin32("-lucrtd");
    linkerFlags.addWin32("-lvcruntimed");
    linkerFlags.addWin32("-lmsvcrtd");

    compilerFlags.addAll(includeDirs.getAll().map((dir) => `-I"${dir}"`));
    compilerFlags.addLinux(includeDirs.getLinux().map((dir) => `-I"${dir}"`));
    compilerFlags.addWin32(includeDirs.getWin32().map((dir) => `-I"${dir}"`));

    const platformCompilerFlags = compilerFlags.combineForPlatform();
    const platformLinkerFlags = linkerFlags.combineForPlatform();

    if (this.config.moduleType === ModuleType.Executable) {
      const compileFlags = platformCompilerFlags.join(" ");
      const linkFlags = [
        ...archives.map((l) => `"${l}"`),
        ...platformLinkerFlags,
      ].join(" ");

      const filePreamble = "// clang-format off\n\n";
      const filePostamble = "\n// clang-format on\n";
      await writeFile(
        paths.moduleCFile,
        filePreamble + (await readFile(paths.moduleCFile)) + filePostamble
      );

      const compileCmd = `"${HAZE_C_COMPILER}" "${paths.moduleCFile}" -c -o "${paths.moduleOFile}" ${compileFlags}`;

      compileCommands.push({
        directory: cwd(),
        file: paths.moduleCFile,
        command: compileCmd,
        output: paths.moduleOFile,
      });
      await this.writeCompileCommands(isTopLevelModule, compileCommands);

      if (this.verbose) {
        this.printCmd(compileCmd);
      }
      await execAsync(compileCmd);

      this.advancePhase(EModulePrintCompilerPhase.Linking);

      const linkCmd = `"${HAZE_C_COMPILER}" "${paths.moduleOFile}" -o "${paths.moduleExecutable}" ${linkFlags}`;
      if (this.verbose) {
        this.printCmd(linkCmd);
      }
      await execAsync(linkCmd);

      if (this.strip) {
        const stripCmd = `strip --strip-unneeded "${paths.moduleExecutable}"`;
        if (this.verbose) {
          this.printCmd(stripCmd);
        }
        await execAsync(stripCmd);
      }
    } else {
      const flags = `${platformCompilerFlags.join(" ")}`;
      const filePreamble = "// clang-format off\n\n";
      const filePostamble = "\n// clang-format on\n";
      await writeFile(
        paths.moduleCFile,
        filePreamble + (await readFile(paths.moduleCFile)) + filePostamble
      );

      const cmd = `"${HAZE_C_COMPILER}" "${paths.moduleCFile}" -c -o "${paths.moduleOFile}" ${flags}`;

      compileCommands.push({
        directory: cwd(),
        file: paths.moduleCFile,
        command: cmd,
        output: paths.moduleOFile,
      });
      await this.writeCompileCommands(isTopLevelModule, compileCommands);

      if (this.verbose) {
        this.printCmd(cmd);
      }
      await execAsync(cmd);

      // "c" tells ar not to print "ar: creating <file>" to stderr when the archive
      // doesn't exist yet -- that's an informational notice, not a warning/error,
      // but execAsync surfaces any non-empty stderr on a successful run.
      const archiveCmd =
        PLATFORM === Platform.Linux
          ? `"${ARCHIVE_TOOL}" rc "${paths.moduleAFile}" "${paths.moduleOFile}" > /dev/null`
          : `"${ARCHIVE_TOOL}" rc "${paths.moduleAFile}" "${paths.moduleOFile}" > NUL 2>&1`;
      if (this.verbose) {
        this.printCmd(archiveCmd);
      }
      await execAsync(archiveCmd);

      const makerel = (absolute: string) =>
        absolute
          .replaceAll("\\", "/")
          .replace(this.moduleDir.replaceAll("\\", "/") + "/build/", "");

      const moduleMetadata: ModuleMetadata = {
        compilerVersion: version,
        fileformatVersion: 1,
        name: this.config.name,
        id: this.config.id,
        version: this.config.version,
        libs: [
          {
            filename: makerel(paths.moduleAFile),
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
      await writeFile(
        paths.moduleMetadataFile,
        JSON.stringify(moduleMetadataSerialized, undefined, 2)
      );

      const importFile = ExportSymbols(sr);
      await writeFile(paths.importFilePath, importFile);

      if (fs.existsSync(paths.moduleOutputLib)) {
        fs.unlinkSync(paths.moduleOutputLib);
      }

      await createTarGz(
        `${this.moduleDir}/build`,
        [
          makerel(paths.moduleAFile),
          makerel(paths.importFilePath),
          makerel(paths.moduleMetadataFile),
        ],
        paths.moduleOutputLib
      );
    }
  }

  async build(isTopLevelModule: boolean, fullRebuild?: boolean) {
    return await catchErrors(async () => {
      this.currentModuleRootDir = this.config.configFilePath
        ? dirname(this.config.configFilePath)
        : process.cwd();

      await withEnv(
        {
          HAZE_WORKSPACE_DIR: this.hazeWorkspaceDirectory,
          HAZE_MODULE_SOURCE_DIR: this.currentModuleRootDir,
          HAZE_MODULE_BUILD_DIR: this.moduleDir + "/build",
          HAZE_MODULE_BINARY_DIR: this.moduleDir + "/bin",
          HAZE_MODULE_TMP_DIR: this.moduleDir + "/tmp",
          HAZE_MODULE_AUTOGEN_DIR: this.moduleDir + "/autogen",
          CC: HAZE_C_COMPILER,
          CXX: HAZE_CXX_COMPILER,
        },
        async () => {
          // Reset phase timer to now so that Parsing/Collecting/etc. durations
          // reflect actual work time, not time spent waiting for prior modules.
          this.markBuildStart();

          const buildCache = new ModuleBuildCache(
            path.join(
              this.hazeWorkspaceDirectory,
              "build-cache",
              `${this.config.name}.json`
            )
          );
          buildCache.load();

          const compilerFingerprint = this.computeCompilerFingerprint();
          const compilerKey = compilerFingerprint
            ? `${version}:${compilerFingerprint}`
            : `${version}`;
          const compilerKeyChanged =
            buildCache.getModuleCompilerKey(this.config.name) !== compilerKey;
          const forceFullRebuild = fullRebuild === true || compilerKeyChanged;

          // Embedded resource files (embed_file_text/embed_file_binary,
          // e.g. a .wgsl shader loaded via embed.watchText) are only
          // discovered by name during analysis below, which is exactly the
          // phase this check exists to decide whether to skip -- so this
          // has to reuse what the *previous* successful build already found
          // and recorded, rather than rediscovering them here.
          const initialRelevantFiles = [
            ...(await this.gatherModuleRelevantFiles()),
            ...buildCache.getModuleTrackedFiles(this.config.name),
          ];
          const generatorsNeedRun = forceFullRebuild
            ? true
            : this.generatorsNeedRun();
          const moduleChanged = forceFullRebuild
            ? true
            : buildCache.hasModuleChanged(
                this.config.name,
                initialRelevantFiles,
                compilerKey
              );

          if (!(moduleChanged || generatorsNeedRun)) {
            this.maybeStripExecutable();
            this.advancePhase(EModulePrintCompilerPhase.Done);
            return;
          }

          const generatorsRan = generatorsNeedRun
            ? await this.runAllGenerators(forceFullRebuild)
            : false;

          if (!(moduleChanged || generatorsRan)) {
            this.maybeStripExecutable();
            this.advancePhase(EModulePrintCompilerPhase.Done);
            return;
          }

          this.advancePhase(EModulePrintCompilerPhase.Collecting);
          await this.phaseCollect();

          this.advancePhase(EModulePrintCompilerPhase.Analyzing);
          const sr = this.phaseAnalyze();

          this.advancePhase(EModulePrintCompilerPhase.Lowering);
          const lowered = this.phaseLower(sr);

          const allModules: [string, string, string][] = [
            [this.config.name, this.config.version, this.config.id],
            ...(await this.loadDependencyModuleGraph()),
          ];

          const paths = this.computeBuildPaths();

          this.advancePhase(EModulePrintCompilerPhase.Generating);
          await this.phaseGenerate(lowered, allModules, paths);

          this.advancePhase(EModulePrintCompilerPhase.CCompiling);
          await this.phaseCCompile(sr, paths, allModules, isTopLevelModule);

          this.advancePhase(EModulePrintCompilerPhase.Done);

          // Now that analysis has actually run, sr.elaboratedEmbeddedFileTable
          // holds every embed_file_text/embed_file_binary'd resource file
          // this module referenced this build, with the exact absolute path
          // already resolved for embedding -- record those too, so a later
          // build's pre-analysis check (above) can tell one of them changed.
          const embeddedFiles = [
            ...sr.elaboratedEmbeddedFileTable.values(),
          ].map((data) => data.absolutePath);
          const finalRelevantFiles = [
            ...(await this.gatherModuleRelevantFiles()),
            ...embeddedFiles,
          ];
          buildCache.updateModule(
            this.config.name,
            finalRelevantFiles,
            compilerKey
          );
          buildCache.save();
        }
      );
    });
  }

  private async writeCompileCommands(
    isTopLevelModule: boolean,
    compileCommands: CompileCommands
  ) {
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
        JSON.stringify(cleanedCommands, null, 2)
      );
    } else {
      // Not top level module, so do a best effort of appending currently known commands, to at least get partial compile commands.

      const addedFiles = new Set<string>();
      let currentCommands: CompileCommands;
      const cleanedCommands: CompileCommands = [];
      try {
        currentCommands = JSON.parse(
          await readFile(
            `${this.hazeWorkspaceDirectory}/compile_commands.json`,
            "utf-8"
          )
        );
        for (const c of currentCommands) {
          if (!addedFiles.has(c.file)) {
            addedFiles.add(c.file);
            cleanedCommands.push(c);
          }
        }
      } catch {}

      for (const c of compileCommands) {
        if (!addedFiles.has(c.file)) {
          addedFiles.add(c.file);
          cleanedCommands.push(c);
        }
      }

      await writeFile(
        `${this.hazeWorkspaceDirectory}/compile_commands.json`,
        JSON.stringify(cleanedCommands, null, 2)
      );
    }
  }

  private async loadDependencyModuleGraph() {
    const metadata = await this.loadDependenciesMetadata();

    const modules: [string, string, string][] = [];

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
          `Lib ${meta.name} does not provide platform ${this.config.platform}`
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

    return [
      archives,
      linkerFlags,
      includeDirs,
      interfaceMacros,
      interfaceLinker,
    ] as const;
  }

  private async loadDependencyCompileCommands() {
    const metadata = await this.loadDependenciesMetadata();
    return metadata.flatMap((meta) => meta.compileCommands) ?? [];
  }

  private async loadDependenciesMetadata() {
    if (this.cachedDependencyMetadata) {
      return this.cachedDependencyMetadata;
    }

    const collected = new Map<
      string,
      Awaited<ReturnType<ModuleCompiler["loadSingleDependencyMetadata"]>>
    >();

    const collectOne = async (name: string) => {
      if (collected.has(name)) {
        return;
      }

      const libpath = join(
        join(this.hazeWorkspaceDirectory, name),
        "bin",
        name + ".hzlib"
      );
      if (!fs.existsSync(libpath)) {
        return;
      }

      const meta = await this.loadSingleDependencyMetadata(libpath, name);
      collected.set(name, meta);

      for (const [transName] of meta.fullModuleGraph) {
        await collectOne(transName);
      }
    };

    for (const dep of this.effectiveDependencies) {
      await collectOne(dep.name);
    }

    this.cachedDependencyMetadata = [...collected.values()];
    return this.cachedDependencyMetadata;
  }

  private async loadSingleDependencyMetadata(libpath: string, libname: string) {
    const tempdir = join(this.moduleDir, "__deps", libname);
    fs.mkdirSync(tempdir, { recursive: true });

    const libMtimeMs = fs.statSync(libpath).mtimeMs;
    if (!this.isExtractionCurrent(libname, libMtimeMs)) {
      await extractTarGz(libpath, tempdir);
      this.saveExtractionStamp(libname, libMtimeMs);
    }

    return parseModuleMetadata(
      await readFile(join(tempdir, "metadata.json"), "utf-8")
    );
  }

  async collectImports() {
    const collected = new Set<string>();

    const collectOne = async (name: string) => {
      if (collected.has(name)) {
        return;
      }
      collected.add(name);

      const libpath = join(
        join(this.hazeWorkspaceDirectory, name),
        "bin",
        name + ".hzlib"
      );
      if (!fs.existsSync(libpath)) {
        return;
      }

      const libMtimeMs = fs.statSync(libpath).mtimeMs;
      const meta = await this.loadSingleDependencyMetadata(libpath, name);
      const depDir = join(this.moduleDir, "__deps", name);
      await this.collectDepDirectory(depDir, name, libMtimeMs);

      // Transitively collect imports for every module whose types may appear
      // in this dep's public interface — consumers shouldn't need to list
      // transitive deps explicitly just because they show up in an import.hz.
      for (const [transName] of meta.fullModuleGraph) {
        await collectOne(transName);
      }
    };

    for (const dep of this.effectiveDependencies) {
      await collectOne(dep.name);
    }
  }

  async addInternalBuiltinSources() {
    // await this.collectDirectory(
    //   join(await getStdlibDirectory(), "internal"),
    //   ECollectionMode.ImportUnderRootDirectly,
    // );
    this.config.hzstdLocation = join(await getStdlibDirectory(), "core", "src");
    this.config.includeDirs.addAll(this.config.hzstdLocation);
  }
}
