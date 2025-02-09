from AdvancedBaseVisitor import AdvancedBaseVisitor
from CompilationDatabase import CompilationDatabase, ObjAttribute
from typing import Optional, List
from grammar import HazeParser
from Datatype import (
    Datatype,
    StructDatatype,
    FunctionDatatype,
    implicitConversion,
    PointerDatatype,
)
from Symbol import DatatypeSymbol, FunctionSymbol, VariableSymbol, FunctionType
from Error import CompilerError, InternalError
from Namespace import Namespace
import os

CONTEXT_STRUCT = "N4Haze7ContextE"


class CodeGenerator(AdvancedBaseVisitor):
    def __init__(self, filename: str, db: CompilationDatabase):
        super().__init__(filename, db)
        self.currentFunctionStack: List[FunctionSymbol] = []
        self.structStack: List[Datatype] = []
        self.output = {
            "includes": "",
            "type_declarations": "",
            "function_declarations": "",
            "function_definitions": "",
            "generic_types": {},
            "generic_functions": {},
        }
        self.includeHeader("stdio.h")
        self.includeHeader("stdint.h")
        self.output[
            "type_declarations"
        ] += f"typedef struct __{CONTEXT_STRUCT}__ {{}} {CONTEXT_STRUCT};\n"
        self.output[
            "function_definitions"
        ] += f"int32_t main() {{\n    {CONTEXT_STRUCT} context = {{ }};\n    return _H4main(&context);\n}}\n\n"

    def includeHeader(self, filename: str):
        self.output["includes"] += f"#include <{filename}>\n"

    def writeFile(self, filename: str):
        os.makedirs(os.path.dirname(filename), exist_ok=True)
        with open(filename, "w") as f:
            f.write("// Include section\n")
            f.write(self.output["includes"])
            f.write("\n\n// Type declaration section\n")
            f.write(self.output["type_declarations"])
            f.write("\n\n// Generic types declaration section\n")
            f.write("\n".join([str(t) for t in self.output["generic_types"].values()]))
            f.write("\n\n// Function declaration section\n")
            f.write(self.output["function_declarations"])
            f.write("\n\n// Function definition section\n")
            f.write(self.output["function_definitions"])

    def implFuncDef(self, ctx):
        symbol: FunctionSymbol = self.getNodeSymbol(ctx)
        functype = symbol.getType()

        if not isinstance(functype, FunctionDatatype):
            raise InternalError("Function type is not a function datatype")

        if not isinstance(symbol, FunctionSymbol):
            raise InternalError("Function symbol is not a function symbol")

        declaration = (
            functype.getReturnType().getCCode() + " " + symbol.getMangledName() + "("
        )

        params = []
        params.append(f"{CONTEXT_STRUCT}* context")
        if symbol.hasThisPointer:
            params.append(f"{symbol.thisPointerType.getCCode()} this")
        params += [
            paramType.getCCode() + " " + paramName
            for paramName, paramType in functype.getParameters()
        ]
        declaration += ", ".join(params)
        declaration += ")"

        self.output["function_declarations"] += declaration + ";\n"
        self.output["function_definitions"] += declaration + " {\n"

        scope = self.getNodeScope(ctx)
        self.db.pushScope(scope)
        self.pushCurrentFunction(symbol)

        self.visitChildren(ctx)

        if ctx.funcbody().body():  # Normal function
            for statement in ctx.funcbody().body().statement():
                self.output["function_definitions"] += f"    {statement.code}"
        else:  # Arrow function
            self.output["function_definitions"] += f"    {ctx.funcbody().expr().code}"

        if not scope.isTerminated():
            if self.getExpectedReturntype().isNone():
                self.output["function_definitions"] += "return;\n"
            else:
                raise InternalError(
                    "Body is missing return statement, but should have been caught already"
                )
        self.popCurrentFunction()

        self.output["function_definitions"] += "}\n\n"
        self.db.popScope()

    def implVariableDefinition(self, ctx, is_mutable: bool):
        self.visitChildren(ctx)
        symbol = self.getNodeSymbol(ctx)
        if isinstance(symbol, VariableSymbol):
            value = implicitConversion(
                self.getNodeDatatype(ctx.expr()),
                symbol.getType(),
                ctx.expr().code,
                self.getLocation(ctx),
            )
            ctx.code = f"{symbol.getType().getCCode()} {symbol.getName()} = {value};\n"
        else:
            raise InternalError("Symbol is not a variable")

    def visitGenericDatatype(self, ctx: HazeParser.HazeParser.GenericDatatypeContext):
        self.visitChildren(ctx)
        datatype = self.getNodeDatatype(ctx)
        if len(datatype.genericsList) > 0:
            self.output["generic_types"][
                datatype.getMangledName()
            ] = datatype.generateDefinitionCCode()

    def visitInlineCStatement(self, ctx):
        self.visitChildren(ctx)
        string = ctx.STRING_LITERAL().getText()[1:-1]
        ctx.code = string + "\n"

    def getCurrentFunction(self):
        return self.currentFunctionStack[-1]

    def getExpectedReturntype(self):
        return self.getCurrentFunction().getType().getReturnType()

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
            ctx.code = "return;\n"

        else:
            value = implicitConversion(
                type,
                self.getExpectedReturntype(),
                ctx.expr().code,
                self.getLocation(ctx),
            )
            ctx.code = f"return {value};\n"

    #     def visitIfexpr(ToylangParser::IfexprContext* ctx):
    #         self.visitChildren(ctx);
    #   setNodeLlvmValue(ctx, self.getNodeLlvmValue(ctx.expr()));

    #     def visitElseifexpr(ToylangParser::ElseifexprContext* ctx):
    #         self.visitChildren(ctx);
    #   setNodeLlvmValue(ctx, self.getNodeLlvmValue(ctx.expr()));

    #     def visitThenblock(ToylangParser::ThenblockContext* ctx):
    #         self.visitChildren(ctx);

    #     def visitElseifblock(ToylangParser::ElseifblockContext* ctx):
    #         self.visitChildren(ctx);

    #     def visitElseblock(ToylangParser::ElseblockContext* ctx):
    #         self.visitChildren(ctx);

    #     def visitIfStatement(ToylangParser::IfStatementContext* ctx):
    #   outerScope = self.getNodeScope(ctx);
    #   auto& builder = getBuilder(ctx);
    #   currentFunction = getCurrentFunction().getLlvmFunction();
    #         if not currentFunction:
    #           raise InternalError("Is missing function llvm value");

    #   visit(ctx.ifexpr());
    #   for (expr : ctx.elseifexpr():
    #     visit(expr);

    #   // First create and collect all blocks and scopes
    #   List<llvm::Value*> exprValues;
    #   List<llvm::BasicBlock*> conditionBlocks = { outerScope.getInsertBlock() };
    #   List<llvm::BasicBlock*> targetBlocks;
    #   for (auto& elifBlock : ctx.elseifblock():
    #     block = llvm::BasicBlock::Create(m_module.getContext(), "condition", *currentFunction);
    #     conditionBlocks.push_back(block);

    #   mergeBlock = llvm::BasicBlock::Create(m_module.getContext(), "merge", *currentFunction);

    #   thenscope = db.pushScope(self.getNodeScope(ctx.thenblock()));
    #   thenscope.createInsertBlock(*currentFunction, m_module);
    #   thenscope.setTerminated(false);
    #   m_builder.SetInsertPoint(thenscope.getInsertBlock());
    #   visit(ctx.thenblock());
    #         if not thenscope.isTerminated():
    #     m_builder.CreateBr(mergeBlock);

    #   db.popScope();
    #   targetBlocks.push_back(thenscope.getInsertBlock());
    #   exprValues.push_back(self.getNodeLlvmValue(ctx.ifexpr()));

    #   List<Ptr<Scope>> elsescopes;
    #   for (elifBlock : ctx.elseifblock():
    #           elifScope = db.pushScope(self.getNodeScope(elifBlock));
    #           elsescopes.push_back(elifScope);
    #           elifScope.setTerminated(false);
    #     m_builder.SetInsertPoint(elifScope.createInsertBlock(*currentFunction, m_module));
    #     targetBlocks.push_back(self.getNodeScope(elifBlock).getInsertBlock());
    #     visit(elifBlock);
    #           if not elifScope.isTerminated():
    #       m_builder.CreateBr(mergeBlock);

    #     db.popScope();

    #   for (elifExpr : ctx.elseifexpr():
    #     exprValues.push_back(self.getNodeLlvmValue(elifExpr));

    #         if ctx.elseblock():
    #           elseScope = db.pushScope(self.getNodeScope(ctx.elseblock()));
    #     m_builder.SetInsertPoint(elseScope.createInsertBlock(*currentFunction, m_module));
    #           elseScope.setTerminated(false);
    #     visit(ctx.elseblock());
    #           if not elseScope.isTerminated():
    #       m_builder.CreateBr(mergeBlock);

    #     db.popScope();
    #     conditionBlocks.push_back(elseScope.getInsertBlock());

    #         else:
    #     conditionBlocks.push_back(mergeBlock);

    #   for (size_t i = 0; i < exprValues.size(); i++:
    #     m_builder.SetInsertPoint(conditionBlocks[i]);
    #     m_builder.CreateCondBr(exprValues[i], targetBlocks[i], conditionBlocks[i + 1]);

    #   outerScope.setNewInsertBlock(mergeBlock);

    #     def visitCompilationhint(ToylangParser::CompilationhintContext* ctx):
    #   filename = fs::cwd() / self.getNodeCompilationHintFilename(ctx);
    #         if not std::filesystem::exists(filename):
    #           raise CompilerError(getLocation(ctx.compilationhintfilename()),
    #                         "File referenced in Compilation hint does not exist.");

    def visitConstantExpr(self, ctx):
        self.visitChildren(ctx)
        ctx.code = ctx.constant().code

    def visitIntegerConstant(self, ctx):
        self.visitChildren(ctx)
        value = int(ctx.getText())
        if value < -(2**31) or value >= 2**31:
            ctx.code = str(value)
        elif value < -(2**15) or value >= 2**15:
            ctx.code = str(value)
        elif value < -(2**7) or value >= 2**7:
            ctx.code = str(value)
        else:
            ctx.code = str(value)

    def visitStringConstant(self, ctx):
        self.visitChildren(ctx)
        ctx.code = f'"{ctx.getText()[1:-1]}"'

    #     def visitBooleanConstant(ToylangParser::BooleanConstantContext* ctx):
    #         self.visitChildren(ctx);
    #   auto& builder = getBuilder(ctx);
    #   setNodeLlvmValue(ctx, builder.getInt1(ctx.getText() == "true"));

    #     def visitBracketExpr(ToylangParser::BracketExprContext* ctx):
    #         self.visitChildren(ctx);
    #   setNodeLlvmValue(ctx, self.getNodeLlvmValue(ctx.expr()));
    #   setNodeDatatype(ctx, self.getNodeDatatype(ctx.expr()));

    #     def visitBinaryExpr(ToylangParser::BinaryExprContext* ctx):
    #         self.visitChildren(ctx);
    #   auto& builder = getBuilder(ctx);
    #   type = self.getNodeDatatype(ctx);
    #   operation = self.getNodeBinaryOperator(ctx);
    #   a = self.getNodeLlvmValue(ctx.expr(0));
    #   b = self.getNodeLlvmValue(ctx.expr(1));
    #   Ptr<Datatype> typeA = self.getNodeDatatype(ctx.expr(0));
    #   Ptr<Datatype> typeB = self.getNodeDatatype(ctx.expr(1));

    #   const unsupportedTypes = [&](:
    #           raise CompilerError(getLocation(ctx),
    #                         std::format("Operation '{}' is not implemented for types '{}' and '{}'",
    #                                     operation,
    #                                     typeA.getDisplayName(),
    #                                     typeB.getDisplayName()));
    # ;

    #   const assertInteger = [&](:
    #           if not typeA.isInteger() || !typeB.isInteger():
    #       unsupportedTypes();

    #           if not Datatype.isSame(typeA, typeB):
    #       unsupportedTypes();

    # ;

    #   const assertBoolean = [&](:
    #           if not typeA.isBoolean() || !typeB.isBoolean():
    #       unsupportedTypes();

    #           if not Datatype.isSame(typeA, typeB):
    #       unsupportedTypes();

    # ;

    #         if operation == "+":
    #     assertInteger();
    #     setNodeLlvmValue(ctx, builder.CreateAdd(a, b));

    #         else if operation == "-":
    #     assertInteger();
    #     setNodeLlvmValue(ctx, builder.CreateSub(a, b));

    #         else if operation == "*":
    #     assertInteger();
    #     setNodeLlvmValue(ctx, builder.CreateMul(a, b));

    #         else if operation == "/":
    #     assertInteger();
    #     setNodeLlvmValue(ctx, builder.CreateSDiv(a, b));

    #         else if operation == "%":
    #     assertInteger();
    #     setNodeLlvmValue(ctx, builder.CreateSRem(a, b));

    #         else if operation == ">":
    #     assertInteger();
    #     setNodeLlvmValue(ctx, builder.CreateICmpSGT(a, b));

    #         else if operation == "<":
    #     assertInteger();
    #     setNodeLlvmValue(ctx, builder.CreateICmpSLT(a, b));

    #         else if operation == ">=":
    #     assertInteger();
    #     setNodeLlvmValue(ctx, builder.CreateICmpSGE(a, b));

    #         else if operation == "<=":
    #     assertInteger();
    #     setNodeLlvmValue(ctx, builder.CreateICmpSLE(a, b));

    #         else if operation == "==" || operation == "is":
    #     assertBoolean();
    #     setNodeLlvmValue(ctx, builder.CreateICmpEQ(a, b));

    #         else if operation == "!=" || operation == "is not":
    #     assertBoolean();
    #     setNodeLlvmValue(ctx, builder.CreateICmpNE(a, b));

    #         else if operation == "and":
    #     assertBoolean();
    #     setNodeLlvmValue(ctx, builder.CreateAnd(a, b));

    #         else if operation == "or":
    #     assertBoolean();
    #     setNodeLlvmValue(ctx, builder.CreateOr(a, b));

    #         else:
    #           raise InternalError("Unsupported binary operator: " + operation);

    def visitFunc(self, ctx: HazeParser.HazeParser.FuncContext):
        return self.implFuncDef(ctx)

    def visitNamedfunc(self, ctx: HazeParser.HazeParser.NamedfuncContext):
        return self.implFuncDef(ctx)

    #     def visitFuncRefExpr(ToylangParser::FuncRefExprContext* ctx):
    #         self.visitChildren(ctx);
    #   setNodeLlvmValue(ctx, self.getNodeLlvmValue(ctx.func()));
    #   setNodeDatatype(ctx, self.getNodeDatatype(ctx.func()));

    #     def visitProg(ToylangParser::ProgContext* ctx):
    #         self.visitChildren(ctx);
    #         if not db.getGlobalScope().tryLookupSymbol("main"):
    #           raise CompilerError(getLocation(ctx), "No main function defined.");

    #     def visitBody(ToylangParser::BodyContext* ctx):
    #   scope = db.getCurrentScope();
    #   scope.setTerminated(false);
    #   for (stmt : ctx.statement():
    #     auto& builder = getBuilder(ctx);
    #           if scope.isTerminated():
    #       printWarningMessage(getLocation(stmt), "Eliminated dead code");
    #       break;

    #     visit(stmt);

    #     def visitFuncbody(ToylangParser::FuncbodyContext* ctx):
    #   auto& builder = getBuilder(ctx);
    #         if ctx.body():
    #     visit(ctx.body());

    #         else if ctx.expr():
    #     visit(ctx.expr());
    #     type = self.getNodeDatatype(ctx.expr());
    #           if type.isNone():
    #       builder.CreateRetVoid();

    #           else:
    #       functionSymbol = getCurrentFunction();
    #       value = convertValueImplicit(getLocation(ctx),
    #                                         self.getNodeDatatype(ctx.expr()),
    #                                         getExpectedReturntype(),
    #                                         self.getNodeLlvmValue(ctx.expr()),
    #                                         builder);

    #             if functionSymbol.hasStructReturn():
    #         f = functionSymbol.getLlvmFunction();
    #               if not f:
    #                 raise InternalError("Missing llvm function");

    #         builder.CreateStore(value, f.value().getArg(0));
    #         builder.CreateRetVoid();

    #             else:
    #         builder.CreateRet(value);

    #     self.getNodeScope(ctx).setTerminated(true);

    # template <typename T> std::any implVariableDefinition(T* ctx, bool is_mutable):
    #         self.visitChildren(ctx);
    #   auto& builder = getBuilder(ctx);
    #   Ptr<Symbol> symbol = self.getNodeSymbol(ctx);
    #         if variableSymbol = std::dynamic_pointer_cast<VariableSymbol>(symbol):
    #     symtype = symbol.getType();
    #     store = builder.CreateAlloca(symtype.getLLVMType(), 0, symbol.self.getName());
    #     value = self.getNodeLlvmValue(ctx.expr());
    #     variableSymbol.setLlvmStore(store);
    #     builder.CreateStore(convertValueImplicit(getLocation(ctx), self.getNodeDatatype(ctx.expr()), symtype, value, builder),
    #                         store);

    #         else:
    #           raise InternalError("Symbol of wrong type");

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
    #           convertValueImplicit(getLocation(ctx), self.getNodeDatatype(ctx.expr()[1]), symbol.getType(), value, builder),
    #           *store);

    #           else:
    #             raise InternalError("Variable is missing store value");

    #         else:
    #           raise CompilerError(
    #         getLocation(ctx),
    #         std::format("Cannot assign to an expression of type '{}'", symbol.getType().getDisplayName()));

    def visitSymbolValueExpr(self, ctx):
        self.visitChildren(ctx)
        symbol = self.getNodeSymbol(ctx)

        if isinstance(symbol, DatatypeSymbol):
            # Call constructor
            if not isinstance(symbol.getType(), StructDatatype):
                raise InternalError("StructType missing")

            if "constructor" in symbol.getType().getMembers():
                symbol = symbol.getType().getMembers()["constructor"]
            else:
                raise InternalError(
                    "No constructor but should have been caught already"
                )

        if isinstance(symbol, FunctionSymbol):
            ctx.code = symbol.getMangledName()
        else:
            ctx.code = symbol.getName()

    def visitExprStatement(self, ctx):
        self.visitChildren(ctx)
        ctx.code = f"{ctx.expr().code};\n"

    def visitExprCallExpr(self, ctx):
        self.visitChildren(ctx)
        exprtype = self.getNodeDatatype(ctx.expr())
        symbol = self.getNodeSymbol(ctx.expr())

        # thisPointer = self.getNodeThisPointer(ctx.expr());
        # args.push_back(thisPointer);
        # thisPointerType = self.getNodeDatatype(expr);

        if not isinstance(exprtype, FunctionDatatype):
            raise CompilerError(
                f"Expression of type '{exprtype.getDisplayName()}' is not callable",
                self.getLocation(ctx),
            )

        ctx.code = f"{ctx.expr().code}("

        params = []
        if symbol.functionType != FunctionType.External_C:
            params.append("context")
        if symbol.hasThisPointer:
            params.append(f"&{ctx.expr().structSymbol.getName()}")
        for i in range(len(exprtype.getParameters())):
            paramexpr = ctx.args().expr()[i]
            expectedtype = exprtype.getParameters()[i][1]
            params.append(
                implicitConversion(
                    self.getNodeDatatype(paramexpr),
                    expectedtype,
                    ctx.args().expr()[i].code,
                    self.getLocation(paramexpr),
                )
            )

        ctx.code += ", ".join(params) + ")"

    def visitStructFuncDecl(self, ctx):
        self.implFuncDef(ctx)

    def visitStructDecl(self, ctx):
        self.visitChildren(ctx)
        datatype: StructDatatype = self.getNodeDatatype(ctx)
        if datatype.genericsList:
            return
        self.output["type_declarations"] += datatype.generateDefinitionCCode()

    # def visitObjectExpr(self, ctx):
    #     self.visitChildren(ctx)
    #     type = self.getNodeDatatype(ctx)
    #     if not isinstance(type, StructDatatype):
    #         raise InternalError("StructDatatype is not of type struct")

    #     ctx.code = f"({type.getCCode()}){{ "
    #     for attr in self.getNodeObjectAttributes(ctx):
    #         objattr: ObjAttribute = attr
    #         ctx.code += f".{objattr.name} = {implicitConversion(objattr.receivedType, objattr.declaredType, objattr.expr.code, self.getLocation(ctx))}, "
    #     ctx.code += " }"

    def visitNamedObjectExpr(self, ctx):
        self.visitChildren(ctx)
        type = self.getNodeDatatype(ctx)
        if not isinstance(type, StructDatatype):
            raise InternalError("StructDatatype is not of type struct")

        ctx.code = f"({type.getCCode()}){{ "
        for attr in self.getNodeObjectAttributes(ctx):
            objattr: ObjAttribute = attr
            ctx.code += f".{objattr.name} = {implicitConversion(objattr.receivedType, objattr.declaredType, objattr.expr.code, self.getLocation(ctx))}, "
        ctx.code += " }"

    def visitExprMemberAccess(self, ctx):
        self.visitChildren(ctx)

        symbol = self.getNodeSymbol(ctx.expr())
        if isinstance(symbol.getType(), StructDatatype):
            if self.hasNodeMemberAccessFieldIndex(ctx):
                fieldIndex = self.getNodeMemberAccessFieldIndex(ctx)
                ctx.code = f"{symbol.getName()}.{symbol.getType().getFieldsOnly()[fieldIndex].getName()}"
                ctx.structSymbol = symbol

            elif self.hasNodeMemberAccessFunctionSymbol(ctx):
                memberFuncSymbol = self.getNodeMemberAccessFunctionSymbol(ctx)
                memberFuncSymbol.parentNamespace = Namespace(
                    symbol.getType().getDisplayName()
                )
                ctx.code = f"{memberFuncSymbol.getMangledName()}"
                ctx.structSymbol = symbol
            else:
                raise InternalError("Neither field nor function")
        elif isinstance(symbol.getType(), PointerDatatype):
            if self.hasNodeMemberAccessFieldIndex(ctx):
                fieldIndex = self.getNodeMemberAccessFieldIndex(ctx)
                ctx.code = f"{symbol.getName()}->{symbol.getType().getPointee().getFieldsOnly()[fieldIndex].getName()}"
                ctx.structSymbol = symbol
            else:
                raise InternalError("Cannot call function on pointer")
        else:
            raise InternalError(
                f"Member access type {type.getDisplayName()} is not structural"
            )
