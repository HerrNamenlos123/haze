import type { Lowered } from "../Lower/LowerTypes";
import type { Module } from "../Module";
import type { Semantic } from "../Semantic/SemanticSymbols";
import { BinaryOperationToString, EBinaryOperation } from "../shared/AST";
import { EPrimitive, EVariableContext, primitiveToString } from "../shared/common";
import { ModuleType } from "../shared/Config";
import { ImpossibleSituation, InternalError, printWarningMessage } from "../shared/Errors";
import { makeTempName, type LoweredTypeId } from "../shared/store";
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
    public module: Module,
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
    if (this.module.moduleConfig.moduleType === ModuleType.Executable) {
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

  getType(id: LoweredTypeId) {
    const type = this.lr.datatypes.get(id);
    if (!type) {
      throw new InternalError("Type with id " + id + " does not exist", undefined, 1);
    }
    return type;
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

    for (const decl of this.lr.cDeclarations) {
      this.out.cDecls.writeLine(decl);
    }

    for (const [id, symbol] of this.lr.functions) {
      this.emitFunction(symbol);
    }

    for (const [id, symbol] of this.lr.datatypes) {
      if (symbol.variant === "Namespace") {
      } else if (symbol.variant === "Primitive") {
        this.out.type_declarations.writeLine(
          `typedef ${this.primitiveToC(symbol.primitive)} _H${this.emitDatatype(symbol)};`,
        );
      } else if (symbol.variant === "Struct") {
        const dt = this.emitDatatype(symbol);
        this.out.type_declarations.writeLine(`typedef struct _H${dt} _H${dt};`);
        this.out.type_definitions.writeLine(`struct _H${dt} {`).pushIndent();
        for (const member of symbol.members) {
          this.out.type_definitions.writeLine(
            `_H${this.emitDatatype(member.type)} ${member.name};`,
          );
        }
        this.out.type_definitions.popIndent().writeLine(`};`).writeLine();
      } else if (symbol.variant === "RawPointer") {
        this.out.type_declarations.writeLine(
          `typedef _H${this.emitDatatype(symbol.pointee)}* _H${this.emitDatatype(symbol)};`,
        );
      } else if (symbol.variant === "Reference") {
        this.out.type_declarations.writeLine(
          `typedef _H${this.emitDatatype(symbol.referee)}* _H${this.emitDatatype(symbol)};`,
        );
      } else if (symbol.variant === "Function") {
        this.out.type_declarations.writeLine(
          `typedef _H${this.emitDatatype(symbol.returnType)} (*_H${this.emitDatatype(symbol)})(${symbol.parameters
            .map((p) => `_H${this.emitDatatype(p.type)} ${p.name}`)
            .join(", ")});`,
        );
      } else if (symbol.variant === "Callable") {
        const dt = this.emitDatatype(symbol);
        this.out.type_declarations.writeLine(`typedef struct _H${dt} _H${dt};`);
        this.out.type_definitions.writeLine(`struct _H${dt} {`).pushIndent();
        this.out.type_definitions.writeLine(`void* thisPtr;`);
        this.out.type_definitions.writeLine(`_H${this.emitDatatype(symbol.functionType)} fn;`);
        this.out.type_definitions.popIndent().writeLine(`};`).writeLine();
      } else {
      }
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

  mangleNestedName(
    symbol:
      | Lowered.StructDatatype
      | Lowered.NamespaceDatatype
      | Lowered.FunctionDeclaration
      | Lowered.FunctionDefinition,
  ) {
    const fragments: string[] = [];
    let p:
      | Lowered.StructDatatype
      | Lowered.NamespaceDatatype
      | Lowered.FunctionDeclaration
      | Lowered.FunctionDefinition
      | undefined = symbol;
    while (p) {
      if (p.variant !== "Struct") {
        fragments.push(p.name.length + p.name);
      } else {
        let generics = "";
        if (p.generics.length > 0) {
          generics += "I";
          for (const g of p.generics) {
            generics += this.emitDatatype(this.getType(g));
          }
          generics += "E";
        }
        fragments.push(p.name.length + p.name + generics);
      }
      const pParent: Lowered.Datatype | undefined = p.parent && this.getType(p.parent);
      if (pParent) {
        if (pParent.variant !== "Struct" && pParent.variant !== "Namespace") {
          throw new ImpossibleSituation();
        }
      }
      p = pParent;
    }
    fragments.reverse();
    let functionPart = "";
    if (symbol.variant === "FunctionDeclaration" || symbol.variant === "FunctionDefinition") {
      const ftype = this.getType(symbol.type);
      if (ftype.variant !== "Function") throw new ImpossibleSituation();
      if (ftype.parameters.length === 0) {
        functionPart += "v";
      } else {
        for (const p of ftype.parameters) {
          functionPart += this.emitDatatype(this.getType(p.type));
        }
      }
    }
    if (fragments.length > 1) {
      return "N" + fragments.join("") + "E" + functionPart;
    } else {
      return fragments[0] + functionPart;
    }
  }

  emitDatatype(idOrType: LoweredTypeId | Lowered.Datatype): string {
    const type = typeof idOrType === "bigint" ? this.getType(idOrType) : idOrType;
    if (!type) throw new InternalError("Type not found: " + idOrType, undefined, 1);
    switch (type.variant) {
      case "Struct": {
        return this.mangleNestedName(type);
      }

      case "Callable": {
        const name = "Callable";
        return (
          name.length +
          name +
          "I" +
          this.emitDatatype(type.thisExprType) +
          "E" +
          this.emitDatatype(type.functionType)
        );
      }

      case "Namespace":
        throw new InternalError("Emitting a namespace is a mistake");

      case "Primitive": {
        const name = primitiveToString(type.primitive);
        return name.length + name;
      }

      case "Function": {
        return (
          "F" +
          type.parameters.map((p) => this.emitDatatype(p.type)).join("") +
          "E" +
          this.emitDatatype(type.returnType)
        );
      }

      case "RawPointer": {
        return "P" + this.emitDatatype(type.pointee);
      }

      case "Reference": {
        return "R" + this.emitDatatype(type.referee);
      }

      default:
        throw new InternalError("Unhandled variant: ");
    }
  }

  emitSymbol(symbol: Lowered.FunctionDeclaration | Lowered.FunctionDefinition) {}

  emitFunction(symbol: Lowered.FunctionDeclaration | Lowered.FunctionDefinition) {
    const declaration = (type: Lowered.Datatype): string => {
      if (type.variant !== "Function") throw new ImpossibleSituation();
      let decl =
        "_H" +
        this.emitDatatype(type.returnType) +
        " " +
        "_H" +
        this.mangleNestedName(symbol) +
        "(";
      decl += type.parameters.map((p) => `_H${this.emitDatatype(p.type)} ${p.name}`).join(", ");
      if (type.vararg) {
        decl += ", ...";
      }
      decl += ")";
      return decl;
    };

    const decl = declaration(this.getType(symbol.type));
    this.out.function_declarations.writeLine(decl + ";");

    if (symbol.variant === "FunctionDefinition") {
      this.out.function_definitions.writeLine(decl + " {").pushIndent();

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
        const type = this.emitDatatype(statement.type);

        // if (statement.symbol.extern !== ELinkage.Internal) {
        //   outWriter.write("extern ");
        // }

        // if (statement.symbol.extern === ELinkage.External_C) {
        // outWriter.write(`${ret} ${statement.symbol.name}`);
        // } else {
        if (statement.variableContext === EVariableContext.Global) {
          outWriter.write(`_H${type} _H${statement.name.length}${statement.name}`);
        } else {
          outWriter.write(`_H${type} ${statement.name}`);
        }
        // }

        if (statement.value) {
          const exprWriter = this.emitExpr(statement.value);
          tempWriter.write(exprWriter.temp);
          outWriter.writeLine(` = ${exprWriter.out.get()};`);
        } else {
          outWriter.writeLine(` = {0};`);
        }
        return { temp: tempWriter, out: outWriter };
      }

      // case "VariableDefinition": {
      //   if (!statement.expr || !statement.symbol.type || statement.symbol.variant !== "Variable") {
      //     throw new ImpossibleSituation();
      //   }
      //   tempWriter.write(exprWriter.temp);
      //   const assignConv = implicitConversion(
      //     statement.expr.type,
      //     statement.symbol.type,
      //     exprWriter.out.get(),
      //     this.module.currentScope,
      //     statement.expr.location,
      //     this.module,
      //   );
      //   const name =
      //     statement.symbol.extern === ELinkage.External_C
      //       ? statement.symbol.name
      //       : mangleSymbol(statement.symbol);
      //   outWriter.writeLine(`${ret} ${name} = ${assignConv};`);
      //   return { temp: tempWriter, out: outWriter };
      // }

      case "ExprStatement": {
        const exprWriter = this.emitExpr(statement.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.writeLine(`(void)(${exprWriter.out.get()});`);
        return { temp: tempWriter, out: outWriter };
      }

      case "InlineCStatement": {
        outWriter.writeLine(statement.value + ";");
        return { temp: tempWriter, out: outWriter };
      }

      case "WhileStatement": {
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
        const exprEmitted = this.emitExpr(expr.expr);
        if (expr.expr.variant === "Callable") {
          const callableType = this.lr.datatypes.get(expr.expr.type)!;
          if (callableType.variant !== "Callable") throw new ImpossibleSituation();

          if (expr.expr.thisExpr) {
            const callableTempName = makeTempName();
            tempWriter.writeLine(
              `_H${this.emitDatatype(expr.expr.type)} ${callableTempName} = {0};`,
            );
            args.unshift(
              `(_H${this.emitDatatype(callableType.thisExprType)})${callableTempName}.thisPtr`,
            );
            outWriter.write(
              `(${callableTempName} = ${exprEmitted.out.get()}, ${callableTempName}.fn)(${args.join(", ")})`,
            );
          }
        } else {
          const callExprWriter = this.emitExpr(expr.expr);
          tempWriter.write(callExprWriter.temp);
          // const funcname = this.mangleNestedName(this.lr.functions.get(expr.functionSymbol)!);
          // outWriter.write(`_H${funcname}`);
          outWriter.write(callExprWriter.out.get() + "(" + expr.arguments.join(", ") + ")");
        }

        return { out: outWriter, temp: tempWriter };

      //   case "ExprAssign": {
      //     const leftWriter = this.emitExpr(expr.leftExpr);
      //     const rightWriter = this.emitExpr(expr.rightExpr);
      //     tempWriter.write(leftWriter.temp);
      //     tempWriter.write(rightWriter.temp);
      //     const assignConv = implicitConversion(
      //       expr.rightExpr.type,
      //       expr.leftExpr.type,
      //       rightWriter.out.get(),
      //       this.module.currentScope,
      //       expr.rightExpr.location,
      //       this.module,
      //     );
      //     outWriter.write(`(${leftWriter.out.get()} ${expr.operation} ${assignConv})`);
      //     return { out: outWriter, temp: tempWriter };
      //   }

      case "StructInstantiation": {
        outWriter.writeLine(`((_H${this.emitDatatype(expr.type)}) { `).pushIndent();
        for (const assign of expr.memberAssigns) {
          const exprWriter = this.emitExpr(assign.value);
          tempWriter.write(exprWriter.temp);
          outWriter.writeLine(`.${assign.name} = ${exprWriter.out.get()}, `);
        }
        outWriter.popIndent().write(" })");
        return { out: outWriter, temp: tempWriter };
      }

      //   case "RawPtrDeref": {
      //     const exprWriter = this.emitExpr(expr.expr);
      //     tempWriter.write(exprWriter.temp);
      //     outWriter.write(`(*(${exprWriter.out.get()}))`);
      //     return { out: outWriter, temp: tempWriter };
      //   }

      case "ExprMemberAccess": {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.write(exprWriter.out.get() + "." + expr.memberName);
        return { out: outWriter, temp: tempWriter };
      }

      //   case "Sizeof":
      //     outWriter.write(`sizeof(${generateUsageCode(expr.datatype, this.module)})`);
      //     return { out: outWriter, temp: tempWriter };

      case "SymbolValue":
        outWriter.write(expr.name);
        // if (expr.variant === "Function") {
        //   if (expr.symbol.extern === ELinkage.External_C) {
        //     outWriter.write(expr.symbol.name);
        //   } else {
        //     outWriter.write(mangleSymbol(expr.symbol));
        //   }
        // } else if (expr.symbol.variant === "Datatype") {
        //   outWriter.write(mangleSymbol(expr.symbol));
        // } else if (expr.symbol.variant === "Variable") {
        //   if (expr.symbol.extern === ELinkage.External_C) {
        //     outWriter.write(expr.symbol.name);
        //   } else {
        //     outWriter.write(mangleSymbol(expr.symbol));
        //   }
        // } else {
        //   throw new ImpossibleSituation();
        // }
        return { out: outWriter, temp: tempWriter };

      //   case "ExplicitCast":
      //     const exprWriter = this.emitExpr(expr.expr);
      //     tempWriter.write(exprWriter.temp);
      //     outWriter.write(
      //       explicitConversion(
      //         expr.expr.type,
      //         expr.type,
      //         exprWriter.out.get(),
      //         this.module.currentScope,
      //         expr.expr.location,
      //         this.module,
      //       ),
      //     );
      //     return { out: outWriter, temp: tempWriter };

      //   case "PreIncr": {
      //     const exprWriter = this.emitExpr(expr.expr);
      //     tempWriter.write(exprWriter.temp);
      //     outWriter.write("(" + expr.operation + exprWriter.out.get() + ")");
      //     return { out: outWriter, temp: tempWriter };
      //   }

      //   case "PostIncr": {
      //     const exprWriter = this.emitExpr(expr.expr);
      //     tempWriter.write(exprWriter.temp);
      //     outWriter.write("(" + exprWriter.out.get() + expr.operation + ")");
      //     return { out: outWriter, temp: tempWriter };
      //   }

      // case "Unary":
      //   switch (expr.operation) {
      //     case "!": {
      //       const exprWriter = this.emitExpr(expr.expr);
      //       tempWriter.write(exprWriter.temp);
      //       const unaryExpr = implicitConversion(
      //         expr.expr.type,
      //         expr.type,
      //         exprWriter.out.get(),
      //         this.module.currentScope,
      //         expr.expr.location,
      //         this.module,
      //       );
      //       outWriter.write("(!" + unaryExpr + ")");
      //       break;
      //     }

      //     case "+":
      //     case "-": {
      //       const exprWriter = this.emitExpr(expr.expr);
      //       tempWriter.write(exprWriter.temp);
      //       outWriter.write("(" + expr.operation + exprWriter.out.get() + ")");
      //       break;
      //     }
      //   }
      //   return { out: outWriter, temp: tempWriter };

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

      case "Callable":
        // if (expr.thisExpr) {
        //   const funcname = this.mangleNestedName(this.lr.functions.get(expr.functionSymbol)!);
        //   outWriter.write(`_H${funcname}`);
        // } else {
        //   const funcname = this.mangleNestedName(this.lr.functions.get(expr.functionSymbol)!);
        //   outWriter.write(`_H${funcname}`);
        // }
        const thisExpr = this.emitExpr(expr.thisExpr);
        tempWriter.write(thisExpr.temp);
        outWriter.write(
          `((_H${this.emitDatatype(expr.type)}) { .thisPtr = (void*)(&${thisExpr.out.get()}), .fn = _H${this.mangleNestedName(this.lr.functions.get(expr.functionSymbol)!)} })`,
        );
        return { out: outWriter, temp: tempWriter };

      case "ConstantExpr":
        if (typeof expr.value === "string") {
          outWriter.write('"' + expr.value + '"');
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
        throw new InternalError(`Unknown expression type ${expr.variant}`);
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

export function generateCode(module: Module, lr: Lowered.Module): string {
  const gen = new CodeGenerator(module, lr);
  gen.generate();
  return gen.writeString();
}
