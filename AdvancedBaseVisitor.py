from grammar import HazeVisitor
from CompilationDatabase import CompilationDatabase, ObjAttribute
from Datatype import Datatype
from Symbol import Symbol, FunctionSymbol
from Scope import Scope
from typing import List, Tuple
from Error import InternalError, getCallerLocation, CompilerError
from Location import Location


class AdvancedBaseVisitor(HazeVisitor.HazeVisitor):
    def __init__(self, filename: str, db: CompilationDatabase):
        self.filename = filename
        self.db = db

    def __prepare(self, ctx):
        if not hasattr(ctx, "semantics"):
            ctx.semantics = {}

    def setNodeDatatype(self, ctx, datatype: Datatype):
        self.__prepare(ctx)
        ctx.semantics["datatype"] = datatype

    def getNodeDatatype(self, ctx) -> Datatype:
        self.__prepare(ctx)
        return ctx.semantics["datatype"]

    def hasNodeDatatype(self, ctx):
        self.__prepare(ctx)
        return "datatype" in ctx.semantics

    def setNodeExternlang(self, ctx, externlang: str):
        self.__prepare(ctx)
        ctx.semantics["externlang"] = externlang

    def getNodeExternlang(self, ctx) -> str:
        self.__prepare(ctx)
        return ctx.semantics["externlang"]

    def hasNodeExternlang(self, ctx):
        self.__prepare(ctx)
        return "externlang" in ctx.semantics

    def setNodeCompilationHintFilename(self, ctx, filename: str):
        self.__prepare(ctx)
        ctx.semantics["filename"] = filename

    def getNodeCompilationHintFilename(self, ctx) -> str:
        self.__prepare(ctx)
        return ctx.semantics["filename"]

    def hasNodeCompilationHintFilename(self, ctx):
        self.__prepare(ctx)
        return "filename" in ctx.semantics

    def setNodeScope(self, ctx, scope: Scope):
        self.__prepare(ctx)
        ctx.semantics["scope"] = scope

    def getNodeScope(self, ctx) -> Scope:
        self.__prepare(ctx)
        return ctx.semantics["scope"]

    def hasNodeScope(self, ctx):
        self.__prepare(ctx)
        return "scope" in ctx.semantics

    def setNodeBinaryOperator(self, ctx, op: str):
        self.__prepare(ctx)
        ctx.semantics["op"] = op

    def getNodeBinaryOperator(self, ctx) -> str:
        self.__prepare(ctx)
        return ctx.semantics["op"]

    def hasNodeBinaryOperator(self, ctx):
        self.__prepare(ctx)
        return "op" in ctx.semantics

    def setNodeThisPointer(self, ctx, value: Datatype):
        self.__prepare(ctx)
        ctx.semantics["thisPointer"] = value

    def getNodeThisPointer(self, ctx) -> Datatype:
        self.__prepare(ctx)
        return ctx.semantics["thisPointer"]

    def hasNodeThisPointer(self, ctx):
        self.__prepare(ctx)
        return "thisPointer" in ctx.semantics

    def setNodeSymbol(self, ctx, symbol: Symbol):
        self.__prepare(ctx)
        ctx.semantics["symbol"] = symbol

    def getNodeSymbol(self, ctx) -> Symbol:
        self.__prepare(ctx)
        return ctx.semantics["symbol"]

    def hasNodeSymbol(self, ctx):
        self.__prepare(ctx)
        return "symbol" in ctx.semantics

    def setNodeArgtypes(self, ctx, argtypes: List[Datatype]):
        self.__prepare(ctx)
        ctx.semantics["argtypes"] = argtypes

    def getNodeArgtypes(self, ctx) -> List[Datatype]:
        self.__prepare(ctx)
        return ctx.semantics["argtypes"]

    def hasNodeArgtypes(self, ctx):
        self.__prepare(ctx)
        return "argtypes" in ctx.semantics

    def setNodeDatatypeAsValue(self, ctx, datatype: Datatype):
        self.__prepare(ctx)
        ctx.semantics["datatypeAsValue"] = datatype

    def getNodeDatatypeAsValue(self, ctx) -> Datatype:
        self.__prepare(ctx)
        return ctx.semantics["datatypeAsValue"]

    def hasNodeDatatypeAsValue(self, ctx):
        self.__prepare(ctx)
        return "datatypeAsValue" in ctx.semantics

    def setNodeObjectAttribute(self, ctx, attribute: ObjAttribute):
        self.__prepare(ctx)
        ctx.semantics["attribute"] = attribute

    def getNodeObjectAttribute(self, ctx) -> ObjAttribute:
        self.__prepare(ctx)
        return ctx.semantics["attribute"]

    def hasNodeObjectAttribute(self, ctx):
        self.__prepare(ctx)
        return "attribute" in ctx.semantics

    def setNodeMemberAccessFieldIndex(self, ctx, index: int):
        self.__prepare(ctx)
        ctx.semantics["index"] = index

    def getNodeMemberAccessFieldIndex(self, ctx) -> int:
        self.__prepare(ctx)
        return ctx.semantics["index"]

    def hasNodeMemberAccessFieldIndex(self, ctx):
        self.__prepare(ctx)
        return "index" in ctx.semantics

    def setNodeMemberAccessFunctionSymbol(self, ctx, symbol: FunctionSymbol):
        self.__prepare(ctx)
        ctx.semantics["memberAccessFunctionSymbol"] = symbol

    def getNodeMemberAccessFunctionSymbol(self, ctx) -> FunctionSymbol:
        self.__prepare(ctx)
        return ctx.semantics["memberAccessFunctionSymbol"]

    def hasNodeMemberAccessFunctionSymbol(self, ctx):
        self.__prepare(ctx)
        return "memberAccessFunctionSymbol" in ctx.semantics

    def useCurrentNodeScope(self, ctx):
        self.setNodeScope(ctx, self.db.getCurrentScope())

    def useParentsScope(self, ctx):
        if not ctx.parent:
            raise InternalError(
                "Cannot inherit parent scope: Parent is not a valid context",
                getCallerLocation(),
            )
        self.setNodeScope(ctx, self.getNodeScope(ctx.parent))

    def getParamTypes(self, ctx):
        params: List[Tuple[str, Datatype]] = []
        for param in ctx.param():
            params.append(
                (param.ID().getText(), self.getNodeDatatype(param.datatype()))
            )
        return params

    def assertExprCallable(self, ctx):
        t = self.getNodeDatatype(ctx)
        if not t.isCallable():
            raise CompilerError(
                f"Expression of type '{t.getDisplayName()}' is not callable",
                self.getLocation(ctx),
            )

    def assertExpectedNumOfArgs(self, ctx, got: int, expected: int):
        if got != expected:
            raise CompilerError(
                f"Expected {expected} arguments but got {got}", self.getLocation(ctx)
            )

    def getLocation(self, ctx):
        return Location(self.filename, ctx.start.line, ctx.start.column)
