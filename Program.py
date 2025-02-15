from SymbolTable import SymbolTable
from Location import Location
from Symbol import Symbol
from Scope import Scope
from FunctionSymbol import FunctionSymbol
from typing import List
from Datatype import FunctionLinkage
from CompilationDatabase import CompilationDatabase


class ExternFunctionRef:
    def __init__(self, linkage: FunctionLinkage, location: Location, symbol: Symbol):
        self.linkage: FunctionLinkage = linkage
        self.location: Location = location
        self.symbol: Symbol = symbol

    def __str__(self):
        return f" * {self.symbol}"

    def __repr__(self):
        return self.__str__()


class Program:
    def __init__(self, db: CompilationDatabase):
        self.globalScope: Scope = db.getGlobalScope()
        self.externFunctionRefs: List[ExternFunctionRef] = []

    def __str__(self):
        s = f"Global Symbols:\n{self.globalScope.symbolTable}\nExtern Function Refs:\n"
        for ref in self.externFunctionRefs:
            s += f"{ref}\n"
        return s

    def __repr__(self):
        return self.__str__()
