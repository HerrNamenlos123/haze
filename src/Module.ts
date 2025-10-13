import * as child_process from "child_process";
import { $ } from "bun";
import os from "os";
import { Glob } from "bun";
import path from "path";
import { mkdir } from "fs/promises";
import {
  assert,
  CmdFailed,
  CompilerError,
  GeneralError,
  ImpossibleSituation,
  InternalError,
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
  statSync,
  writeFileSync,
} from "fs";
import { readdir, stat } from "fs/promises";
import { basename, dirname, extname, join } from "path";
import fs from "fs";
import { version } from "../package.json";
import {
  ConfigParser,
  ModuleType,
  parseModuleMetadata,
  type ModuleConfig,
  type ModuleMetadata,
  type ScriptDef,
} from "./shared/Config";
import { Parser } from "./Parser/Parser";
import {
  Collect,
  CollectFile,
  ECollectionMode,
  makeCollectionContext,
  PrettyPrintCollected,
  type CollectionContext,
} from "./SymbolCollection/SymbolCollection";
import { generateCode } from "./Codegen/CodeGenerator";
import { LowerModule } from "./Lower/Lower";
import { ExportCollectedSymbols } from "./SymbolCollection/Export";
import { Semantic } from "./Semantic/Elaborate";
import { stdout } from "process";
import { spawnSync } from "child_process";
import archiver from "archiver";
import tarFs from "tar-fs";
import gunzip from "gunzip-maybe";

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

  return new Promise<void>((resolve, reject) => {
    output.on("close", () => {
      // console.log(`Archive created: ${archive.pointer()} bytes`);
      resolve();
    });

    archive.on("error", (err) => reject(err));

    archive.pipe(output);

    // Add each file relative to cwd
    files.forEach((file) => {
      const fullPath = path.join(cwd, file);
      archive.file(fullPath, { name: file });
    });

    archive.finalize();
  });
}

async function extractTarGz(archivePath: string, destDir: string) {
  return new Promise<void>((resolve, reject) => {
    fs.createReadStream(archivePath)
      .pipe(gunzip())
      .pipe(tarFs.extract(destDir, {}))
      .on("finish", resolve)
      .on("error", reject);
  });
}

enum Platform {
  Win32,
  Linux,
}

let PLATFORM: Platform;
if (process.platform === "win32") {
  PLATFORM = Platform.Win32;
} else if (process.platform === "linux") {
  PLATFORM = Platform.Linux;
} else if (process.platform === "darwin") {
  throw new Error("MacOS not supported yet");
} else {
  throw new Error("Platform not supported yet: " + process.platform);
}

let LLVM_TOOLCHAIN_DOWNLOAD_URL: string;
if (PLATFORM === Platform.Win32) {
  LLVM_TOOLCHAIN_DOWNLOAD_URL =
    "https://github.com/llvm/llvm-project/releases/download/llvmorg-18.1.8/clang+llvm-18.1.8-x86_64-pc-windows-msvc.tar.xz";
} else {
  LLVM_TOOLCHAIN_DOWNLOAD_URL =
    "https://github.com/llvm/llvm-project/releases/download/llvmorg-18.1.8/clang+llvm-18.1.8-x86_64-linux-gnu-ubuntu-18.04.tar.xz";
}

export const HAZE_STDLIB_NAME = "haze-stdlib";

const HAZE_C_COMPILER = HAZE_GLOBAL_DIR + "/bin/clang";
const HAZE_CXX_COMPILER = HAZE_GLOBAL_DIR + "/bin/clang++";
const ARCHIVE_TOOL = PLATFORM === Platform.Linux ? "ar" : HAZE_GLOBAL_DIR + "/bin/llvm-ar.exe";
const HAZE_CONFIG_FILE = "haze.toml";
const HAZE_LIB_IMPORT_FILE = "import.hz";

export async function getFile(url: string, outfile: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  await Bun.write(outfile, new Uint8Array(buffer));
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
  try {
    const parser = new ConfigParser(HAZE_CONFIG_FILE, startDir);
    return await parser.parseConfig(sourceloc);
  } catch (e: unknown) {
    if (e instanceof GeneralError) {
      console.log(e.message);
    } else {
      console.error(e);
    }
    return;
  }
}

function getStdlibDirectory() {
  if (process.env.NODE_ENV === "production") {
    const whichHz = Bun.which("haze");
    if (!whichHz) {
      throw new GeneralError("Compiler not found in path");
    }
    const realHz = realpathSync(whichHz);
    return join(dirname(realHz), "stdlib/");
  } else {
    return join(__dirname, "../stdlib");
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

async function commandExists(cmd: string) {
  try {
    await $`command -v ${cmd}`;
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager() {
  if (await commandExists("apt-get")) return "debian";
  if (await commandExists("dnf")) return "fedora";
  if (await commandExists("yum")) return "rhel";
  if (await commandExists("zypper")) return "suse";

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
  workingDir: string
): string[] {
  const cache = loadCache(globalBuildDir);
  const changed: string[] = [];

  for (const pattern of globs) {
    const glob = new Glob(pattern);
    for (const file of glob.scanSync(workingDir)) {
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
    const glob = new Glob(pattern);
    for (const file of glob.scanSync(workingDir)) {
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
      const file = await Bun.file(filename).text();
      this.data = JSON.parse(file);
    }
  }

  async save() {
    if (!this.filename) {
      throw new ImpossibleSituation();
    } else {
      await Bun.write(this.filename, JSON.stringify(this.data, undefined, 2));
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
      ].map((f) => `${f.file}=${new Date(f.modified).toISOString()}`)
    );
    if (!this.data[name]) {
      return true;
    }
    const foundFiles = new Set(
      this.data[name]["files"].map(
        (f: { file: string; modified: string }) => `${f.file}=${new Date(f.modified).toISOString()}`
      )
    );
    if (foundFiles.difference(files).size !== 0) {
      return true;
    }
    return false;
  }
}

export function getCurrentPlatform() {
  if (PLATFORM === Platform.Linux) {
    return "linux-x64";
  } else {
    return "win32-x64";
  }
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
        linkerFlags: {
          any: [],
          linux: [],
          win32: [],
        },
        moduleType: ModuleType.Executable,
        nostdlib: false,
        platform: getCurrentPlatform(),
        name: basename(singleFilename),
        version: "0.0.0",
        scripts: {
          any: [],
          linux: [],
          win32: [],
        },
        srcDirectory: dirname(singleFilename),
        authors: undefined,
        description: undefined,
        license: undefined,
        compilerFlags: {
          any: [],
          linux: [],
          win32: [],
        },
        includeSourceloc: sourceloc ?? true,
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
      join(this.globalBuildDir, config.name)
    );

    if (!mainModule.config.nostdlib) {
      const stdlibConfig = await parseConfig(join(getStdlibDirectory(), "core"), sourceloc);
      if (!stdlibConfig) {
        return false;
      }
      const stdlibModule = new ModuleCompiler(
        stdlibConfig,
        this.cache,
        this.globalBuildDir,
        join(this.globalBuildDir, stdlibConfig.name)
      );
      if (!(await stdlibModule.build())) {
        return false;
      }
    }

    if (!singleFilename) {
      const deps = mainModule.config.dependencies;
      for (const dep of deps) {
        const depdir = join(getStdlibDirectory(), dep.path);

        const config = await parseConfig(depdir, sourceloc);
        if (!config) {
          return false;
        }

        const depModule = new ModuleCompiler(
          config,
          this.cache,
          this.globalBuildDir,
          join(this.globalBuildDir, config.name)
        );
        if (!(await depModule.build())) {
          return false;
        }
      }
    }

    if (!(await mainModule.build())) {
      return false;
    }
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
          `This module is a library and cannot be executed. Use 'haze build' to build it instead.`
        );
      }

      let moduleExecutable = join(join(this.globalBuildDir, config.name, "bin"), config.name);
      if (PLATFORM === Platform.Win32) {
        moduleExecutable += ".exe";
      }
      child_process.execSync(`"${moduleExecutable}" ${args?.join(" ")}`, {
        stdio: "inherit",
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

      const MARKERS = {
        download: HAZE_CACHE + "/01-download-marker",
        extract: HAZE_CACHE + "/02-extract-marker",
        finish: HAZE_CACHE + "/03-finish-marker",
        ncursesLib: HAZE_CACHE + "/ncurses-lib",
        musl: HAZE_CACHE + "/musl",
        winSDK: HAZE_CACHE + "/win-sdk",
        winNinja: HAZE_CACHE + "/win-ninja",
        cmakeToolchain: HAZE_CACHE + "/cmake-toolchain",
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
        await exec(
          `tar -xf "${HAZE_TMP_DIR + "/llvm.tar.xz"}" -C "${HAZE_GLOBAL_DIR}" --strip-components=1`
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
        await exec(`rm -f ${HAZE_GLOBAL_DIR}/lib/libtinfo.so.5`);
        if (packageManager === "debian") {
          await exec(`rm -f ${HAZE_TMP_DIR}/libtinfo5_6.1-1ubuntu1_amd64.deb*`);
          await exec(
            `cd ${HAZE_TMP_DIR} && wget http://archive.ubuntu.com/ubuntu/pool/main/n/ncurses/libtinfo5_6.1-1ubuntu1_amd64.deb`
          );
          await exec(
            `dpkg-deb -x ${HAZE_TMP_DIR}/libtinfo5_6.1-1ubuntu1_amd64.deb ${HAZE_GLOBAL_DIR}`
          );
          await exec(
            `cd ${HAZE_GLOBAL_DIR + "/lib"} && ln -s x86_64-linux-gnu/libtinfo.so.5 libtinfo.so.5`
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
          await exec(`rm -f ${HAZE_TMP_DIR}/libtinfo5_6.1-1ubuntu1_amd64.deb*`);
          await exec(
            `cd ${HAZE_TMP_DIR} && wget http://archive.ubuntu.com/ubuntu/pool/main/n/ncurses/libtinfo5_6.1-1ubuntu1_amd64.deb`
          );
          await exec(`cd ${HAZE_TMP_DIR} && ar x libtinfo5_6.1-1ubuntu1_amd64.deb`);
          await exec(`cd ${HAZE_TMP_DIR} && tar -xf data.tar.xz -C ${HAZE_GLOBAL_DIR}`);
          await exec(
            `cd ${HAZE_GLOBAL_DIR + "/lib"} && ln -s x86_64-linux-gnu/libtinfo.so.5 libtinfo.so.5`
          );
        } else {
          throw new CompilerError(
            "This Distro/Package Manager is not supported yet, please report",
            null
          );
        }
        this.markStepDone(MARKERS.ncursesLib);
        console.info("Retrieving libtinfo.so.5... Done");
      }

      if (!this.isStepDone(MARKERS.winSDK) && PLATFORM === Platform.Win32) {
        console.info("Installing Windows SDK...");
        execInherit(
          `powershell -NoLogo -NoProfile -Command \\"if (-not (winget list --name 'Visual Studio Community 2022' | Select-String 'Visual Studio Community 2022')) { winget install 'Visual Studio Community 2022' --override '--add Microsoft.VisualStudio.Workload.NativeDesktop Microsoft.VisualStudio.ComponentGroup.WindowsAppSDK.Cpp' -s msstore } else { Write-Host 'Visual Studio already installed.' }\\"`
        );
        this.markStepDone(MARKERS.winSDK);
        console.info("Installing Windows SDK... Done");
      }

      if (!this.isStepDone(MARKERS.winNinja) && PLATFORM === Platform.Win32) {
        console.info("Installing Ninja Build System...");
        execInherit(
          `powershell -NoLogo -NoProfile -Command "if (-not (winget list --id 'Ninja-build.Ninja' | Select-String 'Ninja-build.Ninja')) { winget install 'Ninja-build.Ninja' } else { Write-Host 'Ninja already installed.'; exit 0 }"`
        );
        this.markStepDone(MARKERS.winNinja);
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

      // throw new Error();
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

function execInherit(str: string, dir?: string) {
  let shell = PLATFORM === Platform.Win32 ? "C:\\Windows\\System32\\cmd.exe" : "/bin/sh";
  const args = PLATFORM === Platform.Win32 ? ["/d", "/s", "/c", `${str}`] : ["-c", `"${str}"`];

  if (dir) {
    fs.mkdirSync(dir, {
      recursive: true,
    });
  }
  const proc = spawnSync(shell, [...args], {
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

class ModuleCompiler {
  cc: CollectionContext;

  constructor(
    public config: ModuleConfig,
    public cache: Cache,
    public globalBuildDir: string,
    public moduleDir: string
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
    const fileText = await Bun.file(filepath).text();
    const ast = Parser.parseTextToAST(this.config, fileText, filepath);
    CollectFile(
      this.cc,
      ast,
      this.cc.moduleScopeId,
      filepath,
      this.config.name,
      this.config.version,
      collectionMode
    );
  }

  async collectDirectory(dirpath: string, collectionMode: ECollectionMode) {
    for (const file of readdirSync(dirpath)) {
      const fullPath = join(dirpath, file);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        this.collectDirectory(fullPath, collectionMode);
      } else {
        if (extname(fullPath) == ".hz") {
          const fileText = await Bun.file(fullPath).text();
          const ast = Parser.parseTextToAST(this.config, fileText, fullPath);
          CollectFile(
            this.cc,
            ast,
            collectionMode === ECollectionMode.WrapIntoModuleNamespace
              ? this.makeUnit()[1]
              : this.cc.moduleScopeId,
            fullPath,
            this.config.name,
            this.config.version,
            collectionMode
          );
        }
      }
    }
  }

  async addProjectSourceFiles() {
    let mode = ECollectionMode.WrapIntoModuleNamespace;
    if (this.config.name === HAZE_STDLIB_NAME) {
      mode = ECollectionMode.ImportUnderRootDirectly;
    }
    await this.collectDirectory(this.config.srcDirectory, mode);
  }

  async build() {
    return await catchErrors(async () => {
      if (this.config.configFilePath) {
        if (
          !(await this.cache.hasModuleChanged(
            this.config.name,
            this.config.srcDirectory,
            this.config.configFilePath
          ))
        ) {
          console.log(`Skipping module ${this.config.name}`);
          return;
        } else {
          console.log(`Building module ${this.config.name}`);
        }
      }

      const MODULE_SOURCE_DIR = this.config.configFilePath
        ? dirname(this.config.configFilePath)
        : process.cwd();

      const env = process.env as any;
      env.HAZE_MODULE_SOURCE_DIR = MODULE_SOURCE_DIR;
      env.HAZE_MODULE_BUILD_DIR = this.moduleDir + "/build";
      env.HAZE_MODULE_BINARY_DIR = this.moduleDir + "/bin";
      env.CC = HAZE_C_COMPILER;
      env.CXX = HAZE_CXX_COMPILER;

      if (this.config.configFilePath) {
        const runPrebuildScript = async (script: ScriptDef) => {
          const exec = () => execInherit(script.command, this.moduleDir + "/build");

          if (script.depends === null) {
            exec();
          } else {
            const changed = checkForChanges(script.depends, this.globalBuildDir, MODULE_SOURCE_DIR);
            if (changed.length > 0) {
              try {
                exec();
              } catch (e) {
                invalidateChangeCache(script.depends, this.globalBuildDir, MODULE_SOURCE_DIR);
                throw e;
              }
            } else {
              console.log(`Skipping prebuild step for '${this.config.name}': No changes detected`);
            }
          }
        };

        const prebuildScript = this.config.scripts.any.find((s) => s.name === "prebuild");
        if (prebuildScript) await runPrebuildScript(prebuildScript);

        if (PLATFORM === Platform.Win32) {
          const prebuildScript = this.config.scripts.win32.find((s) => s.name === "prebuild");
          if (prebuildScript) await runPrebuildScript(prebuildScript);
        }
        if (PLATFORM === Platform.Linux) {
          const prebuildScript = this.config.scripts.linux.find((s) => s.name === "prebuild");
          if (prebuildScript) await runPrebuildScript(prebuildScript);
        }
      }

      await this.addInternalBuiltinSources();
      await this.collectImports();
      await this.addProjectSourceFiles();

      // PrettyPrintCollected(this.cc);

      const sr = Semantic.SemanticallyAnalyze(
        this.cc,
        this.config.moduleType === ModuleType.Library,
        this.config.name,
        this.config.version
      );
      // Semantic.PrettyPrintAnalyzed(sr);
      const lowered = LowerModule(sr);

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

      const code = generateCode(this.config, lowered);
      await Bun.file(moduleCFile).write(code);

      const compilerFlags = this.config.compilerFlags;
      const linkerFlags = this.config.linkerFlags;
      compilerFlags.any.push("-Wno-parentheses-equality");
      compilerFlags.any.push("-Wno-extra-tokens");

      compilerFlags.any.push(`-I"${this.moduleDir}/bin/include"`);
      linkerFlags.any.push(`-L"${this.moduleDir}/bin/lib"`);
      linkerFlags.any.push(`-L"${this.moduleDir}/bin/lib64"`);

      compilerFlags.win32.push(`-D_CRT_SECURE_NO_WARNINGS`);
      linkerFlags.win32.push(`-fuse-ld=lld`);

      compilerFlags.linux.push("-fPIC");

      // MUSL Sysroot Settings
      // compilerFlags.push(`--sysroot=${HAZE_MUSL_SYSROOT}`);
      // linkerFlags.push(`--sysroot=${HAZE_MUSL_SYSROOT}`);
      // compilerFlags.push("-static");
      // compilerFlags.push("-nostdlib");
      // compilerFlags.push("-nostartfiles");
      // compilerFlags.push(`-isystem ${HAZE_MUSL_SYSROOT}/include`);
      // linkerFlags.push(`-L${HAZE_MUSL_SYSROOT}/lib`);
      // linkerFlags.push(`${HAZE_MUSL_SYSROOT}/lib/crt1.o`);
      // linkerFlags.push(`${HAZE_MUSL_SYSROOT}/lib/crti.o`);
      // linkerFlags.push(`${HAZE_MUSL_SYSROOT}/lib/crtn.o`);
      // linkerFlags.push(`-lc`);

      const allCompilerFlags = [...compilerFlags.any];
      if (PLATFORM === Platform.Win32) {
        allCompilerFlags.push(...compilerFlags.win32);
      }
      if (PLATFORM === Platform.Linux) {
        allCompilerFlags.push(...compilerFlags.linux);
      }

      if (this.config.moduleType === ModuleType.Executable) {
        const [libs, dependencyLinkerFlags] = await this.loadDependencyBinaries();

        linkerFlags.any.push(...dependencyLinkerFlags.any);
        linkerFlags.win32.push(...dependencyLinkerFlags.win32);
        linkerFlags.linux.push(...dependencyLinkerFlags.linux);

        const allLinkerFlags = [...linkerFlags.any];
        if (PLATFORM === Platform.Win32) {
          allLinkerFlags.push(...linkerFlags.win32);
        }
        if (PLATFORM === Platform.Linux) {
          allLinkerFlags.push(...linkerFlags.linux);
        }

        const cmd = `"${HAZE_C_COMPILER}" -g "${moduleCFile}" -o "${moduleExecutable}" -I"${
          this.config.srcDirectory
        }" ${libs.map((l) => `"${l}"`).join(" ")} ${allCompilerFlags.join(
          " "
        )} ${allLinkerFlags.join(" ")} -std=c11`;
        // console.log(cmd);
        await exec(cmd);
      } else {
        const cmd = `"${HAZE_C_COMPILER}" -g "${moduleCFile}" -c -o "${moduleOFile}" -I"${
          this.config.srcDirectory
        }" ${allCompilerFlags.join(" ")} -std=c11`;
        // console.log(cmd);
        await exec(cmd);

        // if (fs.existsSync(moduleAFile)) {
        //   await exec(`rm ${moduleAFile}`);
        // }

        if (PLATFORM === Platform.Linux) {
          await exec(`"${ARCHIVE_TOOL}" r "${moduleAFile}" "${moduleOFile}" > /dev/null`);
        } else {
          await exec(`"${ARCHIVE_TOOL}" r "${moduleAFile}" "${moduleOFile}" > NUL 2>&1`);
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
          importFile: HAZE_LIB_IMPORT_FILE,
        };
        await Bun.write(moduleMetadataFile, JSON.stringify(moduleMetadata, undefined, 2));

        const importFile = ExportCollectedSymbols(this.cc);
        await Bun.write(importFilePath, importFile);

        if (fs.existsSync(moduleOutputLib)) {
          fs.unlinkSync(moduleOutputLib);
        }

        await createTarGz(
          `${this.moduleDir}/build`,
          [makerel(moduleAFile), makerel(importFilePath), makerel(moduleMetadataFile)],
          moduleOutputLib
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

  private async loadDependencyBinaries() {
    const libs: string[] = [];
    const linkerFlags = {
      any: [] as string[],
      win32: [] as string[],
      linux: [] as string[],
    };

    const deps = [...this.config.dependencies];
    if (this.config.name !== HAZE_STDLIB_NAME && !this.config.nostdlib) {
      deps.push({
        name: HAZE_STDLIB_NAME,
        path: HAZE_STDLIB_NAME,
      });
    }

    for (const dep of deps) {
      const libpath = join(join(this.globalBuildDir, dep.name), "bin", dep.name + ".hzlib");
      const metadata = await this.loadDependencyMetadata(libpath, dep.name);

      const lib = metadata.libs.find((l) => l.platform === this.config.platform);
      if (!lib) {
        throw new GeneralError(`Lib ${dep.name} does not provide platform ${this.config.platform}`);
      }

      const tempdir = join(this.moduleDir, "__deps", dep.name);
      const archiveFile = join(tempdir, lib.filename);
      libs.push(archiveFile);
      linkerFlags.any.push(...metadata.linkerFlags.any);
      linkerFlags.win32.push(...metadata.linkerFlags.win32);
      linkerFlags.linux.push(...metadata.linkerFlags.linux);
    }
    return [libs, linkerFlags] as const;
  }

  private async loadDependencyMetadata(libpath: string, libname: string) {
    const tempdir = join(this.moduleDir, "__deps", libname);
    fs.mkdirSync(tempdir, { recursive: true });
    await extractTarGz(libpath, tempdir);
    return parseModuleMetadata(await Bun.file(join(tempdir, "metadata.json")).text());
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
      const libpath = join(join(this.globalBuildDir, dep.name), "bin", dep.name + ".hzlib");
      const metadata = await this.loadDependencyMetadata(libpath, dep.name);
      await this.collectDirectory(
        join(this.moduleDir, "__deps", dep.name),
        ECollectionMode.ImportUnderRootDirectly
      );
    }
  }

  private async addInternalBuiltinSources() {
    await this.collectDirectory(
      join(getStdlibDirectory(), "internal"),
      ECollectionMode.ImportUnderRootDirectly
    );
    this.config.compilerFlags.any.push(`-I"${join(getStdlibDirectory(), "core", "src")}"`);
  }
}
