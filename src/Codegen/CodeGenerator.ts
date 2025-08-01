import type { Lowered } from "../Lower/LowerTypes";
import {
  BinaryOperationToString,
  EBinaryOperation,
  EIncrOperation,
  EUnaryOperation,
  UnaryOperationToString,
} from "../shared/AST";
import { EPrimitive, EVariableContext, primitiveToString } from "../shared/common";
import { ModuleType, type ModuleConfig } from "../shared/Config";
import { assert, ImpossibleSituation, InternalError, printWarningMessage } from "../shared/Errors";
import { OutputWriter } from "./OutputWriter";

class CodeGenerator {
  private out = {
    includes: new OutputWriter(),
    cDecls: new OutputWriter(),
    type_declarations: new OutputWriter(),
    type_definitions: new OutputWriter(),
    function_declarations: new OutputWriter(),
    function_definitions: new OutputWriter(),
    global_variables: new OutputWriter(),
  };

  constructor(
    public config: ModuleConfig,
    public lr: Lowered.Module,
  ) {
    // const contextSymbol = this.module.globalScope.lookupSymbol(
    //   "Context",
    //   this.module.globalScope.location,
    // );
    // const context = generateUsageCode(contextSymbol.type, this.module);
    // this.out.type_declarations[mangleSymbol(contextSymbol)] = new OutputWriter()
    //   .writeLine(`struct ${context}_;`)
    //   .writeLine(`typedef struct ${context}_ ${context};`);
    if (this.config.moduleType === ModuleType.Executable) {
      this.out.function_definitions
        .writeLine("int32_t main(int argc, const char* argv[]) {")
        .pushIndent();
      //   // .writeLine(
      //   //   `${generateUsageCode(this.module.getBuiltinType("Context"), this.module)} ctx = {};`,
      //   // )
      //   .writeLine(`_HN6Memory5ArenaE defaultArena = {};`)
      //   .writeLine(`ctx.mem.globalDefaultArena = &defaultArena;`);
      // if (!this.module.moduleConfig.nostdlib) {
      //   // this.out.function_declarations["_H13__setupStdlib"].writeLine(
      //   //   `void _H13__setupStdlib(${generateUsageCode(this.module.getBuiltinType("Context"), this.module)}* ctx);`,
      //   // );
      //   this.out.function_definitions.writeLine("_H13__setupStdlib(&ctx);");
      // }
      // this.out.function_definitions.writeLine(
      //   `_H4ListI6StringE argsList = _HN7Process10__loadArgvE(&ctx, argc, (uint8_t**)argv);`,
      // );
      this.out.function_definitions.writeLine("return _H4mainv();").popIndent().writeLine("}");
    }
  }

  includeHeader(filename: string) {
    this.out.includes.writeLine(`#include <${filename}>`);
  }

  writeString() {
    const writer = new OutputWriter();

    writer.writeLine("#define _POSIX_C_SOURCE 199309L\n");

    writer.write("// Include section\n");
    writer.write(this.out.includes);

    writer.write("\n\n// C Injection section\n");
    writer.write(this.out.cDecls);

    writer.write("\n\n// Type declaration section\n");
    writer.write(this.out.type_declarations);
    writer.writeLine();

    writer.write("\n\n// Type definition section\n");
    writer.write(this.out.type_definitions);
    writer.writeLine();

    writer.write("\n\n// Function declaration section\n");
    writer.write(this.out.function_declarations);
    writer.writeLine();

    writer.write("\n\n// Global Variable section\n");
    writer.write(this.out.global_variables);
    writer.writeLine();

    writer.write("\n\n// Function definition section\n");
    writer.write(this.out.function_definitions);
    writer.writeLine();

    return writer.get();
  }

  generate() {
    this.includeHeader("stdint.h");
    this.includeHeader("stdbool.h");

    this.sortTypeDefinitions();

    for (const decl of this.lr.cDeclarations) {
      this.out.cDecls.writeLine(decl);
    }

    for (const [id, symbol] of this.lr.loweredFunctions) {
      this.emitFunction(symbol);
    }

    for (const symbol of this.lr.sortedLoweredTypes) {
      if (symbol.variant === "Primitive") {
        this.out.type_declarations.writeLine(
          `typedef ${this.primitiveToC(symbol.primitive)} ${this.mangle(symbol)};`,
        );
      } else if (symbol.variant === "Struct") {
        if (!symbol.noemit && !symbol.cstruct) {
          this.out.type_declarations.writeLine(
            `typedef struct ${this.mangle(symbol)} ${this.mangle(symbol)};`,
          );
          this.out.type_definitions.writeLine(`struct ${this.mangle(symbol)} {`).pushIndent();
          for (const member of symbol.members) {
            this.out.type_definitions.writeLine(`${this.mangle(member.type)} ${member.name};`);
          }
          this.out.type_definitions.popIndent().writeLine(`};`).writeLine();
        }
      } else if (symbol.variant === "RawPointer") {
        this.out.type_definitions.writeLine(
          `typedef ${this.mangle(symbol.pointee)}* ${this.mangle(symbol)};`,
        );
      } else if (symbol.variant === "Reference") {
        this.out.type_definitions.writeLine(
          `typedef ${this.mangle(symbol.referee)}* ${this.mangle(symbol)};`,
        );
      } else if (symbol.variant === "Function") {
        this.out.type_definitions.writeLine(
          `typedef ${this.mangle(symbol.returnType)} (*${this.mangle(symbol)})(${symbol.parameters
            .map((p) => `${this.mangle(p)}`)
            .join(", ")});`,
        );
      } else if (symbol.variant === "Callable") {
        this.out.type_declarations.writeLine(
          `typedef struct ${this.mangle(symbol)} ${this.mangle(symbol)};`,
        );
        this.out.type_definitions.writeLine(`struct ${this.mangle(symbol)} {`).pushIndent();
        if (symbol.thisExprType) {
          this.out.type_definitions.writeLine(`${this.mangle(symbol.thisExprType)} thisPtr;`);
        }
        this.out.type_definitions.writeLine(`${this.mangle(symbol.functionType)} fn;`);
        this.out.type_definitions.popIndent().writeLine(`};`).writeLine();
      } else {
      }
    }

    for (const [id, symbol] of this.lr.loweredGlobalVariables) {
      // TODO
    }
  }

  sortTypeDefinitions() {
    const appliedTypes = new Set<Lowered.Datatype>();

    // This function processes the type in the sense that it goes over all types that this type depends on,
    // and if there is a direct relationship, then that type is processed, which sorts it first.
    const processType = (type: Lowered.Datatype) => {
      if (appliedTypes.has(type)) {
        return;
      }

      if (type.variant === "Function") {
        appliedTypes.add(type);
        for (const p of type.parameters) {
          processType(p);
        }
        processType(type.returnType);
        this.lr.sortedLoweredTypes.push(type);
      } else if (type.variant === "Callable") {
        appliedTypes.add(type);
        processType(type.functionType);
        this.lr.sortedLoweredTypes.push(type);
      } else if (type.variant === "Struct") {
        appliedTypes.add(type);
        for (const m of type.members) {
          // Pointer do not matter, only direct references are bad.
          if (m.type.variant !== "RawPointer" && m.type.variant !== "Reference") {
            processType(m.type);
          }
        }
        this.lr.sortedLoweredTypes.push(type);
      } else if (type.variant === "Primitive") {
        appliedTypes.add(type);
        this.lr.sortedLoweredTypes.push(type);
      } else if (type.variant === "RawPointer") {
        appliedTypes.add(type);
        processType(type.pointee);
        this.lr.sortedLoweredTypes.push(type);
      } else if (type.variant === "Reference") {
        appliedTypes.add(type);
        processType(type.referee);
        this.lr.sortedLoweredTypes.push(type);
      } else {
        assert(false);
      }
    };

    // Now define all other types
    for (const [id, t] of this.lr.loweredTypes) {
      processType(t);
    }
  }

  primitiveToC(primitive: EPrimitive) {
    switch (primitive) {
      case EPrimitive.boolean:
        return "bool";
      case EPrimitive.f32:
        return "float";
      case EPrimitive.f64:
        return "double";
      case EPrimitive.i16:
        return "int16_t";
      case EPrimitive.i32:
        return "int32_t";
      case EPrimitive.i64:
        return "int64_t";
      case EPrimitive.i8:
        return "int8_t";
      case EPrimitive.u16:
        return "uint16_t";
      case EPrimitive.u32:
        return "uint32_t";
      case EPrimitive.u64:
        return "uint64_t";
      case EPrimitive.u8:
        return "uint8_t";
      case EPrimitive.none:
        return "void";
      case EPrimitive.str:
        return "const char*";
    }
  }

  mangle(
    datatypeOrSymbol:
      | Lowered.Datatype
      | Lowered.FunctionDeclaration
      | Lowered.FunctionDefinition
      | Lowered.VariableStatement
      | Lowered.SymbolValueExpr
      | Lowered.CallableExpr,
  ) {
    if (datatypeOrSymbol.variant === "CallableExpr") {
      return "_H" + datatypeOrSymbol.functionMangledName;
    }
    if (datatypeOrSymbol.wasMangled) {
      return "_H" + datatypeOrSymbol.mangledName;
    } else {
      return datatypeOrSymbol.mangledName;
    }
  }

  emitSymbol(symbol: Lowered.FunctionDeclaration | Lowered.FunctionDefinition) {}

  emitFunction(symbol: Lowered.FunctionDeclaration | Lowered.FunctionDefinition) {
    let signature = this.mangle(symbol.type.returnType) + " " + this.mangle(symbol) + "(";
    signature += symbol.type.parameters
      .map((p, i) => `${this.mangle(p)} ${symbol.parameterNames[i]}`)
      .join(", ");
    if (symbol.type.vararg) {
      signature += ", ...";
    }
    signature += ")";

    this.out.function_declarations.writeLine(signature + ";");

    if (symbol.variant === "FunctionDefinition") {
      this.out.function_definitions.writeLine(signature + " {").pushIndent();

      const s = this.emitScope(symbol.scope);
      this.out.function_definitions.write(s.temp);
      this.out.function_definitions.write(s.out);

      this.out.function_definitions.popIndent().writeLine("}").writeLine();
    }
  }

  emitScope(scope: Lowered.Scope): { temp: OutputWriter; out: OutputWriter } {
    const tempWriter = new OutputWriter();
    const outWriter = new OutputWriter();

    let returned = false;
    for (const statement of scope.statements) {
      if (returned) {
        printWarningMessage(`Dead code detected and stripped`, statement.sourceloc);
        break;
      }

      if (statement.variant === "ReturnStatement") {
        returned = true;
      }

      const s = this.emitStatement(statement);
      tempWriter.write(s.temp);
      outWriter.write(s.out);
    }

    return { temp: tempWriter, out: outWriter };
  }

  emitStatement(statement: Lowered.Statement): {
    temp: OutputWriter;
    out: OutputWriter;
  } {
    const tempWriter = new OutputWriter();
    const outWriter = new OutputWriter();
    switch (statement.variant) {
      case "ReturnStatement": {
        if (statement.sourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.line} ${JSON.stringify(statement.sourceloc.filename)}`,
          );
        }
        if (statement.expr) {
          const exprWriter = this.emitExpr(statement.expr);
          tempWriter.write(exprWriter.temp);
          outWriter.writeLine(`return ` + exprWriter.out.get() + ";");
        } else {
          outWriter.writeLine("return;");
        }
        return { temp: tempWriter, out: outWriter };
      }

      case "VariableStatement": {
        if (statement.sourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.line} ${JSON.stringify(statement.sourceloc.filename)}`,
          );
        }
        outWriter.write(`${this.mangle(statement.type)} ${this.mangle(statement)}`);

        if (statement.value) {
          const exprWriter = this.emitExpr(statement.value);
          tempWriter.write(exprWriter.temp);
          outWriter.writeLine(` = ${exprWriter.out.get()};`);
        } else {
          if (statement.type.variant === "Struct" && statement.type.members.length === 0) {
            outWriter.writeLine(`;`);
          } else {
            outWriter.writeLine(` = {0};`);
          }
        }
        return { temp: tempWriter, out: outWriter };
      }

      case "ExprStatement": {
        if (statement.sourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.line} ${JSON.stringify(statement.sourceloc.filename)}`,
          );
        }
        const exprWriter = this.emitExpr(statement.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.writeLine(`(void)(${exprWriter.out.get()});`);
        return { temp: tempWriter, out: outWriter };
      }

      case "InlineCStatement": {
        if (statement.sourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.line} ${JSON.stringify(statement.sourceloc.filename)}`,
          );
        }
        outWriter.writeLine(statement.value);
        return { temp: tempWriter, out: outWriter };
      }

      case "WhileStatement": {
        if (statement.sourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.line} ${JSON.stringify(statement.sourceloc.filename)}`,
          );
        }
        const exprWriter = this.emitExpr(statement.condition);
        tempWriter.write(exprWriter.temp);
        outWriter.writeLine(`while (${exprWriter.out.get()}) {`).pushIndent();
        const scope = this.emitScope(statement.then);
        tempWriter.write(scope.temp);
        outWriter.write(scope.out);
        outWriter.popIndent().writeLine("}");
        return { temp: tempWriter, out: outWriter };
      }

      case "IfStatement": {
        if (statement.sourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.line} ${JSON.stringify(statement.sourceloc.filename)}`,
          );
        }
        const exprWriter = this.emitExpr(statement.condition);
        tempWriter.write(exprWriter.temp);
        outWriter.writeLine(`if (${exprWriter.out.get()}) {`).pushIndent();
        const scope = this.emitScope(statement.then);
        tempWriter.write(scope.temp);
        outWriter.write(scope.out);
        outWriter.popIndent().writeLine("}");
        for (const elseif of statement.elseIfs) {
          const exprWriter = this.emitExpr(elseif.condition);
          tempWriter.write(exprWriter.temp);
          outWriter.writeLine(`else if (${exprWriter.out.get()}) {`).pushIndent();
          const s = this.emitScope(elseif.then);
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

      default:
        throw new InternalError(`Unknown statement type: `);
    }
  }

  emitExpr(expr: Lowered.Expression): { temp: OutputWriter; out: OutputWriter } {
    if (!expr) {
      throw new InternalError("Expr is null", undefined, 1);
    }
    const tempWriter = new OutputWriter();
    const outWriter = new OutputWriter();
    switch (expr.variant) {
      case "ExprCallExpr":
        const args = expr.arguments.map((a) => {
          const r = this.emitExpr(a);
          tempWriter.write(r.temp);
          return r.out.get();
        });
        const callExprWriter = this.emitExpr(expr.expr);
        tempWriter.write(callExprWriter.temp);
        // const funcname = this.mangleNestedName(this.lr.functions.get(expr.functionSymbol)!);
        // outWriter.write(`_H${funcname}`);
        outWriter.write(callExprWriter.out.get() + "(" + args.join(", ") + ")");

        return { out: outWriter, temp: tempWriter };

      case "StructInstantiation": {
        outWriter.writeLine(`((${this.mangle(expr.type)}) { `).pushIndent();
        for (const assign of expr.memberAssigns) {
          const exprWriter = this.emitExpr(assign.value);
          tempWriter.write(exprWriter.temp);
          outWriter.writeLine(`.${assign.name} = ${exprWriter.out.get()}, `);
        }
        outWriter.popIndent().write(" })");
        return { out: outWriter, temp: tempWriter };
      }

      case "ExprMemberAccess": {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        if (expr.isReference) {
          outWriter.write("(" + exprWriter.out.get() + ")->" + expr.memberName);
        } else {
          outWriter.write("(" + exprWriter.out.get() + ")." + expr.memberName);
        }
        return { out: outWriter, temp: tempWriter };
      }

      case "SymbolValue": {
        outWriter.write(this.mangle(expr));
        return { out: outWriter, temp: tempWriter };
      }

      case "ExplicitCast":
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.write(`((${this.mangle(expr.type)})${exprWriter.out.get()})`);
        return { out: outWriter, temp: tempWriter };

      case "PreIncrExpr": {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.write(
          "(" + (expr.operation === EIncrOperation.Incr ? "++" : "--") + exprWriter.out.get() + ")",
        );
        return { out: outWriter, temp: tempWriter };
      }

      case "PostIncrExpr": {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.write(
          "(" + exprWriter.out.get() + (expr.operation === EIncrOperation.Incr ? "++" : "--") + ")",
        );
        return { out: outWriter, temp: tempWriter };
      }

      case "UnaryExpr":
        switch (expr.operation) {
          case EUnaryOperation.Minus:
          case EUnaryOperation.Plus:
          case EUnaryOperation.Negate: {
            const writer = this.emitExpr(expr.expr);
            tempWriter.write(writer.temp);
            outWriter.write(
              "(" + UnaryOperationToString(expr.operation) + "(" + writer.out.get() + "))",
            );
            break;
          }
          default:
            assert(false);
        }
        return { out: outWriter, temp: tempWriter };

      case "BinaryExpr":
        switch (expr.operation) {
          case EBinaryOperation.Multiply:
          case EBinaryOperation.Divide:
          case EBinaryOperation.Modulo:
          case EBinaryOperation.Add:
          case EBinaryOperation.Subtract: {
            const leftWriter = this.emitExpr(expr.left);
            const rightWriter = this.emitExpr(expr.right);
            tempWriter.write(leftWriter.temp);
            tempWriter.write(rightWriter.temp);
            outWriter.write(
              "(" +
                leftWriter.out.get() +
                " " +
                BinaryOperationToString(expr.operation) +
                " " +
                rightWriter.out.get() +
                ")",
            );
            break;
          }

          case EBinaryOperation.LessEqual:
          case EBinaryOperation.LessThan:
          case EBinaryOperation.GreaterEqual:
          case EBinaryOperation.GreaterThan: {
            const leftWriter = this.emitExpr(expr.left);
            const rightWriter = this.emitExpr(expr.right);
            tempWriter.write(leftWriter.temp);
            tempWriter.write(rightWriter.temp);
            outWriter.write(
              "(" +
                leftWriter.out.get() +
                " " +
                BinaryOperationToString(expr.operation) +
                " " +
                rightWriter.out.get() +
                ")",
            );
            break;
          }

          case EBinaryOperation.Equal:
          case EBinaryOperation.Unequal: {
            const leftWriter = this.emitExpr(expr.left);
            const rightWriter = this.emitExpr(expr.right);
            tempWriter.write(leftWriter.temp);
            tempWriter.write(rightWriter.temp);
            outWriter.write(
              "(" +
                leftWriter.out.get() +
                " " +
                BinaryOperationToString(expr.operation) +
                " " +
                rightWriter.out.get() +
                ")",
            );
            break;
          }

          case EBinaryOperation.BoolAnd:
          case EBinaryOperation.BoolOr: {
            const leftWriter = this.emitExpr(expr.left);
            const rightWriter = this.emitExpr(expr.right);
            tempWriter.write(leftWriter.temp);
            tempWriter.write(rightWriter.temp);
            outWriter.write(
              "(" +
                leftWriter.out.get() +
                " " +
                BinaryOperationToString(expr.operation) +
                " " +
                rightWriter.out.get() +
                ")",
            );
            break;
          }
        }
        return { out: outWriter, temp: tempWriter };

      case "CallableExpr": {
        const thisExpr = this.emitExpr(expr.thisExpr);
        tempWriter.write(thisExpr.temp);
        outWriter.write(
          `((${this.mangle(expr.type)}) { .thisPtr = ${thisExpr.out.get()}, .fn = ${this.mangle(expr)} })`,
        );
        return { out: outWriter, temp: tempWriter };
      }

      case "RawPointerAddressOf": {
        const e = this.emitExpr(expr.expr);
        tempWriter.write(e.temp);
        outWriter.write("&" + e.out.get());
        return { out: outWriter, temp: tempWriter };
      }

      case "RawPointerDereference": {
        const e = this.emitExpr(expr.expr);
        tempWriter.write(e.temp);
        outWriter.write("*" + e.out.get());
        return { out: outWriter, temp: tempWriter };
      }

      case "Sizeof": {
        if (expr.value) {
          const e = this.emitExpr(expr.value);
          tempWriter.write(e.temp);
          outWriter.write("sizeof(" + e.out.get() + ")");
          return { out: outWriter, temp: tempWriter };
        } else {
          assert(expr.datatype);
          outWriter.write("sizeof(_H" + expr.datatype.mangledName + ")");
          return { out: outWriter, temp: tempWriter };
        }
      }

      case "ExprAssignmentExpr": {
        const target = this.emitExpr(expr.target);
        const value = this.emitExpr(expr.value);
        tempWriter.write(target.temp);
        tempWriter.write(value.temp);
        outWriter.write(target.out.get() + " = " + value.out.get());
        return { out: outWriter, temp: tempWriter };
      }

      case "ConstantExpr":
        if (typeof expr.value === "string") {
          outWriter.write(JSON.stringify(expr.value));
        } else if (typeof expr.value === "boolean") {
          outWriter.write(expr.value ? "1" : "0");
        } else {
          outWriter.write(expr.value.toString());
        }
        return { out: outWriter, temp: tempWriter };
      // switch (expr.) {
      //   case "LiteralConstant":
      //     if (expr.constantSymbol.unit) {
      //       let value = 0;
      //       switch (expr.constantSymbol.unit) {
      //         case "ns":
      //           value = expr.constantSymbol.value;
      //           break;

      //         case "us":
      //           value = expr.constantSymbol.value * 1000;
      //           break;

      //         case "ms":
      //           value = expr.constantSymbol.value * 1000 * 1000;
      //           break;

      //         case "s":
      //           value = expr.constantSymbol.value * 1000 * 1000 * 1000;
      //           break;

      //         case "m":
      //           value = expr.constantSymbol.value * 60 * 1000 * 1000 * 1000;
      //           break;

      //         case "h":
      //           value = expr.constantSymbol.value * 3600 * 1000 * 1000 * 1000;
      //           break;

      //         case "d":
      //           value = expr.constantSymbol.value * 24 * 3600 * 1000 * 1000 * 1000;
      //           break;

      //         default:
      //           throw new InternalError(`Unknown unit ${expr.constantSymbol.unit}`);
      //       }
      //       if (expr.constantSymbol.type.variant !== "Struct") {
      //         throw new ImpossibleSituation();
      //       }
      //       const durationExpr: ObjectExpression = {
      //         variant: "Object",
      //         type: expr.constantSymbol.type,
      //         ctx: expr.ctx,
      //         members: [
      //           [
      //             expr.constantSymbol.type.members[0] as VariableSymbol,
      //             {
      //               variant: "Constant",
      //               constantSymbol: {
      //                 variant: "LiteralConstant",
      //                 type: (expr.constantSymbol.type.members[0] as VariableSymbol).type,
      //                 value: value,
      //                 location: expr.constantSymbol.location,
      //               },
      //               ctx: expr.ctx,
      //               type: (expr.constantSymbol.type.members[0] as VariableSymbol).type,
      //               location: expr.constantSymbol.location,
      //             },
      //           ],
      //         ],
      //         location: expr.constantSymbol.location,
      //       };
      //       const exprWriter = this.emitExpr(durationExpr);
      //       tempWriter.write(exprWriter.temp);
      //       outWriter.write(exprWriter.out.get());
      //     } else {
      //       outWriter.write(expr.constantSymbol.value.toString());
      //     }
      //     return { out: outWriter, temp: tempWriter };

      //   case "BooleanConstant":
      //     outWriter.write(expr.constantSymbol.value ? "1" : "0");
      //     return { out: outWriter, temp: tempWriter };

      //   case "StringConstant":
      //     outWriter.write(expr.constantSymbol.value);
      //     return { out: outWriter, temp: tempWriter };

      // default:
      //   throw new InternalError(
      //     `Unknown constant type ${typeof expr.constantSymbol.value}`,
      //   );
      // }

      default:
        assert(false && "All cases handled");
    }
  }

  //   generateDatatypeUse(datatype: DatatypeSymbol) {
  //     if (!this.out.type_declarations[mangleSymbol(datatype)]) {
  //       this.init(mangleSymbol(datatype), this.out.type_declarations);
  //       this.out.type_declarations[mangleSymbol(datatype)].write(
  //         generateDeclarationCCode(datatype, this.module),
  //       );
  //     }
  //     if (!this.out.type_definitions[mangleSymbol(datatype)]) {
  //       this.init(mangleSymbol(datatype), this.out.type_definitions);
  //       this.out.type_definitions[mangleSymbol(datatype)].write(
  //         generateDefinitionCCode(datatype, this.module),
  //       );
  //     }
  //   }
}

export function generateCode(config: ModuleConfig, lr: Lowered.Module): string {
  const gen = new CodeGenerator(config, lr);
  gen.generate();
  return gen.writeString();
}
