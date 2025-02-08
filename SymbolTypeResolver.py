from AdvancedBaseVisitor import AdvancedBaseVisitor
from CompilationDatabase import CompilationDatabase
from Error import CompilerError
from Datatype import FunctionDatatype


class SymbolTypeResolver(AdvancedBaseVisitor):
    def __init__(self, filename: str, db: CompilationDatabase):
        super().__init__(filename, db)

    def visitExternfuncdef(self, ctx):
        ftype = self.getNodeDatatype(ctx)
        if isinstance(ftype, FunctionDatatype):
            for name, type in ftype.getParameters():
                if type.isUnknown():
                    raise CompilerError(
                        "Type of Parameter is unknown", self.getLocation(ctx)
                    )
            if ftype.getReturnType().isUnknown():
                raise CompilerError("Return type is unknown", self.getLocation(ctx))

    def visitNamedfunc(self, ctx):
        type = self.getNodeDatatype(ctx)
        for name, type in self.getParamTypes(ctx.params()):
            if type.isUnknown():
                raise CompilerError(
                    f"Type of Parameter is unknown", self.getLocation(ctx)
                )
        function = self.getNodeSymbol(ctx).getType()
        if isinstance(function, FunctionDatatype):
            if function.getReturnType().isUnknown():
                raise CompilerError(
                    f"Function {function.getDisplayName()} has no explicit return type, return type inference is not implemented yet",
                    self.getLocation(ctx),
                )
