import HazeVisitor from "./parser/HazeVisitor";

import {
  implicitConversion,
  Primitive,
  serializeDatatype,
  type Datatype,
  type FunctionDatatype,
  type GenericPlaceholderDatatype,
  type StructDatatype,
} from "./Datatype";
import { CompilerError, ImpossibleSituation, InternalError } from "./Errors";
import { Scope } from "./Scope";
import { Program } from "./Program";
import {
  FunctionType,
  mangleSymbol,
  VariableType,
  type ConstantSymbol,
  type DatatypeSymbol,
  type FunctionSymbol,
  type Symbol,
  type VariableSymbol,
} from "./Symbol";
import {
  FuncdeclContext,
  FunctionDatatypeContext,
  type ArgsContext,
  type BinaryExprContext,
  type BooleanConstantContext,
  type CommonDatatypeContext,
  type ConstantExprContext,
  type ExprAssignmentStatementContext,
  type ExprMemberAccessContext,
  type ExprStatementContext,
  type FuncbodyContext,
  type FuncContext,
  type IntegerConstantContext,
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
  resolveGenerics,
  visitCommonDatatypeImpl,
} from "./utils";
import type { ParserRuleContext } from "antlr4";
import type {
  ConstantExpression,
  ExprCallExpression,
  Expression,
  MemberAccessExpression,
  MethodAccessExpression,
  ObjectExpression,
} from "./Expression";
import type {
  ExprStatement,
  ReturnStatement,
  Statement,
  VariableDefinitionStatement,
} from "./Statement";

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
    return visitCommonDatatypeImpl(this, this.program, ctx);
  };

  visitSymbolValueExpr = (ctx: any): Expression => {
    let symbol = this.program.currentScope.lookupSymbol(
      ctx.ID().getText(),
      this.program.getLoc(ctx),
    );
    // symbol = copy(symbol);

    if (symbol.variant === "Datatype") {
      if (symbol.type.variant === "Struct") {
        if (symbol.type.generics.size !== ctx.datatype().length) {
          throw new CompilerError(
            `Datatype expected ${symbol.type.generics.size} generic arguments but got ${ctx.datatype().length}.`,
            this.program.getLoc(ctx),
          );
        }
        // for (let i = 0; i < symbol.type.generics.size; i++) {
        //   symbol.type.generics()[i] = [
        //     symbol.type.generics()[i][0],
        //     this.visit(ctx.datatype()[i]),
        //   ];
        // }
      }
    }

    return {
      type: symbol.type,
      variant: "SymbolValue",
      symbol: symbol,
      ctx: ctx,
    };
  };

  visitExprCallExpr = (ctx: any): Expression => {
    let expr: Expression = this.visit(ctx.expr());

    // let thisPointerExpr: Expression | null = null;
    // thisPointerExpr = copy(expr.expr);
    // expr = new SymbolValueExpression(expr.method, ctx);

    if (expr.type.variant !== "Function") {
      throw new CompilerError(
        `Expression of type '${serializeDatatype(expr.type)}' is not callable`,
        this.program.getLoc(ctx),
      );
    }

    const args: Expression[] = [];
    const params = expr.type.functionParameters;
    const visitedArgs = this.visit(ctx.args());
    if (visitedArgs.length !== params.length) {
      throw new CompilerError(
        `Expected ${params.length} arguments but got ${visitedArgs.length}`,
        this.program.getLoc(ctx),
      );
    }
    for (let i = 0; i < params.length; i++) {
      const arg = visitedArgs[i];
      args.push(arg);
    }

    return {
      type: expr.type.functionReturnType,
      variant: "ExprCall",
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

      let p = symbol.parentSymbol;
      let haveAllGenerics = true;
      while (p) {
        if (p.type.variant !== "Struct") {
          throw new InternalError("Function's parent symbols are not structs");
        }
        for (const [name, tp] of p.type.generics) {
          if (!tp) {
            haveAllGenerics = false;
            break;
          }
          symbol.scope.defineSymbol(
            {
              variant: "Datatype",
              name: name,
              type: tp,
              scope: symbol.scope,
            },
            this.program.getLoc(ctx),
          );
          // addedSymbols.push(name);
        }
        if (p.variant !== "Constant") {
          p = p.parentSymbol;
        }
      }

      if (!haveAllGenerics) {
        return;
      }

      const loc = this.program.getLoc(ctx);
      // const scope = symbol.scope;
      // const newType = resolveGenerics(
      //   symbol.type,
      //   scope,
      //   loc,
      // ) as FunctionDatatype;
      // if (symbol.thisPointer !== undefined) {
      //   symbol.thisPointer = resolveGenerics(symbol.thisPointer, scope, loc);
      // }
      // symbol.type = newType;

      // if (
      //   symbol.type.areAllGenericsResolved() &&
      //   this.program.resolvedFunctions[symbol.getMangledName()]
      // ) {
      //   addedSymbols.forEach((sym) => {
      //     symbol.scope?.purgeSymbol(sym);
      //   });
      //   return;
      // }

      if (!symbol || !symbol.scope) {
        throw new ImpossibleSituation();
      }

      this.program.pushScope(symbol.scope);
      this.functionStack.push(symbol);

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

      const returnedTypes: Record<string, Datatype> = {};
      if (!(ctx instanceof FuncdeclContext)) {
        this.visit(ctx.funcbody()).forEach((statement: Statement) => {
          symbol.scope.statements.push(statement);
          if (statement.variant === "Return" && statement.expr) {
            returnedTypes[serializeDatatype(statement.expr.type)] =
              statement.expr.type;
          }
        });
      }

      // addedSymbols.forEach((sym) => {
      //   symbol.scope?.purgeSymbol(sym);
      // });

      if (!ctx.datatype()) {
        let returntype: Datatype = symbol.type.functionReturnType;
        if (Object.keys(returnedTypes).length > 1) {
          throw new CompilerError(
            `Cannot deduce return type. Multiple return types: ${Object.keys(
              returnedTypes,
            ).join(", ")}`,
            this.program.getLoc(ctx),
          );
        } else if (Object.keys(returnedTypes).length === 1) {
          returntype = Object.values(returnedTypes)[0];
        } else {
          returntype = this.program.currentScope.lookupSymbol("none", loc).type;
        }

        symbol.type.functionReturnType = returntype;
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
      return ctx
        .body()
        .statement_list()
        .map((s) => this.visit(s));
    }
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

  // visitBinaryExpr = (ctx: BinaryExprContext): void => {
  //   this.visitChildren(ctx);
  //   let operation = ctx.children[1].getText();
  //   if (ctx.children[2].getText() === "not") {
  //     operation += " not";
  //   }

  //   this.setNodeBinaryOperator(ctx, operation);
  //   const typeA = this.getNodeDatatype(ctx.expr(0));
  //   const typeB = this.getNodeDatatype(ctx.expr(1));

  //   const datatypesUnrelated = () => {
  //     throw new CompilerError(
  //       `Datatypes '${typeA.getDisplayName()}' and '${typeB.getDisplayName()}' are unrelated and cannot be used for binary operation`,
  //       this.getLocation(ctx),
  //     );
  //   };

  //   switch (operation) {
  //     case "*":
  //     case "/":
  //     case "%":
  //     case "+":
  //     case "-":
  //       if (typeA.isInteger() && typeB.isInteger()) {
  //         this.setNodeDatatype(ctx, typeA);
  //       } else {
  //         datatypesUnrelated();
  //       }
  //       break;

  //     case "<":
  //     case ">":
  //     case "<=":
  //     case ">=":
  //       if (typeA.isInteger() && typeB.isInteger()) {
  //         this.setNodeDatatype(ctx, this.db.getBuiltinDatatype("boolean"));
  //       } else {
  //         datatypesUnrelated();
  //       }
  //       break;

  //     case "==":
  //     case "!=":
  //     case "is":
  //     case "is not":
  //       if (typeA.isInteger() && typeB.isInteger()) {
  //         this.setNodeDatatype(ctx, this.db.getBuiltinDatatype("boolean"));
  //       } else if (typeA.isBoolean() && typeB.isBoolean()) {
  //         this.setNodeDatatype(ctx, this.db.getBuiltinDatatype("boolean"));
  //       } else {
  //         datatypesUnrelated();
  //       }
  //       break;

  //     case "and":
  //     case "or":
  //       if (typeA.isBoolean() && typeB.isBoolean()) {
  //         this.setNodeDatatype(ctx, this.db.getBuiltinDatatype("boolean"));
  //       } else {
  //         datatypesUnrelated();
  //       }
  //       break;

  //     default:
  //       throw new CompilerError(
  //         `Operation '${operation}' is not implemented for types '${typeA.getDisplayName()}' and '${typeB.getDisplayName()}'`,
  //         this.getLocation(ctx),
  //       );
  //   }
  // };

  // visitIfexpr(ctx: IfexprContext): void {
  //   this.visitChildren(ctx);
  //   // this.setNodeDatatype(ctx, this.getNodeDatatype(ctx.expr()));
  // }

  // visitElseifexpr(ctx: ElseifexprContext): void {
  //   this.visitChildren(ctx);
  //   // this.setNodeDatatype(ctx, this.getNodeDatatype(ctx.expr()));
  // }

  visitStructMethod = (ctx: StructMethodContext): void => {
    this.implFunc(ctx);
  };

  visitIntegerConstant = (ctx: IntegerConstantContext): ConstantSymbol => {
    const value = parseInt(ctx.getText(), 10);
    if (Number.isNaN(value)) {
      throw new CompilerError(
        `Could not parse '${ctx.getText()}' as an integer.`,
        this.program.getLoc(ctx),
      );
    }

    if (value < -(2 ** 31) || value > 2 ** 31 - 1) {
      return {
        variant: "Constant",
        type: this.program.globalScope.lookupSymbol(
          "i64",
          this.program.getLoc(ctx),
        ).type,
        value,
      };
    } else if (value < -(2 ** 15) || value > 2 ** 15 - 1) {
      return {
        variant: "Constant",
        type: this.program.globalScope.lookupSymbol(
          "i32",
          this.program.getLoc(ctx),
        ).type,
        value,
      };
    } else if (value < -(2 ** 7) || value > 2 ** 7 - 1) {
      return {
        variant: "Constant",
        type: this.program.globalScope.lookupSymbol(
          "i16",
          this.program.getLoc(ctx),
        ).type,
        value,
      };
    } else {
      return {
        variant: "Constant",
        type: this.program.globalScope.lookupSymbol(
          "i8",
          this.program.getLoc(ctx),
        ).type,
        value,
      };
    }
  };

  visitStringConstant = (ctx: StringConstantContext): ConstantSymbol => {
    return {
      variant: "Constant",
      type: this.program.globalScope.lookupSymbol(
        "stringview",
        this.program.getLoc(ctx),
      ).type,
      value: ctx.getText(),
    };
  };

  visitBooleanConstant = (ctx: BooleanConstantContext): ConstantSymbol => {
    const text = ctx.getText();
    let value = false;
    if (text === "true") {
      value = true;
    } else if (text !== "false") {
      throw new InternalError(`Invalid boolean constant: ${text}`);
    }
    return {
      variant: "Constant",
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

  // visitIfStatement(ctx: IfStatementContext): void {
  //   this.visit(ctx.ifexpr());
  //   for (const expr of ctx.elseifexpr()) {
  //     this.visit(expr);
  //   }

  //   if (!this.getNodeDatatype(ctx.ifexpr()).isBoolean()) {
  //     throw new CompilerError(
  //       `If expression of type '${this.getNodeDatatype(ctx.ifexpr()).getDisplayName()}' is not a boolean`,
  //       this.getLocation(ctx),
  //     );
  //   }

  //   this.db.pushScope(this.getNodeScope(ctx.thenblock()));
  //   this.visit(ctx.thenblock());
  //   this.db.popScope();

  //   for (const elifblock of ctx.elseifblock()) {
  //     this.db.pushScope(this.getNodeScope(elifblock));
  //     this.visit(elifblock);
  //     this.db.popScope();
  //   }

  //   if (ctx.elseblock()) {
  //     this.db.pushScope(this.getNodeScope(ctx.elseblock()));
  //     this.visit(ctx.elseblock());
  //     this.db.popScope();
  //   }
  // }

  visitArgs = (ctx: ArgsContext): Expression[] => {
    const args: Expression[] = [];
    for (const e of ctx.expr_list()) {
      args.push(this.visit(e));
    }
    return args;
  };

  visitExprAssignmentStatement = (
    ctx: ExprAssignmentStatementContext,
  ): void => {
    const rightExpr = this.visit(ctx.expr_list()[1]);
    if (rightExpr.type.isNone()) {
      throw new CompilerError(
        "Cannot assign 'none' to a variable.",
        this.program.getLoc(ctx),
      );
    }
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

    for (const attr of ctx.structmembervalue_list()) {
      const [symbol, expr] = this.visit(attr) as [VariableSymbol, Expression];
      members.push([symbol, expr]);

      const existingSymbol = structtype.members.find(
        (m) => m.name === symbol.name,
      );
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
    }

    return {
      variant: "Object",
      ctx: ctx,
      members: members,
      type: structtype,
    };
  };

  visitExprMemberAccess = (
    ctx: ExprMemberAccessContext,
  ): MemberAccessExpression | MethodAccessExpression => {
    const expr: Expression = this.visit(ctx.expr());
    if (expr.type.variant !== "Struct") {
      throw new CompilerError(
        `Expression of type '${serializeDatatype(expr.type)}' is not a struct`,
        this.program.getLoc(ctx),
      );
    }
    const name: string = ctx.ID().getText();
    const field: VariableSymbol | undefined = expr.type.members.find(
      (m) => m.name === name,
    );
    const method: FunctionSymbol | undefined = expr.type.methods.find(
      (m) => m.name === name,
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
      return {
        ctx: ctx,
        variant: "MemberAccess",
        expr: expr,
        memberName: name,
        type: field.type,
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
      for (const [name, tp] of expr.type.generics) {
        if (!tp) {
          throw new CompilerError(
            `Generic parameter '${name}' has no type`,
            this.program.getLoc(ctx),
          );
        }
        const symbol = this.program.ctxToSymbolMap.get(
          method.ctx,
        ) as FunctionSymbol;
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
      // this.implFunc(method.ctx as FuncContext);

      return {
        ctx: ctx,
        variant: "MethodAccess",
        expr: expr,
        method: method,
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
