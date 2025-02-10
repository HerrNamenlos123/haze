from AdvancedBaseVisitor import AdvancedBaseVisitor
from typing import Optional, List, Tuple, Dict
from Symbol import (
    VariableSymbol,
    VariableType,
    FunctionSymbol,
    DatatypeSymbol,
    GenericPlaceholderSymbol,
)
from Error import CompilerError, InternalError
from Scope import Scope
from Location import Location
from CompilationDatabase import CompilationDatabase
from grammar import HazeParser
from utils import implGenericDatatype
from Namespace import Namespace
from SymbolName import SymbolName
from Datatype import Datatype, FunctionLinkage


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
            )
            self.db.getCurrentScope().defineSymbol(symbol, self.getLocation(ctx))
            self.setNodeSymbol(ctx, symbol)

    def visitGenericDatatype(self, ctx: HazeParser.HazeParser.GenericDatatypeContext):
        implGenericDatatype(self, ctx, True, False)

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
            Datatype.createFunctionType(
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
        flags: str = ""
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
        functionDatatype = Datatype.createFunctionType(
            self.getParamTypes(ctx.params()), returntype
        )

        if len(signature) > 1:
            raise InternalError("External Namespaces are not implemented yet!")

        functionType = FunctionLinkage.Haze
        if not self.currentExternBlockLanguage:
            raise InternalError("Extern func def must have external language")

        if self.currentExternBlockLanguage == "C":
            functionType = FunctionLinkage.External_C

        symbol = FunctionSymbol(
            SymbolName(signature[-1]),
            functionDatatype,
            functionType,
        )
        self.db.getGlobalScope().defineSymbol(symbol, self.getLocation(ctx))
        self.setNodeSymbol(ctx, symbol)
        self.setNodeDatatype(ctx, symbol.type)
        if self.currentExternBlockLanguage:
            self.setNodeExternlang(ctx, self.currentExternBlockLanguage)
        self.db.defineExternFunctionRef(
            self.currentExternBlockLanguage, self.getLocation(ctx), symbol
        )

    def visitFuncbody(self, ctx):
        # This intentionally skips all children, to only process function declarations without bodies (yet)
        pass

    def implFunc(self, ctx, name: str):
        scope = self.db.pushScope(
            Scope(self.getLocation(ctx), self.db.getCurrentScope())
        )
        self.setNodeScope(ctx, scope)

        self.visitChildren(ctx)
        rtype = self.db.getBuiltinDatatype("unknown")
        if ctx.returntype():
            rtype = self.getNodeDatatype(ctx.returntype())

        functype = Datatype.createFunctionType(self.getParamTypes(ctx.params()), rtype)
        namespaces = []
        if len(self.structStack) > 0:
            # functype.generics = (self.structStack[-1][1], None)
            namespaces.append(self.structStack[-1][0])
        symbol = FunctionSymbol(
            SymbolName(name, namespaces),
            functype,
            FunctionLinkage.Haze,
        )
        symbol.ctx = ctx
        self.db.getGlobalScope().defineSymbol(symbol, self.getLocation(ctx))

        if rtype.isUnknown():
            if len(self.structStack) > 0 and name == "constructor":
                rtype = Datatype.createDeferredType()
                f = Datatype.createFunctionType(functype.functionParameters, rtype)
                symbol.type = f
            elif ctx.funcbody().expr():
                rtype = self.getNodeDatatype(ctx.funcbody().expr())
                f = Datatype.createFunctionType(functype.functionParameters, rtype)
                symbol.type = f

            elif not ctx.returntype():
                f = Datatype.createFunctionType(
                    functype.functionParameters,
                    self.db.getBuiltinDatatype("none"),
                )
                symbol.type = f

        if len(self.structStack) != 0:
            if name == "constructor":
                symbol.isConstructor = True
            else:
                symbol.thisPointerType = Datatype.createDeferredType()

        self.db.popScope()

        self.setNodeSymbol(ctx, symbol)
        self.setNodeDatatype(ctx, symbol.type)

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
        )
        self.db.getCurrentScope().defineSymbol(memberSymbol, self.getLocation(ctx))
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

        for generic in genericsList:
            scope.defineSymbol(
                GenericPlaceholderSymbol(SymbolName(generic)), self.getLocation(ctx)
            )

        self.structStack.append((name, genericsList))
        self.visitChildren(ctx)
        self.structStack.pop()

        structtype = Datatype.createStructDatatype(SymbolName(name), genericsList)
        for content in ctx.structcontent():
            structtype.structMemberSymbols.insert(
                self.getNodeSymbol(content), self.getLocation(ctx)
            )

        symbol = DatatypeSymbol(SymbolName(name), structtype)
        self.setNodeSymbol(ctx, symbol)
        self.db.popScope()
        self.db.getCurrentScope().defineSymbol(symbol, self.getLocation(ctx))
        self.setNodeDatatype(ctx, symbol.type)

    def visitStructFuncDecl(self, ctx):
        name = ctx.ID().getText()
        self.implFunc(ctx, name)
