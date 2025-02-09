from Datatype import Datatype
from Location import Location
from enum import Enum
from Error import InternalError
from typing import List, Tuple, Optional, Dict
from Namespace import Namespace


class Symbol:
    def __init__(self, name: str, type: Datatype, declarationLocation: Location):
        self.name = name
        self.type = type
        self.declarationLocation = declarationLocation
        self.parentNamespace: Optional[Namespace] = None

    def isMutable(self):
        pass

    def replaceType(self, type: Datatype):
        self.type = type

    def getName(self):
        return self.name

    def getType(self):
        return self.type


class VariableType(Enum):
    MutableVariable = (1,)
    ContantVariable = (2,)
    Parameter = (3,)
    MutableStructField = (4,)
    ConstantStructField = 5


class VariableSymbol(Symbol):
    def __init__(
        self,
        name: str,
        type: Datatype,
        variableType: VariableType,
        declarationLocation: Location,
    ):
        self.name = name
        self.type = type
        self.variableType = variableType
        self.declarationLocation = declarationLocation

    def isMutable(self):
        return self.variableType in [
            VariableType.MutableVariable,
            VariableType.MutableStructField,
        ]

    def getVariableType(self):
        return self.variableType

    def __str__(self):
        return f"VariableSymbol({self.name}: {self.type})"

    def __repr__(self):
        return self.__str__()


class FunctionType(Enum):
    Toy = (1,)
    External_C = (2,)


class FunctionSymbol(Symbol):
    def __init__(
        self,
        name: str,
        type: Datatype,
        functionType: FunctionType,
        declarationLocation: Location,
    ):
        self.name = name
        self.type = type
        self.functionType = functionType
        self.declarationLocation = declarationLocation
        self.hasThisPointer = False
        self.thisPointerType = None
        self.isConstructor = False
        self.parentNamespace: Optional[Namespace] = None

    def setThisPointer(self, type: Datatype):
        self.thisPointerType = type

    def setIsConstructor(self):
        self.isConstructor = True

    def __str__(self):
        s = f"FunctionSymbol({self.name}: {self.type}"
        if self.hasThisPointer:
            s += f" <this: {self.thisPointerType}>"
        s += ")"
        return s

    def __repr__(self):
        return self.__str__()

    def getMangledName(self):
        if self.functionType == FunctionType.External_C:
            return self.name
        mangled = "_H"
        if self.parentNamespace is not None:
            mangled += "N"
            pns = self.parentNamespace
            while pns is not None:
                mangled += str(len(pns.name))
                mangled += pns.name
                pns = pns.parent
        mangled += str(len(self.name))
        mangled += self.name
        if self.parentNamespace is not None:
            mangled += "E"
        return mangled


class DatatypeSymbol(Symbol):
    def __init__(self, name: str, type: Datatype, declarationLocation: Location):
        self.name = name
        self.type = type
        self.declarationLocation = declarationLocation


class StructMemberSymbol(Symbol):
    def __init__(self, name: str, type: Datatype, declarationLocation: Location):
        self.name = name
        self.type = type
        self.declarationLocation = declarationLocation
