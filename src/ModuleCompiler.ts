import * as child_process from "child_process";
import { Parser } from "./parser";
import { CompilerError, InternalError, UnreachableCode } from "./Errors";
import { Program } from "./Program";
import { SymbolCollector } from "./SymbolCollector";
import { ParserRuleContext, TerminalNode } from "antlr4";
import { performSemanticAnalysis } from "./SemanticAnalyzer";
import { generateCode } from "./CodeGenerator";

const CXX_COMPILER = "clang++";
const C_COMPILER = "clang";

export class ModuleCompiler {
  private filename: string;

  constructor(filename: string) {
    this.filename = filename;
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
      performSemanticAnalysis(program);
      // program.print();
      // console.log(JSON.stringify(program, null, 2));

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
        child_process.execSync(
          `${C_COMPILER} build/${this.filename}.c -o build/out`,
        );
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
