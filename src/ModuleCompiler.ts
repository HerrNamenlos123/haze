import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import { Parser } from "./parser";
import { CompilerError, InternalError, UnreachableCode } from "./Errors";
import { Program } from "./Program";
import { SymbolCollector } from "./SymbolCollector";
import { TerminalNode, type ParseTree } from "antlr4";

// import { Parser } from "./Parser";
// import { CompilationDatabase } from "./CompilationDatabase";
// import { InternalError, CompilerError, UnreachableCode } from "./Error";

// import { SymbolCollector } from "./SymbolCollector";
// import { performSemanticAnalysis } from "./SemanticAnalyzer";
// import { SymbolTypeResolver } from "./SymbolTypeResolver";
// import { ReturnVerifier } from "./ReturnVerifier";
// import { generateCode } from "./CodeGenerator";

const CXX_COMPILER = "clang++";
const C_COMPILER = "clang";

export class ModuleCompiler {
  private filename: string;

  constructor(filename: string) {
    this.filename = filename;
    // this.db = new CompilationDatabase();
  }

  async build() {
    try {
      console.log(`\x1b[32mCompiling\x1b[0m ${this.filename}`);
      const parser = new Parser();
      const ast = await parser.parse(this.filename);
      if (!ast) {
        return false;
      }

      const program = new Program(this.filename);
      // const collector = new SymbolCollector(program);
      // collector.visit(ast);
      console.log(program);

      function prettyPrintAST(node: ParseTree, indent: string = ""): void {
        // Print the current node's text (i.e., the token or rule name)
        if (node instanceof TerminalNode) {
          console.log(`${indent}TerminalNode: ${node.getText()}`);
        } else {
          console.log(`${indent}RuleNode: ${node.constructor.name}`);
        }

        // Recursively print child nodes (if any)
        for (let i = 0; i < node.getChildCount(); i++) {
          const child = node.getChild(i);
          prettyPrintAST(child, indent + "  "); // Increase indentation
        }
      }

      // console.log(ast);
      prettyPrintAST(ast);

      //   performSemanticAnalysis(collector.program, this.filename, this.db);

      //   generateCode(collector.program, path.join("build", this.filename + ".c"));

      //   child_process.execSync(
      //     `${CXX_COMPILER} build/${this.filename}.c -o build/out`,
      //   );
      //   child_process.execSync("build/out", { stdio: "inherit" });

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
