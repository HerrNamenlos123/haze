import * as child_process from "child_process";
import {
  CmdFailed,
  CompilerError,
  GeneralError,
  ImpossibleSituation,
  InternalError,
  SyntaxError,
  UnreachableCode,
} from "./shared/Errors";
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
import { Parser } from "./Parser/Parser";
import { CollectSymbols, getScope } from "./SymbolCollection/SymbolCollection";
import { PrettyPrintAnalyzed, SemanticallyAnalyze } from "./Semantic/Elaborate";
import { generateCode } from "./Codegen/CodeGenerator";
import { LowerModule } from "./Lower/Lower";
import { Collect, type CollectionContext } from "./SymbolCollection/CollectSymbols";

const C_COMPILER = "clang";
const ARCHIVE_TOOL = "ar";
const HAZE_STDLIB_NAME = "haze-stdlib";
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

class Cache {
  filename?: string;
  data: Record<string, any> = {};

  constructor() { }

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
  globalBuildDir: string = "";

  constructor() { }

  async getConfig(singleFilename?: string) {
    let config: ModuleConfig | undefined;
    if (!singleFilename) {
      config = await parseConfig();
    } else {
      config = {
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
    this.globalBuildDir = join(process.cwd(), "__haze__");

    if (!singleFilename) {
      await this.cache.load(join(this.globalBuildDir, "cache.json"));
    }
    const mainModule = new ModuleCompiler(
      config,
      this.cache,
      this.globalBuildDir,
      join(this.globalBuildDir, config.projectName),
    );

    if (!mainModule.config.nostdlib) {
      const stdlibConfig = await parseConfig(join(getStdlibDirectory(), "core"));
      if (!stdlibConfig) {
        return false;
      }
      const stdlibModule = new ModuleCompiler(
        stdlibConfig,
        this.cache,
        this.globalBuildDir,
        join(this.globalBuildDir, stdlibConfig.projectName),
      );
      if (!(await stdlibModule.build())) {
        return false;
      }
    }

    if (!singleFilename) {
      const deps = mainModule.config.dependencies;
      for (const dep of deps) {
        const depdir = join(getStdlibDirectory(), dep.path);

        const config = await parseConfig(depdir);
        if (!config) {
          return false;
        }

        const depModule = new ModuleCompiler(
          config,
          this.cache,
          this.globalBuildDir,
          join(this.globalBuildDir, config.projectName),
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

  async run(singleFilename?: string, args?: string[]): Promise<number> {
    try {
      const config = await this.getConfig(singleFilename);
      if (!config) {
        return -1;
      }

      if (config?.moduleType === ModuleType.Library) {
        throw new GeneralError(
          `This module is a library and cannot be executed. Use 'haze build' to build it instead.`,
        );
      }

      const moduleExecutable = join(
        join(this.globalBuildDir, config.projectName),
        config.projectName,
      );
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
    public moduleBuildDir: string,
  ) {
    this.cc = {
      cInjections: [],
      globalScope: "",
      moduleName: config.projectName,
      scopes: new Map(),
    };
    const globalScope = new Collect.Scope(this.cc, {
      column: 0,
      filename: "global",
      line: 0,
    });
    this.cc.globalScope = globalScope.id;
    this.cc.scopes.set(globalScope.id, globalScope);
  }

  addSourceFromString(text: string, filename: string) {
    CollectSymbols(this.cc, Parser.parseTextToAST(text, filename), {
      filename: filename,
      line: 0,
      column: 0,
    });
  }

  async addProjectSourceFiles() {
    const sources = [] as string[];
    const files = readdirSync(this.config.srcDirectory);
    const sortedFiles = files.sort((a, b) => a.localeCompare(b));
    for (const file of sortedFiles.filter((f) => extname(f) === ".hz")) {
      const fullPath = join(this.config.srcDirectory, file);
      const stats = statSync(fullPath);
      if (stats.isDirectory() || extname(fullPath) !== ".hz") {
        return;
      }
      const fileText = await Bun.file(fullPath).text();
      this.addSourceFromString(fileText, fullPath);
      sources.push(file);
    }
    return sources;
  }

  async build() {
    try {
      if (this.config.configFilePath) {
        if (
          !(await this.cache.hasModuleChanged(
            this.config.projectName,
            this.config.srcDirectory,
            this.config.configFilePath,
          ))
        ) {
          console.log(`Skipping module ${this.config.projectName}`);
          return true;
        } else {
          console.log(`Building module ${this.config.projectName}`);
        }
      }

      await this.addInternalBuiltinSources();
      await this.addDependencySources();
      await this.addProjectSourceFiles();

      const sr = SemanticallyAnalyze(this.cc,
        this.config.moduleType === ModuleType.Library,
      );
      // PrettyPrintAnalyzed(sr);
      const lowered = LowerModule(this.cc, sr);

      const name = this.config.projectName;
      const platform = this.config.platform;
      const moduleCFile = join(this.moduleBuildDir, `${name}-${platform}.c`);
      const moduleOFile = join(this.moduleBuildDir, `${name}-${platform}.o`);
      const moduleAFile = join(this.moduleBuildDir, `${name}-${platform}.a`);
      const moduleExecutable = join(this.moduleBuildDir, `${name}`);

      const moduleMetadataFile = join(this.moduleBuildDir, "metadata.json");
      const moduleOutputLib = join(this.moduleBuildDir, this.config.projectName + ".hzlib");

      const code = generateCode(this.config, lowered);
      await Bun.file(moduleCFile).write(code);

      const compilerFlags = this.config.compilerFlags;
      compilerFlags.push("-Wno-parentheses-equality");
      if (this.config.moduleType === ModuleType.Executable) {
        const [libs, linkerFlags] = await this.loadDependencyBinaries();
        const allLinkerFlags = [...linkerFlags, ...this.config.linkerFlags];
        const cmd = `${C_COMPILER} -g ${moduleCFile} -o ${moduleExecutable} -I${this.config.srcDirectory} ${libs.join(" ")} ${compilerFlags.join(" ")} ${allLinkerFlags.join(" ")} -std=c11`;
        // console.log(cmd);
        await exec(cmd);
      } else {
        const cmd = `${C_COMPILER} -g ${moduleCFile} -c -o ${moduleOFile} -I${this.config.srcDirectory} ${compilerFlags.join(" ")} -fPIC -std=c11`;
        // console.log(cmd);
        await exec(cmd);
        await exec(`${ARCHIVE_TOOL} r ${moduleAFile} ${moduleOFile} > /dev/null`);

        const makerel = (absolute: string) => {
          return absolute.replace(this.moduleBuildDir + "/", "");
        };

        const exportedDeclarations = new Set<string>();
        // for (const [name, s] of this.exportSymbols) {
        //   exportedDeclarations.add(generateSymbolUsageHazeCode(s).get());
        // }

        const moduleMetadata: ModuleMetadata = {
          compilerVersion: version,
          fileformatVersion: 1,
          name: this.config.projectName,
          version: this.config.projectVersion,
          libs: [
            {
              filename: makerel(moduleAFile),
              platform: this.config.platform,
              type: "static",
            },
          ],
          exportedDeclarations: [...exportedDeclarations],
          linkerFlags: this.config.linkerFlags,
        };
        await Bun.write(moduleMetadataFile, JSON.stringify(moduleMetadata, undefined, 2));

        if (fs.existsSync(moduleOutputLib)) {
          await exec(`rm ${moduleOutputLib}`);
        }

        await exec(
          `tar -C ${this.moduleBuildDir} -cvzf ${moduleOutputLib} ${makerel(moduleAFile)} ${makerel(moduleMetadataFile)} > /dev/null`,
        );
      }
      if (this.config.configFilePath) {
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
      } else if (e instanceof SyntaxError) {
        return false;
      } else if (e instanceof CmdFailed) {
        console.error("Build failed");
        return false;
      } else {
        console.error(e);
      }
    }
    return false;
  }

  private async loadDependencyBinaries() {
    const libs: string[] = [];
    const linkerFlags: string[] = [];
    for (const dep of this.config.dependencies || []) {
      const libpath = join(join(this.globalBuildDir, dep.path), dep.path + ".hzlib");
      const metadata = await this.loadDependencyMetadata(libpath, dep.path);

      const lib = metadata.libs.find((l) => l.platform === this.config.platform);
      if (!lib) {
        throw new GeneralError(`Lib ${dep.path} does not provide platform ${this.config.platform}`);
      }

      const tempdir = join(this.globalBuildDir, "temp-" + dep.path);
      await exec(`mkdir -p ${tempdir}`);
      await exec(`tar -xzf ${libpath} -C ${tempdir} ${lib.filename}`);

      const archiveFile = join(tempdir, lib.filename);
      libs.push(archiveFile);
      linkerFlags.push(...metadata.linkerFlags);
    }
    return [libs, linkerFlags];
  }

  private async loadDependencyMetadata(libpath: string, libname: string) {
    const tempdir = join(this.globalBuildDir, "temp-" + libname);
    await exec(`mkdir -p ${tempdir}`);
    await exec(`tar -xzf ${libpath} -C ${tempdir} metadata.json`);
    return parseModuleMetadata(await Bun.file(join(tempdir, "metadata.json")).text());
  }

  private async addDependencySources() {
    const deps = [...this.config.dependencies];
    if (this.config.projectName !== HAZE_STDLIB_NAME && !this.config.nostdlib) {
      deps.push({
        name: HAZE_STDLIB_NAME,
        path: HAZE_STDLIB_NAME,
      });
    }

    for (const dep of this.config.dependencies) {
      const libpath = join(join(this.globalBuildDir, dep.path), dep.path + ".hzlib");
      const metadata = await this.loadDependencyMetadata(libpath, dep.path);

      const declarations = new OutputWriter();
      for (const decl of metadata.exportedDeclarations) {
        declarations.writeLine(decl);
      }

      this.addSourceFromString(declarations.get(), libpath);
    }
  }

  private async addInternalBuiltinSources() {
    function listFilesInDir(dir: string): string[] {
      return readdirSync(dir)
        .map((name) => join(dir, name))
        .filter((path) => statSync(path).isFile());
    }

    const files = listFilesInDir(join(getStdlibDirectory(), "internal"));
    for (const file of files) {
      const internal = await Bun.file(file).text();
      this.addSourceFromString(internal, file);
    }
  }
}
