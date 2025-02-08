from AdvancedBaseVisitor import AdvancedBaseVisitor
from CompilationDatabase import CompilationDatabase, ObjAttribute
from typing import Optional, List
from Datatype import (
    Datatype,
    StructDatatype,
    FunctionDatatype,
    PointerDatatype,
)
from Symbol import DatatypeSymbol, FunctionSymbol, VariableSymbol, VariableType
from Error import CompilerError, InternalError
from Namespace import Namespace


class SemanticAnalyzer(AdvancedBaseVisitor):
    def __init__(self, filename: str, db: CompilationDatabase):
        super().__init__(filename, db)
        self.currentExternBlockLanguage: Optional[str] = None
        self.structStack: List[StructDatatype] = []

    def visitSymbolValueExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        symbolName = ctx.ID().getText()

        symbol = self.db.getCurrentScope().lookupSymbol(
            symbolName, self.getLocation(ctx)
        )
        if isinstance(symbol, DatatypeSymbol):
            # It's a 'Datatype()' Syntax - A constructor call
            self.setNodeDatatypeAsValue(ctx, symbol.getType())
            self.setNodeDatatype(ctx, symbol.getType())
            self.setNodeSymbol(ctx, symbol)
        else:
            self.setNodeSymbol(ctx, symbol)
            self.setNodeDatatype(ctx, symbol.getType())

    def visitExprCallExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        symbol = self.getNodeSymbol(ctx.expr())

        if isinstance(symbol, DatatypeSymbol):
            # Now call constructor on this type
            if not isinstance(symbol.getType(), StructDatatype):
                raise CompilerError(
                    f"Type '{symbol.getType().getDisplayName()}' is not a structural type - Only structural types can be instantiated using constructors",
                    self.getLocation(ctx),
                )

            if not symbol.getType().getMembers().contains("constructor"):
                raise CompilerError(
                    f"Type '{symbol.getType().getDisplayName()}' does not provide a constructor",
                    self.getLocation(ctx),
                )

            symbol = symbol.getType().getMembers().at("constructor")

        visibleParams = []
        returnType: Datatype = None
        if isinstance(symbol, FunctionSymbol):
            visibleParams = symbol.getType().getParameters()
            returnType = symbol.getType().getReturnType()

        elif isinstance(symbol.getType(), FunctionDatatype):
            visibleParams = symbol.getType().getParameters()
            returnType = symbol.getType().getReturnType()

        else:
            raise CompilerError(
                f"Expression of type '{symbol.getType().getDisplayName()}' is not callable",
                self.getLocation(ctx),
            )

        self.assertExpectedNumOfArgs(ctx, len(ctx.args().expr()), len(visibleParams))
        self.setNodeDatatype(ctx, returnType)

    def implFunc(self, ctx):
        scope = self.db.pushScope(self.getNodeScope(ctx))
        symbol: FunctionSymbol = self.getNodeSymbol(ctx)
        functype = symbol.getType()

        if symbol.isConstructor:
            if (
                not functype.getReturnType().isUnknown()
                and not functype.getReturnType().isNone()
            ):
                raise CompilerError(
                    f"Constructor of struct '{self.structStack[-1].getDisplayName()}' cannot have an explicit return type: It returns the struct itself",
                    self.getLocation(ctx),
                )

            newType = FunctionDatatype(functype.getParameters(), self.structStack[-1])
            symbol.replaceType(newType)
            symbol.parentNamespace = Namespace(self.structStack[-1].getName())
            self.setNodeDatatype(ctx, newType)

        if symbol.hasThisPointer:
            symbol.setThisPointer(PointerDatatype(self.structStack[-1]))
            symbol.parentNamespace = Namespace(self.structStack[-1].getName())
            s = VariableSymbol(
                "this",
                PointerDatatype(self.structStack[-1]),
                VariableType.Parameter,
                self.getLocation(ctx),
            )
            self.db.getCurrentScope().defineSymbol(s)

        self.visitChildren(ctx)
        self.db.popScope()

    def implVariableDefinition(self, ctx, variableType: VariableType):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        name = ctx.ID().getText()
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

        symbol = VariableSymbol(name, vartype, variableType, self.getLocation(ctx))
        self.db.getCurrentScope().defineSymbol(symbol)
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

    def visitStructDecl(self, ctx):
        if not isinstance(self.getNodeDatatype(ctx), StructDatatype):
            raise InternalError("Struct decl is not a struct datatype")

        self.structStack.append(self.getNodeDatatype(ctx))
        self.visitChildren(ctx)
        self.structStack.pop()

    def visitFuncRefExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)
        self.setNodeSymbol(ctx, self.getNodeSymbol(ctx.func()))
        self.setNodeDatatype(ctx, self.getNodeSymbol(ctx.func()).getType())

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
                f"Variable '{symbol.getName()}' is immutable.", self.getLocation(ctx)
            )

        exprtype = self.getNodeDatatype(ctx.expr()[1])
        symtype = symbol.getType()
        if exprtype.isNone():
            raise CompilerError(
                self.getLocation(ctx), f"Cannot assign 'none' to a variable."
            )

        if not Datatype.isImplicitlyConvertibleTo(exprtype, symtype):
            raise CompilerError(
                f"No conversion from {exprtype.getDisplayName()} to {symtype.getDisplayName()} available",
                self.getLocation(ctx),
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

        structtype = StructDatatype(self.db.makeAnonymousStructName())
        attributes: List[ObjAttribute] = []
        for attr in ctx.objectattribute():
            att = self.getNodeObjectAttribute(attr)
            attributes.append(att)
            memberSymbol = VariableSymbol(
                att.name,
                att.declaredType,
                VariableType.MutableStructField,
                self.getLocation(ctx),
            )
            structtype.addMember(memberSymbol)

        self.setNodeObjectAttributes(ctx, attributes)
        self.setNodeDatatype(ctx, structtype)

    def visitNamedObjectExpr(self, ctx):
        self.useCurrentNodeScope(ctx)
        self.visitChildren(ctx)

        structName = ctx.ID().getText()
        symbol = self.db.getCurrentScope().lookupSymbol(
            structName, self.getLocation(ctx)
        )

        attributes: List[ObjAttribute] = []

        atts = ctx.objectattribute()

        if isinstance(symbol.getType(), StructDatatype):
            if len(symbol.getType().getFieldsOnly()) != len(atts):
                raise CompilerError(
                    f"Type '{symbol.getType().getDisplayName()}' expects {len(symbol.getType().getFieldsOnly())} fields, but {len(atts)} were provided",
                    self.getLocation(ctx),
                )

            for i in range(len(atts)):
                att = self.getNodeObjectAttribute(atts[i])
                if not att.name in symbol.getType().getMembers():
                    raise CompilerError(
                        f"Type '{symbol.getType().getDisplayName()}' has no member named '{att.name}'",
                        self.getLocation(ctx),
                    )

                field = symbol.getType().getMembers()[att.name]
                att.declaredType = field.getType()
                att.receivedType = self.getNodeDatatype(att.expr)
                attributes.append(att)

            self.setNodeObjectAttributes(ctx, attributes)
            self.setNodeDatatype(ctx, symbol.getType())

        else:
            raise CompilerError(
                f"Trying to instantiate a non-structural datatype '{symbol.getType().getDisplayName()}'",
                self.getLocation(ctx),
            )

    def exprMemberAccessImpl(self, ctx, exprtype: Datatype):
        if isinstance(exprtype, StructDatatype):
            fieldName = ctx.ID().getText()
            fieldIndex = -1
            fields = exprtype.getFieldsOnly()
            for i in range(len(fields)):
                if fields[i].getName() == fieldName:
                    fieldIndex = i
                    break

            memberFuncIndex = -1
            memberFuncs = exprtype.getMemberFuncsOnly()
            for i in range(len(memberFuncs)):
                if memberFuncs[i].getName() == fieldName:
                    memberFuncIndex = i
                    break

            if fieldIndex == -1 and memberFuncIndex == -1:
                raise CompilerError(
                    f"Expression '.{fieldName}' is not a member of type '{exprtype.getDisplayName()}'",
                    self.getLocation(ctx),
                )

            if fieldIndex != -1:
                self.setNodeMemberAccessFieldIndex(ctx, fieldIndex)
                type = exprtype.getFieldsOnly()[fieldIndex].getType()
                self.setNodeDatatype(ctx, type)
                symbol = VariableSymbol(
                    exprtype.getName(),
                    type,
                    VariableType.MutableStructField,
                    self.getLocation(ctx),
                )
                self.setNodeSymbol(ctx, symbol)

            elif memberFuncIndex != -1:
                memberFunc = exprtype.getMemberFuncsOnly()[memberFuncIndex]
                self.setNodeMemberAccessFunctionSymbol(ctx, memberFunc)
                self.setNodeSymbol(ctx, memberFunc)
                self.setNodeDatatype(
                    ctx, exprtype.getMemberFuncsOnly()[memberFuncIndex].getType()
                )

            else:
                raise InternalError(
                    "You fucked up big this time, a struct cannot have a field and a member function with the same name"
                )

        elif isinstance(exprtype, PointerDatatype):
            self.exprMemberAccessImpl(ctx, exprtype.getPointee())

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
