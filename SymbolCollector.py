from AdvancedBaseVisitor import AdvancedBaseVisitor
from typing import Optional, List, Tuple, Dict
from Symbol import (
    VariableSymbol,
    VariableType,
    FunctionSymbol,
    DatatypeSymbol,
    FunctionType,
)
from Error import CompilerError, InternalError
from Datatype import FunctionDatatype, StructDatatype, GenericPlaceholder, Datatype
from Scope import Scope
from Location import Location
from CompilationDatabase import CompilationDatabase
from grammar import HazeParser
from utils import implGenericDatatype
from Namespace import Namespace
from SymbolName import SymbolName


class SymbolCollector(AdvancedBaseVisitor):
    def __init__(self, filename, db):
        super().__init__(filename, db)
        self.currentExternBlockLanguage: Optional[str] = None
        self.structStack: List[Tuple[str, List[str]]] = []

    def visitParam(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        if not self.currentExternBlockLanguage:
            self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.datatype()))
            symbol = VariableSymbol(
                SymbolName(ctx.ID().getText()),
                self.getNodeDatatype(ctx),
                VariableType.Parameter,
                self.getLocation(ctx),
            )
            self.db.getCurrentScope().defineSymbol(symbol)

    def visitGenericDatatype(self, ctx: HazeParser.HazeParser.GenericDatatypeContext):
        currentGenerics = self.structStack[-1][1] if len(self.structStack) > 0 else []
        implGenericDatatype(self, ctx, currentGenerics)

    def visitFunctionDatatype(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        if not ctx.functype().returntype():
            raise CompilerError(
                "Function datatype must have an explicit return type.",
                self.getLocation(ctx),
            )
        self.setNodeDatatype(
            ctx,
            FunctionDatatype(
                self.getParamTypes(ctx.functype().params()),
                self.getNodeDatatype(ctx.functype().returntype()),
            ),
        )

    def visitExternblock(self, ctx):
        lang = ctx.externlang().getText()[1:-1]
        if lang != "C":
            raise CompilerError(
                f"Extern Language '{lang}' is not supported.",
                self.getLocation(ctx.externlang()),
            )
        self.setNodeExternlang(ctx, lang)
        self.currentExternBlockLanguage = lang
        self.visitChildren(ctx)
        self.currentExternBlockLanguage = None

    def visitCompilationhint(self, ctx):
        self.visitChildren(ctx)
        lang = ctx.compilationlang().getText()[1:-1]
        if lang != "C":
            raise CompilerError(
                f"Compilation Language '{lang}' is not supported.",
                self.getLocation(ctx),
            )

        filename = ctx.compilationhintfilename().getText()[1:-1]
        flags = ""
        if ctx.compilationhintflags():
            flags = ctx.compilationhintflags().getText()[1:-1]

        self.db.defineExternalCompilationUnit(filename, lang, flags.split(" "))
        self.setNodeCompilationHintFilename(ctx, filename)

    def visitLinkerhint(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.db.addExternalLinkerFlags(ctx.STRING_LITERAL().getText().split(" "))

    def visitReturntype(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.datatype()))

    def visitExternfuncdef(self, ctx):
        self.visitChildren(ctx)
        signature = [n.getText() for n in ctx.ID()]
        returntype = (
            self.getNodeDatatype(ctx.returntype())
            if ctx.returntype()
            else self.db.getBuiltinDatatype("none")
        )
        functionDatatype = FunctionDatatype(
            self.getParamTypes(ctx.params()), returntype
        )

        if len(signature) > 1:
            raise InternalError("External Namespaces are not implemented yet!")

        functionType = FunctionType.Haze
        if not self.currentExternBlockLanguage:
            raise InternalError("Extern func def must have external language")

        if self.currentExternBlockLanguage == "C":
            functionType = FunctionType.External_C

        symbol = FunctionSymbol(
            SymbolName(signature[-1]),
            functionDatatype,
            functionType,
            self.getLocation(ctx),
        )
        self.db.getGlobalScope().defineSymbol(symbol)
        self.setNodeSymbol(ctx, symbol)
        self.setNodeDatatype(ctx, symbol.getType())
        if self.currentExternBlockLanguage:
            self.setNodeExternlang(ctx, self.currentExternBlockLanguage)
        self.db.defineExternFunctionRef(
            self.currentExternBlockLanguage, self.getLocation(ctx), symbol
        )

    def visitFuncbody(self, ctx):
        pass
        # This intentionally skips all children
        # self.useCurrentNodeScope(ctx)
        # self.visitChildren(ctx)

    def implFunc(self, ctx, name: str):
        scope = self.db.pushScope(
            Scope(self.getLocation(ctx), self.db.getCurrentScope())
        )
        self.setNodeScope(ctx, scope)

        self.visitChildren(ctx)
        rtype = self.db.getBuiltinDatatype("unknown")
        if ctx.returntype():
            rtype = self.getNodeDatatype(ctx.returntype())

        functype = FunctionDatatype(self.getParamTypes(ctx.params()), rtype)
        symbol = FunctionSymbol(
            SymbolName(name), functype, FunctionType.Haze, self.getLocation(ctx)
        )
        if len(self.structStack) != 0:
            symbol.parentNamespace = Namespace(self.structStack[-1][0])
        self.db.getGlobalScope().defineSymbol(symbol)

        if rtype.isUnknown():
            if ctx.funcbody().expr():
                rtype = self.getNodeDatatype(ctx.funcbody().expr())
                symbol.replaceType(FunctionDatatype(functype.getParameters(), rtype))

            elif not ctx.returntype():
                symbol.replaceType(
                    FunctionDatatype(
                        functype.getParameters(), self.db.getBuiltinDatatype("none")
                    )
                )

        if len(self.structStack) != 0:
            if name == "constructor":
                symbol.setIsConstructor()
            else:
                symbol.hasThisPointer = True

        self.db.popScope()

        self.setNodeSymbol(ctx, symbol)
        self.setNodeDatatype(ctx, symbol.getType())

    def visitFunc(self, ctx):
        return self.implFunc(ctx, self.db.makeAnonymousFunctionName())

    def visitNamedfunc(self, ctx):
        return self.implFunc(ctx, ctx.ID().getText())

    def visitStructFieldDecl(self, ctx):
        self.visitChildren(ctx)
        name = ctx.ID().getText()
        type = self.getNodeDatatype(ctx.datatype())

        memberSymbol = VariableSymbol(
            SymbolName(name),
            type,
            VariableType.MutableStructField,
            self.getLocation(ctx),
        )
        self.db.getCurrentScope().defineSymbol(memberSymbol)
        self.setNodeSymbol(ctx, memberSymbol)

    def visitStructDecl(self, ctx):
        name = ctx.ID().getText()
        scope = self.db.pushScope(
            Scope(self.getLocation(ctx), self.db.getCurrentScope())
        )
        self.setNodeScope(ctx, scope)

        genericsList = []
        if ctx.generictypelist():
            genericsList = [n.getText() for n in ctx.generictypelist().ID()]
        self.structStack.append((name, genericsList))
        self.visitChildren(ctx)
        self.structStack.pop()

        structtype = StructDatatype(name)
        structtype.genericsList = genericsList
        for content in ctx.structcontent():
            structtype.addMember(self.getNodeSymbol(content))

        symbol = DatatypeSymbol(SymbolName(name), structtype, self.getLocation(ctx))
        self.setNodeSymbol(ctx, symbol)
        self.db.popScope()
        self.db.getCurrentScope().defineSymbol(symbol)
        self.setNodeDatatype(ctx, symbol.getType())

    def visitStructFuncDecl(self, ctx):
        name = ctx.ID().getText()
        self.implFunc(ctx, name)
