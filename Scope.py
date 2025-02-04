from typing import Optional
from Location import Location
from Symbol import Symbol
from Error import CompilerError


class Scope:
    def __init__(self, location: Location, parentScope: Optional["Scope"]):
        from SymbolTable import SymbolTable

        self.symbolTable = SymbolTable()
        self.parentScope = parentScope
        self.terminated = False
        self.location = location

    def defineSymbol(self, symbol: Symbol):
        self.symbolTable.insert(symbol)

    def tryLookupSymbol(self, name: str) -> Optional[Symbol]:
        symbol = self.symbolTable.tryLookup(name)
        if symbol:
            return symbol

        if self.parentScope:
            return self.parentScope.tryLookupSymbol(name)
        return None

    def lookupSymbol(self, name: str, loc: Location):
        symbol = self.tryLookupSymbol(name)
        if not symbol:
            raise CompilerError(f"Symbol '{name}' was not declared in this scope", loc)
        return symbol

    def mutabilityString(self, symbol: Symbol):
        return "mutable" if symbol.isMutable() else "const"

    def setTerminated(self, terminated: bool):
        self.terminated = terminated

    def isTerminated(self):
        return self.terminated
