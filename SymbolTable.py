from Error import CompilerError
from typing import Optional, Dict
from Symbol import Symbol


class SymbolTable:
    def __init__(self):
        self.symbolMap = {}

    def insert(self, symbol: Symbol):
        if symbol.getName() in self.symbolMap:
            raise CompilerError(
                f"Symbol '{symbol.getName()}' is already declared in this scope",
                symbol.getDeclarationLocation(),
            )
        self.symbolMap[symbol.getName()] = symbol

    def tryLookup(self, name: str) -> Optional[Symbol]:
        return self.symbolMap.get(name)

    def getAllSymbols(self) -> Dict[str, Symbol]:
        return self.symbolMap

    def print(self):
        for symbol in self.symbolMap.values():
            print(
                f" * {symbol.getName()}: {symbol.getType().getDisplayName()} [{'mutable' if symbol.isMutable() else 'const'}]"
            )
