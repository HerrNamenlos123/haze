from typing import Optional, List
from Location import Location
from Symbol import Symbol
from Error import CompilerError
from SymbolTable import SymbolTable
from Error import InternalError, getCallerLocation
from antlr4 import ParserRuleContext


class Statement:
    def __init__(self, ctx: ParserRuleContext):
        self.ctx = ctx


class Scope:
    def __init__(self, location: Location, parentScope: Optional["Scope"]):
        self.symbolTable = SymbolTable()
        self.parentScope = parentScope
        self.terminated = False
        self.location = location
        self.statements: List[Statement] = []

    def defineSymbol(self, symbol: Symbol, loc: Location):
        self.symbolTable.insert(symbol, loc)

    def tryLookupSymbol(self, name: str, loc: Location) -> Optional[Symbol]:
        symbol = self.symbolTable.tryLookup(name, loc)
        if symbol:
            return symbol

        if self.parentScope:
            return self.parentScope.tryLookupSymbol(name, loc)
        return None

    def lookupSymbol(self, name: str, loc: Location):
        symbol = self.symbolTable.tryLookup(name, loc)
        if symbol:
            return symbol
        if self.parentScope:
            return self.parentScope.lookupSymbol(name, loc)
        raise CompilerError(f"Symbol '{name}' was not declared in this scope", loc)

    def mutabilityString(self, symbol: Symbol):
        return "mutable" if symbol.isMutable() else "const"

    def setTerminated(self, terminated: bool):
        self.terminated = terminated

    def isTerminated(self):
        return self.terminated

    def __str__(self):
        return f"Scope({self.location}):\n{self.symbolTable}"

    def __repr__(self):
        return self.__str__()
