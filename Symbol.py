from Datatype import Datatype, FunctionLinkage
from Location import Location
from enum import Enum
from Error import InternalError
from typing import List, Tuple, Optional, Dict, Any
from Namespace import Namespace
from grammar import HazeParser
from antlr4 import ParserRuleContext
import copy


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

    # def __deepcopy__(self, memo):
    #     s = VariableSymbol(
    #         self.name,
    #         self.parentSymbol,
    #         self.type,
    #         self.variableType,
    #     )
    #     s.fullyAnalyzed = self.fullyAnalyzed
    #     return s


class GenericPlaceholderSymbol(Symbol):
    def __init__(self, name: str):
        super().__init__(name, None, Datatype.createGenericPlaceholder(name))

    def __str__(self):
        return f"GenericPlaceholder({self.name})"

    def __repr__(self):
        return self.__str__()

    def __deepcopy__(self, memo):
        s = GenericPlaceholderSymbol(
            self.name,
        )
        return s


class DatatypeSymbol(Symbol):
    def __init__(self, name: str, parentSymbol: Optional[Symbol], type: Datatype):
        super().__init__(name, parentSymbol, type)

    def __str__(self):
        s = f"Type {self.name} = {self.type}"
        if self.type.isStruct():
            s += " { "
            s += ", ".join(
                f"{m.name}: {m.type}" for m in self.type.structSymbolTable().symbols
            )
            s += " }"
        return s

    def __repr__(self):
        return self.__str__()

    def __deepcopy__(self, memo):
        s = DatatypeSymbol(
            self.name,
            copy.deepcopy(self.parentSymbol),
            self.type,
        )
        s.ctx = self.ctx
        return s


class ConstantSymbol(Symbol):
    def __init__(self, type: Datatype, value: Any):
        super().__init__("__Constant", None, type)
        self.value = value

    def __str__(self):
        return f"ConstantSymbol({self.type} = {self.value})"

    def __repr__(self):
        return self.__str__()


class StructMemberSymbol(Symbol):
    def __init__(
        self, name: str, struct: Datatype, type: Datatype, expr: ParserRuleContext
    ):
        super().__init__(name, None, type)
        self.struct = struct
        self.expr = expr

    def __str__(self):
        return f"StructMemberSymbol({self.name}: {self.struct} = {self.type})"

    def __repr__(self):
        return self.__str__()
