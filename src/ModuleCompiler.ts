import * as child_process from "child_process";
import { Parser } from "./parser";
import {
  CompilerError,
  GeneralError,
  InternalError,
  UnreachableCode,
} from "./Errors";
import { Program, type ProjectConfig } from "./Program";
import { SymbolCollector } from "./SymbolCollector";
import { performSemanticAnalysis } from "./SemanticAnalyzer";
import { generateCode } from "./CodeGenerator";
import { readdirSync, statSync } from "fs";
import { extname, join } from "path";
import fs from "fs";
import { embeddedFiles } from "bun";

const C_COMPILER = "clang";

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
      let stdlib_files: { name: string; content: string }[] = [];
      if (process.env.NODE_ENV === "production") {
        const files = Array.from(embeddedFiles);
        files.sort((a, b) => a.name.localeCompare(b.name));
        for (const file of embeddedFiles) {
          stdlib_files.push({ content: await file.text(), name: file.name });
        }
      } else {
        const allFiles = listFiles(join(__dirname, "../stdlib"));
        allFiles.sort((a, b) => a.localeCompare(b));
        for (const file of allFiles) {
          const text = await Bun.file(file).text();
          stdlib_files.push({ name: file, content: text });
        }
      }

      const files = readdirSync(this.projectConfig.srcDirectory);

      const program = new Program(this.projectConfig);
      const collector = new SymbolCollector(program);

      for (const stdlibFile of stdlib_files) {
        const parser = new Parser();
        const ast = await parser.parse(stdlibFile.content, stdlibFile.name);
        if (!ast) {
          throw new GeneralError("Parsing failed");
        }

        program.filename = stdlibFile.name;
        program.ast = ast;
        collector.visit(ast);
      }

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

        program.filename = fullPath;
        program.ast = ast;
        collector.visit(ast);
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

        const cmd = `${C_COMPILER} -g build/main.c -o build/out -std=c11 ${program.linkerFlags.join(" ")}`;
        child_process.execSync(cmd);
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
      if (e instanceof InternalError) {
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
      console.log(`\x1b[32mExecuting\x1b[0m build/out`);
      child_process.execSync("build/out", { stdio: "inherit" });
      return 0;
    } catch (e: any) {
      console.error("Execution failed");
      return e.status as number;
    }
  }
}
