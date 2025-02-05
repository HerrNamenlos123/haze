from Datatype import Datatype
from Location import Location
from enum import Enum
from Error import InternalError
from typing import List, Tuple


class Symbol:
    def __init__(self, name: str, type: Datatype, declarationLocation: Location):
        self.name = name
        self.type = type
        self.declarationLocation = declarationLocation

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
        self.hasStructReturn = False
        self.isConstructor = False

    def getVisibleParameters(self):
        params: List[Tuple[str, Datatype]] = self.type.getParameters()
        if self.hasThisPointer:
            params.remove(params[0])
        if self.hasStructReturn:
            params.remove(params[0])
        return params

    def getNativeStructReturnIndex(self):
        if self.hasStructReturn:
            return 0
        raise InternalError("No struct return")

    def getNativeThisPointerIndex(self):
        if self.hasThisPointer:
            return 1 if self.hasStructReturn else 0
        raise InternalError("No this pointer")

    def visibleParameterToNativeIndex(self, visibleIndex: int):
        if self.hasThisPointer:
            visibleIndex += 1
        if self.hasStructReturn:
            visibleIndex += 1
        return visibleIndex

    def setHasThisPointer(self):
        self.hasThisPointer = True

    def setIsConstructor(self):
        self.isConstructor = True


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
