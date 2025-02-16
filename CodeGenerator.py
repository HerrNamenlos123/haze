from AdvancedBaseVisitor import AdvancedBaseVisitor
from CompilationDatabase import CompilationDatabase, ObjAttribute
from typing import Optional, List, Dict
from grammar import HazeParser
from Datatype import Datatype, implicitConversion, FunctionLinkage
from Symbol import DatatypeSymbol, VariableSymbol
from FunctionSymbol import FunctionSymbol
from Error import CompilerError, InternalError, UnreachableCode, ImpossibleSituation
from Namespace import Namespace
from SymbolTable import SymbolTable, getStructMethods, getStructFields
from SymbolName import SymbolName
from Scope import Scope
from Location import Location
from utils import getObjectAttributes, getNamedObjectAttributes, resolveGenerics
from Program import Program
from Statement import (
    Statement,
    ReturnStatement,
    VariableDefinitionStatement,
    ExprStatement,
)
from Expression import (
    Expression,
    ExprCallExpression,
    ConstantExpression,
    SymbolValueExpression,
    ObjectExpression,
    MemberAccessExpression,
)
import os

CONTEXT_STRUCT = "_HN4Haze7ContextE"


class CodeGenerator:
    def __init__(self, program: Program):
        super().__init__()
        self.program = program
        self.output = {
            "includes": {},
            "type_declarations": {},
            "function_definitions": {},
            "function_declarations": {},
        }
        self.output["type_declarations"][
            CONTEXT_STRUCT
        ] = f"typedef struct __{CONTEXT_STRUCT}__ {{}} {CONTEXT_STRUCT};"
        self.output["function_definitions"][
            "main"
        ] = f"int32_t main() {{\n    {CONTEXT_STRUCT} context = {{ }};\n    return _H4main(&context);\n}}"

    def includeHeader(self, filename: str):
        self.output["includes"][filename] = f"#include <{filename}>"

    def outputFunctionDecl(self, symbol: FunctionSymbol, value: str):
        if symbol.getMangledName() not in self.output["function_declarations"]:
            self.output["function_declarations"][symbol.getMangledName()] = ""
        self.output["function_declarations"][symbol.getMangledName()] += value

    def outputFunctionDef(self, symbol: FunctionSymbol, value: str):
        if symbol.getMangledName() not in self.output["function_definitions"]:
            self.output["function_definitions"][symbol.getMangledName()] = ""
        self.output["function_definitions"][symbol.getMangledName()] += value

    def writeFile(self, filename: str):
        os.makedirs(os.path.dirname(filename), exist_ok=True)
        with open(filename, "w") as f:
            f.write("// Include section\n")
            f.write("\n".join([str(t) for t in self.output["includes"].values()]))

            f.write("\n\n// Type declaration section\n")
            f.write(
                "\n".join([str(t) for t in self.output["type_declarations"].values()])
            )

            f.write("\n\n// Function declaration section\n")
            f.write(
                "\n".join([t for t in self.output["function_declarations"].values()])
            )

            f.write("\n\n// Function definition section\n")
            f.write(
                "\n\n".join([t for t in self.output["function_definitions"].values()])
            )

    def generate(self):
        self.includeHeader("stdio.h")
        self.includeHeader("stdint.h")

        for symbol in self.program.resolvedFunctions.values():
            self.generateFuncUse(symbol)

        for dt in self.program.resolvedDatatypes.values():
            self.generateDatatypeUse(dt)

    def generateFuncUse(self, symbol: FunctionSymbol):
        if not symbol.type.isFunction() or not isinstance(symbol, FunctionSymbol):
            raise InternalError("Function is not a function")

        def declaration(ftype: Datatype, returntype: Datatype):
            decl = returntype.generateUsageCode() + " " + symbol.getMangledName() + "("
            params = []
            params.append(f"{CONTEXT_STRUCT}* context")
            if symbol.thisPointerType:
                params.append(f"{symbol.thisPointerType.generateUsageCode()} this")
            params += [
                paramType.generateUsageCode() + " " + paramName
                for paramName, paramType in ftype.functionParameters()
            ]
            decl += ", ".join(params)
            decl += ")"
            return decl

        decl = declaration(symbol.type, symbol.type.functionReturnType())
        self.outputFunctionDecl(symbol, decl + ";")
        self.outputFunctionDef(symbol, decl + " {\n")

        for statement in symbol.statements:
            self.outputFunctionDef(symbol, self.cgStatement(statement) + "\n")

        self.outputFunctionDef(symbol, "}")

    def cgStatement(self, statement: Statement):
        if isinstance(statement, ReturnStatement):
            if statement.expr is None:
                return "return;"
            return "return " + self.cgExpr(statement.expr) + ";"
        elif isinstance(statement, VariableDefinitionStatement):
            if statement.expr is None or statement.symbol.type is None:
                raise ImpossibleSituation()
            ret = statement.symbol.type.generateUsageCode()
            return (
                ret
                + " "
                + statement.symbol.name
                + " = "
                + self.cgExpr(statement.expr)
                + ";"
            )
        elif isinstance(statement, ExprStatement):
            return self.cgExpr(statement.expr) + ";"
        raise InternalError(f"Unknown statement type {type(statement)}")

    def cgExpr(self, expr: Expression):
        if isinstance(expr, ExprCallExpression):
            args = []
            if isinstance(expr.expr, SymbolValueExpression):
                if isinstance(expr.expr.symbol, FunctionSymbol):
                    if expr.expr.symbol.functionLinkage == FunctionLinkage.Haze:
                        args.append("context")
            if expr.thisPointerExpr is not None:
                args.append("&" + self.cgExpr(expr.thisPointerExpr))
            for arg in expr.args:
                args.append(self.cgExpr(arg))
            return self.cgExpr(expr.expr) + "(" + ", ".join(args) + ")"
        elif isinstance(expr, ObjectExpression):
            s = "((" + expr.type.generateUsageCode() + ") { "
            for symbol, expr in expr.members:
                s += "." + symbol.name + " = " + self.cgExpr(expr) + ", "
            s += " })"
            return s
        elif isinstance(expr, MemberAccessExpression):
            return self.cgExpr(expr.expr) + "." + expr.memberName
        elif isinstance(expr, SymbolValueExpression):
            if isinstance(expr.symbol, FunctionSymbol):
                return expr.symbol.getMangledName()
            else:
                return expr.symbol.name
        elif isinstance(expr, ConstantExpression):
            match expr.constantSymbol.value:
                case int():
                    return str(expr.constantSymbol.value)
                case float():
                    return str(expr.constantSymbol.value)
                case bool():
                    return str(expr.constantSymbol.value)
                case str():
                    return expr.constantSymbol.value
            raise InternalError(
                f"Unknown constant type {type(expr.constantSymbol.value)}"
            )
        raise InternalError(f"Unknown expression type {type(expr)}")

    def implVariableDefinition(self, ctx, is_mutable: bool):
        symbol = self.getNodeSymbol(ctx)
        if isinstance(symbol, VariableSymbol):
            value = implicitConversion(
                self.getNodeDatatype(ctx.expr()),
                symbol.type,
                ctx.expr().code,
                self.getLocation(ctx),
            )
            ctx.code = f"{symbol.type.generateUsageCode()} {symbol.name} = {value};\n"
        else:
            raise InternalError("Symbol is not a variable")

    def generateDatatypeUse(self, datatype: Datatype):
        self.output["type_declarations"][
            datatype.getMangledName()
        ] = datatype.generateDefinitionCCode()

    def visitInlineCStatement(self, ctx):
        self.visitChildren(ctx)
        string = ctx.STRING_LITERAL().getText()[1:-1]
        ctx.code = string + "\n"  # type: ignore

    def getCurrentFunction(self):
        return self.currentFunctionStack[-1]

    def getExpectedReturntype(self):
        r = self.getCurrentFunction().type.functionReturnType
        if not r:
            raise InternalError("Function is missing return type")
        return r

    def pushCurrentFunction(self, symbol: FunctionSymbol):
        return self.currentFunctionStack.append(symbol)

    def popCurrentFunction(self):
        self.currentFunctionStack.pop()

    # def visitExternfuncdef(self, ctx):
    #     self.visitChildren(ctx);
    #     type = self.getNodeDatatype(ctx);
    #     if not isinstance(type, FunctionDatatype):
    #         raise CompilerError("Extern function must be a function type.", self.getLocation(ctx), );

    #     sym = self.getNodeSymbol(ctx);
    #     if isinstance(sym, FunctionSymbol):
    #         function = llvm::Function::Create(functype.getLLVMFunctionType(), llvm::Function::ExternalLinkage, sym.getMangledIdentifier(), *m_module);
    #         sym.setLlvmFunction(function);
    #     else:
    #         raise InternalError("Symbol is not a function symbol");

    def visitReturnStatement(self, ctx):
        scope = self.getNodeScope(ctx)
        scope.setTerminated(True)
        self.visitChildren(ctx)
        type = self.getNodeDatatype(ctx)
        if type.isNone():
            ctx.code = "return;\n"  # type: ignore

        else:
            value = implicitConversion(
                type,
                self.getExpectedReturntype(),
                ctx.expr().code,
                self.getLocation(ctx),
            )
            ctx.code = f"return {value};\n"  # type: ignore

    def visitConstantExpr(self, ctx):
        self.visitChildren(ctx)
        ctx.code = ctx.constant().code  # type: ignore

    def visitIntegerConstant(self, ctx):
        self.visitChildren(ctx)
        value = int(ctx.getText())
        if value < -(2**31) or value >= 2**31:
            ctx.code = str(value)  # type: ignore
        elif value < -(2**15) or value >= 2**15:
            ctx.code = str(value)  # type: ignore
        elif value < -(2**7) or value >= 2**7:
            ctx.code = str(value)  # type: ignore
        else:
            ctx.code = str(value)  # type: ignore

    def visitStringConstant(self, ctx):
        self.visitChildren(ctx)
        ctx.code = f'"{ctx.getText()[1:-1]}"'  # type: ignore

    def visitFunc(self, ctx: HazeParser.HazeParser.FuncContext):
        return self.provideFuncDef(ctx)

    def visitNamedfunc(self, ctx: HazeParser.HazeParser.NamedfuncContext):
        return self.provideFuncDef(ctx)

    def visitMutableVariableDefinition(self, ctx):
        return self.implVariableDefinition(ctx, True)

    def visitImmutableVariableDefinition(self, ctx):
        return self.implVariableDefinition(ctx, False)

    #     def visitExprAssignmentStatement(ToylangParser::ExprAssignmentStatementContext* ctx):
    #         self.visitChildren(ctx);
    #   auto& builder = getBuilder(ctx);
    #   symbol = self.getNodeSymbol(ctx);
    #         if variableSymbol = std::dynamic_pointer_cast<VariableSymbol>(symbol):
    #     value = self.getNodeLlvmValue(ctx.expr()[1]);
    #           if store = variableSymbol.getLlvmStore():
    #       builder.CreateStore(
    #           convertValueImplicit(getLocation(ctx), self.getNodeDatatype(ctx.expr()[1]), symbol.type, value, builder),
    #           *store);

    #           else:
    #             raise InternalError("Variable is missing store value");

    #         else:
    #           raise CompilerError(
    #         getLocation(ctx),
    #         std::format("Cannot assign to an expression of type '{}'", symbol.type.getDisplayName()));

    def visitSymbolValueExpr(self, ctx):
        self.visitChildren(ctx)
        symbol = self.getNodeSymbol(ctx)

        if isinstance(symbol, FunctionSymbol):
            ctx.code = symbol.getMangledName()  # type: ignore
        else:
            ctx.code = symbol.name.name  # type: ignore
        self.setNodeSymbol(ctx, symbol)

    def visitExprStatement(self, ctx):
        self.visitChildren(ctx)
        ctx.code = f"{ctx.expr().code};\n"  # type: ignore

    def visitExprCallExpr(self, ctx):
        self.visitChildren(ctx)
        symbol = self.getNodeSymbol(ctx.expr())
        exprtype = symbol.type

        # thisPointer = self.getNodeThisPointer(ctx.expr());
        # args.push_back(thisPointer);
        # thisPointerType = self.getNodeDatatype(expr);

        if not isinstance(symbol, FunctionSymbol) or not exprtype.isFunction():
            raise CompilerError(
                f"Expression of type '{exprtype.getDisplayName()}' is not callable",
                self.getLocation(ctx),
            )

        ctx.code = f"{ctx.expr().code}("  # type: ignore

        params = []
        if symbol.functionLinkage != FunctionLinkage.External_C:
            params.append("context")
        if symbol.thisPointerType:
            params.append(f"&{ctx.expr().structSymbol.name}")
        for i in range(len(exprtype.functionParameters)):
            paramexpr = ctx.args().expr()[i]
            expectedtype = exprtype.functionParameters[i][1]
            params.append(
                implicitConversion(
                    self.getNodeDatatype(paramexpr),
                    expectedtype,
                    ctx.args().expr()[i].code,
                    self.getLocation(paramexpr),
                )
            )

        ctx.code += ", ".join(params) + ")"  # type: ignore

        if len(symbol.type.generics()) > 0:
            if not symbol.ctx:
                raise InternalError("Function missing context")

            if hasattr(ctx.expr(), "structSymbol"):
                # symbol.type.genericsDict = ctx.expr().structSymbol.type.genericsDict
                self.setNodeSymbol(symbol.ctx, symbol)
                self.generateFuncUse(symbol.ctx)
            else:
                raise InternalError("Function missing context generics dict")

    def visitStructFuncDecl(self, ctx):
        return self.provideFuncDef(ctx)

    def visitStructDecl(self, ctx):
        self.visitChildren(ctx)
        datatype = self.getNodeDatatype(ctx)
        self.structCtx[datatype.name] = ctx
        if not datatype.generics:
            self.output["type_declarations"][
                datatype.getMangledName()
            ] = datatype.generateDefinitionCCode()

    # def visitObjectExpr(self, ctx):
    #     self.visitChildren(ctx)
    #     type = self.getNodeDatatype(ctx)
    #     if not isinstance(type, StructDatatype):
    #         raise InternalError("StructDatatype is not of type struct")

    #     ctx.code = f"({type.generateUsageCode()}){{ "
    #     for attr in self.getNodeObjectAttributes(ctx):
    #         objattr: ObjAttribute = attr
    #         ctx.code += f".{objattr.name} = {implicitConversion(objattr.receivedType, objattr.declaredType, objattr.expr.code, self.getLocation(ctx))}, "
    #     ctx.code += " }"

    def visitNamedObjectExpr(self, ctx: HazeParser.HazeParser.NamedObjectExprContext):
        self.visitChildren(ctx)

        structtype = self.getNodeDatatype(ctx)
        if not structtype.isStruct():
            raise InternalError("StructDatatype is not of type struct")

        ctx.code = f"({structtype.generateUsageCode()}){{ "  # type: ignore
        fields = getStructFields(structtype)
        for i in range(len(fields)):
            expr = ctx.objectattribute()[i].expr()
            ctx.code += f".{fields[i].name} = {implicitConversion(self.getNodeDatatype(expr), fields[i].type, expr.code, self.getLocation(ctx))}, "  # type: ignore
        ctx.code += " }"  # type: ignore

    def visitExprMemberAccess(self, ctx):
        self.visitChildren(ctx)

        symbol = self.getNodeSymbol(ctx.expr())
        if symbol.type.isStruct():
            if self.hasNodeMemberAccessFieldIndex(ctx):
                fieldIndex = self.getNodeMemberAccessFieldIndex(ctx)
                ctx.code = (  # type: ignore
                    f"{symbol.name}.{getStructFields(symbol.type)[fieldIndex].name}"
                )
                # symbol.type.genericsDict = symbol.type.genericsDict
                ctx.structSymbol = symbol  # type: ignore

            elif self.hasNodeMemberAccessFunctionSymbol(ctx):
                memberFuncSymbol = self.getNodeMemberAccessFunctionSymbol(ctx)
                # memberFuncSymbol.parentNamespace = Namespace(
                #     symbol.type.getDisplayName()
                # )
                # memberFuncSymbol.type.genericsDict = symbol.type.genericsDict
                ctx.code = f"{memberFuncSymbol.getMangledName()}"  # type: ignore
                ctx.structSymbol = symbol  # type: ignore
            else:
                raise InternalError("Neither field nor function")
        elif symbol.type.isPointer():
            if self.hasNodeMemberAccessFieldIndex(ctx) and symbol.type.pointee:
                fieldIndex = self.getNodeMemberAccessFieldIndex(ctx)
                ctx.code = f"{symbol.name}->{getStructFields(symbol.type.pointee)[fieldIndex].name}"  # type: ignore
                # ctx.structSymbol = symbol
            else:
                raise InternalError("Cannot call function on pointer")
        else:
            raise InternalError(
                f"Member access type {symbol.type.getDisplayName()} is not structural"
            )


def generateCode(program: Program, outfile: str):
    gen = CodeGenerator(program)
    gen.generate()
    gen.writeFile(outfile)
