from AdvancedBaseVisitor import AdvancedBaseVisitor
from CompilationDatabase import CompilationDatabase, ObjAttribute
from grammar import HazeParser
from typing import Optional, List
import copy
from Datatype import Datatype, FunctionLinkage
from Symbol import DatatypeSymbol, VariableSymbol, VariableType
from FunctionSymbol import FunctionSymbol
from Error import CompilerError, InternalError, UnreachableCode, ImpossibleSituation
from Namespace import Namespace
from utils import (
    implGenericDatatype,
    getObjectAttributes,
    getNamedObjectAttributes,
    resolveGenerics,
)
from Scope import Scope
from SymbolName import SymbolName
from SymbolTable import SymbolTable, getStructFields, getStructFunctions
from Program import Program


class SemanticAnalyzer(AdvancedBaseVisitor):
    def __init__(self, filename: str, db: CompilationDatabase):
        super().__init__(filename, db)
        self.structStack: List[Datatype] = []

    def visitSymbolValueExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        symbolName = ctx.ID().getText()

        symbol = self.db.getCurrentScope().lookupSymbol(
            symbolName, self.getLocation(ctx)
        )
        if isinstance(symbol, DatatypeSymbol):
            # It's a 'Datatype()' Syntax - A constructor call
            self.setNodeDatatypeAsValue(ctx, symbol.type)
            self.setNodeDatatype(ctx, symbol.type)
            self.setNodeSymbol(ctx, symbol)
        else:
            self.setNodeSymbol(ctx, symbol)
            self.setNodeDatatype(ctx, symbol.type)

    def visitExprCallExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        symbol = self.getNodeSymbol(ctx.expr())

        print("Call symbol", symbol)
        if isinstance(symbol, DatatypeSymbol):
            # Now call constructor on this type
            if not symbol.type.isStruct():
                raise CompilerError(
                    f"Type '{symbol.type.getDisplayName()}' is not a structural type - Only structural types can be instantiated using constructors",
                    self.getLocation(ctx),
                )

            sym = symbol.type.structMemberSymbols.tryLookup(
                "constructor", self.getLocation(ctx)
            )
            if not sym:
                raise CompilerError(
                    f"Type '{symbol.type.getDisplayName()}' does not provide a constructor",
                    self.getLocation(ctx),
                )
            symbol = sym

        visibleParams = []
        returnType: Optional[Datatype] = None
        if isinstance(symbol, FunctionSymbol):
            visibleParams = symbol.type.functionParameters
            returnType = symbol.type.functionReturnType

        elif symbol.type.isFunction():
            visibleParams = symbol.type.functionParameters
            returnType = symbol.type.functionReturnType

        else:
            raise CompilerError(
                f"Expression of type '{symbol.type.getDisplayName()}' is not callable",
                self.getLocation(ctx),
            )

        self.assertExpectedNumOfArgs(ctx, len(ctx.args().expr()), len(visibleParams))
        if not returnType:
            raise UnreachableCode()
        self.setNodeDatatype(ctx, returnType)
        self.setNodeSymbol(ctx, symbol)

    def implFunc(self, ctx):
        self.db.pushScope(self.getNodeScope(ctx))
        symbol = self.getNodeSymbol(ctx)

        if (
            not isinstance(symbol, FunctionSymbol)
            or symbol.type.functionParameters is None
            or symbol.type.functionReturnType is None
        ):
            raise InternalError("Symbol is not a function")

        if symbol.isConstructor:
            if (
                not symbol.type.functionReturnType.isUnknown()
                and not symbol.type.functionReturnType.isNone()
                and not symbol.type.functionReturnType.isDeferred()
            ):
                raise CompilerError(
                    f"Constructor of struct '{self.structStack[-1].getDisplayName()}' cannot have an explicit return type: It returns the struct itself",
                    self.getLocation(ctx),
                )

            symbol.type = Datatype.createFunctionType(
                symbol.type.functionParameters, self.structStack[-1]
            )
            self.setNodeDatatype(ctx, symbol.type)
            self.setNodeSymbol(ctx, symbol)

        if symbol.thisPointerType:
            symbol.thisPointerType = Datatype.createPointerDatatype(
                self.structStack[-1]
            )
            s = VariableSymbol(
                SymbolName("this"),
                Datatype.createPointerDatatype(self.structStack[-1]),
                VariableType.Parameter,
            )
            self.db.getCurrentScope().defineSymbol(s, self.getLocation(ctx))

        self.visitChildren(ctx)

        if symbol.thisPointerType:
            if (
                symbol.type.functionReturnType
                and symbol.type.functionReturnType.isDeferred()
            ):
                symbol.type = Datatype.createFunctionType(
                    symbol.type.functionParameters,
                    self.getNodeDatatype(ctx.returntype()),
                )

        if (
            not isinstance(symbol, FunctionSymbol)
            or symbol.type.functionParameters is None
            or symbol.type.functionReturnType is None
        ):
            raise InternalError("Symbol is not a function")

        # Fixup deferred parameter types
        params = copy.deepcopy(symbol.type.functionParameters)
        returntype = copy.deepcopy(symbol.type.functionReturnType)
        for i in range(len(params)):
            if params[i][1].isDeferred():
                params[i] = (params[i][0], self.getParamTypes(ctx.params())[i][1])

        newType = Datatype.createFunctionType(params, returntype)
        symbol.type = newType
        self.setNodeDatatype(ctx, newType)
        self.setNodeSymbol(ctx, symbol)
        self.db.popScope()

    def implVariableDefinition(self, ctx, variableType: VariableType):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)

        name = ctx.ID().getText()
        if name == "context":
            raise CompilerError(
                "'context' is not a valid variable name.", self.getLocation(ctx)
            )
        if name == "this":
            raise CompilerError(
                "'this' is not a valid variable name.", self.getLocation(ctx)
            )

        exprtype = self.getNodeDatatype(ctx.expr())
        vartype = exprtype
        if ctx.datatype():
            vartype = self.getNodeDatatype(ctx.datatype())

        if exprtype.isNone():
            raise CompilerError(
                f"Cannot assign 'none' to a variable.", self.getLocation(ctx)
            )

        if vartype.isNone():
            raise CompilerError(
                f"'none' is not a valid variable type.", self.getLocation(ctx)
            )

        symbol = VariableSymbol(SymbolName(name), vartype, variableType)
        self.db.getCurrentScope().defineSymbol(symbol, self.getLocation(ctx))
        self.setNodeSymbol(ctx, symbol)

    def visitBracketExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.expr()))

    def visitBinaryExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        operation = ctx.children[1].getText()
        if ctx.children[2].getText() == "not":
            operation += " not"

        self.setNodeBinaryOperator(ctx, operation)
        typeA = self.getNodeDatatype(ctx.expr(0))
        typeB = self.getNodeDatatype(ctx.expr(1))

        def datatypesUnrelated():
            raise CompilerError(
                f"Datatypes '{typeA.getDisplayName()}' and '{typeB.getDisplayName()}' are unrelated and cannot be used for binary operation",
                self.getLocation(ctx),
            )

        if (
            operation == "*"
            or operation == "/"
            or operation == "%"
            or operation == "+"
            or operation == "-"
        ):
            if typeA.isInteger() and typeB.isInteger():
                self.setNodeDatatype(ctx, typeA)

            else:
                datatypesUnrelated()

        elif (
            operation == "<"
            or operation == ">"
            or operation == "<="
            or operation == ">="
        ):
            if typeA.isInteger() and typeB.isInteger():
                self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("boolean"))

            else:
                datatypesUnrelated()

        elif (
            operation == "=="
            or operation == "!="
            or operation == "is"
            or operation == "is not"
        ):
            if typeA.isInteger() and typeB.isInteger():
                self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("boolean"))

            elif typeA.isBoolean() and typeB.isBoolean():
                self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("boolean"))

            else:
                datatypesUnrelated()

        elif operation == "and" or operation == "or":
            if typeA.isBoolean() and typeB.isBoolean():
                self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("boolean"))

            else:
                datatypesUnrelated()

        else:
            raise CompilerError(
                f"Operation '{operation}' is not implemented for types '{typeA.getDisplayName()}' and '{typeB.getDisplayName()}'",
                self.getLocation(ctx),
            )

    def visitIfexpr(self, ctx):
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.expr()))

    def visitElseifexpr(self, ctx):
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.expr()))

    def visitFunc(self, ctx):
        return self.implFunc(ctx)

    def visitNamedfunc(self, ctx):
        return self.implFunc(ctx)

    def visitStructFuncDecl(self, ctx):
        # return self.implFunc(ctx)
        if ctx:
            pass

    def visitFuncbody(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)

    def visitIntegerConstant(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        value = int(ctx.getText())
        if not (-(2**31) <= value <= (2**31 - 1)):
            self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("i64"))
        elif not (-(2**15) <= value <= (2**15 - 1)):
            self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("i32"))
        elif not (-(2**7) <= value <= (2**7 - 1)):
            self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("i16"))
        else:
            self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("i8"))

    def visitStringConstant(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("stringview"))

    def visitConstantExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.visitChildren(ctx.constant())
        self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.constant()))

    def visitThenblock(self, ctx):
        self.visitChildren(ctx)

    def visitElseifblock(self, ctx):
        self.visitChildren(ctx)

    def visitElseblock(self, ctx):
        self.visitChildren(ctx)

    def visitBooleanConstant(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("boolean"))

    def visitBody(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)

    def visitStructDecl(self, ctx):
        if not self.getNodeDatatype(ctx).isStruct:
            raise InternalError("Struct decl is not a struct datatype")

        self.structStack.append(self.getNodeDatatype(ctx))
        self.db.pushScope(self.getNodeScope(ctx))
        self.visitChildren(ctx)
        self.db.popScope()
        self.structStack.pop()

    def visitFuncRefExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeSymbol(ctx, self.getNodeSymbol(ctx.func()))
        self.setNodeDatatype(ctx, self.getNodeSymbol(ctx.func()).type)

    def visitReturnStatement(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeDatatype(
            ctx,
            (
                self.getNodeDatatype(ctx.expr())
                if ctx.expr()
                else self.db.getBuiltinDatatype("none")
            ),
        )

    def visitIfStatement(self, ctx):
        self.useParentsScope(ctx)
        self.visit(ctx.ifexpr())
        for expr in ctx.elseifexpr():
            self.visit(expr)

        if not self.getNodeDatatype(ctx.ifexpr()).isBoolean():
            raise CompilerError(
                f"If expression of type '{self.getNodeDatatype(ctx.ifexpr()).getDisplayName()}' is not a boolean",
                self.getLocation(ctx),
            )

        self.db.pushScope(self.getNodeScope(ctx.thenblock()))
        self.visit(ctx.thenblock())
        self.db.popScope()

        for elifblock in ctx.elseifblock():
            self.db.pushScope(self.getNodeScope(elifblock))
            self.visit(elifblock)
            self.db.popScope()

        if ctx.elseblock():
            self.db.pushScope(self.getNodeScope(ctx.elseblock()))
            self.visit(ctx.elseblock())
            self.db.popScope()

    def visitArgs(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeArgtypes(ctx, [self.getNodeDatatype(expr) for expr in ctx.expr()])

    def visitMutableVariableDefinition(self, ctx):
        return self.implVariableDefinition(ctx, VariableType.MutableVariable)

    def visitImmutableVariableDefinition(self, ctx):
        return self.implVariableDefinition(ctx, VariableType.ContantVariable)

    def visitExprAssignmentStatement(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)

        if not self.hasNodeSymbol(ctx.expr()[0]):
            raise CompilerError(f"Expression cannot be modified", self.getLocation(ctx))

        symbol = self.getNodeSymbol(ctx.expr()[0])
        if not symbol.isMutable():
            raise CompilerError(
                f"Variable '{symbol.name}' is immutable.", self.getLocation(ctx)
            )

        exprtype = self.getNodeDatatype(ctx.expr()[1])
        if exprtype.isNone():
            raise CompilerError(
                f"Cannot assign 'none' to a variable.", self.getLocation(ctx)
            )

        self.setNodeSymbol(ctx, symbol)

    def visitObjectAttr(self, ctx):
        self.visitChildren(ctx)
        name = ctx.ID().getText()
        expr = ctx.expr()
        self.setNodeObjectAttribute(
            ctx,
            ObjAttribute(
                name, self.getNodeDatatype(expr), self.getNodeDatatype(expr), expr
            ),
        )
        self.setNodeDatatype(ctx, self.getNodeDatatype(expr))

    def visitObjectExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)

        structtype = Datatype.createStructDatatype(
            SymbolName(self.db.makeAnonymousStructName()), []
        )
        attributes = getObjectAttributes(self, ctx)
        for attribute in attributes:
            structtype.structMemberSymbols.insert(attribute, self.getLocation(ctx))

        self.setNodeDatatype(ctx, structtype)

    def visitGenericDatatype(self, ctx):
        self.visitChildren(ctx)
        if not self.hasNodeDatatype(ctx) or self.getNodeDatatype(ctx).isDeferred():
            implGenericDatatype(self, ctx, False, True)

        print("Generic type ", ctx.ID().getText(), self.getLocation(ctx))
        datatype = self.getNodeDatatype(ctx)
        genTypes = [self.getNodeDatatype(n) for n in ctx.datatype()]
        if len(datatype.generics) != len(genTypes):
            raise CompilerError(
                f"Generic datatype expected {len(datatype.generics)} generic arguments but got {len(genTypes)}.",
                self.getLocation(ctx),
            )

        scope = self.getNodeScope(ctx)
        if len(genTypes) > 0:
            scope = Scope(self.getLocation(ctx), scope)
            for i in range(len(datatype.generics)):
                symbol = DatatypeSymbol(
                    SymbolName(datatype.generics[i][0]), genTypes[i]
                )
                if not symbol.type.isGeneric():
                    scope.defineSymbol(symbol, self.getLocation(ctx))

        dt = resolveGenerics(datatype, scope, self.getLocation(ctx))
        dt = resolveGenerics(dt, scope, self.getLocation(ctx))
        print("Resolved > ", dt, scope)
        scope.print()
        self.setNodeDatatype(ctx, dt)

    def visitParam(self, ctx: HazeParser.HazeParser.ParamContext):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        if self.currentExternBlockLanguage:
            return

        if not self.hasNodeSymbol(ctx):
            raise InternalError("Param has no symbol")

        symbol = self.getNodeSymbol(ctx)
        if symbol.type.isDeferred():
            symbol = symbol.duplicateWithOtherType(self.getNodeDatatype(ctx.datatype()))
            self.setNodeSymbol(ctx, symbol)

    def visitReturntype(self, ctx):
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.datatype()))

    def visitExternblock(self, ctx):
        self.currentExternBlockLanguage = self.getNodeExternlang(ctx)
        self.visitChildren(ctx)
        self.currentExternBlockLanguage = None

    def visitNamedObjectExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)

        structtype = self.getNodeDatatype(ctx.datatype())
        scope = Scope(self.getLocation(ctx), self.db.getCurrentScope())
        for name, tp in structtype.generics:
            if tp:
                scope.defineSymbol(
                    DatatypeSymbol(SymbolName(name), tp), self.getLocation(ctx)
                )

        tp = resolveGenerics(structtype, scope, self.getLocation(ctx))
        self.setNodeDatatype(ctx, tp)

    def exprMemberAccessImpl(self, ctx, exprtype: Datatype):
        if exprtype.isStruct():
            fieldName = ctx.ID().getText()
            fieldIndex = -1
            fields = getStructFields(exprtype)
            for i in range(len(fields)):
                if fields[i].name.name == fieldName:
                    fieldIndex = i
                    break

            memberFuncIndex = -1
            memberFuncs = getStructFunctions(exprtype)
            for i in range(len(memberFuncs)):
                if memberFuncs[i].name.name == fieldName:
                    memberFuncIndex = i
                    break

            if fieldIndex == -1 and memberFuncIndex == -1:
                raise CompilerError(
                    f"Expression '.{fieldName}' is not a member of type '{exprtype.getDisplayName()}'",
                    self.getLocation(ctx),
                )

            if fieldIndex != -1:
                self.setNodeMemberAccessFieldIndex(ctx, fieldIndex)
                tp = fields[fieldIndex].type
                self.setNodeDatatype(ctx, tp)
                symbol = VariableSymbol(
                    exprtype.name,
                    tp,
                    VariableType.MutableStructField,
                )
                self.setNodeSymbol(ctx, symbol)

            elif memberFuncIndex != -1:
                memberFunc = memberFuncs[memberFuncIndex]
                self.setNodeMemberAccessFunctionSymbol(ctx, memberFunc)
                self.setNodeSymbol(ctx, memberFunc)
                self.setNodeDatatype(ctx, memberFuncs[memberFuncIndex].type)

            else:
                raise InternalError(
                    "You fucked up big this time, a struct cannot have a field and a member function with the same name"
                )

        elif exprtype.isPointer() and exprtype.pointee:
            self.exprMemberAccessImpl(ctx, exprtype.pointee)

        else:
            raise CompilerError(
                f"Cannot access member of non-structural datatype '{exprtype.getDisplayName()}'",
                self.getLocation(ctx),
            )

    def visitExprMemberAccess(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        exprtype = self.getNodeDatatype(ctx.expr())
        self.exprMemberAccessImpl(ctx, exprtype)


class FunctionBodyAnalyzer(AdvancedBaseVisitor):
    def __init__(self, filename: str, db: CompilationDatabase):
        super().__init__(filename, db)

    def visitSymbolValueExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        symbolName = ctx.ID().getText()

        symbol = self.db.getCurrentScope().lookupSymbol(
            symbolName, self.getLocation(ctx)
        )
        if isinstance(symbol, DatatypeSymbol):
            # It's a 'Datatype()' Syntax - A constructor call
            self.setNodeDatatypeAsValue(ctx, symbol.type)
            self.setNodeDatatype(ctx, symbol.type)
            self.setNodeSymbol(ctx, symbol)
        else:
            self.setNodeSymbol(ctx, symbol)
            self.setNodeDatatype(ctx, symbol.type)

    def visitExprCallExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        symbol = self.getNodeSymbol(ctx.expr())

        print("Call symbol", symbol)
        if isinstance(symbol, DatatypeSymbol):
            # Now call constructor on this type
            if not symbol.type.isStruct():
                raise CompilerError(
                    f"Type '{symbol.type.getDisplayName()}' is not a structural type - Only structural types can be instantiated using constructors",
                    self.getLocation(ctx),
                )

            sym = symbol.type.structMemberSymbols.tryLookup(
                "constructor", self.getLocation(ctx)
            )
            if not sym:
                raise CompilerError(
                    f"Type '{symbol.type.getDisplayName()}' does not provide a constructor",
                    self.getLocation(ctx),
                )
            symbol = sym

        visibleParams = []
        returnType: Optional[Datatype] = None
        if isinstance(symbol, FunctionSymbol):
            visibleParams = symbol.type.functionParameters
            returnType = symbol.type.functionReturnType

        elif symbol.type.isFunction():
            visibleParams = symbol.type.functionParameters
            returnType = symbol.type.functionReturnType

        else:
            raise CompilerError(
                f"Expression of type '{symbol.type.getDisplayName()}' is not callable",
                self.getLocation(ctx),
            )

        self.assertExpectedNumOfArgs(ctx, len(ctx.args().expr()), len(visibleParams))
        if not returnType:
            raise UnreachableCode()
        self.setNodeDatatype(ctx, returnType)
        self.setNodeSymbol(ctx, symbol)

    def implFunc(self, ctx):
        symbol = self.getNodeSymbol(ctx)
        if (
            not isinstance(symbol, FunctionSymbol)
            or not symbol.scope
            or symbol.type.functionParameters is None
            or symbol.type.functionReturnType is None
        ):
            raise ImpossibleSituation()
        self.db.pushScope(symbol.scope)

        if symbol.thisPointerType:
            symbol.thisPointerType = Datatype.createPointerDatatype(
                self.structStack[-1]
            )
            s = VariableSymbol(
                SymbolName("this"),
                Datatype.createPointerDatatype(self.structStack[-1]),
                VariableType.Parameter,
            )
            self.db.getCurrentScope().defineSymbol(s, self.getLocation(ctx))

        self.visitChildren(ctx)

        if symbol.thisPointerType:
            if (
                symbol.type.functionReturnType
                and symbol.type.functionReturnType.isDeferred()
            ):
                symbol.type = Datatype.createFunctionType(
                    symbol.type.functionParameters,
                    self.getNodeDatatype(ctx.returntype()),
                )

        if (
            not isinstance(symbol, FunctionSymbol)
            or symbol.type.functionParameters is None
            or symbol.type.functionReturnType is None
        ):
            raise InternalError("Symbol is not a function")

        # Fixup deferred parameter types
        params = copy.deepcopy(symbol.type.functionParameters)
        returntype = copy.deepcopy(symbol.type.functionReturnType)
        for i in range(len(params)):
            if params[i][1].isDeferred():
                params[i] = (params[i][0], self.getParamTypes(ctx.params())[i][1])

        newType = Datatype.createFunctionType(params, returntype)
        symbol.type = newType
        self.setNodeDatatype(ctx, newType)
        self.setNodeSymbol(ctx, symbol)
        self.db.popScope()

    def implVariableDefinition(self, ctx, variableType: VariableType):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)

        name = ctx.ID().getText()
        if name == "context":
            raise CompilerError(
                "'context' is not a valid variable name.", self.getLocation(ctx)
            )
        if name == "this":
            raise CompilerError(
                "'this' is not a valid variable name.", self.getLocation(ctx)
            )

        exprtype = self.getNodeDatatype(ctx.expr())
        vartype = exprtype
        if ctx.datatype():
            vartype = self.getNodeDatatype(ctx.datatype())

        if exprtype.isNone():
            raise CompilerError(
                f"Cannot assign 'none' to a variable.", self.getLocation(ctx)
            )

        if vartype.isNone():
            raise CompilerError(
                f"'none' is not a valid variable type.", self.getLocation(ctx)
            )

        symbol = VariableSymbol(SymbolName(name), vartype, variableType)
        self.db.getCurrentScope().defineSymbol(symbol, self.getLocation(ctx))
        self.setNodeSymbol(ctx, symbol)

    def visitBracketExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.expr()))

    def visitBinaryExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        operation = ctx.children[1].getText()
        if ctx.children[2].getText() == "not":
            operation += " not"

        self.setNodeBinaryOperator(ctx, operation)
        typeA = self.getNodeDatatype(ctx.expr(0))
        typeB = self.getNodeDatatype(ctx.expr(1))

        def datatypesUnrelated():
            raise CompilerError(
                f"Datatypes '{typeA.getDisplayName()}' and '{typeB.getDisplayName()}' are unrelated and cannot be used for binary operation",
                self.getLocation(ctx),
            )

        if (
            operation == "*"
            or operation == "/"
            or operation == "%"
            or operation == "+"
            or operation == "-"
        ):
            if typeA.isInteger() and typeB.isInteger():
                self.setNodeDatatype(ctx, typeA)

            else:
                datatypesUnrelated()

        elif (
            operation == "<"
            or operation == ">"
            or operation == "<="
            or operation == ">="
        ):
            if typeA.isInteger() and typeB.isInteger():
                self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("boolean"))

            else:
                datatypesUnrelated()

        elif (
            operation == "=="
            or operation == "!="
            or operation == "is"
            or operation == "is not"
        ):
            if typeA.isInteger() and typeB.isInteger():
                self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("boolean"))

            elif typeA.isBoolean() and typeB.isBoolean():
                self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("boolean"))

            else:
                datatypesUnrelated()

        elif operation == "and" or operation == "or":
            if typeA.isBoolean() and typeB.isBoolean():
                self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("boolean"))

            else:
                datatypesUnrelated()

        else:
            raise CompilerError(
                f"Operation '{operation}' is not implemented for types '{typeA.getDisplayName()}' and '{typeB.getDisplayName()}'",
                self.getLocation(ctx),
            )

    def visitIfexpr(self, ctx):
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.expr()))

    def visitElseifexpr(self, ctx):
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.expr()))

    def visitFunc(self, ctx):
        return self.implFunc(ctx)

    def visitNamedfunc(self, ctx):
        return self.implFunc(ctx)

    def visitStructFuncDecl(self, ctx):
        return self.implFunc(ctx)

    def visitFuncbody(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)

    def visitIntegerConstant(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        value = int(ctx.getText())
        if not (-(2**31) <= value <= (2**31 - 1)):
            self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("i64"))
        elif not (-(2**15) <= value <= (2**15 - 1)):
            self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("i32"))
        elif not (-(2**7) <= value <= (2**7 - 1)):
            self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("i16"))
        else:
            self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("i8"))

    def visitStringConstant(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("stringview"))

    def visitConstantExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.visitChildren(ctx.constant())
        self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.constant()))

    def visitThenblock(self, ctx):
        self.visitChildren(ctx)

    def visitElseifblock(self, ctx):
        self.visitChildren(ctx)

    def visitElseblock(self, ctx):
        self.visitChildren(ctx)

    def visitBooleanConstant(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.db.getBuiltinDatatype("boolean"))

    def visitBody(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)

    def visitStructDecl(self, ctx):
        if not self.getNodeDatatype(ctx).isStruct:
            raise InternalError("Struct decl is not a struct datatype")

        self.structStack.append(self.getNodeDatatype(ctx))
        self.db.pushScope(self.getNodeScope(ctx))
        self.visitChildren(ctx)
        self.db.popScope()
        self.structStack.pop()

    def visitFuncRefExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeSymbol(ctx, self.getNodeSymbol(ctx.func()))
        self.setNodeDatatype(ctx, self.getNodeSymbol(ctx.func()).type)

    def visitReturnStatement(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeDatatype(
            ctx,
            (
                self.getNodeDatatype(ctx.expr())
                if ctx.expr()
                else self.db.getBuiltinDatatype("none")
            ),
        )

    def visitIfStatement(self, ctx):
        self.useParentsScope(ctx)
        self.visit(ctx.ifexpr())
        for expr in ctx.elseifexpr():
            self.visit(expr)

        if not self.getNodeDatatype(ctx.ifexpr()).isBoolean():
            raise CompilerError(
                f"If expression of type '{self.getNodeDatatype(ctx.ifexpr()).getDisplayName()}' is not a boolean",
                self.getLocation(ctx),
            )

        self.db.pushScope(self.getNodeScope(ctx.thenblock()))
        self.visit(ctx.thenblock())
        self.db.popScope()

        for elifblock in ctx.elseifblock():
            self.db.pushScope(self.getNodeScope(elifblock))
            self.visit(elifblock)
            self.db.popScope()

        if ctx.elseblock():
            self.db.pushScope(self.getNodeScope(ctx.elseblock()))
            self.visit(ctx.elseblock())
            self.db.popScope()

    def visitArgs(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeArgtypes(ctx, [self.getNodeDatatype(expr) for expr in ctx.expr()])

    def visitMutableVariableDefinition(self, ctx):
        return self.implVariableDefinition(ctx, VariableType.MutableVariable)

    def visitImmutableVariableDefinition(self, ctx):
        return self.implVariableDefinition(ctx, VariableType.ContantVariable)

    def visitExprAssignmentStatement(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)

        if not self.hasNodeSymbol(ctx.expr()[0]):
            raise CompilerError(f"Expression cannot be modified", self.getLocation(ctx))

        symbol = self.getNodeSymbol(ctx.expr()[0])
        if not symbol.isMutable():
            raise CompilerError(
                f"Variable '{symbol.name}' is immutable.", self.getLocation(ctx)
            )

        exprtype = self.getNodeDatatype(ctx.expr()[1])
        if exprtype.isNone():
            raise CompilerError(
                f"Cannot assign 'none' to a variable.", self.getLocation(ctx)
            )

        self.setNodeSymbol(ctx, symbol)

    def visitObjectAttr(self, ctx):
        self.visitChildren(ctx)
        name = ctx.ID().getText()
        expr = ctx.expr()
        self.setNodeObjectAttribute(
            ctx,
            ObjAttribute(
                name, self.getNodeDatatype(expr), self.getNodeDatatype(expr), expr
            ),
        )
        self.setNodeDatatype(ctx, self.getNodeDatatype(expr))

    def visitObjectExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)

        structtype = Datatype.createStructDatatype(
            SymbolName(self.db.makeAnonymousStructName()), []
        )
        attributes = getObjectAttributes(self, ctx)
        for attribute in attributes:
            structtype.structMemberSymbols.insert(attribute, self.getLocation(ctx))

        self.setNodeDatatype(ctx, structtype)

    def visitGenericDatatype(self, ctx):
        self.visitChildren(ctx)
        if not self.hasNodeDatatype(ctx) or self.getNodeDatatype(ctx).isDeferred():
            implGenericDatatype(self, ctx, False, True)

        print("Generic type ", ctx.ID().getText(), self.getLocation(ctx))
        datatype = self.getNodeDatatype(ctx)
        genTypes = [self.getNodeDatatype(n) for n in ctx.datatype()]
        if len(datatype.generics) != len(genTypes):
            raise CompilerError(
                f"Generic datatype expected {len(datatype.generics)} generic arguments but got {len(genTypes)}.",
                self.getLocation(ctx),
            )

        scope = self.getNodeScope(ctx)
        if len(genTypes) > 0:
            scope = Scope(self.getLocation(ctx), scope)
            for i in range(len(datatype.generics)):
                symbol = DatatypeSymbol(
                    SymbolName(datatype.generics[i][0]), genTypes[i]
                )
                if not symbol.type.isGeneric():
                    scope.defineSymbol(symbol, self.getLocation(ctx))

        dt = resolveGenerics(datatype, scope, self.getLocation(ctx))
        dt = resolveGenerics(dt, scope, self.getLocation(ctx))
        self.setNodeDatatype(ctx, dt)

    def visitParam(self, ctx: HazeParser.HazeParser.ParamContext):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        if self.currentExternBlockLanguage:
            return

        if not self.hasNodeSymbol(ctx):
            raise InternalError("Param has no symbol")

        symbol = self.getNodeSymbol(ctx)
        if symbol.type.isDeferred():
            symbol = symbol.duplicateWithOtherType(self.getNodeDatatype(ctx.datatype()))
            self.setNodeSymbol(ctx, symbol)

    def visitReturntype(self, ctx):
        self.visitChildren(ctx)
        self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.datatype()))

    def visitExternblock(self, ctx):
        self.currentExternBlockLanguage = self.getNodeExternlang(ctx)
        self.visitChildren(ctx)
        self.currentExternBlockLanguage = None

    def visitNamedObjectExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)

        structtype = self.getNodeDatatype(ctx.datatype())
        scope = Scope(self.getLocation(ctx), self.db.getCurrentScope())
        for name, tp in structtype.generics:
            if tp:
                scope.defineSymbol(
                    DatatypeSymbol(SymbolName(name), tp), self.getLocation(ctx)
                )

        tp = resolveGenerics(structtype, scope, self.getLocation(ctx))
        self.setNodeDatatype(ctx, tp)

    def exprMemberAccessImpl(self, ctx, exprtype: Datatype):
        if exprtype.isStruct():
            fieldName = ctx.ID().getText()
            fieldIndex = -1
            fields = getStructFields(exprtype)
            for i in range(len(fields)):
                if fields[i].name.name == fieldName:
                    fieldIndex = i
                    break

            memberFuncIndex = -1
            memberFuncs = getStructFunctions(exprtype)
            for i in range(len(memberFuncs)):
                if memberFuncs[i].name.name == fieldName:
                    memberFuncIndex = i
                    break

            if fieldIndex == -1 and memberFuncIndex == -1:
                raise CompilerError(
                    f"Expression '.{fieldName}' is not a member of type '{exprtype.getDisplayName()}'",
                    self.getLocation(ctx),
                )

            if fieldIndex != -1:
                self.setNodeMemberAccessFieldIndex(ctx, fieldIndex)
                tp = fields[fieldIndex].type
                self.setNodeDatatype(ctx, tp)
                symbol = VariableSymbol(
                    exprtype.name,
                    tp,
                    VariableType.MutableStructField,
                )
                self.setNodeSymbol(ctx, symbol)

            elif memberFuncIndex != -1:
                memberFunc = memberFuncs[memberFuncIndex]
                self.setNodeMemberAccessFunctionSymbol(ctx, memberFunc)
                self.setNodeSymbol(ctx, memberFunc)
                self.setNodeDatatype(ctx, memberFuncs[memberFuncIndex].type)

            else:
                raise InternalError(
                    "You fucked up big this time, a struct cannot have a field and a member function with the same name"
                )

        elif exprtype.isPointer() and exprtype.pointee:
            self.exprMemberAccessImpl(ctx, exprtype.pointee)

        else:
            raise CompilerError(
                f"Cannot access member of non-structural datatype '{exprtype.getDisplayName()}'",
                self.getLocation(ctx),
            )

    def visitExprMemberAccess(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        exprtype = self.getNodeDatatype(ctx.expr())
        self.exprMemberAccessImpl(ctx, exprtype)


def analyzeFunctionSymbol(
    symbol: FunctionSymbol, filename: str, db: CompilationDatabase
):
    if symbol.fullyAnalyzed:
        return

    f = FunctionBodyAnalyzer(filename, db)
    f.visit(symbol.ctx)


def performSemanticAnalysis(program: Program, filename: str, db: CompilationDatabase):

    # # First define all struct methods
    # for symbol in program.globalSymbols.symbols.values():
    #     if isinstance(symbol, FunctionSymbol) and len(symbol.name.namespaces) > 0:
    #         f = FunctionBodyAnalyzer(filename, db)
    #         f.visit(symbol.ctx)

    # Define all global methods
    for symbol in program.globalSymbols.symbols:
        if (
            isinstance(symbol, FunctionSymbol)
            and symbol.functionLinkage == FunctionLinkage.Haze
        ):
            analyzeFunctionSymbol(symbol, filename, db)
