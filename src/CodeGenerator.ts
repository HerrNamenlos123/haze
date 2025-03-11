import { Program } from "./Program";
import {
  InternalError,
  ImpossibleSituation,
  printCompilerMessage,
  ErrorType,
} from "./Errors";
import type { StructDeclContext } from "./parser/HazeParser";
import {
  Language,
  mangleDatatype,
  mangleSymbol,
  serializeSymbol,
  type DatatypeSymbol,
  type FunctionSymbol,
  type Symbol,
  type VariableSymbol,
} from "./Symbol";
import {
  explicitConversion,
  generateDeclarationCCode,
  generateDefinitionCCode,
  generateUsageCode,
  implicitConversion,
  isInteger,
  serializeDatatype,
  type Datatype,
  type FunctionDatatype,
  type RawPointerDatatype,
} from "./Datatype";
import type { Statement } from "./Statement";
import type { Expression, ObjectExpression } from "./Expression";
import { OutputWriter } from "./OutputWriter";
import { datatypeSymbolUsed, resolveGenerics } from "./utils";
import type { Scope } from "./Scope";

class CodeGenerator {
  private program: Program;
  private out = {
    includes: {} as Record<string, OutputWriter>,
    cDecls: {} as Record<string, OutputWriter>,
    type_declarations: {} as Record<string, OutputWriter>,
    type_definitions: {} as Record<string, OutputWriter>,
    function_declarations: {} as Record<string, OutputWriter>,
    function_definitions: {} as Record<string, OutputWriter>,
  };

  constructor(program: Program) {
    this.program = program;

    const contextSymbol = this.program.globalScope.lookupSymbol(
      "Context",
      this.program.globalScope.location,
    );
    const context = generateUsageCode(contextSymbol.type, this.program);
    this.out.type_declarations[mangleSymbol(contextSymbol)] = new OutputWriter()
      .writeLine(`struct ${context}_;`)
      .writeLine(`typedef struct ${context}_ ${context};`);

    this.out.function_definitions["main"] = new OutputWriter()
      .writeLine("int32_t main() {")
      .pushIndent()
      .writeLine(
        `${generateUsageCode(this.program.getBuiltinType("Context"), this.program)} ctx = { };`,
      )
      .writeLine("return _H4main(&ctx);")
      .popIndent()
      .writeLine("}");
  }

  init(field: string, out: Record<string, OutputWriter>) {
    if (!(field in out)) {
      out[field] = new OutputWriter();
    }
  }

  includeHeader(filename: string) {
    this.init(filename, this.out.includes);
    this.out.includes[filename].write(`#include <${filename}>`);
  }

  writeFile(filename: string) {
    const fs = require("fs");
    const writer = new OutputWriter();

    writer.writeLine("#define _POSIX_C_SOURCE 199309L\n");

    writer.write("// Include section\n");
    for (const include of Object.values(this.out.includes)) {
      writer.write(include);
    }

    writer.write("\n\n// C Declaration section\n");
    for (const decl of Object.values(this.out.cDecls)) {
      writer.write(decl);
      writer.writeLine();
    }

    this.generateDatatypeUse(
      this.program.globalScope.lookupDatatypeSymbol(
        "Context",
        this.program.globalScope.location,
      ),
    );

    writer.write("\n\n// Type declaration section\n");
    for (const decl of Object.values(this.out.type_declarations)) {
      writer.write(decl);
      writer.writeLine();
    }

    writer.write("\n\n// Type definition section\n");
    for (const decl of Object.values(this.out.type_definitions)) {
      writer.write(decl);
      writer.writeLine();
    }

    writer.write("\n\n// Function declaration section\n");
    for (const decl of Object.values(this.out.function_declarations)) {
      writer.write(decl);
      writer.writeLine();
    }

    writer.write("\n\n// Function definition section\n");
    for (const def of Object.values(this.out.function_definitions)) {
      writer.write(def);
      writer.writeLine();
    }

    const path = require("path");
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, writer.get());
  }

  generate() {
    this.includeHeader("stdio.h");
    this.includeHeader("assert.h");
    this.includeHeader("stdint.h");
    this.includeHeader("stdlib.h");
    this.includeHeader("time.h");

    for (const decl of this.program.cDefinitionDecl) {
      this.out.cDecls[decl] = new OutputWriter().writeLine(decl);
    }

    for (const symbol of this.program.concreteFunctions.values()) {
      if (symbol.language === Language.Internal) {
        this.generateFuncUse(symbol);
      }
    }

    for (const dt of this.program.concreteDatatypes.values()) {
      this.generateDatatypeUse(dt);
    }
  }

  generateFuncUse(symbol: FunctionSymbol) {
    const declaration = (
      ftype: FunctionDatatype,
      returntype: Datatype,
    ): string => {
      let decl =
        generateUsageCode(returntype, this.program) +
        " " +
        mangleSymbol(symbol) +
        "(";
      const params = [];
      if (
        symbol.parentSymbol &&
        symbol.parentSymbol.variant === "Datatype" &&
        symbol.specialMethod !== "constructor"
      ) {
        const thisPtr: RawPointerDatatype = {
          variant: "RawPointer",
          generics: new Map().set("__Pointee", symbol.parentSymbol.type),
        };
        params.push(`${generateUsageCode(thisPtr, this.program)} this`);
      }
      params.push(
        `${generateUsageCode(this.program.getBuiltinType("Context"), this.program)}* ctx`,
      );
      for (const [paramName, paramType] of ftype.functionParameters) {
        params.push(
          generateUsageCode(paramType, this.program) + " " + paramName,
        );
        // datatypeSymbolUsed(paramType);
      }
      decl += params.join(", ");
      if (ftype.vararg) {
        decl += ", ...";
      }
      decl += ")";
      return decl;
    };

    this.init(mangleSymbol(symbol), this.out.function_definitions);
    this.init(mangleSymbol(symbol), this.out.function_declarations);
    const decl = declaration(symbol.type, symbol.type.functionReturnType);
    this.out.function_declarations[mangleSymbol(symbol)].write(decl + ";");
    this.out.function_definitions[mangleSymbol(symbol)]
      .writeLine(decl + " {")
      .pushIndent();

    this.out.function_definitions[mangleSymbol(symbol)].write(
      this.emitScope(symbol.scope),
    );

    if (symbol.specialMethod === "destructor") {
      if (!symbol.parentSymbol) {
        throw new ImpossibleSituation();
      }
      if (
        symbol.parentSymbol.variant !== "Datatype" ||
        symbol.parentSymbol.type.variant !== "Struct"
      ) {
        throw new ImpossibleSituation();
      }
      const members = symbol.parentSymbol.type.members.filter(
        (m) => m.variant === "Variable",
      );
      this.outputDestructorCalls(
        members,
        this.out.function_definitions[mangleSymbol(symbol)],
        undefined,
        true,
      );
    }

    this.out.function_definitions[mangleSymbol(symbol)]
      .popIndent()
      .writeLine("}");
  }

  outputDestructorCalls(
    symbols: Symbol[],
    writer: OutputWriter,
    returnedSymbol?: VariableSymbol,
    isMember?: boolean,
  ) {
    for (const symbol of symbols.reverse()) {
      if (symbol.variant === "Variable" && symbol.type.variant === "Struct") {
        const destructor = symbol.type.methods.find(
          (m) => m.specialMethod === "destructor",
        );
        if (destructor) {
          if (returnedSymbol && returnedSymbol === symbol) {
            continue;
          }
          writer.writeLine(
            `${mangleSymbol(destructor)}(&${isMember ? "this->" : ""}${symbol.name}, ctx);`,
          );
        }
      }
    }
  }

  emitScope(scope: Scope): OutputWriter {
    const writer = new OutputWriter();

    let returned = false;
    for (const statement of scope.statements) {
      if (returned) {
        printCompilerMessage(
          this.program.getLoc(statement.ctx),
          ErrorType.Warning,
          "warning",
          `Dead code detected and stripped`,
        );
        break;
      }

      if (statement.variant === "Return") {
        returned = true;
        if (statement.expr) {
          writer.writeLine(
            `${generateUsageCode(statement.expr.type, this.program)} __returnval__ = ` +
              this.emitExpr(statement.expr).get() +
              ";",
          );
        }
        const returnedSymbol =
          statement.expr?.variant === "SymbolValue"
            ? statement.expr.symbol.variant === "Variable"
              ? statement.expr.symbol
              : undefined
            : undefined;
        this.outputDestructorCalls(
          Object.values(scope.getSymbols()),
          writer,
          returnedSymbol,
        );
        if (!statement.expr) {
          writer.writeLine("return;");
        } else {
          writer.writeLine("return __returnval__;");
        }
      } else {
        writer.write(this.emitStatement(statement));
      }
    }

    if (!returned) {
      this.outputDestructorCalls(Object.values(scope.getSymbols()), writer);
    }

    return writer;
  }

  emitStatement(statement: Statement): OutputWriter {
    const writer = new OutputWriter();
    switch (statement.variant) {
      case "Return":
        throw new InternalError(
          "Cannot call emitStatement for return statement, use emitExpression instead",
        );

      case "VariableDefinition":
        if (
          !statement.expr ||
          !statement.symbol.type ||
          statement.symbol.variant !== "Variable"
        ) {
          throw new ImpossibleSituation();
        }
        const ret = generateUsageCode(statement.symbol.type, this.program);
        writer.writeLine(
          `${ret} ${statement.symbol.name} = ${this.emitExpr(statement.expr).get()};`,
        );
        return writer;

      case "Expr":
        writer.writeLine(this.emitExpr(statement.expr).get() + ";");
        return writer;

      case "InlineC":
        writer.writeLine(statement.code + ";");
        return writer;

      case "While":
        const whileexpr = implicitConversion(
          statement.expr.type,
          this.program.getBuiltinType("boolean"),
          this.emitExpr(statement.expr).get(),
          statement.scope,
          this.program.getLoc(statement.expr.ctx),
          this.program,
        );
        writer.writeLine(`while (${whileexpr}) {`).pushIndent();
        writer.write(this.emitScope(statement.scope));
        writer.popIndent().writeLine("}");
        return writer;

      case "Conditional":
        const convexpr = implicitConversion(
          statement.if[0].type,
          this.program.getBuiltinType("boolean"),
          this.emitExpr(statement.if[0]).get(),
          statement.if[1],
          this.program.getLoc(statement.if[0].ctx),
          this.program,
        );
        writer.writeLine(`if (${convexpr}) {`).pushIndent();
        writer.write(this.emitScope(statement.if[1]));
        writer.popIndent().writeLine("}");
        for (const [expr, scope] of statement.elseIf) {
          const convexpr = implicitConversion(
            expr.type,
            this.program.getBuiltinType("boolean"),
            this.emitExpr(expr).get(),
            scope,
            this.program.getLoc(expr.ctx),
            this.program,
          );
          writer.writeLine(`else if (${convexpr}) {`).pushIndent();
          writer.write(this.emitScope(scope));
          writer.popIndent().writeLine("}");
        }
        if (statement.else) {
          writer.writeLine(`else {`).pushIndent();
          writer.write(this.emitScope(statement.else));
          writer.popIndent().writeLine("}");
        }
        return writer;

      // default:
      //   throw new InternalError(`Unknown statement type ${statement.variant}`);
    }
  }

  emitExpr(expr: Expression): OutputWriter {
    const writer = new OutputWriter();
    switch (expr.variant) {
      case "ExprCall":
        const args = [];
        if (expr.thisPointerExpr) {
          args.push("&" + this.emitExpr(expr.thisPointerExpr).get());
        }
        if (expr.expr.variant === "SymbolValue") {
          if (expr.expr.symbol.variant === "Function") {
            if (expr.expr.symbol.language === Language.Internal) {
              args.push("ctx");
            }
          } else if (expr.expr.symbol.variant === "Variable") {
            args.push("ctx");
          }
        } else if (expr.expr.variant === "MemberAccess") {
          args.push("ctx");
        }
        for (let i = 0; i < expr.args.length; i++) {
          const val = this.emitExpr(expr.args[i]).get();
          if (expr.expr.type.variant !== "Function") {
            throw new ImpossibleSituation();
          }
          let scope = this.program.currentScope;
          if (
            expr.expr.variant === "MemberAccess" &&
            expr.expr.methodSymbol &&
            expr.expr.methodSymbol.thisPointerExpr &&
            expr.expr.methodSymbol.variant === "Function"
          ) {
            scope = expr.expr.methodSymbol.scope;
          }
          const target = expr.expr.type.functionParameters[i]
            ? expr.expr.type.functionParameters[i][1]
            : expr.args[i].type;
          const converted = implicitConversion(
            expr.args[i].type,
            target,
            val,
            scope,
            this.program.getLoc(expr.args[i].ctx),
            this.program,
          );
          args.push(converted);
        }
        if (
          expr.expr.variant === "MemberAccess" &&
          expr.expr.methodSymbol &&
          expr.expr.methodSymbol.thisPointerExpr &&
          expr.expr.methodSymbol.variant === "Function"
        ) {
          writer.write(
            mangleSymbol(expr.expr.methodSymbol) +
              "(&" +
              this.emitExpr(expr.expr.methodSymbol.thisPointerExpr).get() +
              ", " +
              args.join(", ") +
              ")",
          );
        } else {
          writer.write(
            this.emitExpr(expr.expr).get() + "(" + args.join(", ") + ")",
          );
        }
        return writer;

      case "ExprAssign":
        const assignConv = implicitConversion(
          expr.rightExpr.type,
          expr.leftExpr.type,
          this.emitExpr(expr.rightExpr).get(),
          this.program.currentScope,
          this.program.getLoc(expr.rightExpr.ctx),
          this.program,
        );
        writer.write(`(${this.emitExpr(expr.leftExpr).get()} = ${assignConv})`);
        return writer;

      case "Object":
        writer
          .writeLine(`((${generateUsageCode(expr.type, this.program)}) { `)
          .pushIndent();
        for (const [symbol, memberExpr] of expr.members) {
          writer.writeLine(
            `.${symbol.name} = ${this.emitExpr(memberExpr).get()}, `,
          );
        }
        writer.popIndent().write(" })");
        return writer;

      case "RawPtrDeref":
        writer.write(`(*(${this.emitExpr(expr.expr).get()}))`);
        return writer;

      case "MemberAccess":
        writer.write(this.emitExpr(expr.expr).get() + "." + expr.memberName);
        return writer;

      case "Sizeof":
        writer.write(
          `sizeof(${generateUsageCode(expr.datatype, this.program)})`,
        );
        return writer;

      case "SymbolValue":
        if (expr.symbol.variant === "Function") {
          writer.write(mangleSymbol(expr.symbol));
          return writer;
        } else if (
          expr.symbol.variant === "Variable" ||
          expr.symbol.variant === "Datatype"
        ) {
          writer.write(expr.symbol.name);
          return writer;
        } else {
          throw new ImpossibleSituation();
        }

      case "ExplicitCast":
        writer.write(
          explicitConversion(
            expr.expr.type,
            expr.type,
            this.emitExpr(expr.expr).get(),
            this.program.currentScope,
            this.program.getLoc(expr.ctx),
            this.program,
          ),
        );
        return writer;

      case "PreIncr":
        {
          writer.write(
            "(" + expr.operation + this.emitExpr(expr.expr).get() + ")",
          );
        }
        return writer;

      case "PostIncr":
        {
          writer.write(
            "(" + this.emitExpr(expr.expr).get() + expr.operation + ")",
          );
        }
        return writer;

      case "Unary":
        switch (expr.operation) {
          case "!":
            {
              const unaryExpr = implicitConversion(
                expr.expr.type,
                expr.type,
                this.emitExpr(expr.expr).get(),
                this.program.currentScope,
                this.program.getLoc(expr.ctx),
                this.program,
              );
              writer.write("(!" + unaryExpr + ")");
            }
            break;

          case "+":
          case "-":
            {
              writer.write(
                "(" + expr.operation + this.emitExpr(expr.expr).get() + ")",
              );
            }
            break;
        }
        return writer;

      case "Binary":
        switch (expr.operation) {
          case "*":
          case "/":
          case "%":
          case "+":
          case "-":
            {
              const left = implicitConversion(
                expr.leftExpr.type,
                expr.type,
                this.emitExpr(expr.leftExpr).get(),
                this.program.currentScope,
                this.program.getLoc(expr.ctx),
                this.program,
              );
              const right = implicitConversion(
                expr.rightExpr.type,
                expr.type,
                this.emitExpr(expr.rightExpr).get(),
                this.program.currentScope,
                this.program.getLoc(expr.ctx),
                this.program,
              );
              writer.write(
                "(" + left + " " + expr.operation + " " + right + ")",
              );
            }
            break;

          case "<":
          case ">":
          case "<=":
          case ">=":
            writer.write(
              "(" +
                this.emitExpr(expr.leftExpr).get() +
                " " +
                expr.operation +
                " " +
                this.emitExpr(expr.rightExpr).get() +
                ")",
            );
            break;

          case "==":
          case "!=":
            {
              writer.write(
                "(" +
                  this.emitExpr(expr.leftExpr).get() +
                  " " +
                  expr.operation +
                  " " +
                  this.emitExpr(expr.rightExpr).get() +
                  ")",
              );
            }
            break;

          case "&&":
          case "||":
            {
              writer.write(
                "(" +
                  this.emitExpr(expr.leftExpr).get() +
                  " " +
                  expr.operation +
                  " " +
                  this.emitExpr(expr.rightExpr).get() +
                  ")",
              );
            }
            break;
        }
        return writer;

      case "Constant":
        switch (expr.constantSymbol.variant) {
          case "LiteralConstant":
            if (expr.constantSymbol.unit) {
              let value = 0;
              switch (expr.constantSymbol.unit) {
                case "ns":
                  value = expr.constantSymbol.value;
                  break;

                case "us":
                  value = expr.constantSymbol.value * 1000;
                  break;

                case "ms":
                  value = expr.constantSymbol.value * 1000 * 1000;
                  break;

                case "s":
                  value = expr.constantSymbol.value * 1000 * 1000 * 1000;
                  break;

                case "m":
                  value = expr.constantSymbol.value * 60 * 1000 * 1000 * 1000;
                  break;

                case "h":
                  value = expr.constantSymbol.value * 3600 * 1000 * 1000 * 1000;
                  break;

                case "d":
                  value =
                    expr.constantSymbol.value * 24 * 3600 * 1000 * 1000 * 1000;
                  break;

                default:
                  throw new InternalError(
                    `Unknown unit ${expr.constantSymbol.unit}`,
                  );
              }
              if (expr.constantSymbol.type.variant !== "Struct") {
                throw new ImpossibleSituation();
              }
              const durationExpr: ObjectExpression = {
                variant: "Object",
                type: expr.constantSymbol.type,
                ctx: expr.ctx,
                members: [
                  [
                    expr.constantSymbol.type.members[0] as VariableSymbol,
                    {
                      variant: "Constant",
                      constantSymbol: {
                        variant: "LiteralConstant",
                        type: (
                          expr.constantSymbol.type.members[0] as VariableSymbol
                        ).type,
                        value: value,
                      },
                      ctx: expr.ctx,
                      type: (
                        expr.constantSymbol.type.members[0] as VariableSymbol
                      ).type,
                    },
                  ],
                ],
              };
              writer.write(this.emitExpr(durationExpr).get());
            } else {
              writer.write(expr.constantSymbol.value.toString());
            }
            return writer;

          case "BooleanConstant":
            writer.write(expr.constantSymbol.value ? "1" : "0");
            return writer;

          case "StringConstant":
            writer.write(expr.constantSymbol.value);
            return writer;

          // default:
          //   throw new InternalError(
          //     `Unknown constant type ${typeof expr.constantSymbol.value}`,
          //   );
        }

      default:
        throw new InternalError(`Unknown expression type ${expr.variant}`);
    }
  }

  //   implVariableDefinition(ctx: any, isMutable: boolean) {
  //     const symbol = this.getNodeSymbol(ctx);
  //     if (symbol instanceof VariableSymbol) {
  //       const value = implicitConversion(
  //         this.getNodeDatatype(ctx.expr()),
  //         symbol.type,
  //         ctx.expr().code,
  //         this.getLocation(ctx),
  //       );
  //       ctx.code = `${symbol.type.generateUsageCode()} ${symbol.name} = ${value};\n`;
  //     } else {
  //       throw new InternalError("Symbol is not a variable");
  //     }
  //   }

  generateDatatypeUse(datatype: DatatypeSymbol) {
    if (!this.out.type_declarations[mangleSymbol(datatype)]) {
      this.init(mangleSymbol(datatype), this.out.type_declarations);
      this.out.type_declarations[mangleSymbol(datatype)].write(
        generateDeclarationCCode(datatype, this.program),
      );
    }
    if (!this.out.type_definitions[mangleSymbol(datatype)]) {
      this.init(mangleSymbol(datatype), this.out.type_definitions);
      this.out.type_definitions[mangleSymbol(datatype)].write(
        generateDefinitionCCode(datatype, this.program),
      );
    }
  }

  //   getCurrentFunction() {
  //     return this.currentFunctionStack[this.currentFunctionStack.length - 1];
  //   }

  //   getExpectedReturntype() {
  //     const r = this.getCurrentFunction().type.functionReturnType;
  //     if (!r) {
  //       throw new InternalError("Function is missing return type");
  //     }
  //     return r;
  //   }

  //   pushCurrentFunction(symbol: FunctionSymbol) {
  //     this.currentFunctionStack.push(symbol);
  //   }

  //   popCurrentFunction() {
  //     this.currentFunctionStack.pop();
  //   }

  //   visitReturnStatement(ctx: any) {
  //     const scope = this.getNodeScope(ctx);
  //     scope.setTerminated(true);
  //     this.visitChildren(ctx);
  //     const type = this.getNodeDatatype(ctx);
  //     if (type.isNone()) {
  //       ctx.code = "return;\n"; // type: ignore
  //     } else {
  //       const value = implicitConversion(
  //         type,
  //         this.getExpectedReturntype(),
  //         ctx.expr().code,
  //         this.getLocation(ctx),
  //       );
  //       ctx.code = `return ${value};\n`; // type: ignore
  //     }
  //   }

  //   visitConstantExpr(ctx: any) {
  //     this.visitChildren(ctx);
  //     ctx.code = ctx.constant().code; // type: ignore
  //   }

  //   visitIntegerConstant(ctx: any) {
  //     this.visitChildren(ctx);
  //     const value = parseInt(ctx.getText());
  //     ctx.code = value.toString(); // type: ignore
  //   }

  //   visitStringConstant(ctx: any) {
  //     this.visitChildren(ctx);
  //     ctx.code = `"${ctx.getText().slice(1, -1)}"`; // type: ignore
  //   }

  //   visitFunc(ctx: any) {
  //     return this.provideFuncDef(ctx);
  //   }

  //   visitNamedfunc(ctx: any) {
  //     return this.provideFuncDef(ctx);
  //   }

  //   visitMutableVariableDefinition(ctx: any) {
  //     return this.implVariableDefinition(ctx, true);
  //   }

  //   visitImmutableVariableDefinition(ctx: any) {
  //     return this.implVariableDefinition(ctx, false);
  //   }

  //   visitSymbolValueExpr(ctx: any) {
  //     this.visitChildren(ctx);
  //     const symbol = this.getNodeSymbol(ctx);

  //     if (symbol instanceof FunctionSymbol) {
  //       ctx.code = symbol.getMangledName(); // type: ignore
  //     } else {
  //       ctx.code = symbol.name; // type: ignore
  //     }
  //     this.setNodeSymbol(ctx, symbol);
  //   }

  //   visitExprStatement(ctx: any) {
  //     this.visitChildren(ctx);
  //     ctx.code = `${ctx.expr().code};\n`; // type: ignore
  //   }

  //   visitExprCallExpr(ctx: ExprCallExprContext) {
  //     this.visitChildren(ctx);
  //     const symbol = this.getNodeSymbol(ctx.expr());
  //     const exprtype = symbol.type;

  //     // thisPointer = this.getNodeThisPointer(ctx.expr());
  //     // args.push_back(thisPointer);
  //     // thisPointerType = this.getNodeDatatype(expr);

  //     if (!(symbol instanceof FunctionSymbol) || !exprtype.isFunction()) {
  //       throw new CompilerError(
  //         `Expression of type '${exprtype.getDisplayName()}' is not callable`,
  //         this.getLocation(ctx),
  //       );
  //     }

  //     ctx.code = `${ctx.expr().code}(`; // type: ignore

  //     const params: string[] = [];
  //     if (symbol.functionLinkage !== FunctionLinkage.External_C) {
  //       params.push("context");
  //     }
  //     if (symbol.thisPointerType) {
  //       params.push(`&${ctx.expr().structSymbol.name}`);
  //     }
  //     for (let i = 0; i < exprtype.functionParameters.length; i++) {
  //       const paramexpr = ctx.args().expr()[i];
  //       const expectedtype = exprtype.functionParameters[i][1];
  //       params.push(
  //         implicitConversion(
  //           this.getNodeDatatype(paramexpr),
  //           expectedtype,
  //           paramexpr.code,
  //           this.getLocation(paramexpr),
  //         ),
  //       );
  //     }

  //     ctx.code += `${params.join(", ")});`; // type: ignore

  //     if (symbol.type.generics.length > 0) {
  //       if (!symbol.ctx) {
  //         throw new InternalError("Function missing context");
  //       }

  //       if (ctx.expr().structSymbol) {
  //         // symbol.type.genericsDict = ctx.expr().structSymbol.type.genericsDict
  //         this.setNodeSymbol(symbol.ctx, symbol);
  //         this.generateFuncUse(symbol.ctx);
  //       } else {
  //         throw new InternalError("Function missing context generics dict");
  //       }
  //     }
  //   }

  //   visitStructFuncDecl(ctx: StructFuncDeclContext) {
  //     return this.provideFuncDef(ctx);
  //   }

  //   visitStructDecl(ctx: StructDeclContext) {
  //     this.visitChildren(ctx);
  //     const datatype = this.getNodeDatatype(ctx);
  //     this.structCtx[datatype.name] = ctx;
  //     if (!datatype.generics) {
  //       this.output["type_declarations"][datatype.getMangledName()] =
  //         datatype.generateDefinitionCCode();
  //     }
  //   }

  // visitObjectExpr(ctx: ObjectExprContext) {
  //     this.visitChildren(ctx);
  //     const type = this.getNodeDatatype(ctx);
  //     if (!(type instanceof StructDatatype)) {
  //         throw new InternalError("StructDatatype is not of type struct");
  //     }

  //     ctx.code = `(${type.generateUsageCode()}){ `;
  //     for (const attr of this.getNodeObjectAttributes(ctx)) {
  //         const objattr: ObjAttribute = attr;
  //         ctx.code += `.

  // visitNamedObjectExpr(ctx) {
  //   throw new InternalError("Not implemented");
  //   // self.visitChildren(ctx)
  //   // structtype = self.getNodeDatatype(ctx)
  //   // if not structtype.isStruct():
  //   //     raise InternalError("StructDatatype is not of type struct")

  //   // ctx.code = f"({structtype.generateUsageCode()}){{ "  # type: ignore
  //   // fields = getStructFields(structtype)
  //   // for i in range(len(fields)):
  //   //     expr = ctx.objectattribute()[i].expr()
  //   //     ctx.code += f".{fields[i].name} = {implicitConversion(self.getNodeDatatype(expr), fields[i].type, expr.code, self.getLocation(ctx))}, "  # type: ignore
  //   // ctx.code += " }"  # type: ignore
  // }

  // visitExprMemberAccess(self, ctx) {
  //   throw new InternalError("Not implemented");

  //   // self.visitChildren(ctx)

  //   // symbol = self.getNodeSymbol(ctx.expr())
  //   // if symbol.type.isStruct():
  //   //     if self.hasNodeMemberAccessFieldIndex(ctx):
  //   //         fieldIndex = self.getNodeMemberAccessFieldIndex(ctx)
  //   //         ctx.code = (  # type: ignore
  //   //             f"{symbol.name}.{getStructFields(symbol.type)[fieldIndex].name}"
  //   //         )
  //   //         # symbol.type.genericsDict = symbol.type.genericsDict
  //   //         ctx.structSymbol = symbol  # type: ignore

  //   //     elif self.hasNodeMemberAccessFunctionSymbol(ctx):
  //   //         memberFuncSymbol = self.getNodeMemberAccessFunctionSymbol(ctx)
  //   //         # memberFuncSymbol.parentNamespace = Namespace(
  //   //         #     symbol.type.getDisplayName()
  //   //         # )
  //   //         # memberFuncSymbol.type.genericsDict = symbol.type.genericsDict
  //   //         ctx.code = f"{memberFuncSymbol.getMangledName()}"  # type: ignore
  //   //         ctx.structSymbol = symbol  # type: ignore
  //   //     else:
  //   //         raise InternalError("Neither field nor function")
  //   // elif symbol.type.isPointer():
  //   //     if self.hasNodeMemberAccessFieldIndex(ctx) and symbol.type.pointee:
  //   //         fieldIndex = self.getNodeMemberAccessFieldIndex(ctx)
  //   //         ctx.code = f"{symbol.name}->{getStructFields(symbol.type.pointee)[fieldIndex].name}"  # type: ignore
  //   //         # ctx.structSymbol = symbol
  //   //     else:
  //   //         raise InternalError("Cannot call function on pointer")
  //   // else:
  //   //     raise InternalError(
  //   //         f"Member access type {symbol.type.getDisplayName()} is not structural"
  //   //     )
  // }
}

export function generateCode(program: Program, outfile: string) {
  const gen = new CodeGenerator(program);
  gen.generate();
  gen.writeFile(outfile);
}
