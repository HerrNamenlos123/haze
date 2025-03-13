import HazeVisitor from "./parser/HazeVisitor";

import {
  findMemberInStruct,
  findMethodInStruct,
  getIntegerBinaryResult,
  getStructMembers,
  implicitConversion,
  isBoolean,
  isF32,
  isFloat,
  isInteger,
  isNone,
  Primitive,
  serializeDatatype,
  type Datatype,
  type FunctionDatatype,
  type NamespaceDatatype,
  type PrimitiveDatatype,
  type StructDatatype,
} from "./Datatype";
import {
  CompilerError,
  GeneralError,
  ImpossibleSituation,
  InternalError,
} from "./Errors";
import { Scope } from "./Scope";
import { Module } from "./Module";
import {
  isDatatypeGeneric,
  isSymbolGeneric,
  Language,
  mangleDatatype,
  mangleSymbol,
  serializeSymbol,
  VariableScope,
  VariableType,
  type BooleanConstantSymbol,
  type ConstantSymbol,
  type DatatypeSymbol,
  type FunctionSymbol,
  type LiteralConstantSymbol,
  type LiteralUnit,
  type StringConstantSymbol,
  type VariableSymbol,
} from "./Symbol";
import {
  BinaryExprContext,
  BodyContext,
  ElseifexprContext,
  ExplicitCastExprContext,
  ExprAssignmentExprContext,
  FuncdeclContext,
  FuncRefExprContext,
  IfexprContext,
  IfStatementContext,
  InlineCStatementContext,
  LiteralConstantContext,
  NamedfuncContext,
  ParamContext,
  ParamsContext,
  PostIncrExprContext,
  PreIncrExprContext,
  SymbolValueExprContext,
  UnaryExprContext,
  VariableDeclarationContext,
  VariableDefinitionContext,
  VariableStatementContext,
  WhileStatementContext,
  type ArgsContext,
  type BooleanConstantContext,
  type CommonDatatypeContext,
  type ConstantExprContext,
  type ExprMemberAccessContext,
  type ExprStatementContext,
  type FuncbodyContext,
  type FuncContext,
  type ParenthesisExprContext,
  type ReturnStatementContext,
  type StringConstantContext,
  type StructInstantiationExprContext,
  type StructMemberValueContext,
  type StructMethodContext,
} from "./parser/HazeParser";
import {
  analyzeVariableStatement,
  collectFunction,
  collectVariableStatement,
  datatypeSymbolUsed,
  defineGenericsInScope,
  getNestedReturnTypes,
  INTERNAL_METHOD_NAMES,
  RESERVED_VARIABLE_NAMES,
  resolveGenerics,
  visitCommonDatatypeImpl,
  visitParam,
  visitParams,
  type ParamPack,
} from "./utils";
import { ParserRuleContext } from "antlr4";
import type {
  BinaryExpression,
  ConstantExpression,
  ExplicitCastExpression,
  ExprAssignmentExpr,
  ExprCallExpression,
  Expression,
  MemberAccessExpression,
  MethodAccessExpression,
  ObjectExpression,
  PostIncrExpr,
  PreIncrExpr,
  RawPointerDereferenceExpression,
  SizeofExpr,
  SymbolValueExpression,
  UnaryExpression,
} from "./Expression";
import type {
  ConditionalStatement,
  ExprStatement,
  InlineCStatement,
  ReturnStatement,
  Statement,
  VariableDeclarationStatement,
  VariableDefinitionStatement,
  WhileStatement,
} from "./Statement";
import { SymbolFlags } from "typescript";
import { ModuleType } from "./Config";

class FunctionBodyAnalyzer extends HazeVisitor<any> {
  private program: Module;
  private functionStack: FunctionSymbol[];

  constructor(program: Module) {
    super();
    this.program = program;
    this.functionStack = [];
  }

  visitParam = (ctx: ParamContext): [string, Datatype] => {
    return visitParam(this, ctx);
  };

  visitParams = (ctx: ParamsContext): ParamPack => {
    return visitParams(this, ctx);
  };

  visitCommonDatatype = (ctx: CommonDatatypeContext): Datatype => {
    return visitCommonDatatypeImpl(this, this.program, ctx);
  };

  visitSymbolValueExpr = (ctx: SymbolValueExprContext): Expression => {
    const name = ctx.ID().getText();
    if (name === "sizeof") {
      if (ctx.datatype_list().length !== 1) {
        throw new CompilerError(
          `sizeof<> Operator expected 1 generic argument but got ${ctx.datatype_list().length}.`,
          this.program.location(ctx),
        );
      }
      const datatype: Datatype = this.visit(ctx.datatype_list()[0]);
      return {
        variant: "Sizeof",
        ctx: ctx,
        type: this.program.getBuiltinType("u64"),
        datatype: datatype,
        location: this.program.location(ctx),
      };
    }

    let symbol = this.program.currentScope.lookupSymbol(
      name,
      this.program.location(ctx),
    );

    symbol = { ...symbol };
    if (symbol.variant === "Datatype") {
      if (symbol.type.variant === "Struct") {
        if (
          symbol.type.generics
            .entries()
            .toArray()
            .some((a) => a[1])
        ) {
          throw new InternalError(
            `Found Datatype ${serializeDatatype(symbol.type)} but it already has generics`,
          );
        }

        symbol.type = { ...symbol.type };
        symbol.type.generics = new Map(symbol.type.generics);
        symbol.type.methods = symbol.type.methods.map((m) => ({ ...m }));
        if (symbol.type.generics.size !== ctx.datatype_list().length) {
          throw new CompilerError(
            `Datatype expected ${symbol.type.generics.size} generic arguments but got ${ctx.datatype_list().length}.`,
            this.program.location(ctx),
          );
        }
        let index = 0;
        for (const [name, tp] of symbol.type.generics) {
          if (tp?.variant !== "Generic") {
            symbol.type.generics.set(
              name,
              this.visit(ctx.datatype_list()[index]),
            );
          }
          index++;
        }

        if (
          symbol.type.generics
            .entries()
            .every((e) => e[1] !== undefined && e[1].variant !== "Generic")
        ) {
          datatypeSymbolUsed(
            {
              name: symbol.name,
              scope: symbol.scope,
              type: symbol.type,
              variant: "Datatype",
              parentSymbol: symbol.parentSymbol,
              export: symbol.export,
              location: symbol.location,
            },
            this.program,
          );
          const constructorSymbol = symbol.type.methods.find(
            (m) => m.name === "constructor",
          );
          if (!constructorSymbol) {
            throw new CompilerError(
              `Type '${serializeDatatype(symbol.type)}' must provide a constructor`,
              this.program.location(ctx),
            );
          }
          if (
            !this.program.concreteFunctions.get(mangleSymbol(constructorSymbol))
          ) {
            constructorSymbol.scope = new Scope(
              constructorSymbol.scope.location,
              constructorSymbol.scope,
            );
            for (const [name, tp] of symbol.type.generics) {
              if (!tp) {
                throw new CompilerError(
                  `Generic parameter '${name}' has no type`,
                  this.program.location(ctx),
                );
              }
              if (symbol.type.generics.get(name) === undefined) {
                symbol.type.generics.set(name, tp);
              }
              constructorSymbol.scope.defineSymbol({
                variant: "Datatype",
                name: name,
                scope: constructorSymbol.scope,
                type: tp,
                export: false,
                location: constructorSymbol.location,
              });
            }
            constructorSymbol.type = resolveGenerics(
              constructorSymbol.type,
              constructorSymbol.scope,
              constructorSymbol.location,
            ) as FunctionDatatype;
            constructorSymbol.type.functionReturnType = symbol.type;
            constructorSymbol.parentSymbol = symbol;
            this.implFunc(
              constructorSymbol.ctx as FuncContext,
              constructorSymbol,
            );
          }
        }
      }
    }

    return {
      type: symbol.type,
      variant: "SymbolValue",
      symbol: symbol,
      ctx: ctx,
      location: symbol.location,
    };
  };

  visitPreIncrExpr = (ctx: PreIncrExprContext): PreIncrExpr => {
    const expr: Expression = this.visit(ctx.expr());
    const operator = ctx._op.text;
    if (operator !== "++" && operator !== "--") {
      throw new CompilerError(
        `Unknown operator ${operator}`,
        this.program.location(ctx),
      );
    }
    if (!isInteger(expr.type)) {
      throw new CompilerError(
        `Unary operator '${operator}' is not known for type '${serializeDatatype(expr.type)}'`,
        this.program.location(ctx),
      );
    }
    return {
      variant: "PreIncr",
      ctx: ctx,
      expr: expr,
      operation: operator,
      type: expr.type,
      location: expr.location,
    };
  };

  visitPostIncrExpr = (ctx: PostIncrExprContext): PostIncrExpr => {
    const expr: Expression = this.visit(ctx.expr());
    const operator = ctx._op.text;
    if (operator !== "++" && operator !== "--") {
      throw new CompilerError(
        `Unknown operator ${operator}`,
        this.program.location(ctx),
      );
    }
    if (!isInteger(expr.type)) {
      throw new CompilerError(
        `Unary operator '${operator}' is not known for type '${serializeDatatype(expr.type)}'`,
        this.program.location(ctx),
      );
    }
    return {
      variant: "PostIncr",
      ctx: ctx,
      expr: expr,
      operation: operator,
      type: expr.type,
      location: expr.location,
    };
  };

  visitExprCallExpr = (ctx: any): Expression => {
    let expr: Expression = this.visit(ctx.expr());

    if (expr.type.variant === "Struct") {
      const constructor = expr.type.methods.find(
        (m) => m.name === "constructor",
      );
      if (!constructor) {
        throw new CompilerError(
          `Type '${serializeDatatype(expr.type)}' does not provide a constructor`,
          this.program.location(ctx),
        );
      }
      expr = {
        variant: "SymbolValue",
        ctx: ctx,
        symbol: constructor,
        type: constructor.type,
        location: expr.location,
      };
    }

    if (expr.variant === "MemberAccess" && expr.methodSymbol) {
      expr = {
        variant: "SymbolValue",
        ctx: ctx,
        symbol: expr.methodSymbol,
        type: expr.methodSymbol.type,
        location: expr.location,
      };
    }

    if (expr.type.variant !== "Function") {
      throw new CompilerError(
        `Expression of type '${serializeDatatype(expr.type)}' is not callable`,
        this.program.location(ctx),
      );
    }

    if (
      expr.variant === "SymbolValue" &&
      expr.symbol.variant === "Function" &&
      expr.symbol.specialMethod === "constructor"
    ) {
      const symbol = { ...expr.symbol };
      symbol.scope = new Scope(symbol.scope.location, symbol.scope);
      if (
        expr.symbol.parentSymbol?.variant !== "Datatype" ||
        expr.symbol.parentSymbol.type.variant !== "Struct"
      ) {
        throw new ImpossibleSituation();
      }
      symbol.parentSymbol = {
        ...expr.symbol.parentSymbol!,
      } as DatatypeSymbol<StructDatatype>;
      symbol.parentSymbol.type = { ...symbol.parentSymbol!.type };
      if (symbol.parentSymbol.type.variant !== "Struct") {
        throw new ImpossibleSituation();
      }
      for (const [name, tp] of symbol.parentSymbol.type.generics) {
        if (!tp) {
          throw new CompilerError(
            `Generic parameter '${name}' has no type`,
            this.program.location(ctx),
          );
        }
        if (symbol.parentSymbol.type.generics.get(name) === undefined) {
          symbol.parentSymbol.type.generics.set(name, tp);
        }
        symbol.scope.defineSymbol({
          variant: "Datatype",
          name: name,
          scope: symbol.scope,
          type: tp,
          export: false,
          location: symbol.location,
        });
      }
      symbol.type = resolveGenerics(
        symbol.type,
        symbol.scope,
        this.program.location(ctx),
      ) as FunctionDatatype;
      this.implFunc(symbol.ctx as FuncContext, symbol);
    }

    const args: Expression[] = [];
    const params = expr.type.functionParameters;
    const visitedArgs = this.visit(ctx.args());
    if (visitedArgs.length !== params.length) {
      if (!expr.type.vararg) {
        throw new CompilerError(
          `Expected ${params.length} arguments but got ${visitedArgs.length}`,
          this.program.location(ctx),
        );
      } else if (visitedArgs.length < params.length) {
        throw new CompilerError(
          `Expected at least ${params.length} arguments but got ${visitedArgs.length}`,
          this.program.location(ctx),
        );
      }
    }
    for (let i = 0; i < visitedArgs.length; i++) {
      const arg = visitedArgs[i];
      args.push(arg);
    }

    let thisPointerExpr: Expression | undefined = undefined;
    if (expr.variant === "SymbolValue" && expr.symbol.variant === "Function") {
      thisPointerExpr = expr.symbol.thisPointerExpr;
    } else if (expr.variant === "MemberAccess") {
      thisPointerExpr = undefined;
    } else if (
      expr.variant === "SymbolValue" &&
      expr.symbol.variant === "Variable" &&
      expr.symbol.type.variant === "Function"
    ) {
      thisPointerExpr = undefined;
    } else {
      throw new ImpossibleSituation();
    }

    return {
      type: expr.type.functionReturnType,
      variant: "ExprCall",
      thisPointerExpr: thisPointerExpr,
      args: args,
      expr: expr,
      ctx: ctx,
      location: this.program.location(ctx),
    };
  };

  visitFunc = (ctx: FuncContext): FunctionSymbol => {
    const symbol = collectFunction(
      this,
      ctx,
      this.program.makeAnonymousName(),
      this.program,
      this.functionStack[this.functionStack.length - 1],
    );
    this.implFunc(ctx, symbol);
    return symbol;
  };

  implFunc(
    ctx: FuncContext | NamedfuncContext | FuncdeclContext,
    symbol: FunctionSymbol,
  ): void {
    if (symbol.variant !== "Function") {
      throw new ImpossibleSituation();
    }

    if (symbol.wasAnalyzed) {
      return;
    }

    this.program.pushScope(symbol.scope);
    this.functionStack.push(symbol);

    if (symbol.language === Language.Internal) {
      if (!symbol.scope) {
        throw new InternalError("Function missing scope");
      }

      if (!symbol || !symbol.scope) {
        throw new ImpossibleSituation();
      }

      if (symbol.parentSymbol && symbol.parentSymbol.variant === "Datatype") {
        symbol.scope.defineSymbol({
          variant: "Variable",
          name: "this",
          type: {
            variant: "RawPointer",
            generics: new Map().set("__Pointee", symbol.parentSymbol.type),
          },
          variableType: VariableType.Parameter,
          variableScope: VariableScope.Local,
          export: false,
          location: symbol.location,
        });
      }

      for (const [name, tp] of symbol.type.functionParameters) {
        symbol.scope.defineSymbol({
          variant: "Variable",
          name: name,
          type: tp,
          variableType: VariableType.Parameter,
          variableScope: VariableScope.Local,
          export: false,
          location: symbol.location,
        });
      }

      symbol.scope.defineSymbol({
        variant: "Variable",
        name: "ctx",
        type: {
          variant: "RawPointer",
          generics: new Map().set(
            "__Pointee",
            this.program.getBuiltinType("Context"),
          ),
        },
        variableType: VariableType.Parameter,
        variableScope: VariableScope.Local,
        export: false,
        location: symbol.location,
      });

      if (!(ctx instanceof FuncdeclContext)) {
        this.visit(ctx.funcbody()).forEach((statement: Statement) => {
          symbol.scope.statements.push(statement);
        });
      }

      const returnedTypes = getNestedReturnTypes(symbol.scope);
      if (!ctx.datatype() && symbol.specialMethod !== "constructor") {
        let returntype: Datatype = symbol.type.functionReturnType;
        if (returnedTypes.length > 1) {
          throw new CompilerError(
            `Cannot deduce return type. Multiple return types: ${returnedTypes
              .map((tp) => serializeDatatype(tp))
              .join(", ")}`,
            this.program.location(ctx),
          );
        } else if (returnedTypes.length === 1) {
          returntype = returnedTypes[0];
        } else {
          returntype = this.program.getBuiltinType("none");
        }

        symbol.type.functionReturnType = returntype;
      }

      symbol = { ...symbol };
      symbol.type = { ...symbol.type };
      symbol.type.functionReturnType = resolveGenerics(
        symbol.type.functionReturnType,
        symbol.scope,
        symbol.scope.location,
      );

      if (!symbol.declared) {
        if (!isNone(symbol.type.functionReturnType)) {
          if (!symbol.scope.statements.some((s) => s.variant === "Return")) {
            throw new CompilerError(
              `Function ${symbol.name} is missing return statement`,
              this.program.location(ctx),
            );
          }
        } else {
          if (
            symbol.scope.statements.some(
              (s) => s.variant === "Return" && s.expr !== undefined,
            )
          ) {
            throw new CompilerError(
              `Function ${symbol.name} returning none cannot return a value `,
              this.program.location(ctx),
            );
          }
        }
      }

      symbol.wasAnalyzed = true;
      this.functionStack.pop();
      this.program.popScope();
      this.program.concreteFunctions.set(mangleSymbol(symbol), symbol);
      if (symbol.export) {
        this.program.exportFunctions.set(mangleSymbol(symbol), symbol);
      }
    } else {
      this.visitChildren(ctx);
    }
  }

  visitFuncbody = (ctx: FuncbodyContext): Statement[] => {
    if (ctx.expr()) {
      const expr: Expression = this.visit(ctx.expr());
      implicitConversion(
        expr.type,
        this.functionStack[this.functionStack.length - 1].type
          .functionReturnType,
        "",
        this.program.currentScope,
        this.program.location(ctx),
        this.program,
      );
      return [
        {
          variant: "Return",
          ctx: ctx,
          expr: expr,
          location: this.program.location(ctx),
        } as ReturnStatement,
      ];
    } else {
      return this.visitBody(ctx.body());
    }
  };

  visitBody = (ctx: BodyContext): Statement[] => {
    return ctx.statement_list().map((s) => this.visit(s));
  };

  visitExprStatement = (ctx: ExprStatementContext): ExprStatement => {
    return {
      variant: "Expr",
      ctx: ctx,
      expr: this.visit(ctx.expr()),
      location: this.program.location(ctx),
    };
  };

  visitVariableDefinition = (ctx: VariableDefinitionContext): Statement => {
    const statement = collectVariableStatement(
      this,
      ctx,
      this.program,
      VariableScope.Local,
      this.functionStack[this.functionStack.length - 1],
    );
    return analyzeVariableStatement(this, this.program, statement);
  };

  visitVariableDeclaration = (ctx: VariableDeclarationContext): Statement => {
    const statement = collectVariableStatement(
      this,
      ctx,
      this.program,
      VariableScope.Local,
      this.functionStack[this.functionStack.length - 1],
    );
    const s = analyzeVariableStatement(this, this.program, statement);
    return s;
  };

  visitVariableStatement = (ctx: VariableStatementContext): Statement => {
    return this.visit(ctx.variablestatement());
  };

  visitParenthesisExpr = (ctx: ParenthesisExprContext): Expression => {
    return this.visit(ctx.expr());
  };

  visitExplicitCastExpr = (
    ctx: ExplicitCastExprContext,
  ): ExplicitCastExpression => {
    const expr: Expression = this.visit(ctx.expr());
    const targetType: Datatype = this.visit(ctx.datatype());
    return {
      variant: "ExplicitCast",
      expr: expr,
      ctx: ctx,
      type: targetType,
      location: this.program.location(ctx),
    };
  };

  visitBinaryExpr = (ctx: BinaryExprContext): BinaryExpression => {
    const left: Expression = this.visit(ctx.expr_list()[0]);
    const right: Expression = this.visit(ctx.expr_list()[1]);
    let operation = ctx.getChild(1).getText();
    if (operation === "is" && ctx.getChild(2).getText() === "not") {
      operation = "!=";
    }
    if (operation === "is") {
      operation = "==";
    }
    if (operation === "and") {
      operation = "&&";
    }
    if (operation === "or") {
      operation = "||";
    }

    switch (operation) {
      case "*":
      case "/":
      case "%":
      case "+":
      case "-":
        if (isInteger(left.type) && isInteger(right.type)) {
          return {
            variant: "Binary",
            ctx: ctx,
            leftExpr: left,
            operation: operation,
            rightExpr: right,
            type: getIntegerBinaryResult(
              left.type as PrimitiveDatatype,
              right.type as PrimitiveDatatype,
            ),
            location: this.program.location(ctx),
          };
        }
        if (isF32(left.type) && isF32(right.type)) {
          return {
            variant: "Binary",
            ctx: ctx,
            leftExpr: left,
            operation: operation,
            rightExpr: right,
            location: this.program.location(ctx),
            type: this.program.getBuiltinType("f32"),
          };
        } else if (isFloat(left.type) && isFloat(right.type)) {
          return {
            variant: "Binary",
            ctx: ctx,
            leftExpr: left,
            operation: operation,
            rightExpr: right,
            location: this.program.location(ctx),
            type: this.program.getBuiltinType("f64"),
          };
        } else if (
          (isFloat(left.type) && isInteger(right.type)) ||
          (isInteger(left.type) && isFloat(right.type))
        ) {
          return {
            variant: "Binary",
            ctx: ctx,
            leftExpr: left,
            operation: operation,
            rightExpr: right,
            type: this.program.getBuiltinType("f64"),
            location: this.program.location(ctx),
          };
        }
        break;

      case "<":
      case ">":
      case "<=":
      case ">=":
        if (
          (isInteger(left.type) || isFloat(left.type)) &&
          (isInteger(right.type) || isFloat(right.type))
        ) {
          return {
            variant: "Binary",
            ctx: ctx,
            leftExpr: left,
            operation: operation,
            rightExpr: right,
            type: this.program.getBuiltinType("boolean"),
            location: this.program.location(ctx),
          };
        }
        break;

      case "==":
      case "!=":
        if (
          (isBoolean(left.type) && isBoolean(right.type)) ||
          (isInteger(left.type) && isInteger(right.type)) ||
          (isFloat(left.type) && isFloat(right.type))
        ) {
          return {
            variant: "Binary",
            ctx: ctx,
            leftExpr: left,
            operation: operation,
            rightExpr: right,
            type: this.program.getBuiltinType("boolean"),
            location: this.program.location(ctx),
          };
        }
        break;

      case "&&":
      case "||":
        if (isBoolean(left.type) && isBoolean(right.type)) {
          return {
            variant: "Binary",
            ctx: ctx,
            leftExpr: left,
            operation: operation,
            rightExpr: right,
            type: this.program.getBuiltinType("boolean"),
            location: this.program.location(ctx),
          };
        }
        break;
    }

    throw new CompilerError(
      `No binary operator '${operation}' is known for types '${serializeDatatype(left.type)}' and '${serializeDatatype(right.type)}'`,
      this.program.location(ctx),
    );
  };

  visitUnaryExpr = (ctx: UnaryExprContext): UnaryExpression => {
    const expr: Expression = this.visit(ctx.expr());
    let operation = ctx.getChild(0).getText();
    if (operation === "not") {
      operation = "!";
    }

    switch (operation) {
      case "!":
        return {
          variant: "Unary",
          ctx: ctx,
          expr: expr,
          operation: operation,
          location: this.program.location(ctx),
          type: this.program.getBuiltinType("boolean"),
        };

      case "+":
      case "-":
        if (!isInteger(expr.type) && !isFloat(expr.type)) {
          throw new CompilerError(
            `Unary operator '${operation}' is not known for type '${serializeDatatype(expr.type)}'`,
            this.program.location(ctx),
          );
        }
        return {
          variant: "Unary",
          ctx: ctx,
          expr: expr,
          operation: operation,
          type: expr.type,
          location: this.program.location(ctx),
        };

      default:
        throw new CompilerError(
          `No unary operator '${operation}' is known for type '${serializeDatatype(expr.type)}'`,
          this.program.location(ctx),
        );
    }
  };

  // visitStructMethod = (ctx: StructMethodContext): void => {
  //   this.implFunc(ctx);
  // };

  visitStringConstant = (ctx: StringConstantContext): StringConstantSymbol => {
    return {
      variant: "StringConstant",
      type: this.program.getBuiltinType("stringview"),
      value: ctx.getText(),
      location: this.program.location(ctx),
    };
  };

  visitLiteralConstant = (ctx: LiteralConstantContext): ConstantSymbol => {
    const match = ctx.getText().match(/^(\d+(?:\.\d+)?)(s|ms|us|ns|m|h|d)?$/);
    if (!match) {
      throw new InternalError(
        "Could not parse literal",
        this.program.location(ctx),
      );
    }
    const [, valueStr, unitStr] = match;
    const isFloat = valueStr.indexOf(".") !== -1;
    let value = isFloat ? parseFloat(valueStr) : parseInt(valueStr);

    if (Number.isNaN(value)) {
      throw new CompilerError(
        `Could not parse '${ctx.getText()}'.`,
        this.program.location(ctx),
      );
    }

    let type = isFloat
      ? this.program.getBuiltinType("f64")
      : this.program.getBuiltinType("i64");
    let unit: LiteralUnit | undefined = undefined;

    if (unitStr) {
      switch (unitStr) {
        case "s":
        case "ms":
        case "us":
        case "ns":
        case "m":
        case "h":
        case "d":
          (type = this.program.getBuiltinType("Duration")), (unit = unitStr);
          break;

        default:
          throw new CompilerError(
            `'${unitStr}' is not a valid unit`,
            this.program.location(ctx),
          );
      }
    }

    return {
      variant: "LiteralConstant",
      type: type,
      value: value,
      location: this.program.location(ctx),
      unit: unit,
    };
  };

  visitBooleanConstant = (
    ctx: BooleanConstantContext,
  ): BooleanConstantSymbol => {
    const text = ctx.getText();
    let value = false;
    if (text === "true") {
      value = true;
    } else if (text !== "false") {
      throw new InternalError(`Invalid boolean constant: ${text}`);
    }
    return {
      variant: "BooleanConstant",
      type: this.program.getBuiltinType("boolean"),
      value,
      location: this.program.location(ctx),
    };
  };

  visitConstantExpr = (ctx: ConstantExprContext): ConstantExpression => {
    const symbol: ConstantSymbol = this.visit(ctx.constant());
    return {
      variant: "Constant",
      constantSymbol: symbol,
      ctx: ctx,
      type: symbol.type,
      location: this.program.location(ctx),
    };
  };

  visitFuncRefExpr = (ctx: FuncRefExprContext): SymbolValueExpression => {
    const symbol = this.visitFunc(ctx.func());
    return {
      variant: "SymbolValue",
      ctx: ctx,
      symbol: symbol,
      type: symbol.type,
      location: this.program.location(ctx),
    };
  };

  visitInlineCStatement = (ctx: InlineCStatementContext): InlineCStatement => {
    const string = JSON.parse(ctx.STRING_LITERAL().getText());
    return {
      variant: "InlineC",
      ctx,
      code: string,
      location: this.program.location(ctx),
    };
  };

  visitReturnStatement = (ctx: ReturnStatementContext): ReturnStatement => {
    if (ctx.expr()) {
      const expr: Expression = this.visit(ctx.expr());
      implicitConversion(
        expr.type,
        this.functionStack[this.functionStack.length - 1].type
          .functionReturnType,
        "",
        this.program.currentScope,
        this.program.location(ctx),
        this.program,
      );
      return {
        variant: "Return",
        expr,
        ctx,
        location: this.program.location(ctx),
      };
    } else {
      implicitConversion(
        this.program.getBuiltinType("none"),
        this.functionStack[this.functionStack.length - 1].type
          .functionReturnType,
        "",
        this.program.currentScope,
        this.program.location(ctx),
        this.program,
      );
      return {
        variant: "Return",
        ctx: ctx,
        location: this.program.location(ctx),
      };
    }
  };

  visitIfexpr = (ctx: IfexprContext): Expression => {
    return this.visit(ctx.expr());
  };

  visitElseifexpr = (ctx: ElseifexprContext): Expression => {
    return this.visit(ctx.expr());
  };

  visitIfStatement = (ctx: IfStatementContext): Statement => {
    const ifExpr: Expression = this.visitIfexpr(ctx.ifexpr());
    const elseIfExprs: Expression[] = [];
    for (const expr of ctx.elseifexpr_list()) {
      elseIfExprs.push(this.visit(expr));
    }

    const parentScope = this.program.currentScope;
    const location = this.program.location(ctx);
    const statement: ConditionalStatement = {
      variant: "Conditional",
      if: [ifExpr, new Scope(location, parentScope)],
      elseIf: elseIfExprs.map((e) => [e, new Scope(location, parentScope)]),
      else: ctx.elseblock() && new Scope(location, parentScope),
      ctx: ctx,
      location: location,
    };

    const ifScope = this.program.pushScope(statement.if[1]);
    this.visitBody(ctx.thenblock().body()).forEach((statement: Statement) => {
      ifScope.statements.push(statement);
    });
    this.program.popScope();

    let index = 0;
    for (const [expr, scope] of statement.elseIf) {
      this.program.pushScope(scope);
      this.visitBody(ctx.elseifblock_list()[index].body()).forEach(
        (statement: Statement) => {
          scope.statements.push(statement);
        },
      );
      this.program.popScope();
      index++;
    }

    if (statement.else) {
      const scope = this.program.pushScope(statement.else);
      this.visitBody(ctx.elseblock().body()).forEach((statement: Statement) => {
        scope.statements.push(statement);
      });
      this.program.popScope();
    }

    return statement;
  };

  visitWhileStatement = (ctx: WhileStatementContext): Statement => {
    const expr: Expression = this.visit(ctx.expr());

    const location = this.program.location(ctx);
    const whileStatement: WhileStatement = {
      variant: "While",
      expr: expr,
      scope: new Scope(location, this.program.currentScope),
      ctx: ctx,
      location: location,
    };

    this.program.pushScope(whileStatement.scope);
    this.visitBody(ctx.body()).forEach((statement: Statement) => {
      whileStatement.scope.statements.push(statement);
    });
    this.program.popScope();
    return whileStatement;
  };

  visitArgs = (ctx: ArgsContext): Expression[] => {
    const args: Expression[] = [];
    for (const e of ctx.expr_list()) {
      args.push(this.visit(e));
    }
    return args;
  };

  visitExprAssignmentExpr = (
    ctx: ExprAssignmentExprContext,
  ): ExprAssignmentExpr => {
    const leftExpr: Expression = this.visit(ctx.expr_list()[0]);
    const rightExpr: Expression = this.visit(ctx.expr_list()[1]);
    if (
      rightExpr.type.variant === "Primitive" &&
      rightExpr.type.primitive === Primitive.none
    ) {
      throw new CompilerError(
        "Cannot assign a value of type 'none'.",
        this.program.location(ctx),
      );
    }
    if (
      leftExpr.type.variant === "Primitive" &&
      leftExpr.type.primitive === Primitive.none
    ) {
      throw new CompilerError(
        "Cannot assign to an expression of type 'none'.",
        this.program.location(ctx),
      );
    }

    return {
      variant: "ExprAssign",
      type: leftExpr.type,
      ctx: ctx,
      leftExpr: leftExpr,
      rightExpr: rightExpr,
      location: this.program.location(ctx),
    };
  };

  visitStructMemberValue = (
    ctx: StructMemberValueContext,
  ): [VariableSymbol, Expression] => {
    const name = ctx.ID().getText();
    const expr = this.visit(ctx.expr());
    const symbol: VariableSymbol = {
      name: name,
      type: expr.type,
      variableType: VariableType.MutableStructField,
      variableScope: VariableScope.Member,
      variant: "Variable",
      export: false,
      location: this.program.location(ctx),
    };
    return [symbol, expr];
  };

  // visitObjectExpr = (ctx: ObjectExprContext): ObjectExpression => {
  //   const newType: StructDatatype = {
  //     variant: "Struct",
  //     members: [],
  //   };
  //   const members: Array<[VariableSymbol, Expression]> = [];
  //   for (const attr of ctx.objectattribute_list()) {
  //     const [symbol, expr] = this.visit(attr);
  //     newType.members.push(symbol);
  //     members.push([symbol, expr]);
  //   }

  //   const struct = Datatype.createStructDatatype(
  //     this.db.makeAnonymousStructName(),
  //     [],
  //     symbolTable,
  //   );
  //   return {
  //     ctx: ctx,
  //     type: struct,
  //     members: members,
  //   };
  // };

  visitStructInstantiationExpr = (
    ctx: StructInstantiationExprContext,
  ): ObjectExpression => {
    const structtype: Datatype = this.visit(ctx.datatype());
    const members: Array<[VariableSymbol, Expression]> = [];

    if (structtype.variant !== "Struct") {
      throw new CompilerError(
        `Expression of type '${serializeDatatype(structtype)}' is not a struct`,
        this.program.location(ctx),
      );
    }

    const scope = new Scope(
      this.program.location(ctx),
      this.program.currentScope,
    );
    defineGenericsInScope(structtype.generics, scope);

    const assignedMembers = [] as string[];
    for (const attr of ctx.structmembervalue_list()) {
      const [symbol, expr] = this.visit(attr) as [VariableSymbol, Expression];
      members.push([symbol, expr]);

      const existingSymbol = findMemberInStruct(structtype, symbol.name);
      if (!existingSymbol) {
        throw new CompilerError(
          `'${symbol.name}' is not a member of '${serializeDatatype(structtype)}'`,
          this.program.location(ctx),
        );
      }

      // const symType = existingSymbol.type;
      const symType = resolveGenerics(
        existingSymbol.type,
        scope,
        this.program.location(ctx),
      );

      implicitConversion(
        symbol.type,
        symType,
        "",
        scope,
        this.program.location(ctx),
        this.program,
      );

      assignedMembers.push(symbol.name);
    }

    for (const member of structtype.members) {
      if (member.variant === "Variable") {
        if (!assignedMembers.includes(member.name)) {
          throw new CompilerError(
            `'${member.name}' is not assigned in struct instantiation`,
            this.program.location(ctx),
          );
        }
      } else if (member.variant === "StructMemberUnion") {
        // We need to set exactly one of the union members
        let setMember = undefined as VariableSymbol | undefined;
        for (const inner of member.symbols) {
          if (assignedMembers.includes(inner.name)) {
            if (setMember) {
              throw new CompilerError(
                `Cannot set more than one member of union in struct instantiation`,
                this.program.location(ctx),
              );
            }
            setMember = inner;
          }
        }
        if (!setMember) {
          throw new CompilerError(
            `No member of union is not assigned in struct instantiation`,
            this.program.location(ctx),
          );
        }
      }
    }

    return {
      variant: "Object",
      ctx: ctx,
      members: members,
      type: structtype,
      location: this.program.location(ctx),
    };
  };

  visitExprMemberAccess = (ctx: ExprMemberAccessContext): Expression => {
    let expr: Expression = this.visit(ctx.expr());
    const name: string = ctx.ID().getText();

    if (INTERNAL_METHOD_NAMES.includes(name)) {
      throw new CompilerError(
        `Cannot access internal method '${name}'`,
        this.program.location(ctx),
      );
    }

    if (expr.type.variant !== "Namespace") {
      while (expr.type.variant !== "Struct") {
        if (expr.type.variant !== "RawPointer") {
          throw new CompilerError(
            `Cannot access member '${name}' of non-structural datatype '${serializeDatatype(expr.type)}'`,
            this.program.location(ctx),
          );
        }

        const p = expr.type.generics.get("__Pointee");
        if (!p) {
          throw new ImpossibleSituation();
        }
        if (name === "ptr") {
          const e: RawPointerDereferenceExpression = {
            variant: "RawPtrDeref",
            expr: expr,
            ctx: ctx,
            type: p,
            location: this.program.location(ctx),
          };
          return e;
        }

        expr = {
          variant: "RawPtrDeref",
          expr: expr,
          ctx: ctx,
          type: p.variant === "RawPointer" ? p.generics.get("__Pointee")! : p,
          location: this.program.location(ctx),
        } as RawPointerDereferenceExpression;
      }
    }

    if (expr.type.variant === "Struct") {
      const field: VariableSymbol | undefined = findMemberInStruct(
        expr.type,
        name,
      );
      const method: FunctionSymbol | undefined = findMethodInStruct(
        expr.type,
        name,
      );

      if (!field && !method) {
        throw new CompilerError(
          `Expression '${name}' is not a member of type '${serializeDatatype(expr.type)}'`,
          this.program.location(ctx),
        );
      }

      if (field && method) {
        throw new CompilerError(
          `Access to member '${name}' of type '${serializeDatatype(expr.type)}' is ambiguous`,
          this.program.location(ctx),
        );
      }

      if (field) {
        const symbol = { ...field };
        symbol.type = { ...symbol.type };
        if (symbol.type.variant === "Struct") {
          symbol.type.generics = new Map(symbol.type.generics);
        }
        const scope = new Scope(
          this.program.currentScope.location,
          this.program.currentScope,
        );
        for (const [name, tp] of expr.type.generics) {
          if (!tp) {
            throw new CompilerError(
              `Generic parameter '${name}' has no type`,
              this.program.location(ctx),
            );
          }
          if (symbol.type.variant === "Struct") {
            if (
              symbol.type.generics.has(name) &&
              symbol.type.generics.get(name) === undefined
            ) {
              symbol.type.generics.set(name, tp);
            }
          }
          scope.defineSymbol({
            variant: "Datatype",
            name: name,
            scope: scope,
            type: tp,
            export: false,
            location: this.program.location(ctx),
          });
        }
        const symtype = resolveGenerics(
          symbol.type,
          scope,
          this.program.location(ctx),
        );
        return {
          ctx: ctx,
          variant: "MemberAccess",
          expr: expr,
          memberName: name,
          type: symtype,
          location: this.program.location(ctx),
        };
      }

      if (method) {
        if (!method.ctx) {
          throw new ImpossibleSituation();
        }
        // method = { ...method };

        if (!method.parentSymbol) {
          throw new InternalError("Method has no parent symbol");
        }
        if (
          !("type" in method.parentSymbol) ||
          method.parentSymbol.type.variant !== "Struct"
        ) {
          throw new InternalError("Parent symbol is not a struct");
        }

        // method.parentSymbol = { ...method.parentSymbol };
        // method.parentSymbol.type = {
        //   variant: "Struct",
        //   generics: method.parentSymbol.type.generics,
        // };
        // Datatype.createStructDatatype(
        //   method.parentSymbol.type.name(),
        //   expr.type.generics(),
        //   method.parentSymbol.type.structSymbolTable(),
        // );

        // this.setNodeSymbol(method.ctx, { ...method });
        const symbol = { ...method };
        symbol.type = { ...symbol.type };
        symbol.scope = new Scope(symbol.scope.location, symbol.scope);
        symbol.parentSymbol = { ...method.parentSymbol };
        symbol.parentSymbol.type = { ...method.parentSymbol.type };
        symbol.parentSymbol.type.generics = new Map(
          symbol.parentSymbol.type.generics,
        );
        if (symbol.parentSymbol.type.variant !== "Struct") {
          throw new ImpossibleSituation();
        }
        for (const [name, tp] of expr.type.generics) {
          if (!tp) {
            throw new CompilerError(
              `Generic parameter '${name}' has no type`,
              this.program.location(ctx),
            );
          }
          if (symbol.parentSymbol.type.generics.get(name) === undefined) {
            symbol.parentSymbol.type.generics.set(name, tp);
          }
          symbol.scope.defineSymbol({
            variant: "Datatype",
            name: name,
            scope: symbol.scope,
            type: tp,
            export: false,
            location: this.program.location(ctx),
          });
        }
        symbol.type = resolveGenerics(
          symbol.type,
          symbol.scope,
          symbol.location,
        ) as FunctionDatatype;
        symbol.thisPointerExpr = expr;
        this.implFunc(method.ctx as FuncContext, symbol);

        return {
          ctx: ctx,
          variant: "MemberAccess",
          methodSymbol: symbol,
          memberName: name,
          expr: expr,
          type: method.type,
          location: this.program.location(ctx),
        };
      } else {
        throw new CompilerError(
          `Cannot access member of non-structural datatype '${serializeDatatype(expr.type)}'`,
          this.program.location(ctx),
        );
      }
    } else {
      if (expr.type.variant !== "Namespace") {
        throw new ImpossibleSituation();
      }
      let symbol = expr.type.symbolsScope.lookupSymbol(
        name,
        this.program.location(ctx),
      );

      if (!symbol) {
        throw new CompilerError(
          `'${name}' is not a member of type '${serializeDatatype(expr.type)}'`,
          this.program.location(ctx),
        );
      }
      return {
        ctx: ctx,
        variant: "SymbolValue",
        symbol: symbol,
        type: symbol.type,
        location: this.program.location(ctx),
      };
    }
  };
}

function analyzeFunctionSymbol(program: Module, symbol: FunctionSymbol) {
  const analyzer = new FunctionBodyAnalyzer(program);
  program.filename = symbol.location.filename;
  analyzer.implFunc(symbol.ctx as FuncContext, symbol);
  program.filename = undefined;
}

function analyzeVariableSymbol(
  program: Module,
  statement: VariableDeclarationStatement | VariableDefinitionStatement,
) {
  const analyzer = new FunctionBodyAnalyzer(program);
  program.filename = statement.location.filename;
  if (statement.ctx instanceof VariableDeclarationContext) {
    return analyzeVariableStatement(analyzer, program, statement);
  } else if (statement.ctx instanceof VariableDefinitionContext) {
    return analyzeVariableStatement(analyzer, program, statement);
  }
  program.filename = undefined;
}

export function performSemanticAnalysis(program: Module) {
  const clonedGlobals = program.concreteGlobalStatements.values().toArray();
  for (const statement of clonedGlobals) {
    analyzeVariableSymbol(program, statement);
  }

  const clonedFuncs = program.concreteFunctions.values().toArray();
  for (const symbol of clonedFuncs) {
    analyzeFunctionSymbol(program, symbol);
  }

  const mainFunction = program.globalScope.tryLookupSymbol(
    "main",
    program.globalScope.location,
  );
  if (
    program.moduleConfig.moduleType === ModuleType.Executable &&
    !mainFunction
  ) {
    throw new GeneralError(
      `Function 'main()' was not defined. This executable needs it as an entry point.`,
    );
  }
  if (program.moduleConfig.moduleType === ModuleType.Library && mainFunction) {
    throw new GeneralError(
      `Function 'main()' was defined, but this module is a library and it cannot define a main function`,
    );
  }

  if (mainFunction) {
    if (mainFunction.type.variant !== "Function") {
      throw new ImpossibleSituation();
    }
    if (
      mainFunction.type.functionReturnType.variant !== "Primitive" ||
      mainFunction.type.functionReturnType.primitive !== Primitive.i32
    ) {
      throw new CompilerError(
        `Main function must return 'i32'`,
        mainFunction.location,
      );
    }
  }
}
