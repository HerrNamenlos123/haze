from Symbol import Symbol
from Datatype import Datatype, FunctionLinkage
from SymbolName import SymbolName
from antlr4 import ParserRuleContext
from typing import Optional, List
from Scope import Scope
from Error import InternalError


class FunctionSymbol(Symbol):
    def __init__(
        self,
        name: str,
        parentSymbol: Optional[Symbol],
        type: Datatype,
        functionLinkage: FunctionLinkage,
        scope: Optional[Scope],
        ctx: ParserRuleContext,
    ):
        super().__init__(name, parentSymbol, type, ctx)
        self.thisPointerType: Optional[Datatype] = None
        self.isConstructor: bool = False
        self.scope = scope
        self.functionLinkage = functionLinkage
        self.returnedTypes: List[Datatype] = []

    def __str__(self):
        s = ""
        match self.functionLinkage:
            case FunctionLinkage.Haze:
                pass
            case FunctionLinkage.External_C:
                s += "extern-c "

        n = self.name
        p = self.parentSymbol
        while p is not None:
            n = f"{p.type.getDisplayName()}.{n}"
            p = p.parentSymbol
        s += n

        g = []
        for t in self.type.generics:
            if t[1]:
                g.append(f"{t[0]} = {t[1].getDisplayName()}")
            else:
                g.append(f"{t[0]}")
        if len(g) > 0:
            s += f"<{','.join(g)}>"
        s += "("
        params = []
        if self.thisPointerType:
            params.append(f"this: {self.thisPointerType}")
        for n, type in self.type.functionParameters:
            params.append(f"{n}: {type}")
        s += ", ".join(params)
        s += f") -> {self.type.functionReturnType}"
        return s

    def __repr__(self):
        return self.__str__()

    def getMangledName(self):
        if self.functionLinkage == FunctionLinkage.External_C:
            return str(self.name)
        mangled = "_H"
        p = self.parentSymbol
        if p is not None:
            mangled += "N"
            while p is not None:
                mangled += str(len(p.name))
                mangled += p.name
        mangled += str(len(self.name))
        mangled += self.name

        if len(self.type.generics) > 0:
            mangled += "I"
            for t in self.type.generics:
                if not t[1]:
                    raise InternalError("Cannot mangle non-instantiated generic type")
                mangled += t[1].getMangledName()
            mangled += "E"

        if self.parentSymbol is not None:
            mangled += "E"
        return mangled
