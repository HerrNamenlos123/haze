from Error import CompilerError, InternalError, getCallerLocation
from typing import Optional, Dict, List
from Symbol import Symbol, VariableSymbol, FunctionSymbol
from Location import Location
from SymbolName import SymbolName
from Datatype import Datatype


class SymbolTable:
    def __init__(self):
        self.symbols: Dict[SymbolName, Symbol] = {}

    def insert(self, symbol: Symbol, loc: Location):
        if symbol.name in self.symbols:
            raise CompilerError(
                f"Symbol '{symbol.name}' is already declared in this scope", loc
            )
        self.symbols[symbol.name] = symbol

    def tryLookup(self, name: SymbolName, loc: Location) -> Optional[Symbol]:
        if name in self.symbols:  # Exact match
            return self.symbols[name]

        if name.namespaces:  # Cannot proceed if namespaces are mentioned
            return None

        # IF no namespaces (only lone name), try to match and see it it's unambiguous
        found = None
        for symbolName, symbol in self.symbols.items():
            if symbolName.name == name.name:
                if not found:
                    found = symbol
                else:
                    raise CompilerError(
                        f"Symbol '{name}' is ambiguous in this context", loc
                    )
        return found

    def getFiltered(self, type) -> List:
        funcs = []
        for symbol in self.symbols.values():
            if isinstance(symbol, type):
                funcs.append(symbol)
        return funcs

    def print(self):
        for symbol in self.symbols.values():
            print(
                f" * {symbol.name}: {symbol.type.getDisplayName()} [{'mutable' if symbol.isMutable() else 'const'}]"
            )


def getStructFields(struct: Datatype):
    if not struct.isStruct():
        raise InternalError("Not a struct", getCallerLocation())

    members: List[VariableSymbol] = []
    memsym: SymbolTable = struct.structMemberSymbols
    for member in memsym.getFiltered(VariableSymbol):
        sym: VariableSymbol = member
        members.append(sym)
    return members


def getStructFunctions(struct: Datatype):
    if not struct.isStruct():
        raise InternalError("Not a struct", getCallerLocation())

    members: List[FunctionSymbol] = []
    memsym: SymbolTable = struct.structMemberSymbols
    for member in memsym.getFiltered(FunctionSymbol):
        sym: FunctionSymbol = member
        members.append(sym)
    return members
