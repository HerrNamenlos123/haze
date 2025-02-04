import antlr4
from Error import printCompilerMessage, ErrorType
from Location import Location
from grammar import HazeLexer, HazeParser
from antlr4.error.ErrorListener import ErrorListener
from antlr4 import InputStream


class HazeErrorListener(ErrorListener):
    def __init__(self, filename: str):
        self.filename = filename

    def syntaxError(self, recognizer, offendingSymbol, line, column, msg, e):
        printCompilerMessage(
            Location(self.filename, line, column), ErrorType.Error, "SyntaxError", msg
        )


class Parser:
    def __init__(self, filename: str):
        with open(filename, "r") as fs:
            self.inputStream = InputStream(fs.read())
        self.lexer = HazeLexer.HazeLexer(self.inputStream)
        self.errorListener = HazeErrorListener(filename)
        self.lexer.removeErrorListeners()
        self.lexer.addErrorListener(self.errorListener)
        self.tokens = antlr4.CommonTokenStream(self.lexer)
        self.parser = HazeParser.HazeParser(self.tokens)
        self.parser.removeErrorListeners()
        self.parser.addErrorListener(self.errorListener)

    def parse(self):
        if self.parser.getNumberOfSyntaxErrors() != 0:
            return None
        self.ast = self.parser.prog()
        if self.parser.getNumberOfSyntaxErrors() != 0:
            return None
        return self.ast
