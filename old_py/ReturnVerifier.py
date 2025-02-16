from old_py.AdvancedBaseVisitor import AdvancedBaseVisitor
from CompilationDatabase import CompilationDatabase
from Error import CompilerError, getCallerLocation, UnreachableCode
from Datatype import Datatype, isSame
from typing import List


class ReturnVerifier(AdvancedBaseVisitor):
    def __init__(self, filename: str, db: CompilationDatabase):
        super().__init__(filename, db)
        self.currentFunctionReturnType: List[Datatype] = []

    def visitReturntype(self, ctx):
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.datatype()))

    def visitReturnStatement(self, ctx):
        self.visitChildren(ctx)
        type = self.getNodeDatatype(ctx)
        if self.getCurrentReturnType().isNone() and not type.isNone():
            raise CompilerError(
                "Cannot return a value from a function returning none",
                self.getLocation(ctx),
            )
        self.getNodeScope(ctx).setTerminated(True)

    def implFunc(self, ctx):
        functype = self.getNodeDatatype(ctx)
        scope = self.getNodeScope(ctx)
        if functype.functionReturnType is not None:
            self.currentFunctionReturnType.append(functype.functionReturnType)
        self.visitChildren(ctx)
        if not scope.isTerminated() and not self.getCurrentReturnType().isNone():
            raise CompilerError("Function must return a value", self.getLocation(ctx))
        self.currentFunctionReturnType.pop()

    def visitStructFuncDecl(self, ctx):
        return self.implFunc(ctx)

    def visitFunc(self, ctx):
        return self.implFunc(ctx)

    def visitFuncbody(self, ctx):
        if ctx.body():
            self.visit(ctx.body())
        elif ctx.expr():
            self.visit(ctx.expr())
            type = self.getNodeDatatype(ctx.expr())
            if self.getCurrentReturnType().isNone() and not type.isNone():
                raise CompilerError(
                    "Cannot return a value from a function returning none",
                    self.getLocation(ctx),
                )
            self.getNodeScope(ctx).setTerminated(True)

    def visitNamedfunc(self, ctx):
        functype = self.getNodeDatatype(ctx)
        symbol = self.getNodeSymbol(ctx)
        scope = self.getNodeScope(ctx)
        if functype.functionReturnType is not None:
            self.currentFunctionReturnType.append(functype.functionReturnType)
        scope.setTerminated(False)
        self.visitChildren(ctx)
        if not scope.isTerminated() and not self.getCurrentReturnType().isNone():
            raise CompilerError("Function must return a value", self.getLocation(ctx))

        if symbol.name == "main":
            if functype.functionReturnType is None:
                raise UnreachableCode()
            if not isSame(
                functype.functionReturnType, self.db.getBuiltinDatatype("i32")
            ):
                raise CompilerError(
                    "Main function must return i32", self.getLocation(ctx)
                )

        self.currentFunctionReturnType.pop()

    def getCurrentReturnType(self):
        if len(self.currentFunctionReturnType) == 0:
            raise CompilerError(
                "Cannot get current return type: No function on the stack",
                getCallerLocation(),
            )
        return self.currentFunctionReturnType[-1]
