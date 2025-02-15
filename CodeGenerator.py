from AdvancedBaseVisitor import AdvancedBaseVisitor
from CompilationDatabase import CompilationDatabase, ObjAttribute
from typing import Optional, List, Dict
from grammar import HazeParser
from Datatype import Datatype, implicitConversion, FunctionLinkage
from Symbol import DatatypeSymbol, VariableSymbol
from FunctionSymbol import FunctionSymbol
from Error import CompilerError, InternalError, UnreachableCode
from Namespace import Namespace
from SymbolTable import SymbolTable, getStructFunctions, getStructFields
from SymbolName import SymbolName
from Scope import Scope
from Location import Location
from utils import getObjectAttributes, getNamedObjectAttributes, resolveGenerics
import os

CONTEXT_STRUCT = "N4Haze7ContextE"


class CodeGenerator(AdvancedBaseVisitor):
    def __init__(self, filename: str, db: CompilationDatabase):
        super().__init__(filename, db)
        self.currentFunctionStack: List[FunctionSymbol] = []
        self.structStack: List[Datatype] = []
        self.output = {
            "includes": {},
            "type_declarations": {},
            "function_definitions": {},
            "function_declarations": {},
        }
        self.functionCtx = {}
        self.structCtx = {}
        self.includeHeader("stdio.h")
        self.includeHeader("stdint.h")
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
                "\n\n".join([t for t in self.output["function_declarations"].values()])
            )

            f.write("\n\n// Function definition section\n")
            f.write(
                "\n\n".join([t for t in self.output["function_definitions"].values()])
            )

    def provideFuncDef(self, ctx):
        symbol = self.getNodeSymbol(ctx)
        if (
            not symbol.type.isFunction()
            or not isinstance(symbol, FunctionSymbol)
            or symbol.type.functionParameters is None
            or symbol.type.functionReturnType is None
        ):
            raise InternalError("Function is not a function")

        self.functionCtx[symbol.name] = ctx
        if not symbol.type.isGeneric():
            self.generateFuncUse(ctx)

    def generateFuncUse(self, ctx, generics: Optional[Dict[str, Datatype]] = None):
        symbol = self.getNodeSymbol(ctx)
        if (
            not symbol.type.isFunction()
            or not isinstance(symbol, FunctionSymbol)
            or symbol.type.functionParameters is None
            or symbol.type.functionReturnType is None
        ):
            raise InternalError("Function is not a function")

        def declaration(ftype: Datatype, returntype: Datatype):
            decl = returntype.generateUsageCode() + " " + symbol.getMangledName() + "("
            params = []
            params.append(f"{CONTEXT_STRUCT}* context")
            if symbol.thisPointerType:
                params.append(f"{symbol.thisPointerType.generateUsageCode()} this")
            params += [
                paramType.generateUsageCode() + " " + paramName
                for paramName, paramType in ftype.functionParameters
            ]
            decl += ", ".join(params)
            decl += ")"
            return decl

        if len(symbol.type.generics) > 0:
            resolveGenerics(symbol.type, self.getNodeScope(ctx), self.getLocation(ctx))

        decl = declaration(symbol.type, symbol.type.functionReturnType)
        self.outputFunctionDecl(symbol, decl + ";")
        self.outputFunctionDef(symbol, decl + " {\n")
        # elif generics is not None and len(generics.keys()) > 0:  # Now instantiate it
        # ft = symbol.type.instantiate(generics)
        # ft.genericsDict = generics
        # decl = declaration(ft, functype.functionReturnType)
        # self.output["generic_function_declarations"][symbol.getMangledName()] = (
        #     decl + ";\n"
        # )
        # self.output["generic_function_definitions"][symbol.getMangledName()] = (
        #     decl + " {\n"
        # )
        # pass

        scope = self.getNodeScope(ctx)
        self.db.pushScope(scope)
        self.pushCurrentFunction(symbol)
        print("gen ", symbol)
        self.visitChildren(ctx)

        if ctx.funcbody().body():  # Normal function
            for statement in ctx.funcbody().body().statement():
                self.outputFunctionDef(symbol, f"    {statement.code}")
        else:  # Arrow function
            self.outputFunctionDef(symbol, f"    {ctx.funcbody().expr().code}")

        if not scope.isTerminated():
            if self.getExpectedReturntype().isNone():
                self.outputFunctionDef(symbol, "    return;\n")
            else:
                raise InternalError(
                    "Body is missing return statement, but should have been caught already"
                )
        self.popCurrentFunction()

        self.outputFunctionDef(symbol, "}")
        self.db.popScope()

    def implVariableDefinition(self, ctx, is_mutable: bool):
        self.visitChildren(ctx)

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

    def visitGenericDatatype(self, ctx: HazeParser.HazeParser.GenericDatatypeContext):
        self.visitChildren(ctx)
        datatype = self.getNodeDatatype(ctx)
        if datatype.isStruct() and datatype.generics:
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
        return self.provideFuncDef(ctx)

    def visitNamedfunc(self, ctx: HazeParser.HazeParser.NamedfuncContext):
        return self.provideFuncDef(ctx)

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
    #     symtype = symbol.type;
    #     store = builder.CreateAlloca(symtype.getLLVMType(), 0, symbol.self.name);
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

        if isinstance(symbol, DatatypeSymbol):
            # Call constructor
            if not symbol.type.isStruct():
                raise InternalError("StructType missing")

            memsym: SymbolTable = symbol.type.structMemberSymbols
            symbol = memsym.tryLookup(SymbolName("constructor"), self.getLocation(ctx))
            if not symbol:
                raise InternalError(
                    "No constructor but should have been caught already"
                )

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

        if len(symbol.type.generics) > 0:
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
