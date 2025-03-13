import * as child_process from "child_process";
import { $ } from "bun";
import { Parser } from "./parser";
import {
  CompilerError,
  GeneralError,
  InternalError,
  UnreachableCode,
} from "./Errors";
import {
  ConfigParser,
  ModuleType,
  parseModuleMetadata,
  Program,
  type ModuleConfig,
  type ModuleMetadata,
  type ProjectConfig,
} from "./Program";
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

const C_COMPILER = "clang";
const ARCHIVE_TOOL = "ar";

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

export class ModuleCompiler {
  projectConfig?: ProjectConfig;

  constructor() {}

  async loadConfig(moduleDir?: string) {
    this.projectConfig = await parseConfig(moduleDir);
    if (!this.projectConfig) {
      process.exit(1);
    }
  }

  async loadDependencyMetadata(libpath: string, libname: string) {
    if (!this.projectConfig) {
      throw new GeneralError("Config missing");
    }
    const tempdir = join(this.projectConfig.buildDir, "temp-" + libname);
    await $`mkdir -p ${tempdir}`;
    await $`tar -xzf ${libpath} -C ${tempdir} metadata.json`;
    return parseModuleMetadata(
      await Bun.file(join(tempdir, "metadata.json")).text(),
    );
  }

  async loadDependencies(program: Program, collector: SymbolCollector) {
    if (!this.projectConfig) {
      throw new GeneralError("Config missing");
    }
    for (const dep of this.projectConfig.dependencies || []) {
      const libpath = join(
        join(this.projectConfig.buildDir, dep.path),
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
      program.ast = ast;
      collector.collect(ast, dep.name + ".hzlib");
    }
  }

  async loadDependencyLibs() {
    if (!this.projectConfig) {
      throw new GeneralError("Config missing");
    }
    const libs: string[] = [];
    const linkerFlags: string[] = [];
    for (const dep of this.projectConfig.dependencies || []) {
      const libpath = join(
        join(this.projectConfig.buildDir, dep.path),
        dep.path + ".hzlib",
      );
      const metadata = await this.loadDependencyMetadata(libpath, dep.path);

      const lib = metadata.libs.find((l) => l.platform === "linux-x64");
      if (!lib) {
        throw new GeneralError(
          `Lib ${dep.path} does not provide platform ${"linux-x64"}`,
        );
      }

      const tempdir = join(this.projectConfig.buildDir, "temp-" + dep.path);
      await $`mkdir -p ${tempdir}`;
      await $`tar -xzf ${libpath} -C ${tempdir} ${lib.filename}`;

      const archiveFile = join(tempdir, lib.filename);
      libs.push(archiveFile);
      linkerFlags.push(...metadata.linkerFlags);
    }
    return [libs, linkerFlags];
  }

  async loadInternals(
    program: Program,
    collector: SymbolCollector,
    stdlibDirectory: string,
  ) {
    const internalContext = join(
      join(stdlibDirectory, "internal"),
      "internal.hz",
    );
    const parser = new Parser();
    const ast = await parser.parse(
      await Bun.file(internalContext).text(),
      internalContext,
    );
    if (!ast) {
      throw new GeneralError("Parsing failed");
    }
    program.ast = ast;
    collector.collect(ast, internalContext);
  }

  async build() {
    try {
      if (!this.projectConfig) {
        throw new GeneralError("Config missing");
      }

      const program = new Program(this.projectConfig);
      const collector = new SymbolCollector(program);

      let stdlibDirectory: string;
      if (process.env.NODE_ENV === "production") {
        const whichHz = Bun.which("hz");
        if (!whichHz) {
          throw new GeneralError(`Compiler not found in path`);
        }
        stdlibDirectory = join(dirname(whichHz), "stdlib/");
      } else {
        stdlibDirectory = join(__dirname, "../stdlib");
      }

      const moduleBuildDir = join(
        this.projectConfig.buildDir,
        this.projectConfig.projectName,
      );

      // if (!this.projectConfig.nostdlib) {
      //   let stdlib_files: { name: string; content: string }[] = [];
      //   if (process.env.NODE_ENV === "production") {
      //     const whichHz = Bun.which("hz");
      //     if (!whichHz) {
      //       throw new GeneralError(`Compiler not found in path`);
      //     }
      //     const allFiles = listFiles(join(dirname(whichHz), "stdlib/"));
      //     allFiles.sort((a, b) => a.localeCompare(b));
      //     for (const file of allFiles) {
      //       const text = await Bun.file(file).text();
      //       stdlib_files.push({ name: file, content: text });
      //     }
      //   } else {
      //     const allFiles = listFiles(join(__dirname, "../stdlib"));
      //     allFiles.sort((a, b) => a.localeCompare(b));
      //     for (const file of allFiles) {
      //       const text = await Bun.file(file).text();
      //       stdlib_files.push({ name: file, content: text });
      //     }
      //   }

      //   for (const stdlibFile of stdlib_files) {
      //     const parser = new Parser();
      //     const ast = await parser.parse(stdlibFile.content, stdlibFile.name);
      //     if (!ast) {
      //       throw new GeneralError("Parsing failed");
      //     }

      //     program.ast = ast;
      //     collector.collect(ast, stdlibFile.name);
      //   }
      // }

      await this.loadInternals(program, collector, stdlibDirectory);
      await this.loadDependencies(program, collector);

      const files = readdirSync(this.projectConfig.srcDirectory);
      const sortedFiles = files.sort((a, b) => a.localeCompare(b));
      for (const file of sortedFiles) {
        const fullPath = join(this.projectConfig.srcDirectory, file);
        const stats = statSync(fullPath);
        if (stats.isDirectory() || extname(fullPath) !== ".hz") {
          return;
        }
        console.log(`\x1b[32mTranspiling\x1b[0m ${fullPath}`);
        const parser = new Parser();
        const ast = await parser.parseFile(fullPath);
        if (!ast) {
          throw new GeneralError("Parsing failed");
        }

        program.ast = ast;
        collector.collect(ast, fullPath);
      }

      performSemanticAnalysis(program);
      // program.print();

      const platform = "linux-x64";
      const moduleCFile = join(
        moduleBuildDir,
        this.projectConfig.projectName + "-" + platform + ".c",
      );
      const moduleOFile = join(
        moduleBuildDir,
        this.projectConfig.projectName + "-" + platform + ".o",
      );
      const moduleArchive = join(
        moduleBuildDir,
        this.projectConfig.projectName + "-" + platform + ".a",
      );
      const moduleExecutable = join(
        moduleBuildDir,
        this.projectConfig.projectName + "-" + platform,
      );
      const moduleMetadataFile = join(moduleBuildDir, "metadata.json");
      const moduleOutputLib = join(
        moduleBuildDir,
        this.projectConfig.projectName + ".hzlib",
      );
      generateCode(program, moduleCFile);

      try {
        if (program.prebuildCmds) {
          for (const cmd of program.prebuildCmds) {
            try {
              console.log(`\x1b[32mExecuting pre-build command:\x1b[0m ${cmd}`);
              child_process.execSync(cmd, { stdio: "pipe" });
            } catch (e) {
              console.error("Requirement check failed: " + cmd);
              return false;
            }
          }
        }
        console.log(
          `\x1b[32mC-Compiling\x1b[0m ${this.projectConfig.projectName}`,
        );

        if (this.projectConfig.moduleType === ModuleType.Executable) {
          const [libs, linkerFlags] = await this.loadDependencyLibs();
          const cmd = `${C_COMPILER} -g ${moduleCFile} -o ${moduleExecutable} ${libs.join(" ")} ${linkerFlags.join(" ")} -std=c11 ${program.linkerFlags.join(" ")}`;
          child_process.execSync(cmd);
        } else {
          const cmd = `${C_COMPILER} -g ${moduleCFile} -c -o ${moduleOFile} -fPIC -std=c11 ${program.linkerFlags.join(" ")}`;
          child_process.execSync(cmd);
          child_process.execSync(
            `${ARCHIVE_TOOL} r ${moduleArchive} ${moduleOFile}`,
          );

          const makerel = (absolute: string) => {
            return absolute.replace(moduleBuildDir + "/", "");
          };

          const exportedDeclarations = new Set<string>();
          for (const [name, s] of program.exportDatatypes) {
            exportedDeclarations.add(generateSymbolUsageHazeCode(s).get());
          }
          for (const [name, s] of program.exportFunctions) {
            exportedDeclarations.add(generateSymbolUsageHazeCode(s).get());
          }

          const moduleMetadata: ModuleMetadata = {
            compilerVersion: version,
            fileformatVersion: 1,
            name: this.projectConfig.projectName,
            version: this.projectConfig.projectVersion,
            libs: [
              {
                filename: makerel(moduleArchive),
                platform: platform,
                type: "static",
              },
            ],
            exportedDeclarations: [...exportedDeclarations],
            linkerFlags: this.projectConfig.linkerFlags,
          };
          await Bun.write(
            moduleMetadataFile,
            JSON.stringify(moduleMetadata, undefined, 2),
          );

          if (fs.existsSync(moduleOutputLib)) {
            await $`rm ${moduleOutputLib}`;
          }

          await $`tar -C ${moduleBuildDir} -cvzf ${moduleOutputLib} ${makerel(moduleArchive)} ${makerel(moduleMetadataFile)} > nul`;
        }

        if (program.postbuildCmds) {
          for (const cmd of program.postbuildCmds) {
            try {
              console.log(
                `\x1b[32mExecuting post-build command:\x1b[0m ${cmd}`,
              );
              child_process.execSync(cmd);
            } catch (e) {
              console.error("Requirement check failed: " + cmd);
              return false;
            }
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
          console.error("Build failed");
        }
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
        console.error(e);
      }
    }
    return false;
  }

  async run(): Promise<number> {
    try {
      if (!this.projectConfig) {
        throw new GeneralError("Config missing");
      }
      if (this.projectConfig?.moduleType === ModuleType.Library) {
        throw new GeneralError(
          `This module is a library and cannot be executed. Use 'hz build' to build it.`,
        );
      }
      console.log(`\x1b[32mExecuting\x1b[0m build/main`);
      child_process.execSync("build/main", { stdio: "inherit" });
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
