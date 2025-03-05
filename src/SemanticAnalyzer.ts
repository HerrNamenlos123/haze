import HazeVisitor from "./parser/HazeVisitor";

import {
  findMemberInStruct,
  findMethodInStruct,
  getIntegerBinaryResult,
  getStructMembers,
  implicitConversion,
  isBoolean,
  isInteger,
  isNone,
  Primitive,
  serializeDatatype,
  type Datatype,
  type FunctionDatatype,
  type PrimitiveDatatype,
  type StructDatatype,
} from "./Datatype";
import { CompilerError, ImpossibleSituation, InternalError } from "./Errors";
import { Scope } from "./Scope";
import { Program } from "./Program";
import {
  FunctionType,
  mangleDatatype,
  mangleSymbol,
  serializeSymbol,
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
  IfexprContext,
  IfStatementContext,
  InlineCStatementContext,
  LiteralConstantContext,
  PostIncrExprContext,
  PreIncrExprContext,
  SymbolValueExprContext,
  UnaryExprContext,
  WhileStatementContext,
  type ArgsContext,
  type BooleanConstantContext,
  type CommonDatatypeContext,
  type ConstantExprContext,
  type ExprMemberAccessContext,
  type ExprStatementContext,
  type FuncbodyContext,
  type FuncContext,
  type NamedfuncContext,
  type ParenthesisExprContext,
  type ReturnStatementContext,
  type StringConstantContext,
  type StructInstantiationExprContext,
  type StructMemberValueContext,
  type StructMethodContext,
  type VariableDefinitionContext,
} from "./parser/HazeParser";
import {
  datatypeSymbolUsed,
  defineGenericsInScope,
  getNestedReturnTypes,
  resolveGenerics,
  visitCommonDatatypeImpl,
} from "./utils";
import type { ParserRuleContext } from "antlr4";
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
  UnaryExpression,
} from "./Expression";
import type {
  ConditionalStatement,
  ExprStatement,
  InlineCStatement,
  ReturnStatement,
  Statement,
  VariableDefinitionStatement,
  WhileStatement,
} from "./Statement";

const RESERVED_VARIABLE_NAMES = ["this", "context", "__returnval__"];
const INTERNAL_METHOD_NAMES = ["constructor", "destructor", "sizeof"];
const RESERVED_NAMESPACES = ["global"];

class FunctionBodyAnalyzer extends HazeVisitor<any> {
  private program: Program;
  private functionStack: FunctionSymbol[];

  constructor(program: Program) {
    super();
    this.program = program;
    this.functionStack = [];
  }

  visitCommonDatatype = (ctx: CommonDatatypeContext): Datatype => {
    return visitCommonDatatypeImpl(this, this.program, ctx);
  };

  visitSymbolValueExpr = (ctx: SymbolValueExprContext): Expression => {
    const name = ctx.ID().getText();
    if (name === "sizeof") {
      if (ctx.datatype_list().length !== 1) {
        throw new CompilerError(
          `sizeof<> Operator expected 1 generic argument but got ${ctx.datatype_list().length}.`,
          this.program.getLoc(ctx),
        );
      }
      const datatype: Datatype = this.visit(ctx.datatype_list()[0]);
      return {
        variant: "Sizeof",
        ctx: ctx,
        type: this.program.getBuiltinType("u64"),
        datatype: datatype,
      };
    }

    let symbol = this.program.currentScope.lookupSymbol(
      name,
      this.program.getLoc(ctx),
    );

    symbol = { ...symbol };
    symbol.type = { ...symbol.type };
    if (symbol.variant === "Datatype") {
      if (symbol.type.variant === "Struct") {
        symbol.type.generics = new Map(symbol.type.generics);
        symbol.type.methods = symbol.type.methods.map((m) => ({ ...m }));
        if (symbol.type.generics.size !== ctx.datatype_list().length) {
          throw new CompilerError(
            `Datatype expected ${symbol.type.generics.size} generic arguments but got ${ctx.datatype_list().length}.`,
            this.program.getLoc(ctx),
          );
        }
        let index = 0;
        for (const [name, tp] of symbol.type.generics) {
          symbol.type.generics.set(
            name,
            this.visit(ctx.datatype_list()[index]),
          );
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
            },
            this.program,
          );
          const constructorSymbol = symbol.type.methods.find(
            (m) => m.name === "constructor",
          );
          const destructorSymbol = symbol.type.methods.find(
            (m) => m.name === "destructor",
          );
          if (!constructorSymbol) {
            throw new CompilerError(
              `Type '${serializeDatatype(symbol.type)}' must provide a constructor`,
              this.program.getLoc(ctx),
            );
          }
          if (!destructorSymbol) {
            throw new CompilerError(
              `Type '${serializeDatatype(symbol.type)}' must provide a destructor`,
              this.program.getLoc(ctx),
            );
          }
          if (
            !this.program.concreteFunctions[mangleSymbol(constructorSymbol)]
          ) {
            constructorSymbol.scope = new Scope(
              constructorSymbol.scope.location,
              constructorSymbol.scope,
            );
            for (const [name, tp] of symbol.type.generics) {
              if (!tp) {
                throw new CompilerError(
                  `Generic parameter '${name}' has no type`,
                  this.program.getLoc(ctx),
                );
              }
              if (symbol.type.generics.get(name) === undefined) {
                symbol.type.generics.set(name, tp);
              }
              constructorSymbol.scope.defineSymbol(
                {
                  variant: "Datatype",
                  name: name,
                  scope: constructorSymbol.scope,
                  type: tp,
                },
                this.program.getLoc(ctx),
              );
            }
            constructorSymbol.type = resolveGenerics(
              constructorSymbol.type,
              constructorSymbol.scope,
              this.program.getLoc(constructorSymbol.ctx),
            ) as FunctionDatatype;
            constructorSymbol.type.functionReturnType = symbol.type;
            constructorSymbol.parentSymbol = symbol;
            this.program.ctxToSymbolMap.set(
              constructorSymbol.ctx,
              constructorSymbol,
            );
            this.implFunc(constructorSymbol.ctx as FuncContext);
          }
          if (!this.program.concreteFunctions[mangleSymbol(destructorSymbol)]) {
            destructorSymbol.scope = new Scope(
              destructorSymbol.scope.location,
              destructorSymbol.scope,
            );
            for (const [name, tp] of symbol.type.generics) {
              if (!tp) {
                throw new CompilerError(
                  `Generic parameter '${name}' has no type`,
                  this.program.getLoc(ctx),
                );
              }
              if (symbol.type.generics.get(name) === undefined) {
                symbol.type.generics.set(name, tp);
              }
              destructorSymbol.scope.defineSymbol(
                {
                  variant: "Datatype",
                  name: name,
                  scope: destructorSymbol.scope,
                  type: tp,
                },
                this.program.getLoc(ctx),
              );
            }
            destructorSymbol.type = resolveGenerics(
              destructorSymbol.type,
              destructorSymbol.scope,
              this.program.getLoc(destructorSymbol.ctx),
            ) as FunctionDatatype;
            destructorSymbol.parentSymbol = symbol;
            this.program.ctxToSymbolMap.set(
              destructorSymbol.ctx,
              destructorSymbol,
            );
            this.implFunc(destructorSymbol.ctx as FuncContext);
          }
        }
      }
    }

    return {
      type: symbol.type,
      variant: "SymbolValue",
      symbol: symbol,
      ctx: ctx,
    };
  };

  visitPreIncrExpr = (ctx: PreIncrExprContext): PreIncrExpr => {
    const expr: Expression = this.visit(ctx.expr());
    const operator = ctx._op.text;
    if (operator !== "++" && operator !== "--") {
      throw new CompilerError(
        `Unknown operator ${operator}`,
        this.program.getLoc(ctx),
      );
    }
    if (!isInteger(expr.type)) {
      throw new CompilerError(
        `Unary operator '${operator}' is not known for type '${serializeDatatype(expr.type)}'`,
        this.program.getLoc(ctx),
      );
    }
    return {
      variant: "PreIncr",
      ctx: ctx,
      expr: expr,
      operation: operator,
      type: expr.type,
    };
  };

  visitPostIncrExpr = (ctx: PostIncrExprContext): PostIncrExpr => {
    const expr: Expression = this.visit(ctx.expr());
    const operator = ctx._op.text;
    if (operator !== "++" && operator !== "--") {
      throw new CompilerError(
        `Unknown operator ${operator}`,
        this.program.getLoc(ctx),
      );
    }
    if (!isInteger(expr.type)) {
      throw new CompilerError(
        `Unary operator '${operator}' is not known for type '${serializeDatatype(expr.type)}'`,
        this.program.getLoc(ctx),
      );
    }
    return {
      variant: "PostIncr",
      ctx: ctx,
      expr: expr,
      operation: operator,
      type: expr.type,
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
          this.program.getLoc(ctx),
        );
      }
      expr = {
        variant: "SymbolValue",
        ctx: ctx,
        symbol: constructor,
        type: constructor.type,
      };
    }

    if (expr.variant === "MemberAccess" && expr.methodSymbol) {
      expr = {
        variant: "SymbolValue",
        ctx: ctx,
        symbol: expr.methodSymbol,
        type: expr.methodSymbol.type,
      };
    }

    if (
      expr.variant !== "SymbolValue" ||
      expr.type.variant !== "Function" ||
      expr.symbol.variant !== "Function"
    ) {
      throw new CompilerError(
        `Expression of type '${serializeDatatype(expr.type)}' is not callable`,
        this.program.getLoc(ctx),
      );
    }

    if (
      expr.symbol.specialMethod === "constructor" ||
      expr.symbol.specialMethod === "destructor"
    ) {
      const symbol = { ...expr.symbol };
      symbol.scope = new Scope(symbol.scope.location, symbol.scope);
      symbol.parentSymbol = { ...expr.symbol.parentSymbol! };
      symbol.parentSymbol.type = { ...expr.symbol.parentSymbol!.type };
      if (symbol.parentSymbol.type.variant !== "Struct") {
        throw new ImpossibleSituation();
      }
      for (const [name, tp] of symbol.parentSymbol.type.generics) {
        if (!tp) {
          throw new CompilerError(
            `Generic parameter '${name}' has no type`,
            this.program.getLoc(ctx),
          );
        }
        if (symbol.parentSymbol.type.generics.get(name) === undefined) {
          symbol.parentSymbol.type.generics.set(name, tp);
        }
        symbol.scope.defineSymbol(
          {
            variant: "Datatype",
            name: name,
            scope: symbol.scope,
            type: tp,
          },
          this.program.getLoc(ctx),
        );
      }
      symbol.type = resolveGenerics(
        symbol.type,
        symbol.scope,
        this.program.getLoc(symbol.ctx),
      ) as FunctionDatatype;
      this.program.ctxToSymbolMap.set(symbol.ctx, symbol);
      this.implFunc(symbol.ctx as FuncContext);
    }

    const args: Expression[] = [];
    const params = expr.type.functionParameters;
    const visitedArgs = this.visit(ctx.args());
    if (visitedArgs.length !== params.length) {
      if (!expr.type.vararg) {
        throw new CompilerError(
          `Expected ${params.length} arguments but got ${visitedArgs.length}`,
          this.program.getLoc(ctx),
        );
      } else if (visitedArgs.length < params.length) {
        throw new CompilerError(
          `Expected at least ${params.length} arguments but got ${visitedArgs.length}`,
          this.program.getLoc(ctx),
        );
      }
    }
    for (let i = 0; i < visitedArgs.length; i++) {
      const arg = visitedArgs[i];
      args.push(arg);
    }

    return {
      type: expr.type.functionReturnType,
      variant: "ExprCall",
      thisPointerExpr: expr.symbol.thisPointerExpr,
      args: args,
      expr: expr,
      ctx: ctx,
    };
  };

  implFunc(ctx: FuncContext | NamedfuncContext | FuncdeclContext): void {
    let symbol = this.program.ctxToSymbolMap.get(ctx);
    if (symbol?.variant !== "Function") {
      throw new ImpossibleSituation();
    }

    if (symbol.functionType === FunctionType.Internal) {
      if (!symbol.scope) {
        throw new InternalError("Function missing scope");
      }

      const loc = this.program.getLoc(ctx);

      if (!symbol || !symbol.scope) {
        throw new ImpossibleSituation();
      }

      this.program.pushScope(symbol.scope);
      this.functionStack.push(symbol);

      if (symbol.parentSymbol) {
        symbol.scope.defineSymbol(
          {
            variant: "Variable",
            name: "this",
            type: {
              variant: "RawPointer",
              generics: new Map().set("__Pointee", symbol.parentSymbol.type),
            },
            variableType: VariableType.Parameter,
          },
          loc,
        );
      }

      for (const [name, tp] of symbol.type.functionParameters) {
        symbol.scope.defineSymbol(
          {
            variant: "Variable",
            name: name,
            type: tp,
            variableType: VariableType.Parameter,
          },
          loc,
        );
      }

      if (!(ctx instanceof FuncdeclContext)) {
        this.visit(ctx.funcbody()).forEach((statement: Statement) => {
          symbol.scope.statements.push(statement);
        });
      }

      const returnedTypes = getNestedReturnTypes(symbol.scope);
      if (
        !ctx.datatype() &&
        symbol.specialMethod !== "constructor" &&
        symbol.specialMethod !== "destructor"
      ) {
        let returntype: Datatype = symbol.type.functionReturnType;
        if (returnedTypes.length > 1) {
          throw new CompilerError(
            `Cannot deduce return type. Multiple return types: ${returnedTypes
              .map((tp) => serializeDatatype(tp))
              .join(", ")}`,
            this.program.getLoc(ctx),
          );
        } else if (returnedTypes.length === 1) {
          returntype = returnedTypes[0];
        } else {
          returntype = this.program.currentScope.lookupSymbol("none", loc).type;
        }

        symbol.type.functionReturnType = returntype;
      }

      if (!isNone(symbol.type.functionReturnType)) {
        if (!symbol.scope.statements.some((s) => s.variant === "Return")) {
          throw new CompilerError(
            `Function ${symbol.name} is missing return statement`,
            this.program.getLoc(ctx),
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
            this.program.getLoc(ctx),
          );
        }
      }

      this.functionStack.pop();
      this.program.popScope();
      this.program.ctxToSymbolMap.set(ctx, symbol);
      this.program.concreteFunctions[mangleSymbol(symbol)] = symbol;
    } else {
      this.visitChildren(ctx);
    }
  }

  visitFunc = (ctx: FuncContext): void => {
    this.implFunc(ctx);
  };

  visitNamedfunc = (ctx: NamedfuncContext): void => {
    this.implFunc(ctx);
  };

  visitFuncbody = (ctx: FuncbodyContext): Statement[] => {
    if (ctx.expr()) {
      const expr: Expression = this.visit(ctx.expr());
      implicitConversion(
        expr.type,
        this.functionStack[this.functionStack.length - 1].type
          .functionReturnType,
        "",
        this.program.currentScope,
        this.program.getLoc(ctx),
        this.program,
      );
      return [{ variant: "Return", ctx: ctx, expr: expr } as ReturnStatement];
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
    };
  };

  visitVariableDefinition = (
    ctx: VariableDefinitionContext,
  ): VariableDefinitionStatement => {
    const name = ctx.ID().getText();
    if (RESERVED_VARIABLE_NAMES.includes(name)) {
      throw new CompilerError(
        `'${name}' is not a valid variable name.`,
        this.program.getLoc(ctx),
      );
    }
    const mutable = ctx.variablemutability().getText() === "let";

    const expr: Expression = this.visit(ctx.expr());
    let datatype = expr.type;
    if (ctx.datatype()) {
      datatype = this.visit(ctx.datatype());
    }

    if (
      datatype.variant === "Primitive" &&
      datatype.primitive === Primitive.none
    ) {
      throw new CompilerError(
        `'none' is not a valid variable type.`,
        this.program.getLoc(ctx),
      );
    }

    const symbol: VariableSymbol = {
      variableType: mutable
        ? VariableType.MutableVariable
        : VariableType.ConstantVariable,
      name: name,
      type: datatype,
      variant: "Variable",
    };
    this.program.currentScope.defineSymbol(symbol, this.program.getLoc(ctx));
    return {
      variant: "VariableDefinition",
      ctx: ctx,
      symbol: symbol,
      expr: expr,
    };
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
          };
        }
        break;

      case "<":
      case ">":
      case "<=":
      case ">=":
        if (isInteger(left.type) && isInteger(right.type)) {
          return {
            variant: "Binary",
            ctx: ctx,
            leftExpr: left,
            operation: operation,
            rightExpr: right,
            type: this.program.getBuiltinType("boolean"),
          };
        }
        break;

      case "==":
      case "!=":
        if (
          (isBoolean(left.type) && isBoolean(right.type)) ||
          (isInteger(left.type) && isInteger(right.type))
        ) {
          return {
            variant: "Binary",
            ctx: ctx,
            leftExpr: left,
            operation: operation,
            rightExpr: right,
            type: this.program.getBuiltinType("boolean"),
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
          };
        }
        break;
    }

    throw new CompilerError(
      `No comparison operator '${operation}' is known for types '${serializeDatatype(left.type)}' and '${serializeDatatype(right.type)}'`,
      this.program.getLoc(ctx),
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
          type: this.program.getBuiltinType("boolean"),
        };

      case "+":
      case "-":
        if (!isInteger(expr.type)) {
          throw new CompilerError(
            `Unary operator '${operation}' is not known for type '${serializeDatatype(expr.type)}'`,
            this.program.getLoc(ctx),
          );
        }
        return {
          variant: "Unary",
          ctx: ctx,
          expr: expr,
          operation: operation,
          type: expr.type,
        };

      default:
        throw new CompilerError(
          `No unary operator '${operation}' is known for type '${serializeDatatype(expr.type)}'`,
          this.program.getLoc(ctx),
        );
    }
  };

  visitStructMethod = (ctx: StructMethodContext): void => {
    this.implFunc(ctx);
  };

  visitStringConstant = (ctx: StringConstantContext): StringConstantSymbol => {
    return {
      variant: "StringConstant",
      type: this.program.globalScope.lookupSymbol(
        "stringview",
        this.program.getLoc(ctx),
      ).type,
      value: ctx.getText(),
    };
  };

  visitLiteralConstant = (ctx: LiteralConstantContext): ConstantSymbol => {
    const match = ctx.getText().match(/^(\d+(?:\.\d+)?)(s|ms|us|ns|m|h|d)?$/);
    if (!match) {
      throw new InternalError(
        "Could not parse literal",
        this.program.getLoc(ctx),
      );
    }
    const [, valueStr, unitStr] = match;
    const isFloat = valueStr.indexOf(".") !== -1;
    let value = isFloat ? parseFloat(valueStr) : parseInt(valueStr);

    if (Number.isNaN(value)) {
      throw new CompilerError(
        `Could not parse '${ctx.getText()}'.`,
        this.program.getLoc(ctx),
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
          type = this.program.globalScope.lookupSymbol(
            "Duration",
            this.program.getLoc(ctx),
          ).type;
          unit = unitStr;
          break;

        default:
          throw new CompilerError(
            `'${unitStr}' is not a valid unit`,
            this.program.getLoc(ctx),
          );
      }
    }

    return {
      variant: "LiteralConstant",
      type: type,
      value: value,
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
      type: this.program.globalScope.lookupSymbol(
        "boolean",
        this.program.getLoc(ctx),
      ).type,
      value,
    };
  };

  visitConstantExpr = (ctx: ConstantExprContext): ConstantExpression => {
    const symbol: ConstantSymbol = this.visit(ctx.constant());
    return {
      variant: "Constant",
      constantSymbol: symbol,
      ctx: ctx,
      type: symbol.type,
    };
  };

  // visitThenblock(ctx: ThenblockContext): void {
  //   this.visitChildren(ctx);
  // }

  // visitElseifblock(ctx: ElseifblockContext): void {
  //   this.visitChildren(ctx);
  // }

  // visitElseblock(ctx: ElseblockContext): void {
  //   this.visitChildren(ctx);
  // }

  // visitFuncRefExpr = (ctx: FuncRefExprContext): void => {
  //   this.visitChildren(ctx);
  //   // this.setNodeSymbol(ctx, this.getNodeSymbol(ctx.func()));
  //   // this.setNodeDatatype(ctx, this.getNodeSymbol(ctx.func()).type);
  // };

  visitInlineCStatement = (ctx: InlineCStatementContext): InlineCStatement => {
    const string = JSON.parse(ctx.STRING_LITERAL().getText());
    return {
      variant: "InlineC",
      ctx,
      code: string,
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
        this.program.getLoc(ctx),
        this.program,
      );
      return {
        variant: "Return",
        expr,
        ctx,
      };
    } else {
      implicitConversion(
        this.program.currentScope.lookupSymbol("none", this.program.getLoc(ctx))
          .type,
        this.functionStack[this.functionStack.length - 1].type
          .functionReturnType,
        "",
        this.program.currentScope,
        this.program.getLoc(ctx),
        this.program,
      );
      return {
        variant: "Return",
        ctx,
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
    const statement: ConditionalStatement = {
      variant: "Conditional",
      if: [ifExpr, new Scope(this.program.getLoc(ctx), parentScope)],
      elseIf: elseIfExprs.map((e) => [
        e,
        new Scope(this.program.getLoc(ctx), parentScope),
      ]),
      else: ctx.elseblock() && new Scope(this.program.getLoc(ctx), parentScope),
      ctx,
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

    const whileStatement: WhileStatement = {
      variant: "While",
      expr: expr,
      scope: new Scope(this.program.getLoc(ctx), this.program.currentScope),
      ctx,
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
        this.program.getLoc(ctx),
      );
    }
    if (
      leftExpr.type.variant === "Primitive" &&
      leftExpr.type.primitive === Primitive.none
    ) {
      throw new CompilerError(
        "Cannot assign to an expression of type 'none'.",
        this.program.getLoc(ctx),
      );
    }

    return {
      variant: "ExprAssign",
      type: leftExpr.type,
      ctx: ctx,
      leftExpr: leftExpr,
      rightExpr: rightExpr,
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
      variant: "Variable",
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
        this.program.getLoc(ctx),
      );
    }

    const scope = new Scope(
      this.program.getLoc(ctx),
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
          this.program.getLoc(ctx),
        );
      }

      const symType = resolveGenerics(
        existingSymbol.type,
        scope,
        this.program.getLoc(ctx),
      );

      implicitConversion(
        symbol.type,
        symType,
        "",
        scope,
        this.program.getLoc(ctx),
        this.program,
      );

      assignedMembers.push(symbol.name);
    }

    for (const member of structtype.members) {
      if (member.variant === "Variable") {
        if (!assignedMembers.includes(member.name)) {
          throw new CompilerError(
            `'${member.name}' is not assigned in struct instantiation`,
            this.program.getLoc(ctx),
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
                this.program.getLoc(ctx),
              );
            }
            setMember = inner;
          }
        }
        if (!setMember) {
          throw new CompilerError(
            `No member of union is not assigned in struct instantiation`,
            this.program.getLoc(ctx),
          );
        }
      }
    }

    return {
      variant: "Object",
      ctx: ctx,
      members: members,
      type: structtype,
    };
  };

  visitExprMemberAccess = (ctx: ExprMemberAccessContext): Expression => {
    let expr: Expression = this.visit(ctx.expr());
    const name: string = ctx.ID().getText();

    if (INTERNAL_METHOD_NAMES.includes(name)) {
      throw new CompilerError(
        `Cannot access internal method '${name}'`,
        this.program.getLoc(ctx),
      );
    }

    console.log(
      name,
      "from",
      serializeDatatype(expr.type),
      (expr.type.variant === "Struct" &&
        expr.type.methods.map((m) => m.name)) ||
        (expr.type.variant === "RawPointer" &&
          (expr.type.generics.get("__Pointee") as StructDatatype).methods.map(
            (m) => m.name,
          )) ||
        "",
    );

    while (expr.type.variant !== "Struct") {
      if (expr.type.variant !== "RawPointer") {
        throw new CompilerError(
          `Cannot access member '${name}' of non-structural datatype '${serializeDatatype(expr.type)}'`,
          this.program.getLoc(ctx),
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
        };
        return e;
      }

      expr = {
        variant: "RawPtrDeref",
        expr: expr,
        ctx: ctx,
        type: p.variant === "RawPointer" ? p.generics.get("__Pointee")! : p,
      } as RawPointerDereferenceExpression;
    }

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
        this.program.getLoc(ctx),
      );
    }

    if (field && method) {
      throw new CompilerError(
        `Access to member '${name}' of type '${serializeDatatype(expr.type)}' is ambiguous`,
        this.program.getLoc(ctx),
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
            this.program.getLoc(ctx),
          );
        }
        if (symbol.type.variant === "Struct") {
          if (symbol.type.generics.get(name) === undefined) {
            // symbol.type.generics.set(name, tp);
          }
        }
        scope.defineSymbol(
          {
            variant: "Datatype",
            name: name,
            scope: scope,
            type: tp,
          },
          this.program.getLoc(ctx),
        );
      }
      // symbol.type = resolveGenerics(
      //   symbol.type,
      //   scope,
      //   this.program.getLoc(ctx),
      // );
      return {
        ctx: ctx,
        variant: "MemberAccess",
        expr: expr,
        memberName: name,
        type: symbol.type,
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
      if (method.parentSymbol.type.variant !== "Struct") {
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
      const symbol = {
        ...(this.program.ctxToSymbolMap.get(method.ctx) as FunctionSymbol),
      };
      symbol.scope = new Scope(symbol.scope.location, symbol.scope);
      symbol.parentSymbol = { ...method.parentSymbol };
      symbol.parentSymbol.type = { ...method.parentSymbol.type };
      if (symbol.parentSymbol.type.variant !== "Struct") {
        throw new ImpossibleSituation();
      }
      for (const [name, tp] of expr.type.generics) {
        if (!tp) {
          throw new CompilerError(
            `Generic parameter '${name}' has no type`,
            this.program.getLoc(ctx),
          );
        }
        if (symbol.parentSymbol.type.generics.get(name) === undefined) {
          symbol.parentSymbol.type.generics.set(name, tp);
        }
        symbol.scope.defineSymbol(
          {
            variant: "Datatype",
            name: name,
            scope: symbol.scope,
            type: tp,
          },
          this.program.getLoc(ctx),
        );
      }
      symbol.type = resolveGenerics(
        symbol.type,
        symbol.scope,
        this.program.getLoc(symbol.ctx),
      ) as FunctionDatatype;
      symbol.thisPointerExpr = expr;
      this.program.ctxToSymbolMap.set(method.ctx, symbol);
      this.implFunc(method.ctx as FuncContext);

      return {
        ctx: ctx,
        variant: "MemberAccess",
        methodSymbol: symbol,
        memberName: name,
        expr: expr,
        type: method.type,
      };
    } else {
      throw new CompilerError(
        `Cannot access member of non-structural datatype '${serializeDatatype(expr.type)}'`,
        this.program.getLoc(ctx),
      );
    }
  };
}

function analyzeFunctionSymbol(program: Program, symbol: FunctionSymbol) {
  const analyzer = new FunctionBodyAnalyzer(program);
  analyzer.visit(symbol.ctx);
}

export function performSemanticAnalysis(program: Program) {
  for (const symbol of Object.values(program.concreteFunctions)) {
    analyzeFunctionSymbol(program, symbol);
  }
}
