from Error import CompilerError, InternalError, getCallerLocation
from typing import Optional, List
from Symbol import Symbol, VariableSymbol
from Location import Location
from Datatype import Datatype


class SymbolTable:
    def __init__(self):
        self.symbols: List[Symbol] = []

    def insert(self, symbol: Symbol, loc: Location):
        if symbol.name in self.symbols:
            raise CompilerError(
                f"Symbol '{symbol.name}' is already declared in this scope", loc
            )
        self.symbols.append(symbol)

    def tryLookup(self, name: str, loc: Location) -> Optional[Symbol]:
        for s in self.symbols:
            if s.name == name:
                return s

        # if name.namespaces:  # Cannot proceed if namespaces are mentioned
        #     return None

        # # IF no namespaces (only lone name), try to match and see it it's unambiguous
        # found = None
        # for symbolName, symbol in self.symbols.items():
        #     if symbolName.name == name.name:
        #         if not found:
        #             found = symbol
        #         else:
        #             raise CompilerError(
        #                 f"Symbol '{name}' is ambiguous in this context", loc
        #             )
        # return found
        return None

    def getFiltered(self, type) -> List:
        funcs = []
        for symbol in self.symbols:
            if isinstance(symbol, type):
                funcs.append(symbol)
        return funcs

    def setSymbol(self, name: str, symbol: Symbol):
        for i in range(len(self.symbols)):
            if self.symbols[i].name == name:
                self.symbols[i] = symbol
                return
        raise InternalError("Could not find symbol to set: " + name)

    def __str__(self):
        out = ""
        for symbol in self.symbols:
            out += f" * {symbol} [{'mutable' if symbol.isMutable() else 'const'}]\n"
        if len(out) == 0:
            out = "[No symbols]"
        return out

    def __repr__(self):
        return self.__str__()


def getStructFields(struct: Datatype):
    if not struct.isStruct():
        raise InternalError("Not a struct", getCallerLocation())

    members: List[VariableSymbol] = []
    memsym: SymbolTable = struct.structMemberSymbols
    for member in memsym.getFiltered(VariableSymbol):
        sym: VariableSymbol = member
        members.append(sym)
    return members


def getStructField(struct: Datatype, name: str) -> Optional[VariableSymbol]:
    if not struct.isStruct():
        raise InternalError("Not a struct", getCallerLocation())

    memsym: SymbolTable = struct.structMemberSymbols
    for member in memsym.getFiltered(VariableSymbol):
        sym: VariableSymbol = member
        if sym.name == name:
            return sym
    return None


def getStructMethods(struct: Datatype):
    from FunctionSymbol import FunctionSymbol

    if not struct.isStruct():
        raise InternalError("Not a struct", getCallerLocation())

    members: List[FunctionSymbol] = []
    memsym: SymbolTable = struct.structMemberSymbols
    for member in memsym.getFiltered(FunctionSymbol):
        sym: FunctionSymbol = member
        members.append(sym)
    return members


def getStructMethod(struct: Datatype, name: str):
    from FunctionSymbol import FunctionSymbol

    if not struct.isStruct():
        raise InternalError("Not a struct", getCallerLocation())

    memsym: SymbolTable = struct.structMemberSymbols
    for member in memsym.getFiltered(FunctionSymbol):
        sym: FunctionSymbol = member
        if sym.name == name:
            return sym
    return None
