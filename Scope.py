from typing import Optional
from Location import Location
from Symbol import Symbol
from Error import CompilerError
from SymbolTable import SymbolTable, SymbolName
from Error import InternalError, getCallerLocation


class Scope:
    def __init__(self, location: Location, parentScope: Optional["Scope"]):
        self.symbolTable = SymbolTable()
        self.parentScope = parentScope
        self.terminated = False
        self.location = location

    def defineSymbol(self, symbol: Symbol, loc: Location):
        if not isinstance(symbol.name, SymbolName):
            raise InternalError("Symbol must have SymbolName", getCallerLocation())
        self.symbolTable.insert(symbol, loc)

    def tryLookupSymbol(
        self, name: str | SymbolName, loc: Location
    ) -> Optional[Symbol]:
        if isinstance(name, str):
            name = SymbolName(name)
        symbol = self.symbolTable.tryLookup(name, loc)
        if symbol:
            return symbol

        if self.parentScope:
            return self.parentScope.tryLookupSymbol(name, loc)
        return None

    def lookupSymbol(self, name: str | SymbolName, loc: Location):
        if isinstance(name, str):
            name = SymbolName(name)
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

    def print(self):
        print(self.__str__())
        self.symbolTable.print()

    def __str__(self):
        return f"Scope({self.location})"

    def __repr__(self):
        return self.__str__()
