import * as child_process from "child_process";
import os from "os";
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
} from "./shared/Config";
import { Parser } from "./Parser/Parser";
import {
  Collect,
  CollectFile,
  ECollectionMode,
  makeCollectionContext,
  makeSymbol,
  PrettyPrintCollected,
  type CollectionContext,
} from "./SymbolCollection/SymbolCollection";
import { generateCode } from "./Codegen/CodeGenerator";
import { LowerModule } from "./Lower/Lower";
import { ExportCollectedSymbols } from "./SymbolCollection/Export";
import { Semantic } from "./Semantic/Elaborate";
import { stdout } from "process";

export const HAZE_DIR = os.homedir() + "/.haze/";
export const HAZE_CACHE = HAZE_DIR + "cache/";
export const HAZE_TOOLCHAIN_INSTALLED_MARKER = HAZE_CACHE + "toolchain-installed.json";
export const HAZE_GLOBAL_DIR = HAZE_DIR + "global/";
export const HAZE_TMP_DIR = HAZE_DIR + "tmp/";

const LLVM_TOOLCHAIN_DOWNLOAD_URL =
  "https://github.com/llvm/llvm-project/releases/download/llvmorg-18.1.8/clang+llvm-18.1.8-x86_64-linux-gnu-ubuntu-18.04.tar.xz";

export const HAZE_STDLIB_NAME = "haze-stdlib";

const C_COMPILER = HAZE_GLOBAL_DIR + "bin/clang";
const ARCHIVE_TOOL = "ar";
const HAZE_CONFIG_FILE = "haze.toml";
const HAZE_LIB_IMPORT_FILE = "import.hz";

export function makeModulePrefix(config: ModuleConfig) {
  return config.name + "." + config.version.replaceAll(".", "_");
}

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
        linkerFlags: [],
        moduleType: ModuleType.Executable,
        nostdlib: false,
        platform: "linux-x64",
        name: basename(singleFilename),
        version: "0.0.0",
        scripts: [],
        srcDirectory: dirname(singleFilename),
        authors: undefined,
        description: undefined,
        license: undefined,
        compilerFlags: [],
        includeSourceloc: sourceloc ?? true,
      };
    }
    return config;
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

      if (config?.moduleType === ModuleType.Library) {
        throw new GeneralError(
          `This module is a library and cannot be executed. Use 'haze build' to build it instead.`
        );
      }

      const moduleExecutable = join(join(this.globalBuildDir, config.name, "output"), config.name);
      child_process.execSync(`${moduleExecutable} ${args?.join(" ")}`, {
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
        // ncursesDownload: HAZE_CACHE + "/ncurses-download-marker",
        // ncursesExtract: HAZE_CACHE + "/ncurses-extract-marker",
        // ncursesConfigure: HAZE_CACHE + "/ncurses-configure-marker",
        // ncursesBuild: HAZE_CACHE + "/ncurses-build-marker",
        // ncursesInstall: HAZE_CACHE + "/ncurses-install-marker",
        ncursesLib: HAZE_CACHE + "/ncurses-lib",
      };

      // Step 1: Download
      if (!this.isStepDone(MARKERS.download)) {
        console.info("Downloading LLVM toolchain...");
        await getFileWithProgress(LLVM_TOOLCHAIN_DOWNLOAD_URL, HAZE_TMP_DIR + "llvm.tar.xz");
        this.markStepDone(MARKERS.download);
        console.info("Downloading LLVM toolchain... Done");
      }

      // Step 2: Extract
      if (!this.isStepDone(MARKERS.extract)) {
        console.info("Extracting LLVM toolchain...");
        await exec(
          `tar -xf ${HAZE_TMP_DIR + "llvm.tar.xz"} -C ${HAZE_GLOBAL_DIR} --strip-components=1`
        );
        this.markStepDone(MARKERS.extract);
        console.info("Extracting LLVM toolchain... Done");
      }

      // Step 3: Finish
      if (!this.isStepDone(MARKERS.finish)) {
        this.markStepDone(MARKERS.finish);
        console.info("Toolchain setup finished.");
      }

      // if (!this.isStepDone(MARKERS.ncursesDownload)) {
      //   console.info("Downloading ncurses source...");
      //   await getFileWithProgress(
      //     "https://ftp.gnu.org/pub/gnu/ncurses/ncurses-5.9.tar.gz",
      //     HAZE_TMP_DIR + "ncurses.tar.gz"
      //   );
      //   this.markStepDone(MARKERS.ncursesDownload);
      //   console.info("Downloading ncurses source... Done");
      // }

      // if (!this.isStepDone(MARKERS.ncursesExtract)) {
      //   console.info("Extracting ncurses source...");
      //   if (!existsSync(`${HAZE_TMP_DIR}/ncurses/src/`))
      //     mkdirSync(`${HAZE_TMP_DIR}/ncurses/src/`, { recursive: true });
      //   await exec(
      //     `tar -xf ${
      //       HAZE_TMP_DIR + "ncurses.tar.gz"
      //     } -C ${HAZE_TMP_DIR}/ncurses/src/ --strip-components=1`
      //   );
      //   this.markStepDone(MARKERS.ncursesExtract);
      //   console.info("Extracting ncurses source... Done");
      // }

      // if (!this.isStepDone(MARKERS.ncursesConfigure)) {
      //   console.info("Configure ncurses...");
      //   await exec(
      //     `cd ${
      //       HAZE_TMP_DIR + "/ncurses/src/"
      //     } && ./configure --prefix=${HAZE_GLOBAL_DIR} --with-shared --with-termlib --with-xterm-kbs=DEL`
      //   );
      //   this.markStepDone(MARKERS.ncursesConfigure);
      //   console.info("Configure ncurses... Done");
      // }

      // if (!this.isStepDone(MARKERS.ncursesBuild)) {
      //   console.info("Building ncurses...");
      //   await exec(`cd ${HAZE_TMP_DIR + "/ncurses/src/"} && make -j$(nproc)`);
      //   this.markStepDone(MARKERS.ncursesBuild);
      //   console.info("Building ncurses... Done");
      // }

      // if (!this.isStepDone(MARKERS.ncursesInstall)) {
      //   console.info("Installing ncurses...");
      //   await exec(`cd ${HAZE_TMP_DIR + "/ncurses/src/"} && make install`);
      //   await exec(`cd ${HAZE_GLOBAL_DIR + "/lib"} && ln -s libtinfo.so.6 libtinfo.so.5`);
      //   this.markStepDone(MARKERS.ncursesInstall);
      //   console.info("Installing ncurses... Done");
      // }

      if (!this.isStepDone(MARKERS.ncursesLib)) {
        console.info("Retrieving libtinfo.so.5...");
        mkdirSync(`${HAZE_TMP_DIR}/`, { recursive: true });
        await exec(`rm -f ${HAZE_TMP_DIR}libtinfo5_6.1-1ubuntu1_amd64.deb*`);
        await exec(`rm -f ${HAZE_GLOBAL_DIR}/lib/libtinfo.so.5`);
        await exec(
          `cd ${HAZE_TMP_DIR} && wget http://archive.ubuntu.com/ubuntu/pool/main/n/ncurses/libtinfo5_6.1-1ubuntu1_amd64.deb`
        );
        await exec(
          `dpkg-deb -x ${HAZE_TMP_DIR}/libtinfo5_6.1-1ubuntu1_amd64.deb ${HAZE_GLOBAL_DIR}`
        );
        await exec(
          `cd ${HAZE_GLOBAL_DIR + "/lib"} && ln -s x86_64-linux-gnu/libtinfo.so.5 libtinfo.so.5`
        );
        this.markStepDone(MARKERS.ncursesLib);
        console.info("Retrieving libtinfo.so.5... Done");
      }

      // throw new Error();
    });
  }
}

async function exec(str: string) {
  try {
    child_process.execSync(str);
  } catch (e) {
    throw new CmdFailed();
  }
}

class ModuleCompiler {
  cc: CollectionContext;

  constructor(
    public config: ModuleConfig,
    public cache: Cache,
    public globalBuildDir: string,
    public moduleBuildDir: string
  ) {
    this.cc = makeCollectionContext(this.config);
  }

  private makeUnit() {
    const [unit, unitId] = makeSymbol(this.cc, {
      variant: Collect.ENode.UnitScope,
      parentScope: 0 as Collect.Id,
      symbols: new Set(),
    });
    const moduleScope = this.cc.nodes.get(0 as Collect.Id);
    assert(moduleScope.variant === Collect.ENode.ModuleScope);
    moduleScope.symbols.add(unitId);
    return [unit, unitId] as const;
  }

  async collectFileAsRoot(filepath: string, collectionMode: ECollectionMode) {
    const fileText = await Bun.file(filepath).text();
    const ast = Parser.parseTextToAST(this.config, fileText, filepath);
    CollectFile(
      this.cc,
      ast,
      0 as Collect.Id,
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
              : (0 as Collect.Id),
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

      await this.addInternalBuiltinSources();
      await this.collectImports();
      await this.addProjectSourceFiles();

      PrettyPrintCollected(this.cc);

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
      const moduleCFile = join(this.moduleBuildDir, `build/${name}-${platform}.c`);
      const moduleOFile = join(this.moduleBuildDir, `build/${name}-${platform}.o`);
      const moduleAFile = join(this.moduleBuildDir, `build/${name}-${platform}.a`);
      const moduleExecutable = join(this.moduleBuildDir, `output/${name}`);

      const moduleMetadataFile = join(this.moduleBuildDir, "build/metadata.json");
      const moduleOutputLib = join(this.moduleBuildDir, "output/" + this.config.name + ".hzlib");
      const importFilePath = join(this.moduleBuildDir, "build", HAZE_LIB_IMPORT_FILE);

      await mkdir(join(this.moduleBuildDir, "build/"), { recursive: true });
      await mkdir(join(this.moduleBuildDir, "output/"), { recursive: true });

      const code = generateCode(this.config, lowered);
      await Bun.file(moduleCFile).write(code);

      const compilerFlags = this.config.compilerFlags;
      compilerFlags.push("-Wno-parentheses-equality");
      compilerFlags.push("-Wno-extra-tokens");
      if (this.config.moduleType === ModuleType.Executable) {
        const [libs, linkerFlags] = await this.loadDependencyBinaries();
        const allLinkerFlags = [...linkerFlags, ...this.config.linkerFlags];
        const cmd = `${C_COMPILER} -g ${moduleCFile} -o ${moduleExecutable} -I${
          this.config.srcDirectory
        } ${libs.join(" ")} ${compilerFlags.join(" ")} ${allLinkerFlags.join(" ")} -std=c11`;
        // console.log(cmd);
        await exec(cmd);
      } else {
        const cmd = `${C_COMPILER} -g ${moduleCFile} -c -o ${moduleOFile} -I${
          this.config.srcDirectory
        } ${compilerFlags.join(" ")} -fPIC -std=c11`;
        // console.log(cmd);
        await exec(cmd);

        // if (fs.existsSync(moduleAFile)) {
        //   await exec(`rm ${moduleAFile}`);
        // }

        await exec(`${ARCHIVE_TOOL} r ${moduleAFile} ${moduleOFile} > /dev/null`);

        const makerel = (absolute: string) => {
          return absolute.replace(this.moduleBuildDir + "/build/", "");
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
          await exec(`rm ${moduleOutputLib}`);
        }

        await exec(
          `tar -C ${this.moduleBuildDir}/build -cvzf ${moduleOutputLib} ${makerel(
            moduleAFile
          )} ${makerel(importFilePath)} ${makerel(moduleMetadataFile)} > /dev/null`
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
    const linkerFlags: string[] = [];

    const deps = [...this.config.dependencies];
    if (this.config.name !== HAZE_STDLIB_NAME && !this.config.nostdlib) {
      deps.push({
        name: HAZE_STDLIB_NAME,
        path: HAZE_STDLIB_NAME,
      });
    }

    for (const dep of deps) {
      const libpath = join(join(this.globalBuildDir, dep.name), "output", dep.name + ".hzlib");
      const metadata = await this.loadDependencyMetadata(libpath, dep.name);

      const lib = metadata.libs.find((l) => l.platform === this.config.platform);
      if (!lib) {
        throw new GeneralError(`Lib ${dep.name} does not provide platform ${this.config.platform}`);
      }

      const tempdir = join(this.moduleBuildDir, "__deps", dep.name);
      await exec(`mkdir -p ${tempdir}`);
      await exec(`tar -xzf ${libpath} -C ${tempdir} ${lib.filename}`);

      const archiveFile = join(tempdir, lib.filename);
      libs.push(archiveFile);
      linkerFlags.push(...metadata.linkerFlags);
    }
    return [libs, linkerFlags];
  }

  private async loadDependencyMetadata(libpath: string, libname: string) {
    const tempdir = join(this.moduleBuildDir, "__deps", libname);
    await exec(`mkdir -p ${tempdir}`);
    await exec(`tar -xzf ${libpath} -C ${tempdir} metadata.json`);
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
      const libpath = join(join(this.globalBuildDir, dep.name), "output", dep.name + ".hzlib");
      const metadata = await this.loadDependencyMetadata(libpath, dep.name);

      const tempdir = join(this.moduleBuildDir, "__deps", dep.name, "import");
      await exec(`mkdir -p ${tempdir}`);
      await exec(`tar -xzf ${libpath} -C ${tempdir} ${metadata.importFile}`);

      await this.collectDirectory(join(tempdir), ECollectionMode.ImportUnderRootDirectly);
    }
  }

  private async addInternalBuiltinSources() {
    await this.collectDirectory(
      join(getStdlibDirectory(), "internal"),
      ECollectionMode.ImportUnderRootDirectly
    );
  }
}
