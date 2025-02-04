from typing import Optional
from Location import Location
from Symbol import Symbol


class Scope:
    def __init__(self, location: Location, parentScope: Optional["Scope"]):
        from SymbolTable import SymbolTable

        self.symbolTable = SymbolTable()
        self.parentScope = parentScope
        self.terminated = False
        self.location = location

    def defineSymbol(self, symbol: Symbol):
        self.symbolTable.insert(symbol)
