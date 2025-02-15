from SymbolTable import SymbolTable
from Location import Location
from Symbol import Symbol
from FunctionSymbol import FunctionSymbol
from typing import List
from Datatype import FunctionLinkage


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
    def __init__(self):
        self.globalSymbols: SymbolTable = SymbolTable()
        self.externFunctionRefs: List[ExternFunctionRef] = []

    def __str__(self):
        s = f"Global Symbols:\n{self.globalSymbols}\nExtern Function Refs:\n"
        for ref in self.externFunctionRefs:
            s += f"{ref}\n"

        s += "\nGlobal Functions:\n"
        for symbol in self.globalSymbols.symbols:
            if (
                isinstance(symbol, FunctionSymbol)
                and symbol.functionLinkage == FunctionLinkage.Haze
            ):
                s += f"Symbol '{symbol}' "
                if symbol.scope:
                    s += f"at {symbol.scope}\n"
                else:
                    s += "\n"
            s += "\n"
        return s

    def __repr__(self):
        return self.__str__()
