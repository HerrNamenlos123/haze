import HazeLexer from "./parser/HazeLexer";
import HazeParser from "./parser/HazeParser";
import { ErrorType, Location, printErrorMessage } from "./Errors";
import { CharStream, CommonTokenStream, ErrorListener } from "antlr4";

class HazeErrorListener extends ErrorListener<any> {
  filename: string;

  constructor(filename: string) {
    super();
    this.filename = filename;
  }

  syntaxError(
    recognizer: any,
    offendingSymbol: any,
    line: number,
    column: number,
    msg: string,
    e: any,
  ) {
    printErrorMessage(
      msg,
      new Location(this.filename, line, column),
      "SyntaxError",
    );
  }
}

export class Parser {
  constructor() {}

  async parse(filename: string) {
    const file = Bun.file(filename);
    const text = await file.text();

    const errorListener = new HazeErrorListener(filename);
    let inputStream = new CharStream(text);
    let lexer = new HazeLexer(inputStream);
    lexer.removeErrorListeners();
    lexer.addErrorListener(errorListener);

    let tokenStream = new CommonTokenStream(lexer);
    let parser = new HazeParser(tokenStream);
    parser.removeErrorListeners();
    parser.addErrorListener(errorListener);

    if (parser.syntaxErrorsCount != 0) {
      return;
    }
    const ast = parser.prog();
    if (parser.syntaxErrorsCount != 0) {
      return;
    }
    return ast;
  }
}
