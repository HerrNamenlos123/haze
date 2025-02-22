import HazeVisitor from "./parser/HazeVisitor";

import type { Datatype, GenericPlaceholderDatatype } from "./Datatype";
import { CompilerError, ImpossibleSituation, InternalError } from "./Errors";
import { Scope } from "./Scope";
import { Program } from "./Program";
import { type FunctionSymbol } from "./Symbol";
import type { CommonDatatypeContext } from "./parser/HazeParser";

const RESERVED_VARIABLE_NAMES = ["this", "context"];

class FunctionBodyAnalyzer extends HazeVisitor<any> {
  private program: Program;
  private functionStack: FunctionSymbol[];

  constructor(program: Program) {
    super();
    this.program = program;
    this.functionStack = [];
  }

  visitCommonDatatype = (ctx: CommonDatatypeContext): Datatype => {
    const name = ctx.ID().getText();
    const baseType = this.program.findBaseDatatype(name);
    if (!baseType) {
      const d: GenericPlaceholderDatatype = {
        variant: "Generic",
        name: name,
      };
      return d;
    }

    const genericsProvided: Datatype[] = ctx
      .datatype_list()
      .map((n) => this.visit(n));
    switch (baseType.variant) {
      case "Primitive":
        if (genericsProvided.length > 0) {
          throw new CompilerError(
            `Type '${name}' expected no generic arguments but got ${genericsProvided.length}.`,
            this.program.getLoc(ctx),
          );
        }
        return baseType;

      case "Struct":
        if (genericsProvided.length > 0) {
          throw new CompilerError(
            `Type '${name}<>' expected ${Object.keys(baseType.generics).length} generic arguments but got ${genericsProvided.length}.`,
            this.program.getLoc(ctx),
          );
        }
        return baseType;

      default:
        throw new ImpossibleSituation();
    }
  };

  visitSymbolValueExpr(ctx: any): Expression {
    let symbol = this.db
      .getCurrentScope()
      .lookupSymbol(ctx.ID().getText(), this.getLocation(ctx));
    symbol = copy(symbol);

    if (symbol instanceof DatatypeSymbol) {
      if (symbol.type.generics().length !== ctx.datatype().length) {
        throw new CompilerError(
          `Datatype expected ${symbol.type.generics().length} generic arguments but got ${ctx.datatype().length}.`,
          this.getLocation(ctx),
        );
      }
      for (let i = 0; i < symbol.type.generics().length; i++) {
        symbol.type.generics()[i] = [
          symbol.type.generics()[i][0],
          this.visit(ctx.datatype()[i]),
        ];
      }
    }

    this.setNodeSymbol(ctx, symbol);
    return new SymbolValueExpression(symbol, ctx);
  }

  visitExprCallExpr(ctx: any): Expression {
    let expr: Expression = this.visit(ctx.expr());

    let thisPointerExpr: Expression | null = null;
    if (expr instanceof MethodAccessExpression) {
      thisPointerExpr = copy(expr.expr);
      expr = new SymbolValueExpression(expr.method, ctx);
    }

    if (!expr.type.isFunction()) {
      throw new CompilerError(
        `Expression of type '${expr.type.getDisplayName()}' is not callable`,
        this.getLocation(ctx),
      );
    }

    const args: Expression[] = [];
    const params = expr.type.functionParameters();
    const _args = this.visit(ctx.args());
    this.assertExpectedNumOfArgs(ctx, _args.length, params.length);
    _args.forEach((_argExpr: Expression) => {
      args.push(_argExpr);
    });

    return new ExprCallExpression(expr, thisPointerExpr, args, ctx);
  }

  implFunc(ctx: any): void {
    let symbol = this.getNodeSymbol(ctx);
    if (
      !(symbol instanceof FunctionSymbol) ||
      symbol.type.functionParameters() === null ||
      symbol.type.functionReturnType() === null
    ) {
      throw new ImpossibleSituation();
    }

    if (symbol.functionLinkage === FunctionLinkage.Haze) {
      if (!symbol.scope) {
        throw new InternalError("Function missing scope");
      }
      let p = symbol.parentSymbol;
      const addedSymbols: string[] = [];
      let haveAllGenerics = true;
      while (p !== null) {
        for (let i = 0; i < p.type.generics().length; i++) {
          const tp = p.type.generics()[i][1];
          if (!tp) {
            haveAllGenerics = false;
            break;
          }
          symbol.scope.defineSymbol(
            new DatatypeSymbol(p.type.generics()[i][0], null, tp),
            this.getLocation(ctx),
          );
          addedSymbols.push(p.type.generics()[i][0]);
        }
        p = p.parentSymbol;
      }

      if (!haveAllGenerics) {
        return;
      }

      const loc = this.getLocation(ctx);
      const scope = symbol.scope;
      const newType = resolveGenerics(symbol.type, scope, loc);
      symbol = copy(symbol);
      if (symbol.thisPointerType !== undefined) {
        symbol.thisPointerType = resolveGenerics(
          symbol.thisPointerType,
          scope,
          loc,
        );
      }
      symbol.type = newType;

      if (
        symbol.type.areAllGenericsResolved() &&
        this.program.resolvedFunctions[symbol.getMangledName()]
      ) {
        addedSymbols.forEach((sym) => {
          symbol.scope?.purgeSymbol(sym);
        });
        return;
      }

      if (!symbol || !symbol.scope) {
        throw new ImpossibleSituation();
      }

      this.db.pushScope(symbol.scope);
      this.functionStack.push(symbol);

      const returnedTypes: Record<string, Datatype> = {};
      this.visit(ctx.funcbody()).forEach((statement: any) => {
        symbol.statements.push(statement);
        if (statement instanceof ReturnStatement && statement.expr) {
          returnedTypes[statement.expr.type.getDisplayName()] =
            statement.expr.type;
        }
      });

      addedSymbols.forEach((sym) => {
        symbol.scope?.purgeSymbol(sym);
      });

      if (!ctx.returntype()) {
        let returntype: Datatype = symbol.type.functionReturnType();
        if (Object.keys(returnedTypes).length > 1) {
          throw new CompilerError(
            `Cannot deduce return type. Multiple return types: ${Object.keys(
              returnedTypes,
            ).join(", ")}`,
            this.getLocation(ctx),
          );
        } else if (Object.keys(returnedTypes).length === 1) {
          returntype = Object.values(returnedTypes)[0];
        } else {
          returntype = this.db.getBuiltinDatatype("none");
        }

        symbol.type = Datatype.createFunctionType(
          symbol.type.functionParameters(),
          returntype,
        );
      }

      this.functionStack.pop();
      this.db.popScope();
      this.setNodeSymbol(ctx, symbol);
      this.program.resolvedFunctions[symbol.getMangledName()] = symbol;
    } else {
      this.visitChildren(ctx);
    }
  }

  visitFunc(ctx: FuncContext): void {
    this.implFunc(ctx);
  }

  visitNamedfunc(ctx: NamedfuncContext): void {
    this.implFunc(ctx);
  }

  visitExternfuncdef(ctx: ExternfuncdefContext): void {
    this.implFunc(ctx);
  }

  visitFuncbody(ctx: FuncbodyContext): Statement[] {
    if (ctx.expr()) {
      const expr: Expression = this.visit(ctx.expr());
      implicitConversion(
        expr.type,
        this.functionStack[
          this.functionStack.length - 1
        ].type.functionReturnType(),
        "",
        this.getLocation(ctx),
      );
      return [ReturnStatement(ctx.expr(), ctx)];
    } else {
      return ctx
        .body()
        .statement()
        .map((s) => this.visit(s));
    }
  }

  visitExprStatement(ctx: ExprStatementContext): ExprStatement {
    return new ExprStatement(this.visit(ctx.expr()), ctx);
  }

  implVariableDefinition(
    ctx: VariableDefinitionContext,
    variableType: VariableType,
  ): VariableDefinitionStatement {
    const name = ctx.ID().getText();
    if (RESERVED_VARIABLE_NAMES.includes(name)) {
      throw new CompilerError(
        `'${name}' is not a valid variable name.`,
        this.getLocation(ctx),
      );
    }

    const expr: Expression = this.visit(ctx.expr());
    let datatype = expr.type;
    if (ctx.datatype()) {
      datatype = this.visit(ctx.datatype());
    }

    if (datatype.isNone()) {
      throw new CompilerError(
        `'none' is not a valid variable type.`,
        this.getLocation(ctx),
      );
    }

    const symbol = new VariableSymbol(name, null, datatype, variableType);
    this.db.getCurrentScope().defineSymbol(symbol, this.getLocation(ctx));
    this.setNodeSymbol(ctx, symbol);
    return new VariableDefinitionStatement(symbol, expr, ctx);
  }

  visitBracketExpr(ctx: BracketExprContext): Expression {
    return this.visit(ctx.expr());
  }

  visitBinaryExpr(ctx: BinaryExprContext): void {
    this.visitChildren(ctx);
    let operation = ctx.children[1].getText();
    if (ctx.children[2].getText() === "not") {
      operation += " not";
    }

    this.setNodeBinaryOperator(ctx, operation);
    const typeA = this.getNodeDatatype(ctx.expr(0));
    const typeB = this.getNodeDatatype(ctx.expr(1));

    const datatypesUnrelated = () => {
      throw new CompilerError(
        `Datatypes '${typeA.getDisplayName()}' and '${typeB.getDisplayName()}' are unrelated and cannot be used for binary operation`,
        this.getLocation(ctx),
      );
    };

    switch (operation) {
      case "*":
      case "/":
      case "%":
      case "+":
      case "-":
        if (typeA.isInteger() && typeB.isInteger()) {
          this.setNodeDatatype(ctx, typeA);
        } else {
          datatypesUnrelated();
        }
        break;

      case "<":
      case ">":
      case "<=":
      case ">=":
        if (typeA.isInteger() && typeB.isInteger()) {
          this.setNodeDatatype(ctx, this.db.getBuiltinDatatype("boolean"));
        } else {
          datatypesUnrelated();
        }
        break;

      case "==":
      case "!=":
      case "is":
      case "is not":
        if (typeA.isInteger() && typeB.isInteger()) {
          this.setNodeDatatype(ctx, this.db.getBuiltinDatatype("boolean"));
        } else if (typeA.isBoolean() && typeB.isBoolean()) {
          this.setNodeDatatype(ctx, this.db.getBuiltinDatatype("boolean"));
        } else {
          datatypesUnrelated();
        }
        break;

      case "and":
      case "or":
        if (typeA.isBoolean() && typeB.isBoolean()) {
          this.setNodeDatatype(ctx, this.db.getBuiltinDatatype("boolean"));
        } else {
          datatypesUnrelated();
        }
        break;

      default:
        throw new CompilerError(
          `Operation '${operation}' is not implemented for types '${typeA.getDisplayName()}' and '${typeB.getDisplayName()}'`,
          this.getLocation(ctx),
        );
    }
  }

  visitIfexpr(ctx: IfexprContext): void {
    this.visitChildren(ctx);
    // this.setNodeDatatype(ctx, this.getNodeDatatype(ctx.expr()));
  }

  visitElseifexpr(ctx: ElseifexprContext): void {
    this.visitChildren(ctx);
    // this.setNodeDatatype(ctx, this.getNodeDatatype(ctx.expr()));
  }

  visitStructFuncDecl(ctx: StructFuncDeclContext): void {
    this.implFunc(ctx);
  }

  visitIntegerConstant(ctx: IntegerConstantContext): ConstantSymbol {
    const value = parseInt(ctx.getText(), 10);
    if (Number.isNaN(value)) {
      throw new CompilerError(
        `Could not parse '${ctx.getText()}' as an integer.`,
        this.getLocation(ctx),
      );
    }

    if (value < -(2 ** 31) || value > 2 ** 31 - 1) {
      return new ConstantSymbol(this.db.getBuiltinDatatype("i64"), value);
    } else if (value < -(2 ** 15) || value > 2 ** 15 - 1) {
      return new ConstantSymbol(this.db.getBuiltinDatatype("i32"), value);
    } else if (value < -(2 ** 7) || value > 2 ** 7 - 1) {
      return new ConstantSymbol(this.db.getBuiltinDatatype("i16"), value);
    } else {
      return new ConstantSymbol(this.db.getBuiltinDatatype("i8"), value);
    }
  }

  visitStringConstant(ctx: StringConstantContext): ConstantSymbol {
    return new ConstantSymbol(
      this.db.getBuiltinDatatype("stringview"),
      ctx.getText(),
    );
  }

  visitBooleanConstant(ctx: BooleanConstantContext): ConstantSymbol {
    const text = ctx.getText();
    let value = false;
    if (text === "true") {
      value = true;
    } else if (text !== "false") {
      throw new InternalError(`Invalid boolean constant: ${text}`);
    }
    return new ConstantSymbol(this.db.getBuiltinDatatype("boolean"), value);
  }

  visitConstantExpr(ctx: ConstantExprContext): ConstantExpression {
    const symbol: ConstantSymbol = this.visit(ctx.constant());
    return new ConstantExpression(symbol, symbol.type, ctx);
  }

  visitThenblock(ctx: ThenblockContext): void {
    this.visitChildren(ctx);
  }

  visitElseifblock(ctx: ElseifblockContext): void {
    this.visitChildren(ctx);
  }

  visitElseblock(ctx: ElseblockContext): void {
    this.visitChildren(ctx);
  }

  visitBody(ctx: BodyContext): void {
    this.visitChildren(ctx);
  }

  visitFuncRefExpr(ctx: FuncRefExprContext): void {
    this.visitChildren(ctx);
    this.setNodeSymbol(ctx, this.getNodeSymbol(ctx.func()));
    this.setNodeDatatype(ctx, this.getNodeSymbol(ctx.func()).type);
  }

  visitReturnStatement(ctx: ReturnStatementContext): ReturnStatement {
    if (ctx.expr()) {
      const expr: Expression = this.visit(ctx.expr());
      implicitConversion(
        expr.type,
        this.functionStack[
          this.functionStack.length - 1
        ].type.functionReturnType(),
        "",
        this.getLocation(ctx),
      );
      return new ReturnStatement(expr, ctx);
    } else {
      implicitConversion(
        this.db.getBuiltinDatatype("none"),
        this.functionStack[
          this.functionStack.length - 1
        ].type.functionReturnType(),
        "",
        this.getLocation(ctx),
      );
      return new ReturnStatement(null, ctx);
    }
  }

  visitIfStatement(ctx: IfStatementContext): void {
    this.visit(ctx.ifexpr());
    for (const expr of ctx.elseifexpr()) {
      this.visit(expr);
    }

    if (!this.getNodeDatatype(ctx.ifexpr()).isBoolean()) {
      throw new CompilerError(
        `If expression of type '${this.getNodeDatatype(ctx.ifexpr()).getDisplayName()}' is not a boolean`,
        this.getLocation(ctx),
      );
    }

    this.db.pushScope(this.getNodeScope(ctx.thenblock()));
    this.visit(ctx.thenblock());
    this.db.popScope();

    for (const elifblock of ctx.elseifblock()) {
      this.db.pushScope(this.getNodeScope(elifblock));
      this.visit(elifblock);
      this.db.popScope();
    }

    if (ctx.elseblock()) {
      this.db.pushScope(this.getNodeScope(ctx.elseblock()));
      this.visit(ctx.elseblock());
      this.db.popScope();
    }
  }

  visitArgs(ctx: ArgsContext): Expression[] {
    const args: Expression[] = [];
    for (const e of ctx.expr()) {
      args.push(this.visit(e));
    }
    return args;
  }

  visitMutableVariableDefinition(
    ctx: MutableVariableDefinitionContext,
  ): VariableDefinitionStatement {
    return this.implVariableDefinition(ctx, VariableType.MutableVariable);
  }

  visitImmutableVariableDefinition(
    ctx: ImmutableVariableDefinitionContext,
  ): VariableDefinitionStatement {
    return this.implVariableDefinition(ctx, VariableType.ConstantVariable);
  }

  visitExprAssignmentStatement(ctx: ExprAssignmentStatementContext): void {
    const rightExpr = this.visit(ctx.expr()[1]);
    if (rightExpr.type.isNone()) {
      throw new CompilerError(
        "Cannot assign 'none' to a variable.",
        this.getLocation(ctx),
      );
    }
  }

  visitObjectAttr(ctx: ObjectAttrContext): [VariableSymbol, Expression] {
    const name = ctx.ID().getText();
    const expr = this.visit(ctx.expr());
    const symbol = new VariableSymbol(
      name,
      null,
      expr.type,
      VariableType.MutableStructField,
    );
    return [symbol, expr];
  }

  visitObjectExpr(ctx: ObjectExprContext): ObjectExpression {
    const symbolTable = new SymbolTable();
    const members: Array<[VariableSymbol, Expression]> = [];
    for (const attr of ctx.objectattribute()) {
      const [symbol, expr] = this.visit(attr);
      symbolTable.insert(symbol, this.getLocation(ctx));
      members.push([symbol, expr]);
    }

    const struct = Datatype.createStructDatatype(
      this.db.makeAnonymousStructName(),
      [],
      symbolTable,
    );
    return new ObjectExpression(struct, members, ctx);
  }

  visitNamedObjectExpr(ctx: NamedObjectExprContext): ObjectExpression {
    const structtype: Datatype = this.visit(ctx.datatype());
    const members: Array<[VariableSymbol, Expression]> = [];

    for (const attr of ctx.objectattribute()) {
      const [symbol, expr] = this.visit(attr);
      members.push([symbol, expr]);

      const existingSymbol = structtype
        .structSymbolTable()
        .tryLookup(symbol.name, this.getLocation(ctx));

      if (!existingSymbol) {
        throw new CompilerError(
          `'${symbol.name}' is not a member of '${structtype.getDisplayName()}'`,
          this.getLocation(ctx),
        );
      }

      implicitConversion(
        symbol.type,
        existingSymbol.type,
        "",
        this.getLocation(ctx),
      );
    }

    return new ObjectExpression(structtype, members, ctx);
  }

  exprMemberAccessImpl(
    ctx: ExprMemberAccessContext,
    expr: Expression,
  ): MemberAccessExpression | MethodAccessExpression {
    if (expr.type.isStruct()) {
      const name: string = ctx.ID().getText();
      const field: VariableSymbol | undefined = getStructField(expr.type, name);
      let method: FunctionSymbol | undefined = getStructMethod(expr.type, name);

      if (!field && !method) {
        throw new CompilerError(
          `Expression '${name}' is not a member of type '${expr.type.getDisplayName()}'`,
          this.getLocation(ctx),
        );
      }

      if (field && method) {
        throw new CompilerError(
          `Access to member '${name}' of type '${expr.type.getDisplayName()}' is ambiguous`,
          this.getLocation(ctx),
        );
      }

      if (field) {
        return new MemberAccessExpression(expr, name, field, ctx);
      }

      if (method) {
        if (!method.ctx) {
          throw new ImpossibleSituation();
        }
        method = { ...method };

        if (!method.parentSymbol) {
          throw new InternalError("Method has no parent symbol");
        }
        if (!method.parentSymbol.type.isStruct()) {
          throw new InternalError("Parent symbol is not a struct");
        }

        method.parentSymbol = { ...method.parentSymbol };
        method.parentSymbol.type = Datatype.createStructDatatype(
          method.parentSymbol.type.name(),
          expr.type.generics(),
          method.parentSymbol.type.structSymbolTable(),
        );

        this.setNodeSymbol(method.ctx, { ...method });
        this.implFunc(method.ctx);
        return new MethodAccessExpression({ ...expr }, { ...method }, ctx);
      }
    } else {
      throw new CompilerError(
        `Cannot access member of non-structural datatype '${expr.type.getDisplayName()}'`,
        this.getLocation(ctx),
      );
    }
  }

  visitExprMemberAccess(
    ctx: ExprMemberAccessContext,
  ): MemberAccessExpression | MethodAccessExpression {
    const expr: Expression = this.visit(ctx.expr());
    return this.exprMemberAccessImpl(ctx, expr);
  }
}

function analyzeFunctionSymbol(program: Program, symbol: FunctionSymbol) {
  const analyzer = new FunctionBodyAnalyzer(program);
  analyzer.visit(symbol.ctx);
}

export function performSemanticAnalysis(program: Program) {
  console.log("analyzing");
  for (const symbol of Object.values(program.concreteFunctions)) {
    analyzeFunctionSymbol(program, symbol);
  }
}
