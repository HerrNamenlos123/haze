import * as child_process from "child_process";
import { $ } from "bun";
import { Parser } from "./parser";
import {
  CompilerError,
  GeneralError,
  ImpossibleSituation,
  InternalError,
  UnreachableCode,
} from "./shared/Errors";
import { Module } from "./Module";
import { readdirSync, realpathSync, statSync } from "fs";
import { readdir, stat } from "fs/promises";
import { basename, dirname, extname, join } from "path";
import fs from "fs";
import { version } from "../package.json";
import { OutputWriter } from "./Codegen/OutputWriter";
import {
  ConfigParser,
  ModuleType,
  parseModuleMetadata,
  type ModuleConfig,
  type ModuleMetadata,
} from "./shared/Config";

const C_COMPILER = "clang";
const ARCHIVE_TOOL = "ar";
const HAZE_STDLIB_NAME = "haze-stdlib";

function listFiles(dir: string): string[] {
  let files: string[] = [];

  const items = fs.readdirSync(dir);

  items.forEach((item) => {
    const fullPath = join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files = [...files, ...listFiles(fullPath)]; // Recursively add files from subdirectories
    } else {
      files.push(fullPath);
    }
  });

  return files;
}

const HAZE_CONFIG_FILE = "haze.toml";

async function parseConfig(startDir?: string) {
  try {
    const parser = new ConfigParser(HAZE_CONFIG_FILE, startDir);
    return await parser.parseConfig();
  } catch (e: unknown) {
    if (e instanceof GeneralError) {
      console.log(e.message);
    } else {
      console.error(e);
    }
    return;
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

export class ProjectCompiler {
  cache: Cache = new Cache();

  constructor() {}

  async getConfig(singleFilename?: string) {
    let config: ModuleConfig | undefined;
    if (!singleFilename) {
      config = await parseConfig();
    } else {
      config = {
        buildDir: join(process.cwd(), "__haze__"),
        configFilePath: undefined,
        dependencies: [],
        linkerFlags: [],
        moduleType: ModuleType.Executable,
        nostdlib: false,
        platform: "linux-x64",
        projectName: basename(singleFilename),
        projectVersion: "0.0.0",
        scripts: [],
        srcDirectory: dirname(singleFilename),
        projectAuthors: undefined,
        projectDescription: undefined,
        projectLicense: undefined,
        compilerFlags: [],
      };
    }
    return config;
  }

  async build(singleFilename?: string) {
    const config = await this.getConfig(singleFilename);
    if (!config) {
      return false;
    }
    if (!singleFilename) {
      await this.cache.load(join(config.buildDir, "cache.json"));
    }
    const mainModule = new ModuleCompiler(config, this.cache);

    console.log("starting in ", join(mainModule.getStdlibDirectory(), "core"));
    const stdlibConfig = await parseConfig(join(mainModule.getStdlibDirectory(), "core"));
    if (!stdlibConfig) {
      return false;
    }
    const stdlibModule = new ModuleCompiler(stdlibConfig, this.cache, mainModule.globalBuildDir);
    if (!(await stdlibModule.build())) {
      return false;
    }

    if (!singleFilename) {
      const deps = mainModule.module.moduleConfig.dependencies;
      for (const dep of deps) {
        const depdir = join(mainModule.getStdlibDirectory(), dep.path);

        const config = await parseConfig(depdir);
        if (!config) {
          return false;
        }

        const depModule = new ModuleCompiler(config, this.cache, mainModule.globalBuildDir);
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

  async run(singleFilename?: string, args?: string[]): Promise<number> {
    try {
      const config = await this.getConfig(singleFilename);
      if (!config) {
        return -1;
      }

      if (config?.moduleType === ModuleType.Library) {
        throw new GeneralError(
          `This module is a library and cannot be executed. Use 'hz build' to build it.`,
        );
      }

      const moduleBuildDir = join(config.buildDir, config.projectName);
      const moduleExecutable = join(moduleBuildDir, config.projectName);
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
}

class ModuleCompiler {
  module: Module;
  globalBuildDir: string;
  moduleBuildDir: string;
  cache: Cache;

  constructor(moduleConfig: ModuleConfig, cache: Cache, globalBuildDir?: string) {
    this.module = new Module(moduleConfig);
    this.cache = cache;
    if (!globalBuildDir) {
      this.globalBuildDir = moduleConfig.buildDir;
      this.moduleBuildDir = join(moduleConfig.buildDir, moduleConfig.projectName);
    } else {
      this.globalBuildDir = globalBuildDir;
      this.moduleBuildDir = join(globalBuildDir, moduleConfig.projectName);
    }
  }

  getStdlibDirectory() {
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

  async loadInternals() {
    const internal = await Bun.file(
      join(join(this.getStdlibDirectory(), "internal"), "internal.hz"),
    ).text();
    const parser = new Parser();
    const ast = await parser.parse(internal, "internal.hz");
    if (!ast) {
      throw new GeneralError("Parsing failed");
    }
    this.module.ast = ast;
    this.module.collector.collect(ast, parser, "internal.hz");
  }

  async loadDependencyMetadata(libpath: string, libname: string) {
    const tempdir = join(this.globalBuildDir, "temp-" + libname);
    await $`mkdir -p ${tempdir}`;
    await $`tar -xzf ${libpath} -C ${tempdir} metadata.json`;
    return parseModuleMetadata(await Bun.file(join(tempdir, "metadata.json")).text());
  }

  async importDeps() {
    const deps = this.module.moduleConfig.dependencies;
    if (this.module.moduleConfig.projectName !== HAZE_STDLIB_NAME) {
      deps.push({
        name: HAZE_STDLIB_NAME,
        path: HAZE_STDLIB_NAME,
      });
    }
    for (const dep of deps) {
      const libpath = join(join(this.globalBuildDir, dep.path), dep.path + ".hzlib");
      const metadata = await this.loadDependencyMetadata(libpath, dep.path);

      const declarations = new OutputWriter();
      for (const decl of metadata.exportedDeclarations) {
        declarations.writeLine(decl);
      }

      const parser = new Parser();
      const ast = await parser.parse(declarations.get(), dep.name + ".hzlib");
      if (!ast) {
        throw new GeneralError("Parsing failed");
      }
      this.module.ast = ast;
      this.module.collector.collect(ast, parser, dep.name + ".hzlib");
    }
  }

  async loadSources() {
    const sources = [] as string[];
    const files = readdirSync(this.module.moduleConfig.srcDirectory);
    const sortedFiles = files.sort((a, b) => a.localeCompare(b));
    for (const file of sortedFiles.filter((f) => extname(f) === ".hz")) {
      const fullPath = join(this.module.moduleConfig.srcDirectory, file);
      const stats = statSync(fullPath);
      if (stats.isDirectory() || extname(fullPath) !== ".hz") {
        return;
      }
      const parser = new Parser();
      const ast = await parser.parseFile(fullPath);
      if (!ast) {
        throw new GeneralError("Parsing failed");
      }

      this.module.ast = ast;
      this.module.collector.collect(ast, parser, fullPath);
      sources.push(file);
    }
    return sources;
  }

  async loadDependencyLibs() {
    const libs: string[] = [];
    const linkerFlags: string[] = [];
    for (const dep of this.module.moduleConfig.dependencies || []) {
      const libpath = join(join(this.globalBuildDir, dep.path), dep.path + ".hzlib");
      const metadata = await this.loadDependencyMetadata(libpath, dep.path);

      const lib = metadata.libs.find((l) => l.platform === this.module.moduleConfig.platform);
      if (!lib) {
        throw new GeneralError(
          `Lib ${dep.path} does not provide platform ${this.module.moduleConfig.platform}`,
        );
      }

      const tempdir = join(this.globalBuildDir, "temp-" + dep.path);
      await $`mkdir -p ${tempdir}`;
      await $`tar -xzf ${libpath} -C ${tempdir} ${lib.filename}`;

      const archiveFile = join(tempdir, lib.filename);
      libs.push(archiveFile);
      linkerFlags.push(...metadata.linkerFlags);
    }
    return [libs, linkerFlags];
  }

  async build() {
    try {
      if (this.module.moduleConfig.configFilePath) {
        if (
          !(await this.cache.hasModuleChanged(
            this.module.moduleConfig.projectName,
            this.module.moduleConfig.srcDirectory,
            this.module.moduleConfig.configFilePath,
          ))
        ) {
          console.log(`Skipping module ${this.module.moduleConfig.projectName}`);
          return true;
        } else {
          console.log(`Building module ${this.module.moduleConfig.projectName}`);
        }
      }

      await this.loadInternals();
      await this.importDeps();
      await this.loadSources();
      // performSemanticAnalysis(this.module);

      const name = this.module.moduleConfig.projectName;
      const platform = this.module.moduleConfig.platform;
      const moduleCFile = join(this.moduleBuildDir, `${name}-${platform}.c`);
      const moduleOFile = join(this.moduleBuildDir, `${name}-${platform}.o`);
      const moduleAFile = join(this.moduleBuildDir, `${name}-${platform}.a`);
      const moduleExecutable = join(this.moduleBuildDir, `${name}`);

      const moduleMetadataFile = join(this.moduleBuildDir, "metadata.json");
      const moduleOutputLib = join(
        this.moduleBuildDir,
        this.module.moduleConfig.projectName + ".hzlib",
      );
      // generateCode(this.module, moduleCFile);

      const compilerFlags = this.module.moduleConfig.compilerFlags;
      try {
        if (this.module.moduleConfig.moduleType === ModuleType.Executable) {
          const [libs, linkerFlags] = await this.loadDependencyLibs();
          const cmd = `${C_COMPILER} -g ${moduleCFile} -o ${moduleExecutable} -I${this.module.moduleConfig.srcDirectory} ${libs.join(" ")} ${compilerFlags.join(" ")} ${linkerFlags.join(" ")} -std=c11`;
          child_process.execSync(cmd);
        } else {
          const cmd = `${C_COMPILER} -g ${moduleCFile} -c -o ${moduleOFile} -I${this.module.moduleConfig.srcDirectory} ${compilerFlags.join(" ")} -fPIC -std=c11`;
          child_process.execSync(cmd);
          child_process.execSync(`${ARCHIVE_TOOL} r ${moduleAFile} ${moduleOFile} > /dev/null`);

          const makerel = (absolute: string) => {
            return absolute.replace(this.moduleBuildDir + "/", "");
          };

          const exportedDeclarations = new Set<string>();
          for (const [name, s] of this.module.exportSymbols) {
            // exportedDeclarations.add(generateSymbolUsageHazeCode(s).get());
          }

          const moduleMetadata: ModuleMetadata = {
            compilerVersion: version,
            fileformatVersion: 1,
            name: this.module.moduleConfig.projectName,
            version: this.module.moduleConfig.projectVersion,
            libs: [
              {
                filename: makerel(moduleAFile),
                platform: this.module.moduleConfig.platform,
                type: "static",
              },
            ],
            exportedDeclarations: [...exportedDeclarations],
            linkerFlags: this.module.moduleConfig.linkerFlags,
          };
          await Bun.write(moduleMetadataFile, JSON.stringify(moduleMetadata, undefined, 2));

          if (fs.existsSync(moduleOutputLib)) {
            await $`rm ${moduleOutputLib}`;
          }

          await $`tar -C ${this.moduleBuildDir} -cvzf ${moduleOutputLib} ${makerel(moduleAFile)} ${makerel(moduleMetadataFile)} > /dev/null`;
        }
        if (this.module.moduleConfig.configFilePath) {
          // await this.cache.compiledModule(
          //   this.module.moduleConfig.projectName,
          //   this.module.moduleConfig.srcDirectory,
          //   this.module.moduleConfig.configFilePath,
          // );
        }
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
        } else {
          console.error("Build failed");
        }
      }
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
      } else {
        console.error(e);
      }
    }
    return false;
  }
}
