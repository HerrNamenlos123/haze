from Error import CompilerError, InternalError, getCallerLocation
from typing import Optional, Dict, List
from Symbol import Symbol
from Location import Location
from SymbolName import SymbolName


class SymbolTable:
    def __init__(self):
        self.symbolMap: Dict[SymbolName, Symbol] = {}

    def insert(self, symbol: Symbol):
        if symbol.getName() in self.symbolMap:
            raise CompilerError(
                f"Symbol '{symbol.getName()}' is already declared in this scope",
                symbol.declarationLocation,
            )
        self.symbolMap[symbol.getName()] = symbol

    def tryLookup(self, name: SymbolName, loc: Location) -> Optional[Symbol]:
        if name in self.symbolMap:  # Exact match
            return self.symbolMap[name]

        if name.namespaces:  # Cannot proceed if namespaces
            return None

        # IF no namespaces (only lone name), try to match and see it it's unambiguous
        found = None
        for symbolName, symbol in self.symbolMap.items():
            if symbolName.name == name.name:
                if not found:
                    found = symbol
                else:
                    raise CompilerError(
                        f"Symbol '{name}' is ambiguous in this context", loc
                    )
        return found

    def getAllSymbols(self) -> Dict[SymbolName, Symbol]:
        return self.symbolMap

    def print(self):
        for symbol in self.symbolMap.values():
            print(
                f" * {symbol.getName()}: {symbol.getType().getDisplayName()} [{'mutable' if symbol.isMutable() else 'const'}]"
            )
