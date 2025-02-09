from Datatype import Datatype, FunctionLinkage
from Location import Location
from enum import Enum
from Error import InternalError
from typing import List, Tuple, Optional, Dict
from Namespace import Namespace
from SymbolName import SymbolName
import copy


class Symbol:
    def __init__(self, name: SymbolName, type: Datatype):
        self.name = name
        self.type = type

    def isMutable(self) -> bool:
        return False

    def duplicateWithOtherType(self, type: Datatype) -> "Symbol":
        raise InternalError("Not implemented")


class VariableType(Enum):
    MutableVariable = (1,)
    ContantVariable = (2,)
    Parameter = (3,)
    MutableStructField = (4,)
    ConstantStructField = 5


class VariableSymbol(Symbol):
    def __init__(
        self,
        name: SymbolName,
        type: Datatype,
        variableType: VariableType,
    ):
        super().__init__(name, type)
        self.variableType = variableType

    def isMutable(self):
        return self.variableType in [
            VariableType.MutableVariable,
            VariableType.MutableStructField,
        ]

    def getVariableType(self):
        return self.variableType

    def duplicateWithOtherType(self, type: Datatype):
        return VariableSymbol(self.name, type, self.variableType)

    def __str__(self):
        return f"VariableSymbol({self.name}: {self.type})"

    def __repr__(self):
        return self.__str__()


class FunctionSymbol(Symbol):
    def __init__(
        self,
        name: SymbolName,
        type: Datatype,
        functionLinkage: FunctionLinkage = FunctionLinkage.Haze,
    ):
        super().__init__(name, type)
        self.hasThisPointer: bool = False
        self.thisPointerType: Optional[Datatype] = None
        self.isConstructor: bool = False
        self.functionLinkage = functionLinkage
        self.ctx = None

    def duplicateWithOtherType(self, type: Datatype):
        f = FunctionSymbol(self.name, type)
        f.hasThisPointer = self.hasThisPointer
        f.thisPointerType = self.thisPointerType
        f.isConstructor = self.isConstructor
        f.functionLinkage = self.functionLinkage
        f.ctx = self.ctx
        return f

    def __deepcopy__(self, memo):
        new_obj = FunctionSymbol(
            copy.deepcopy(self.name, memo),
            copy.deepcopy(self.type, memo),
        )
        memo[id(self)] = new_obj
        new_obj.hasThisPointer = self.hasThisPointer
        new_obj.thisPointerType = copy.deepcopy(self.thisPointerType, memo)
        new_obj.isConstructor = self.isConstructor
        new_obj.functionLinkage = self.functionLinkage
        new_obj.ctx = self.ctx
        return new_obj

    def __str__(self):
        s = f"{self.name}"
        g = []
        for t in self.type.generics:
            # if t in self.type.genericsDict:
            #     t = f"{t} = {self.type.genericsDict[t].getDisplayName()}"
            g.append(t)
        if len(g) > 0:
            s += f"<{','.join(g)}>"
        s += "("
        params = []
        if self.hasThisPointer:
            params.append(f"this: {self.thisPointerType}")
        for name, type in self.type.functionParameters:
            params.append(f"{name}: {type}")
        s += ", ".join(params)
        s += f") -> {self.type.functionReturnType}"
        return s

    def __repr__(self):
        return self.__str__()

    def getMangledName(self):
        if self.functionLinkage == FunctionLinkage.External_C:
            return str(self.name)
        mangled = "_H"
        if len(self.name.namespaces) > 0:
            mangled += "N"
            for ns in self.name.namespaces:
                mangled += str(len(ns))
                mangled += ns
        mangled += str(len(self.name.name))
        mangled += self.name.name

        if len(self.type.generics) > 0:
            mangled += "I"
            # for t in self.getType().generics:
            #     mangled += self.getType().genericsDict[t].getMangledName()
            mangled += "E"

        if len(self.name.namespaces) > 0:
            mangled += "E"
        return mangled


class GenericPlaceholderSymbol(Symbol):
    def __init__(self, name: SymbolName):
        super().__init__(name, Datatype.createGenericPlaceholder(name.name))


class DatatypeSymbol(Symbol):
    def __init__(self, name: SymbolName, type: Datatype):
        super().__init__(name, type)

    def duplicateWithOtherType(self, type: Datatype):
        return DatatypeSymbol(self.name, type)


class StructMemberSymbol(Symbol):
    def __init__(self, name: SymbolName, type: Datatype):
        super().__init__(name, type)

    def duplicateWithOtherType(self, type: Datatype):
        return StructMemberSymbol(self.name, type)
