import { ModuleType, Program } from "./Program";
import {
  InternalError,
  ImpossibleSituation,
  ErrorType,
  printWarningMessage,
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
import {
  datatypeSymbolUsed,
  defineGenericsInScope,
  resolveGenerics,
} from "./utils";
import { Scope } from "./Scope";

class CodeGenerator {
  private program: Program;
  private out = {
    includes: {} as Record<string, OutputWriter>,
    cDecls: {} as Record<string, OutputWriter>,
    type_declarations: {} as Record<string, OutputWriter>,
    type_definitions: {} as Record<string, OutputWriter>,
    function_declarations: {} as Record<string, OutputWriter>,
    function_definitions: {} as Record<string, OutputWriter>,
    global_variables: {} as Record<string, OutputWriter>,
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

    if (this.program.projectConfig.moduleType === ModuleType.Executable) {
      const mainWriter = new OutputWriter();
      this.out.function_definitions["main"] = mainWriter;
      mainWriter
        .writeLine("int32_t main() {")
        .pushIndent()
        .writeLine(
          `${generateUsageCode(this.program.getBuiltinType("Context"), this.program)} ctx = {};`,
        );
      if (!this.program.projectConfig.nostdlib) {
        mainWriter.writeLine("_H13__setupStdlib(&ctx);");
      }
      mainWriter.writeLine("return _H4main(&ctx);").popIndent().writeLine("}");
    }
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

    writer.write("\n\n// Global Variable section\n");
    for (const decl of Object.values(this.out.global_variables)) {
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
    this.out.includes["_USE_MATH_DEFINES"] = new OutputWriter().writeLine(
      "#define _USE_MATH_DEFINES",
    );
    this.includeHeader("stdio.h");
    this.includeHeader("assert.h");
    this.includeHeader("stdint.h");
    this.includeHeader("stdlib.h");
    this.includeHeader("memory.h");
    this.includeHeader("stdarg.h");
    this.includeHeader("math.h");
    this.includeHeader("time.h");

    for (const decl of this.program.cDefinitionDecl) {
      this.out.cDecls[decl] = new OutputWriter().writeLine(decl);
    }

    for (const statement of this.program.concreteGlobalStatements.values()) {
      const s = this.emitStatement(statement);
      this.out.global_variables[mangleSymbol(statement.symbol)] =
        new OutputWriter().write(s.temp);
      this.out.global_variables[mangleSymbol(statement.symbol)] =
        new OutputWriter().write(s.out);
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
        symbol.parentSymbol.type.variant !== "Namespace" &&
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

    this.init(mangleSymbol(symbol), this.out.function_declarations);
    const decl = declaration(symbol.type, symbol.type.functionReturnType);
    this.out.function_declarations[mangleSymbol(symbol)].write(decl + ";");

    if (!symbol.declared) {
      this.init(mangleSymbol(symbol), this.out.function_definitions);
      this.out.function_definitions[mangleSymbol(symbol)]
        .writeLine(decl + " {")
        .pushIndent();

      const s = this.emitScope(symbol.scope);
      this.out.function_definitions[mangleSymbol(symbol)].write(s.temp);
      this.out.function_definitions[mangleSymbol(symbol)].write(s.out);

      this.out.function_definitions[mangleSymbol(symbol)]
        .popIndent()
        .writeLine("}");
    }
  }

  emitScope(scope: Scope): { temp: OutputWriter; out: OutputWriter } {
    const tempWriter = new OutputWriter();
    const outWriter = new OutputWriter();

    let returned = false;
    for (const statement of scope.statements) {
      if (returned) {
        printWarningMessage(
          `Dead code detected and stripped`,
          statement.location,
        );
        break;
      }

      if (statement.variant === "Return") {
        returned = true;
      }

      const s = this.emitStatement(statement);
      tempWriter.write(s.temp);
      outWriter.write(s.out);
    }

    return { temp: tempWriter, out: outWriter };
  }

  emitStatement(statement: Statement): {
    temp: OutputWriter;
    out: OutputWriter;
  } {
    const tempWriter = new OutputWriter();
    const outWriter = new OutputWriter();
    switch (statement.variant) {
      case "Return": {
        if (statement.expr) {
          const exprWriter = this.emitExpr(statement.expr);
          tempWriter.write(exprWriter.temp);
          outWriter.writeLine(`return ` + exprWriter.out.get() + ";");
        } else {
          outWriter.writeLine("return;");
        }
        return { temp: tempWriter, out: outWriter };
      }

      case "VariableDeclaration": {
        if (!statement.symbol.type || statement.symbol.variant !== "Variable") {
          throw new ImpossibleSituation();
        }
        const ret = generateUsageCode(statement.symbol.type, this.program);
        outWriter.writeLine(`${ret} ${statement.symbol.name} = {0};`);
        return { temp: tempWriter, out: outWriter };
      }

      case "VariableDefinition": {
        if (
          !statement.expr ||
          !statement.symbol.type ||
          statement.symbol.variant !== "Variable"
        ) {
          throw new ImpossibleSituation();
        }
        const ret = generateUsageCode(statement.symbol.type, this.program);
        const exprWriter = this.emitExpr(statement.expr);
        tempWriter.write(exprWriter.temp);
        const assignConv = implicitConversion(
          statement.expr.type,
          statement.symbol.type,
          exprWriter.out.get(),
          this.program.currentScope,
          statement.expr.location,
          this.program,
        );
        outWriter.writeLine(
          `${ret} ${mangleSymbol(statement.symbol)} = ${assignConv};`,
        );
        return { temp: tempWriter, out: outWriter };
      }

      case "Expr": {
        const exprWriter = this.emitExpr(statement.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.writeLine(exprWriter.out.get() + ";");
        return { temp: tempWriter, out: outWriter };
      }

      case "InlineC": {
        outWriter.writeLine(statement.code + ";");
        return { temp: tempWriter, out: outWriter };
      }

      case "While": {
        const exprWriter = this.emitExpr(statement.expr);
        tempWriter.write(exprWriter.temp);
        const whileexpr = implicitConversion(
          statement.expr.type,
          this.program.getBuiltinType("boolean"),
          exprWriter.out.get(),
          statement.scope,
          statement.expr.location,
          this.program,
        );
        outWriter.writeLine(`while (${whileexpr}) {`).pushIndent();
        const scope = this.emitScope(statement.scope);
        tempWriter.write(scope.temp);
        outWriter.write(scope.out);
        outWriter.popIndent().writeLine("}");
        return { temp: tempWriter, out: outWriter };
      }

      case "Conditional": {
        const exprWriter = this.emitExpr(statement.if[0]);
        tempWriter.write(exprWriter.temp);
        const convexpr = implicitConversion(
          statement.if[0].type,
          this.program.getBuiltinType("boolean"),
          exprWriter.out.get(),
          statement.if[1],
          statement.if[0].location,
          this.program,
        );
        outWriter.writeLine(`if (${convexpr}) {`).pushIndent();
        const scope = this.emitScope(statement.if[1]);
        tempWriter.write(scope.temp);
        outWriter.write(scope.out);
        outWriter.popIndent().writeLine("}");
        for (const [expr, scope] of statement.elseIf) {
          const exprWriter = this.emitExpr(expr);
          tempWriter.write(exprWriter.temp);
          const convexpr = implicitConversion(
            expr.type,
            this.program.getBuiltinType("boolean"),
            exprWriter.out.get(),
            scope,
            expr.location,
            this.program,
          );
          outWriter.writeLine(`else if (${convexpr}) {`).pushIndent();
          const s = this.emitScope(scope);
          tempWriter.write(s.temp);
          outWriter.write(s.out);
          outWriter.popIndent().writeLine("}");
        }
        if (statement.else) {
          outWriter.writeLine(`else {`).pushIndent();
          const scope = this.emitScope(statement.else);
          tempWriter.write(scope.temp);
          outWriter.write(scope.out);
          outWriter.popIndent().writeLine("}");
        }
        return { temp: tempWriter, out: outWriter };
      }

      // default:
      //   throw new InternalError(`Unknown statement type ${statement.variant}`);
    }
  }

  emitExpr(expr: Expression): { temp: OutputWriter; out: OutputWriter } {
    const tempWriter = new OutputWriter();
    const outWriter = new OutputWriter();
    switch (expr.variant) {
      case "ExprCall":
        const args = [];
        let useCommaOperatorForThisAssignment: string | undefined = undefined;
        if (expr.thisPointerExpr) {
          const exprWriter = this.emitExpr(expr.thisPointerExpr);
          tempWriter.write(exprWriter.temp);
          if (expr.thisPointerExpr.variant !== "ExprCall") {
            args.push("&" + exprWriter.out.get());
          } else {
            const tempname = this.program.makeTempVarname();
            tempWriter.writeLine(
              `${generateUsageCode(expr.thisPointerExpr.type, this.program)} ${tempname};`,
            );
            args.push("&" + tempname);
            useCommaOperatorForThisAssignment = `${tempname} = ${exprWriter.out.get()}`;
          }
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
          const exprWriter = this.emitExpr(expr.args[i]);
          tempWriter.write(exprWriter.temp);
          const val = exprWriter.out.get();
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
            expr.args[i].location,
            this.program,
          );
          args.push(converted);
        }
        const callExprWriter = this.emitExpr(expr.expr);
        tempWriter.write(callExprWriter.temp);
        if (useCommaOperatorForThisAssignment) {
          outWriter.write(
            `(${useCommaOperatorForThisAssignment},${callExprWriter.out.get()}(${args.join(", ")}))`,
          );
        } else {
          outWriter.write(
            callExprWriter.out.get() + "(" + args.join(", ") + ")",
          );
        }
        return { out: outWriter, temp: tempWriter };

      case "ExprAssign": {
        const leftWriter = this.emitExpr(expr.leftExpr);
        const rightWriter = this.emitExpr(expr.rightExpr);
        tempWriter.write(leftWriter.temp);
        tempWriter.write(rightWriter.temp);
        const assignConv = implicitConversion(
          expr.rightExpr.type,
          expr.leftExpr.type,
          rightWriter.out.get(),
          this.program.currentScope,
          expr.rightExpr.location,
          this.program,
        );
        outWriter.write(`(${leftWriter.out.get()} = ${assignConv})`);
        return { out: outWriter, temp: tempWriter };
      }

      case "Object": {
        outWriter
          .writeLine(`((${generateUsageCode(expr.type, this.program)}) { `)
          .pushIndent();
        for (const [symbol, memberExpr] of expr.members) {
          const exprWriter = this.emitExpr(memberExpr);
          tempWriter.write(exprWriter.temp);
          outWriter.writeLine(`.${symbol.name} = ${exprWriter.out.get()}, `);
        }
        outWriter.popIndent().write(" })");
        return { out: outWriter, temp: tempWriter };
      }

      case "RawPtrDeref": {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.write(`(*(${exprWriter.out.get()}))`);
        return { out: outWriter, temp: tempWriter };
      }

      case "MemberAccess": {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.write(exprWriter.out.get() + "." + expr.memberName);
        return { out: outWriter, temp: tempWriter };
      }

      case "Sizeof":
        outWriter.write(
          `sizeof(${generateUsageCode(expr.datatype, this.program)})`,
        );
        return { out: outWriter, temp: tempWriter };

      case "SymbolValue":
        if (expr.symbol.variant === "Function") {
          outWriter.write(mangleSymbol(expr.symbol));
        } else if (expr.symbol.variant === "Datatype") {
          outWriter.write(mangleSymbol(expr.symbol));
        } else if (expr.symbol.variant === "Variable") {
          outWriter.write(mangleSymbol(expr.symbol));
        } else {
          throw new ImpossibleSituation();
        }
        return { out: outWriter, temp: tempWriter };

      case "ExplicitCast":
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.write(
          explicitConversion(
            expr.expr.type,
            expr.type,
            exprWriter.out.get(),
            this.program.currentScope,
            expr.expr.location,
            this.program,
          ),
        );
        return { out: outWriter, temp: tempWriter };

      case "PreIncr": {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.write("(" + expr.operation + exprWriter.out.get() + ")");
        return { out: outWriter, temp: tempWriter };
      }

      case "PostIncr": {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.write("(" + exprWriter.out.get() + expr.operation + ")");
        return { out: outWriter, temp: tempWriter };
      }

      case "Unary":
        switch (expr.operation) {
          case "!": {
            const exprWriter = this.emitExpr(expr.expr);
            tempWriter.write(exprWriter.temp);
            const unaryExpr = implicitConversion(
              expr.expr.type,
              expr.type,
              exprWriter.out.get(),
              this.program.currentScope,
              expr.expr.location,
              this.program,
            );
            outWriter.write("(!" + unaryExpr + ")");
            break;
          }

          case "+":
          case "-": {
            const exprWriter = this.emitExpr(expr.expr);
            tempWriter.write(exprWriter.temp);
            outWriter.write("(" + expr.operation + exprWriter.out.get() + ")");
            break;
          }
        }
        return { out: outWriter, temp: tempWriter };

      case "Binary":
        switch (expr.operation) {
          case "*":
          case "/":
          case "%":
          case "+":
          case "-": {
            const leftWriter = this.emitExpr(expr.leftExpr);
            const rightWriter = this.emitExpr(expr.rightExpr);
            tempWriter.write(leftWriter.temp);
            tempWriter.write(rightWriter.temp);
            const left = implicitConversion(
              expr.leftExpr.type,
              expr.type,
              leftWriter.out.get(),
              this.program.currentScope,
              expr.leftExpr.location,
              this.program,
            );
            const right = implicitConversion(
              expr.rightExpr.type,
              expr.type,
              rightWriter.out.get(),
              this.program.currentScope,
              expr.rightExpr.location,
              this.program,
            );
            outWriter.write(
              "(" + left + " " + expr.operation + " " + right + ")",
            );
            break;
          }

          case "<":
          case ">":
          case "<=":
          case ">=": {
            const leftWriter = this.emitExpr(expr.leftExpr);
            const rightWriter = this.emitExpr(expr.rightExpr);
            tempWriter.write(leftWriter.temp);
            tempWriter.write(rightWriter.temp);
            outWriter.write(
              "(" +
                leftWriter.out.get() +
                " " +
                expr.operation +
                " " +
                rightWriter.out.get() +
                ")",
            );
            break;
          }

          case "==":
          case "!=": {
            const leftWriter = this.emitExpr(expr.leftExpr);
            const rightWriter = this.emitExpr(expr.rightExpr);
            tempWriter.write(leftWriter.temp);
            tempWriter.write(rightWriter.temp);
            outWriter.write(
              "(" +
                leftWriter.out.get() +
                " " +
                expr.operation +
                " " +
                rightWriter.out.get() +
                ")",
            );
            break;
          }

          case "&&":
          case "||": {
            const leftWriter = this.emitExpr(expr.leftExpr);
            const rightWriter = this.emitExpr(expr.rightExpr);
            tempWriter.write(leftWriter.temp);
            tempWriter.write(rightWriter.temp);
            outWriter.write(
              "(" +
                leftWriter.out.get() +
                " " +
                expr.operation +
                " " +
                rightWriter.out.get() +
                ")",
            );
            break;
          }
        }
        return { out: outWriter, temp: tempWriter };

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
                        location: expr.constantSymbol.location,
                      },
                      ctx: expr.ctx,
                      type: (
                        expr.constantSymbol.type.members[0] as VariableSymbol
                      ).type,
                      location: expr.constantSymbol.location,
                    },
                  ],
                ],
                location: expr.constantSymbol.location,
              };
              const exprWriter = this.emitExpr(durationExpr);
              tempWriter.write(exprWriter.temp);
              outWriter.write(exprWriter.out.get());
            } else {
              outWriter.write(expr.constantSymbol.value.toString());
            }
            return { out: outWriter, temp: tempWriter };

          case "BooleanConstant":
            outWriter.write(expr.constantSymbol.value ? "1" : "0");
            return { out: outWriter, temp: tempWriter };

          case "StringConstant":
            outWriter.write(expr.constantSymbol.value);
            return { out: outWriter, temp: tempWriter };

          // default:
          //   throw new InternalError(
          //     `Unknown constant type ${typeof expr.constantSymbol.value}`,
          //   );
        }

      default:
        throw new InternalError(`Unknown expression type ${expr.variant}`);
    }
  }

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
}

export function generateCode(program: Program, outfile: string) {
  const gen = new CodeGenerator(program);
  gen.generate();
  gen.writeFile(outfile);
}
