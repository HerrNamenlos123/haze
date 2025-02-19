import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import { Parser } from "./parser";
import {
  CompilerError,
  ImpossibleSituation,
  InternalError,
  UnreachableCode,
} from "./Errors";
import { Program } from "./Program";
import { SymbolCollector } from "./SymbolCollector";
import { ParserRuleContext, ParseTree, RuleNode, TerminalNode } from "antlr4";
import { ProgContext } from "./parser/HazeParser";
import { generateGraphviz as generateGraph } from "./graph";

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
      const collector = new SymbolCollector(program);
      collector.visit(ast);
      // console.log(JSON.stringify(program, null, 2));

      Bun.write(
        path.join("build", this.filename + ".mmd"),
        generateGraph(program),
      );
      try {
        child_process.execSync(
          `mmdc -i build/${this.filename}.mmd -o build/${this.filename}.svg -t default`,
        );
      } catch (e) {
        console.error("Running mermaid failed");
        return;
      }

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
