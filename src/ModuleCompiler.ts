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
  ModuleType,
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

export class ModuleCompiler {
  private projectConfig: ProjectConfig;

  constructor(projectConfig: ProjectConfig) {
    this.projectConfig = projectConfig;
  }

  async build() {
    try {
      const program = new Program(this.projectConfig);
      const collector = new SymbolCollector(program);

      if (!this.projectConfig.nostdlib) {
        let stdlib_files: { name: string; content: string }[] = [];
        if (process.env.NODE_ENV === "production") {
          const whichHz = Bun.which("hz");
          if (!whichHz) {
            throw new GeneralError(`Compiler not found in path`);
          }
          const allFiles = listFiles(join(dirname(whichHz), "stdlib"));
          allFiles.sort((a, b) => a.localeCompare(b));
          for (const file of allFiles) {
            const text = await Bun.file(file).text();
            stdlib_files.push({ name: file, content: text });
          }
        } else {
          const allFiles = listFiles(join(__dirname, "../stdlib"));
          allFiles.sort((a, b) => a.localeCompare(b));
          for (const file of allFiles) {
            const text = await Bun.file(file).text();
            stdlib_files.push({ name: file, content: text });
          }
        }

        for (const stdlibFile of stdlib_files) {
          const parser = new Parser();
          const ast = await parser.parse(stdlibFile.content, stdlibFile.name);
          if (!ast) {
            throw new GeneralError("Parsing failed");
          }

          program.ast = ast;
          collector.collect(ast, stdlibFile.name);
        }
      }

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

      generateCode(program, `build/main.c`);

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
        console.log(`\x1b[32mC-Compiling\x1b[0m build/main.c`);

        if (this.projectConfig.moduleType === ModuleType.Executable) {
          const cmd = `${C_COMPILER} -g build/main.c -o build/main -std=c11 ${program.linkerFlags.join(" ")}`;
          child_process.execSync(cmd);
        } else {
          const cmd = `${C_COMPILER} -g build/main.c -c -o build/main.o -fPIC -std=c11 ${program.linkerFlags.join(" ")}`;
          child_process.execSync(cmd);
          child_process.execSync(
            `${ARCHIVE_TOOL} r build/linux-x64-static.a build/main.o`,
          );

          const moduleMetadata: ModuleMetadata = {
            compilerVersion: version,
            fileformatVersion: 1,
            name: this.projectConfig.projectName,
            version: this.projectConfig.projectVersion,
            libs: [
              {
                filename: `linux-x64-static.a`,
                platform: "linux-x64",
                type: "static",
              },
            ],
            exportedSymbols: [],
          };
          await Bun.write(
            "build/metadata.json",
            JSON.stringify(moduleMetadata),
          );

          if (fs.existsSync("build/main.hzlib")) {
            await $`rm build/main.hzlib`;
          }
          await $`tar -C build -cvf build/main.hzlib linux-x64-static.a metadata.json > nul`;
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
        console.error("Build failed");
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
      console.log(`\x1b[32mExecuting\x1b[0m build/main`);
      child_process.execSync("build/main", { stdio: "inherit" });
      return 0;
    } catch (e: any) {
      console.error("Execution failed");
      return e.status as number;
    }
  }
}
