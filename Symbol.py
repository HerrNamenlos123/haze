from Datatype import Datatype, FunctionLinkage
from Location import Location
from enum import Enum
from Error import InternalError
from typing import List, Tuple, Optional, Dict
from Namespace import Namespace
from grammar import HazeParser
from antlr4 import ParserRuleContext


class Symbol:
    def __init__(
        self,
        name: str,
        parentSymbol: Optional["Symbol"],
        type: Datatype,
        ctx: Optional[ParserRuleContext] = None,
    ):
        self.name = name
        self.parentSymbol = parentSymbol
        self.type = type
        self.ctx = ctx
        self.fullyAnalyzed = False

    def isMutable(self) -> bool:
        return False


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
        parentSymbol: Optional["Symbol"],
        type: Datatype,
        variableType: VariableType,
    ):
        super().__init__(name, parentSymbol, type)
        self.variableType = variableType

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


class GenericPlaceholderSymbol(Symbol):
    def __init__(self, name: str):
        super().__init__(name, None, Datatype.createGenericPlaceholder(name))


class DatatypeSymbol(Symbol):
    def __init__(self, name: str, parentSymbol: Optional[Symbol], type: Datatype):
        super().__init__(name, parentSymbol, type)
