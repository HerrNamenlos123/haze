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
import { ParserRuleContext, TerminalNode } from "antlr4";
import { performSemanticAnalysis } from "./SemanticAnalyzer";
import { generateCode } from "./CodeGenerator";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { parse } from "@ltd/j-toml";

const CXX_COMPILER = "clang++";
const C_COMPILER = "clang";
const HAZE_CONFIG_FILE = "haze.toml";

export class ModuleCompiler {
  private filename: string;
  private fullConfigPath?: string;

  constructor(filename: string) {
    this.filename = filename;
  }

  findUpwards(filename: string, startDir = process.cwd()): string | undefined {
    let dir = startDir;
    while (dir !== dirname(dir)) {
      const filePath = join(dir, filename);
      if (existsSync(filePath)) return filePath;
      dir = dirname(dir);
    }
    return undefined;
  }

  getString(toml: any, field: string): string {
    if (typeof toml[field] === "string") {
      return toml[field];
    } else if (field in toml) {
      throw new GeneralError(
        `Field '${field}' in file ${this.fullConfigPath} must be of type string`,
      );
    } else {
      throw new GeneralError(
        `Required field '${field}' is missing in ${this.fullConfigPath}`,
      );
    }
  }

  getOptionalString(toml: any, field: string): string | undefined {
    if (typeof toml[field] === "string") {
      return toml[field];
    } else if (field in toml) {
      throw new GeneralError(
        `Field '${field}' in file ${this.fullConfigPath} must be of type string`,
      );
    }
    return undefined;
  }

  getOptionalStringArray(toml: any, field: string): string[] | undefined {
    if (Array.isArray(toml[field])) {
      const array = toml[field];
      array.forEach((s) => {
        if (typeof s !== "string") {
          throw new GeneralError(
            `Element '${s}' of field '${field}' in file ${this.fullConfigPath} must be of type string`,
          );
        }
      });
      return array;
    } else if (field in toml) {
      throw new GeneralError(
        `Field '${field}' in file ${this.fullConfigPath} must be an array`,
      );
    }
    return undefined;
  }

  getScripts(toml: any) {
    const scripts = [] as { name: string; command: string }[];
    for (const [name, cmd] of Object.entries(toml["scripts"])) {
      if (typeof cmd !== "string") {
        throw new GeneralError(
          `Script '${name}' in file ${this.fullConfigPath} must be of type string`,
        );
      }
      scripts.push({
        name: name,
        command: cmd,
      });
    }
    return scripts;
  }

  async parseConfig(path: string): Promise<ProjectConfig> {
    const content = await Bun.file(path).text();
    const toml = parse(content, { bigint: false });
    return {
      projectName: this.getString(toml, "name"),
      projectVersion: this.getString(toml, "version"),
      projectAuthors: this.getOptionalStringArray(toml, "authors"),
      projectDescription: this.getOptionalString(toml, "description"),
      projectLicense: this.getOptionalString(toml, "license"),
      scripts: this.getScripts(toml),
    };
  }

  async build() {
    try {
      this.fullConfigPath = this.findUpwards(HAZE_CONFIG_FILE);
      if (!this.fullConfigPath) {
        console.log(
          `No '${HAZE_CONFIG_FILE}' file found in any parent directory. Are you in the correct directory?`,
        );
        return false;
      }

      let config: ProjectConfig;
      try {
        config = await this.parseConfig(this.fullConfigPath);
      } catch (e: unknown) {
        if (e instanceof GeneralError) {
          console.log(e.message);
        } else {
          console.error(e);
        }
        return false;
      }

      console.log(`\x1b[32mTranspiling\x1b[0m ${this.filename}`);
      const parser = new Parser();
      const ast = await parser.parse(this.filename);
      if (!ast) {
        return false;
      }

      const program = new Program(this.filename, ast, config);
      const collector = new SymbolCollector(program);
      collector.visit(ast);
      performSemanticAnalysis(program);
      // program.print();

      console.log(`\x1b[32mGenerating\x1b[0m ${this.filename}`);
      generateCode(program, `build/${this.filename}.c`);

      // Bun.write(
      //   path.join("build", this.filename + ".mmd"),
      //   generateGraph(program),
      // );
      // try {
      //   child_process.execSync(
      //     `mmdc -i build/${this.filename}.mmd -o build/${this.filename}.svg -t default`,
      //   );
      // } catch (e) {
      //   console.error("Running mermaid failed");
      //   return;
      // }

      function prettyPrintAST(
        node: ParserRuleContext | TerminalNode,
        indent: string = "",
      ): void {
        if (node instanceof TerminalNode) {
          console.log(`${indent}TerminalNode: ${node.getText()}`);
        } else {
          console.log(`${indent}RuleNode: ${node.constructor.name}`);
        }
        if (node instanceof ParserRuleContext) {
          for (let i = 0; i < node.getChildCount(); i++) {
            const child = node.getChild(i) as ParserRuleContext | TerminalNode;
            prettyPrintAST(child, indent + "  ");
          }
        }
      }

      // prettyPrintAST(ast);

      try {
        // -lglfw -lSDL2main -lSDL2  -lwayland-client -lglfw -lGL
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
        console.log(`\x1b[32mC-Compiling\x1b[0m ${this.filename}`);

        const cmd = `${C_COMPILER} -g build/${this.filename}.c -o build/out -std=c11 ${program.linkerFlags.join(" ")}`;
        // console.log(cmd);
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
        console.log(`\x1b[32mExecuting\x1b[0m ${this.filename}`);
        child_process.execSync("build/out", { stdio: "inherit" });
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

  execute(): number {
    // TODO
    return 0;
  }
}
