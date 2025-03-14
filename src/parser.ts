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
  parser?: HazeParser;

  constructor() {}

  async parseFile(filename: string) {
    const file = Bun.file(filename);
    const text = await file.text();
    return await this.parse(text, filename);
  }

  async parse(text: string, errorListenerFilename: string) {
    const errorListener = new HazeErrorListener(errorListenerFilename);
    let inputStream = new CharStream(text);
    let lexer = new HazeLexer(inputStream);
    lexer.removeErrorListeners();
    lexer.addErrorListener(errorListener);

    let tokenStream = new CommonTokenStream(lexer);
    this.parser = new HazeParser(tokenStream);
    this.parser.removeErrorListeners();
    this.parser.addErrorListener(errorListener);

    if (this.parser.syntaxErrorsCount != 0) {
      return;
    }
    const ast = this.parser.prog();
    if (this.parser.syntaxErrorsCount != 0) {
      return;
    }
    return ast;
  }
}
