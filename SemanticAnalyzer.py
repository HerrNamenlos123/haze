from AdvancedBaseVisitor import AdvancedBaseVisitor
import sys
from CompilationDatabase import CompilationDatabase, ObjAttribute
from grammar.HazeParser import HazeParser
from typing import Optional, List, Tuple, Dict
from Datatype import Datatype, FunctionLinkage
from Symbol import DatatypeSymbol, VariableSymbol, VariableType, StructMemberSymbol
from FunctionSymbol import FunctionSymbol
from Symbol import ConstantSymbol
from Error import CompilerError, InternalError, UnreachableCode, ImpossibleSituation
from utils import (
    resolveGenerics,
)
from Scope import Scope
from SymbolTable import (
    SymbolTable,
    getStructFields,
    getStructMethods,
    getStructField,
    getStructMethod,
)
from Program import Program
from Expression import (
    ConstantExpression,
    ObjectExpression,
    SymbolValueExpression,
    Expression,
)
from Datatype import implicitConversion
from Statement import VariableDefinitionStatement, ReturnStatement
from Expression import MemberAccessExpression, ExprCallExpression
import copy


RESERVED_VARIABLE_NAMES = ["this", "context"]


class FunctionBodyAnalyzer(AdvancedBaseVisitor):
    def __init__(self, program: Program, filename: str, db: CompilationDatabase):
        super().__init__(filename, db)
        self.program = program

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
        p = foundSymbol.parentSymbol
        foundSymbol = copy.deepcopy(foundSymbol)
        foundSymbol.parentSymbol = p

        genericsProvided = [self.visit(n) for n in ctx.datatype()]

        if len(foundSymbol.type.generics) != len(genericsProvided):
            raise CompilerError(
                f"Datatype expected {len(foundSymbol.type.generics)} generic arguments but got {len(genericsProvided)}.",
                self.getLocation(ctx),
            )

        for i in range(len(foundSymbol.type.generics)):
            if not genericsProvided[i].isGeneric():
                if not foundSymbol.type.generics[i][1]:
                    foundSymbol.type.generics[i] = (
                        foundSymbol.type.generics[i][0],
                        genericsProvided[i],
                    )

        scope = Scope(self.getLocation(ctx), self.db.getCurrentScope())
        for i in range(len(foundSymbol.type.generics)):
            scope.defineSymbol(
                DatatypeSymbol(
                    foundSymbol.type.generics[i][0], None, genericsProvided[i]
                ),
                self.getLocation(ctx),
            )

        dt = resolveGenerics(foundSymbol.type, scope, self.getLocation(ctx))
        if dt.areAllGenericsResolved():
            self.program.resolvedDatatypes[dt.getMangledName()] = dt
        return dt

    def visitSymbolValueExpr(self, ctx):
        symbol = self.db.getCurrentScope().lookupSymbol(
            ctx.ID().getText(), self.getLocation(ctx)
        )
        symbol = copy.deepcopy(symbol)

        if isinstance(symbol, DatatypeSymbol):
            if len(symbol.type.generics) != len(ctx.datatype()):
                raise CompilerError(
                    f"Datatype expected {len(symbol.type.generics)} generic arguments but got {len(ctx.datatype())}.",
                    self.getLocation(ctx),
                )
            for i in range(len(symbol.type.generics)):
                symbol.type.generics[i] = (
                    symbol.type.generics[i][0],
                    self.visit(ctx.datatype()[i]),
                )

        self.setNodeSymbol(ctx, symbol)
        return SymbolValueExpression(symbol, ctx)

    def visitExprCallExpr(self, ctx):
        expr = self.visit(ctx.expr())

        if not expr.type.isFunction():
            raise CompilerError(
                f"Expression of type '{expr.type.getDisplayName()}' is not callable",
                self.getLocation(ctx),
            )

        # if isinstance(expr, SymbolValueExpression) and expr.symbol.type.isStruct() and expr.symbol.has:
        #     # Now call constructor on this type
        #     if not symbol.type.isStruct():
        #         raise CompilerError(
        #             f"Type '{symbol.type.getDisplayName()}' is not a structural type - Only structural types can be instantiated using constructors",
        #             self.getLocation(ctx),
        #         )

        #     sym = symbol.type.structMemberSymbols.tryLookup(
        #         "constructor", self.getLocation(ctx)
        #     )
        #     if not sym:
        #         raise CompilerError(
        #             f"Type '{symbol.type.getDisplayName()}' does not provide a constructor",
        #             self.getLocation(ctx),
        #         )
        #     symbol = sym

        visibleParams = expr.type.functionParameters
        # returnType = expr.type.functionReturnType
        self.assertExpectedNumOfArgs(ctx, len(ctx.args().expr()), len(visibleParams))
        return ExprCallExpression(expr, ctx)

    def implFunc(
        self,
        ctx: (
            HazeParser.FuncContext
            | HazeParser.NamedfuncContext
            | HazeParser.StructFuncDeclContext
        ),
    ):
        symbol = self.getNodeSymbol(ctx)
        if (
            not isinstance(symbol, FunctionSymbol)
            or not symbol.scope
            or symbol.type.functionParameters is None
            or symbol.type.functionReturnType is None
        ):
            raise ImpossibleSituation()

        p = symbol.parentSymbol
        addedSymbols = []
        while p is not None:
            for i in range(len(p.type.generics)):
                tp = p.type.generics[i][1]
                if not tp:
                    raise ImpossibleSituation()
                symbol.scope.defineSymbol(
                    DatatypeSymbol(p.type.generics[i][0], None, tp),
                    self.getLocation(ctx),
                )
                addedSymbols.append(p.type.generics[i][0])
            p = p.parentSymbol

        newType = resolveGenerics(symbol.type, symbol.scope, self.getLocation(ctx))
        symbol = copy.deepcopy(symbol)
        symbol.type = newType

        if (
            symbol.type.areAllGenericsResolved()
            and symbol.getMangledName() in self.program.resolvedFunctions
        ):
            for sym in addedSymbols:
                if symbol.scope:
                    symbol.scope.purgeSymbol(sym)
            return

        if not symbol or not symbol.scope:
            raise ImpossibleSituation()

        self.db.pushScope(symbol.scope)

        returnedTypes: Dict[str, Datatype] = {}
        for statement in self.visit(ctx.funcbody()):
            symbol.statements.append(statement)
            if isinstance(statement, ReturnStatement) and statement.expr:
                returnedTypes[statement.expr.type.getDisplayName()] = (
                    statement.expr.type
                )

        for sym in addedSymbols:
            if symbol.scope:
                symbol.scope.purgeSymbol(sym)

        if len(returnedTypes.keys()) > 1:
            raise CompilerError(
                f"Cannot deduce return type. Multiple return types: {', '.join(returnedTypes.keys())}",
                self.getLocation(ctx),
            )
        elif len(returnedTypes) == 1:
            symbol.type.functionReturnType = next(iter(returnedTypes.values()))
        else:
            symbol.type.functionReturnType = self.db.getBuiltinDatatype("none")

        self.db.popScope()
        self.setNodeSymbol(ctx, symbol)
        self.program.resolvedFunctions[symbol.getMangledName()] = copy.deepcopy(symbol)

    def visitFunc(self, ctx):
        return self.implFunc(ctx)

    def visitNamedfunc(self, ctx):
        return self.implFunc(ctx)

    def visitFuncbody(self, ctx):
        if ctx.expr():
            return [ReturnStatement(ctx.expr(), ctx)]
        else:
            return [self.visit(s) for s in ctx.body().statement()]

    def implVariableDefinition(self, ctx, variableType: VariableType):
        name = ctx.ID().getText()
        if name in RESERVED_VARIABLE_NAMES:
            raise CompilerError(
                f"'{name}' is not a valid variable name.", self.getLocation(ctx)
            )

        expr: Expression = self.visit(ctx.expr())
        datatype = expr.type
        if ctx.datatype():
            datatype = self.visit(ctx.datatype())

        if datatype.isNone():
            raise CompilerError(
                f"'none' is not a valid variable type.", self.getLocation(ctx)
            )

        symbol = VariableSymbol(name, None, datatype, variableType)
        self.db.getCurrentScope().defineSymbol(symbol, self.getLocation(ctx))
        self.setNodeSymbol(ctx, symbol)
        return VariableDefinitionStatement(symbol, expr, ctx)

    def visitBracketExpr(self, ctx):
        return self.visit(ctx.expr())

    def visitBinaryExpr(self, ctx):
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
        # self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.expr()))

    def visitElseifexpr(self, ctx):
        self.visitChildren(ctx)
        # self.setNodeDatatype(ctx, self.getNodeDatatype(ctx.expr()))

    def visitStructFuncDecl(self, ctx):
        return self.implFunc(ctx)

    def visitIntegerConstant(self, ctx):
        self.visitChildren(ctx)
        value = int(ctx.getText())
        if not (-(2**31) <= value <= (2**31 - 1)):
            return ConstantSymbol(self.db.getBuiltinDatatype("i64"), value)
        elif not (-(2**15) <= value <= (2**15 - 1)):
            return ConstantSymbol(self.db.getBuiltinDatatype("i32"), value)
        elif not (-(2**7) <= value <= (2**7 - 1)):
            return ConstantSymbol(self.db.getBuiltinDatatype("i16"), value)
        else:
            return ConstantSymbol(self.db.getBuiltinDatatype("i8"), value)

    def visitStringConstant(self, ctx):
        return ConstantSymbol(self.db.getBuiltinDatatype("stringview"), ctx.getText())

    def visitBooleanConstant(self, ctx):
        text = ctx.getText()
        value = False
        if text == "true":
            value = True
        elif text != "false":
            raise InternalError("Invalid boolean constant: " + text)
        return ConstantSymbol(self.db.getBuiltinDatatype("boolean"), value)

    def visitConstantExpr(self, ctx):
        symbol: ConstantSymbol = self.visit(ctx.constant())
        return ConstantExpression(symbol, symbol.type, ctx)

    def visitThenblock(self, ctx):
        self.visitChildren(ctx)

    def visitElseifblock(self, ctx):
        self.visitChildren(ctx)

    def visitElseblock(self, ctx):
        self.visitChildren(ctx)

    def visitBody(self, ctx):
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
        self.visitChildren(ctx)
        self.setNodeSymbol(ctx, self.getNodeSymbol(ctx.func()))
        self.setNodeDatatype(ctx, self.getNodeSymbol(ctx.func()).type)

    def visitReturnStatement(self, ctx):
        if ctx.expr():
            return ReturnStatement(self.visit(ctx.expr()), ctx)
        else:
            return ReturnStatement(None, ctx)

    def visitIfStatement(self, ctx):
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
        self.visitChildren(ctx)
        args: List[Expression] = []
        for e in ctx.expr():
            args.append(self.visit(e))
        return args

    def visitMutableVariableDefinition(self, ctx):
        return self.implVariableDefinition(ctx, VariableType.MutableVariable)

    def visitImmutableVariableDefinition(self, ctx):
        return self.implVariableDefinition(ctx, VariableType.ContantVariable)

    def visitExprAssignmentStatement(self, ctx):
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
        name = ctx.ID().getText()
        expr = self.visit(ctx.expr())
        symbol = VariableSymbol(name, None, expr.type, VariableType.MutableStructField)
        return (symbol, expr)

    def visitObjectExpr(self, ctx):
        struct = Datatype.createStructDatatype(self.db.makeAnonymousStructName(), [])
        objexpr = ObjectExpression(struct, ctx)
        for attr in ctx.objectattribute():
            symbol, expr = self.visit(attr)
            objexpr.members.append((symbol, expr))
            struct.structMemberSymbols.insert(symbol, self.getLocation(ctx))
        return objexpr

    def visitNamedObjectExpr(self, ctx):
        structtype: Datatype = self.visit(ctx.datatype())

        structMembers: SymbolTable = structtype.structMemberSymbols
        objexpr = ObjectExpression(structtype, ctx)
        for attr in ctx.objectattribute():
            symbol, expr = self.visit(attr)
            objexpr.members.append((symbol, expr))
            existingSymbol = structMembers.tryLookup(symbol.name, self.getLocation(ctx))
            if not existingSymbol:
                raise CompilerError(
                    f"'{symbol.name}' is not a member of '{structtype.getDisplayName()}'",
                    self.getLocation(ctx),
                )
            implicitConversion(
                symbol.type, existingSymbol.type, "", self.getLocation(ctx)
            )
        return objexpr

    def exprMemberAccessImpl(self, ctx, expr: Expression):
        if expr.type.isStruct():
            name = ctx.ID().getText()
            field: Optional[VariableSymbol] = getStructField(expr.type, name)
            method: Optional[FunctionSymbol] = getStructMethod(expr.type, name)

            if field is None and method is None:
                raise CompilerError(
                    f"Expression '{name}' is not a member of type '{expr.type.getDisplayName()}'",
                    self.getLocation(ctx),
                )

            if field is not None and method is not None:
                raise CompilerError(
                    f"Access to member '{name}' of type '{expr.type.getDisplayName()}' is ambiguous",
                    self.getLocation(ctx),
                )

            if field is not None:
                return MemberAccessExpression(expr, name, field, ctx)

            if method is not None:
                if not method.ctx:
                    raise ImpossibleSituation()
                method = copy.deepcopy(method)

                if not method.parentSymbol:
                    raise InternalError("Method has no parent symbol")
                method.parentSymbol = copy.deepcopy(method.parentSymbol)
                method.parentSymbol.type.generics = expr.type.generics

                self.setNodeSymbol(method.ctx, method)
                self.implFunc(method.ctx)  # type: ignore
                return MemberAccessExpression(expr, name, method, ctx)

        # elif expr.type.isPointer() and expr.type.pointee:
        #     self.exprMemberAccessImpl(ctx, expr.type.pointee)

        else:
            raise CompilerError(
                f"Cannot access member of non-structural datatype '{expr.type.getDisplayName()}'",
                self.getLocation(ctx),
            )

    def visitExprMemberAccess(self, ctx):
        expr: Expression = self.visit(ctx.expr())
        return self.exprMemberAccessImpl(ctx, expr)


def analyzeFunctionSymbol(
    program: Program, symbol: FunctionSymbol, filename: str, db: CompilationDatabase
):
    if symbol.fullyAnalyzed:
        return

    f = FunctionBodyAnalyzer(program, filename, db)
    f.visit(symbol.ctx)


def performSemanticAnalysis(program: Program, filename: str, db: CompilationDatabase):

    # # First define all struct methods
    # for symbol in program.globalSymbols.symbols.values():
    #     if isinstance(symbol, FunctionSymbol) and len(symbol.name.namespaces) > 0:
    #         f = FunctionBodyAnalyzer(filename, db)
    #         f.visit(symbol.ctx)

    # Define all global methods
    for symbol in program.globalScope.symbolTable.symbols:
        if (
            isinstance(symbol, FunctionSymbol)
            and symbol.functionLinkage == FunctionLinkage.Haze
        ):
            if not symbol.type.isGeneric():
                analyzeFunctionSymbol(program, symbol, filename, db)
