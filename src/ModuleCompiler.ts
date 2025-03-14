import * as child_process from "child_process";
import { $ } from "bun";
import { Parser } from "./parser";
import {
  CompilerError,
  GeneralError,
  InternalError,
  UnreachableCode,
} from "./Errors";
import { Module } from "./Module";
import { SymbolCollector } from "./SymbolCollector";
import { performSemanticAnalysis } from "./SemanticAnalyzer";
import { generateCode } from "./CodeGenerator";
import { readdirSync, statSync } from "fs";
import { dirname, extname, join } from "path";
import fs from "fs";
import { version } from "../package.json";
import { type VariableSymbol } from "./Symbol";
import { TypeExporter } from "./TypeExporter";
import {
  generateDatatypeDeclarationHazeCode,
  generateDatatypeUsageHazeCode,
  generateSymbolUsageHazeCode,
  type RawPointerDatatype,
  type StructDatatype,
} from "./Datatype";
import exp from "constants";
import { OutputWriter } from "./OutputWriter";
import {
  ConfigParser,
  ModuleType,
  parseModuleMetadata,
  type ModuleConfig,
  type ModuleDependency,
  type ModuleLibMetadata,
  type ModuleMetadata,
} from "./Config";

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

export class ProjectCompiler {
  constructor() {}

  async build() {
    const config = await parseConfig();
    if (!config) {
      return false;
    }
    const mainModule = new ModuleCompiler(config);

    const stdlibConfig = await parseConfig(
      join(mainModule.getStdlibDirectory(), "core"),
    );
    if (!stdlibConfig) {
      return false;
    }
    const stdlibModule = new ModuleCompiler(
      stdlibConfig,
      mainModule.globalBuildDir,
    );
    if (!(await stdlibModule.build())) {
      return false;
    }

    const deps = mainModule.module.moduleConfig.dependencies;
    for (const dep of deps) {
      const depdir = join(mainModule.getStdlibDirectory(), dep.path);

      const config = await parseConfig(depdir);
      if (!config) {
        return false;
      }

      const depModule = new ModuleCompiler(config, mainModule.globalBuildDir);
      if (!(await depModule.build())) {
        return false;
      }
    }

    if (!(await mainModule.build())) {
      return false;
    }
    return true;
  }

  async run(): Promise<number> {
    try {
      const config = await parseConfig();
      if (!config) {
        return -1;
      }

      if (config?.moduleType === ModuleType.Library) {
        throw new GeneralError(
          `This module is a library and cannot be executed. Use 'hz build' to build it.`,
        );
      }

      if (!(await this.build())) {
        return -1;
      }

      const platform = "linux-x64";
      const moduleBuildDir = join(config.buildDir, config.projectName);
      const moduleExecutable = join(moduleBuildDir, config.projectName);
      child_process.execSync(moduleExecutable, { stdio: "inherit" });
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

  constructor(moduleConfig: ModuleConfig, globalBuildDir?: string) {
    this.module = new Module(moduleConfig);
    if (!globalBuildDir) {
      this.globalBuildDir = moduleConfig.buildDir;
      this.moduleBuildDir = join(
        moduleConfig.buildDir,
        moduleConfig.projectName,
      );
    } else {
      this.globalBuildDir = globalBuildDir;
      this.moduleBuildDir = join(globalBuildDir, moduleConfig.projectName);
    }
  }

  getStdlibDirectory() {
    if (process.env.NODE_ENV === "production") {
      const whichHz = Bun.which("haze");
      if (!whichHz) {
        throw new GeneralError(`Compiler not found in path`);
      }
      return join(dirname(whichHz), "stdlib/");
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
    return parseModuleMetadata(
      await Bun.file(join(tempdir, "metadata.json")).text(),
    );
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
      const libpath = join(
        join(this.globalBuildDir, dep.path),
        dep.path + ".hzlib",
      );
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
    }
  }

  async loadDependencyLibs() {
    const libs: string[] = [];
    const linkerFlags: string[] = [];
    for (const dep of this.module.moduleConfig.dependencies || []) {
      const libpath = join(
        join(this.globalBuildDir, dep.path),
        dep.path + ".hzlib",
      );
      const metadata = await this.loadDependencyMetadata(libpath, dep.path);

      const lib = metadata.libs.find(
        (l) => l.platform === this.module.moduleConfig.platform,
      );
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
      await this.loadInternals();
      await this.importDeps();
      await this.loadSources();
      performSemanticAnalysis(this.module);

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
      generateCode(this.module, moduleCFile);

      try {
        if (this.module.moduleConfig.moduleType === ModuleType.Executable) {
          const [libs, linkerFlags] = await this.loadDependencyLibs();
          const cmd = `${C_COMPILER} -g ${moduleCFile} -o ${moduleExecutable} ${libs.join(" ")} ${linkerFlags.join(" ")} -std=c11`;
          child_process.execSync(cmd);
        } else {
          const cmd = `${C_COMPILER} -g ${moduleCFile} -c -o ${moduleOFile} -fPIC -std=c11`;
          child_process.execSync(cmd);
          child_process.execSync(
            `${ARCHIVE_TOOL} r ${moduleAFile} ${moduleOFile}`,
          );

          const makerel = (absolute: string) => {
            return absolute.replace(this.moduleBuildDir + "/", "");
          };

          const exportedDeclarations = new Set<string>();
          for (const [name, s] of this.module.exportSymbols) {
            exportedDeclarations.add(generateSymbolUsageHazeCode(s).get());
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
          await Bun.write(
            moduleMetadataFile,
            JSON.stringify(moduleMetadata, undefined, 2),
          );

          if (fs.existsSync(moduleOutputLib)) {
            await $`rm ${moduleOutputLib}`;
          }

          await $`tar -C ${this.moduleBuildDir} -cvzf ${moduleOutputLib} ${makerel(moduleAFile)} ${makerel(moduleMetadataFile)} > /dev/null`;
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
