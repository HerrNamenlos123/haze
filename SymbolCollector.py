from AdvancedBaseVisitor import AdvancedBaseVisitor
from typing import Optional, List, Tuple, Dict
from Symbol import (
    VariableSymbol,
    VariableType,
    DatatypeSymbol,
    GenericPlaceholderSymbol,
)
from FunctionSymbol import FunctionSymbol
from Error import CompilerError, InternalError, ImpossibleSituation
from Scope import Scope
from grammar.HazeParser import HazeParser
from Datatype import Datatype, FunctionLinkage
from Program import Program, ExternFunctionRef
from utils import resolveGenerics


class SymbolCollector(AdvancedBaseVisitor):
    def __init__(self, filename, db):
        super().__init__(filename, db)
        self.program = Program(db)
        self.currentLinkage: Optional[FunctionLinkage] = None
        self.structStack: List[DatatypeSymbol] = []
        self.currentFunctionSymbols: List[FunctionSymbol] = []

    def visitParam(self, ctx):
        return ctx.ID().getText(), self.visit(ctx.datatype())

    def visitGenericDatatype(self, ctx: HazeParser.GenericDatatypeContext):
        name = ctx.ID().getText()
        foundSymbol = self.db.getCurrentScope().tryLookupSymbol(
            name, self.getLocation(ctx)
        )
        if not foundSymbol:
            raise CompilerError(
                f"Type '{name}' is not defined.",
                self.getLocation(ctx),
            )

        genericsProvided = [self.visit(n) for n in ctx.datatype()]
        if len(foundSymbol.type.generics) != len(genericsProvided):
            raise CompilerError(
                f"Datatype expected {len(foundSymbol.type.generics)} generic arguments but got {len(genericsProvided)}.",
                self.getLocation(ctx),
            )
        dt = resolveGenerics(
            foundSymbol.type, self.db.getCurrentScope(), self.getLocation(ctx)
        )
        return dt

    def visitFunctionDatatype(self, ctx):
        params = []
        for param in ctx.functype().params().param():
            params.append(self.visit(param))

        return Datatype.createFunctionType(
            params,
            self.visit(ctx.functype().returntype()),
        )

    def visitExternblock(self, ctx):
        lang = ctx.externlang().getText()[1:-1]
        match lang:
            case "C":
                if self.currentLinkage:
                    raise CompilerError(
                        "Extern blocks cannot be nested",
                        self.getLocation(ctx),
                    )
                self.currentLinkage = FunctionLinkage.External_C
                self.visitChildren(ctx)
                self.currentLinkage = None
            case _:
                raise CompilerError(
                    f"Extern Language '{lang}' is not supported.",
                    self.getLocation(ctx.externlang()),
                )

    # def visitCompilationhint(self, ctx):
    #     self.visitChildren(ctx)
    #     lang = ctx.compilationlang().getText()[1:-1]
    #     if lang != "C":
    #         raise CompilerError(
    #             f"Compilation Language '{lang}' is not supported.",
    #             self.getLocation(ctx),
    #         )

    #     filename = ctx.compilationhintfilename().getText()[1:-1]
    #     flags: str = ""
    #     if ctx.compilationhintflags():
    #         flags = ctx.compilationhintflags().getText()[1:-1]

    #     self.db.defineExternalCompilationUnit(filename, lang, flags.split(" "))
    #     self.setNodeCompilationHintFilename(ctx, filename)

    # def visitLinkerhint(self, ctx):
    #     self.useCurrentNodeScope(ctx)
    #     self.visitChildren(ctx)
    #     self.db.addExternalLinkerFlags(ctx.STRING_LITERAL().getText().split(" "))

    def visitReturntype(self, ctx):
        return self.visit(ctx.datatype())

    def visitExternfuncdef(self, ctx: HazeParser.ExternfuncdefContext):
        if not self.currentLinkage:
            raise ImpossibleSituation()

        signature = [n.getText() for n in ctx.ID()]
        if len(signature) > 1 and self.currentLinkage == FunctionLinkage.External_C:
            raise CompilerError(
                "Extern C functions cannot be namespaced", self.getLocation(ctx)
            )

        if len(signature) > 1:
            raise InternalError(
                "Namespacing for external function is not implemented yet"
            )

        name = signature[-1]
        symbol = FunctionSymbol(
            name,
            None,
            Datatype.createFunctionType(
                [], Datatype.createPrimitiveType(Datatype.PrimitiveVariants.none)
            ),
            self.currentLinkage,
            None,
            ctx,
        )

        for i in range(len(ctx.params().param())):
            name, datatype = self.visit(ctx.params().param()[i])
            symbol.type.functionParameters.append((name, datatype))

        self.currentFunctionSymbols.append(symbol)
        self.visitChildren(ctx)
        self.currentFunctionSymbols.pop()

        if ctx.returntype():
            symbol.type.functionReturnType = self.visit(ctx.returntype())

        self.program.globalScope.defineSymbol(symbol, self.getLocation(ctx))
        self.program.externFunctionRefs.append(
            ExternFunctionRef(FunctionLinkage.External_C, self.getLocation(ctx), symbol)
        )

    def implFunc(
        self,
        ctx: (
            HazeParser.FuncContext
            | HazeParser.NamedfuncContext
            | HazeParser.StructFuncDeclContext
        ),
        name: str,
    ):
        scope = self.db.pushScope(
            Scope(self.getLocation(ctx), self.db.getCurrentScope())
        )

        if self.currentLinkage:
            raise ImpossibleSituation()

        symbol = FunctionSymbol(
            name,
            self.structStack[-1] if len(self.structStack) > 0 else None,
            Datatype.createFunctionType([], Datatype.createDeferredType()),
            FunctionLinkage.Haze,
            scope,
            ctx,
        )
        self.setNodeSymbol(ctx, symbol)

        for i in range(len(ctx.params().param())):
            nm, datatype = self.visit(ctx.params().param()[i])
            symbol.type.functionParameters.append((nm, datatype))
            if symbol.scope:
                symbol.scope.defineSymbol(
                    VariableSymbol(nm, symbol, datatype, VariableType.Parameter),
                    self.getLocation(ctx),
                )

        if ctx.returntype():
            symbol.type.functionReturnType = self.visit(ctx.returntype())
        else:
            symbol.type.functionReturnType = Datatype.createDeferredType()

        if symbol.type.functionReturnType.isDeferred():
            if ctx.funcbody().expr():
                expr = self.visit(ctx.funcbody().expr())
                symbol.type.functionReturnType = expr.type

        if symbol.parentSymbol and symbol.parentSymbol.type.isStruct():
            if name == "constructor":
                symbol.isConstructor = True
                if symbol.type.functionReturnType.isDeferred():
                    symbol.type.functionReturnType = symbol.parentSymbol.type
                else:
                    raise CompilerError(
                        f"Constructor of struct '{symbol.parentSymbol.name}' returns the struct itself implicitly",
                        self.getLocation(ctx),
                    )
            else:
                symbol.thisPointerType = Datatype.createPointerDatatype(
                    symbol.parentSymbol.type
                )
                if not symbol.scope:
                    raise ImpossibleSituation()
                symbol.scope.defineSymbol(
                    VariableSymbol(
                        "this", symbol, symbol.thisPointerType, VariableType.Parameter
                    ),
                    self.getLocation(ctx),
                )
        self.program.globalScope.defineSymbol(symbol, self.getLocation(ctx))

        self.db.popScope()
        return symbol

    def visitFunc(self, ctx):
        return self.implFunc(ctx, self.db.makeAnonymousFunctionName())

    def visitNamedfunc(self, ctx):
        return self.implFunc(ctx, ctx.ID().getText())

    def visitStructFieldDecl(self, ctx):
        name = ctx.ID().getText()
        datatype = self.visit(ctx.datatype())
        return VariableSymbol(
            name,
            self.structStack[-1],
            datatype,
            VariableType.MutableStructField,
        )

    def visitStructDecl(self, ctx):
        name = ctx.ID().getText()
        parentScope = self.db.getCurrentScope()
        scope = self.db.pushScope(Scope(self.getLocation(ctx), parentScope))

        genericsList = [(n.getText(), None) for n in ctx.datatype()]
        for generic in genericsList:
            scope.defineSymbol(
                GenericPlaceholderSymbol(generic[0]), self.getLocation(ctx)
            )

        symbol = DatatypeSymbol(
            name,
            self.structStack[-1] if len(self.structStack) > 0 else None,
            Datatype.createStructDatatype(name, genericsList),
        )
        parentScope.defineSymbol(symbol, self.getLocation(ctx))

        self.structStack.append(symbol)

        for content in ctx.structcontent():
            symbol.type.structMemberSymbols.insert(
                self.visit(content), self.getLocation(ctx)
            )

        self.structStack.pop()
        self.db.popScope()

    def visitStructFuncDecl(self, ctx):
        name = ctx.ID().getText()
        return self.implFunc(ctx, name)
