import { Lowered } from "../Lower/Lower";
import { Conversion } from "../Semantic/Conversion";
import {
  BinaryOperationToString,
  EBinaryOperation,
  EDatatypeMutability,
  EIncrOperation,
  EUnaryOperation,
  UnaryOperationToString,
} from "../shared/AST";
import { EPrimitive, type NameSet } from "../shared/common";
import { getModuleGlobalNamespaceName, ModuleType, type ModuleConfig } from "../shared/Config";
import { assert, InternalError, printWarningMessage } from "../shared/Errors";
import { OutputWriter } from "./OutputWriter";

class CodeGenerator {
  private out = {
    includes: new OutputWriter(),
    cDecls: new OutputWriter(),
    type_declarations: new OutputWriter(),
    type_definitions: new OutputWriter(),
    function_declarations: new OutputWriter(),
    function_definitions: new OutputWriter(),
    builtin_declarations: new OutputWriter(),
    builtin_definitions: new OutputWriter(),
    global_variables: new OutputWriter(),
  };

  private arithmeticFunctionsCache = new Map<EBinaryOperation, Map<Lowered.TypeUseId, string>>();
  private incrFunctionsCache = new Map<EIncrOperation, Map<Lowered.TypeUseId, string>>();
  private trapFunctionCache: string | undefined;

  constructor(public config: ModuleConfig, public lr: Lowered.Module) {
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
      const ns = getModuleGlobalNamespaceName(config.name, config.version);
      this.out.function_definitions
        .writeLine(`return _HN${ns.length}${ns}4mainEv();`)
        .popIndent()
        .writeLine("}");
    }
  }

  includeHeader(filename: string) {
    this.out.includes.writeLine(`#include <${filename}>`);
  }

  writeString() {
    const writer = new OutputWriter();

    writer.writeLine("#define _POSIX_C_SOURCE 199309L\n");
    writer.writeLine("#define _GNU_SOURCE\n");

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

    writer.write("\n\n// Arithmetic Function declaration section\n");
    writer.write(this.out.builtin_declarations);
    writer.writeLine();

    writer.write("\n\n// Global Variable section\n");
    writer.write(this.out.global_variables);
    writer.writeLine();

    writer.write("\n\n// Function definition section\n");
    writer.write(this.out.function_definitions);
    writer.writeLine();

    writer.write("\n\n// Arithmetic Function definition section\n");
    writer.write(this.out.builtin_definitions);
    writer.writeLine();

    return writer.get();
  }

  generate() {
    this.includeHeader("stdint.h");
    this.includeHeader("stdio.h");
    this.includeHeader("stdbool.h");
    this.includeHeader("stdlib.h");
    this.includeHeader("limits.h");
    this.includeHeader("string.h");

    const sortedLoweredTypeDefs: (Lowered.TypeDef | Lowered.TypeUse)[] = [];

    this.sortTypeDefs(sortedLoweredTypeDefs);

    for (const decl of this.lr.cInjections) {
      this.out.cDecls.writeLine(decl);
    }

    for (const [id, symbol] of this.lr.loweredFunctions) {
      this.emitFunction(symbol);
    }

    for (const symbol of sortedLoweredTypeDefs) {
      if (symbol.variant === Lowered.ENode.PrimitiveDatatype) {
        if (symbol.primitive === EPrimitive.c_str) {
          this.out.type_declarations.writeLine(`typedef const char* _H5c_str;`);
        } else if (symbol.primitive === EPrimitive.str) {
          this.out.type_declarations.writeLine(`typedef struct _H3str _H3str;`);
          this.out.type_definitions.writeLine(`struct _H3str {`).pushIndent();
          this.out.type_definitions.writeLine(`const char* data;`);
          this.out.type_definitions.writeLine(`uint64_t length;`);
          this.out.type_definitions.popIndent().writeLine(`};`);
        } else if (symbol.primitive === EPrimitive.null) {
          this.out.type_declarations.writeLine(
            `typedef struct ${this.mangleTypeDef(symbol)} ${this.mangleTypeDef(symbol)};`
          );
          this.out.type_definitions.writeLine(`struct ${this.mangleTypeDef(symbol)} {};`);
        } else {
          this.out.type_declarations.writeLine(
            `typedef ${this.primitiveToC(symbol.primitive)} ${this.mangleTypeDef(symbol)};`
          );
        }
      } else if (symbol.variant === Lowered.ENode.StructDatatype) {
        if (!symbol.noemit) {
          this.out.type_declarations.writeLine(
            `typedef struct ${this.mangleTypeDef(symbol)} ${this.mangleTypeDef(symbol)};`
          );
          this.out.type_definitions
            .writeLine(`struct ${this.mangleTypeDef(symbol)} {`)
            .pushIndent();
          for (const member of symbol.members) {
            this.out.type_definitions.writeLine(
              `${this.mangleTypeUse(member.type)} ${member.name};`
            );
          }
          this.out.type_definitions.popIndent().writeLine(`};`).writeLine();
        }
      } else if (symbol.variant === Lowered.ENode.PointerDatatype) {
        this.out.type_declarations.writeLine(
          `typedef ${this.mangleTypeUse(symbol.pointee)}* ${this.mangleTypeDef(symbol)};`
        );
      } else if (symbol.variant === Lowered.ENode.ReferenceDatatype) {
        this.out.type_declarations.writeLine(
          `typedef ${this.mangleTypeUse(symbol.referee)}* ${this.mangleTypeDef(symbol)};`
        );
      } else if (symbol.variant === Lowered.ENode.ArrayDatatype) {
        this.out.type_declarations.writeLine(
          `typedef struct ${this.mangleTypeDef(symbol)} ${this.mangleTypeDef(symbol)};`
        );
        this.out.type_definitions.writeLine(`struct ${this.mangleTypeDef(symbol)} {`).pushIndent();
        this.out.type_definitions.writeLine(
          `${this.mangleTypeUse(symbol.datatype)} data[${symbol.length}];`
        );
        this.out.type_definitions.popIndent().writeLine(`};`);
      } else if (symbol.variant === Lowered.ENode.SliceDatatype) {
        this.out.type_declarations.writeLine(
          `typedef struct ${this.mangleTypeDef(symbol)} ${this.mangleTypeDef(symbol)};`
        );
        this.out.type_definitions.writeLine(`struct ${this.mangleTypeDef(symbol)} {`).pushIndent();
        this.out.type_definitions.writeLine(`${this.mangleTypeUse(symbol.datatype)}* data;`);
        this.out.type_definitions.writeLine(`uint64_t length;`);
        this.out.type_definitions.popIndent().writeLine(`};`);
      } else if (symbol.variant === Lowered.ENode.FunctionDatatype) {
        this.out.type_declarations.writeLine(
          `typedef ${this.mangleTypeUse(symbol.returnType)} (*${this.mangleTypeDef(
            symbol
          )})(${symbol.parameters.map((p) => `${this.mangleTypeUse(p)}`).join(", ")});`
        );
      } else if (symbol.variant === Lowered.ENode.CallableDatatype) {
        this.out.type_declarations.writeLine(
          `typedef struct ${this.mangleTypeDef(symbol)} ${this.mangleTypeDef(symbol)};`
        );
        this.out.type_definitions.writeLine(`struct ${this.mangleTypeDef(symbol)} {`).pushIndent();
        if (symbol.thisExprType) {
          this.out.type_definitions.writeLine(
            `${this.mangleTypeUse(symbol.thisExprType)} thisPtr;`
          );
        }
        this.out.type_definitions.writeLine(`${this.mangleTypeDef(symbol.functionType)} fn;`);
        this.out.type_definitions.popIndent().writeLine(`};`).writeLine();
      } else if (symbol.variant === Lowered.ENode.TypeUse) {
        if (symbol.mutability !== EDatatypeMutability.Default) {
          const constWord = symbol.mutability === EDatatypeMutability.Const ? "const " : "";
          this.out.type_declarations.writeLine(
            `typedef ${constWord}${this.mangleTypeDef(symbol.type)} ${this.mangleTypeUse(symbol)};`
          );
        }
      } else {
        assert(false);
      }
    }

    for (const [id, symbol] of this.lr.loweredGlobalVariables) {
      // TODO
    }
  }

  sortTypeDefs(sortedLoweredTypes: (Lowered.TypeDef | Lowered.TypeUse)[]) {
    const appliedTypes = new Set<Lowered.TypeDef | Lowered.TypeUse>();

    // This function processes the type in the sense that it goes over all types that this type depends on,
    // and if there is a direct relationship, then that type is processed, which sorts it first.
    // This is required because C has a very strict requirement on ordering of struct definitions that depend on another
    const processTypeDef = (typeId: Lowered.TypeDefId) => {
      const type = this.lr.typeDefNodes.get(typeId);

      if (appliedTypes.has(type)) {
        return;
      }

      if (type.variant === Lowered.ENode.FunctionDatatype) {
        appliedTypes.add(type);
        for (const p of type.parameters) {
          processTypeUse(p);
        }
        processTypeUse(type.returnType);
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.CallableDatatype) {
        appliedTypes.add(type);
        processTypeDef(type.functionType);
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.StructDatatype) {
        appliedTypes.add(type);
        for (const m of type.members) {
          const type = this.lr.typeUseNodes.get(m.type);
          const typeDef = this.lr.typeDefNodes.get(type.type);
          // Pointer do not matter, only direct references are bad.
          if (
            typeDef.variant !== Lowered.ENode.PointerDatatype &&
            typeDef.variant !== Lowered.ENode.ReferenceDatatype
          ) {
            processTypeUse(m.type);
          }
        }
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.PrimitiveDatatype) {
        appliedTypes.add(type);
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.PointerDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.pointee);
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.ReferenceDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.referee);
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.LiteralValueDatatype) {
        appliedTypes.add(type);
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.ArrayDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.datatype);
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.SliceDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.datatype);
        sortedLoweredTypes.push(type);
      } else {
        assert(false);
      }
    };

    const processTypeUse = (typeId: Lowered.TypeUseId) => {
      const type = this.lr.typeUseNodes.get(typeId);
      if (appliedTypes.has(type)) {
        return;
      }
      appliedTypes.add(type);
      processTypeDef(type.type);
      sortedLoweredTypes.push(type);
    };

    for (const [id, t] of this.lr.loweredTypeDefs) {
      processTypeDef(t);
    }
    for (const [id, t] of this.lr.loweredTypeUses) {
      processTypeUse(t);
    }
  }

  primitiveToC(primitive: EPrimitive) {
    switch (primitive) {
      case EPrimitive.bool:
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
      case EPrimitive.int:
        return "int64_t";
      case EPrimitive.real:
        return "double";
      case EPrimitive.usize:
        return "uint64_t";
      case EPrimitive.void:
        return "void";
      case EPrimitive.null:
        assert(false, "null should be handled specially");
      case EPrimitive.str:
        return "_H3str";
      case EPrimitive.c_str:
        return "const char*";
    }
  }

  mangleTypeDef(type: Lowered.TypeDef | Lowered.TypeDefId): string {
    if (typeof type !== "object") {
      type = this.lr.typeDefNodes.get(type);
    }
    return this.mangleName(type.name);
  }

  mangleTypeUse(type: Lowered.TypeUse | Lowered.TypeUseId): string {
    if (typeof type !== "object") {
      type = this.lr.typeUseNodes.get(type);
    }
    return this.mangleName(type.name);
  }

  mangleFunctionSymbol(func: Lowered.FunctionSymbol | Lowered.FunctionId): string {
    if (typeof func !== "object") {
      func = this.lr.functionNodes.get(func);
    }
    return this.mangleName(func.name);
  }

  mangleName(name: NameSet): string {
    if (name.wasMangled) {
      return "_H" + name.mangledName;
    } else {
      return name.mangledName;
    }
  }

  makeTrapFunction() {
    if (this.trapFunctionCache !== undefined) {
      return this.trapFunctionCache;
    }

    const functionName = "___hz_builtin_trap";
    this.out.builtin_declarations.writeLine(`__attribute__((noreturn, cold))`);
    this.out.builtin_declarations.writeLine(
      `static _Noreturn void ${functionName}(const char* msg);`
    );
    this.out.builtin_definitions.writeLine(`__attribute__((noreturn, cold))`);
    this.out.builtin_definitions
      .writeLine(`static _Noreturn void ${functionName}(const char* msg) {`)
      .pushIndent();
    this.out.builtin_definitions.writeLine(`fprintf(stderr, "Runtime error: %s\\n", msg);`);
    this.out.builtin_definitions.writeLine(`abort();`);
    this.out.builtin_definitions.popIndent().writeLine(`}`);
    this.trapFunctionCache = functionName;
    return functionName;
  }

  makeCheckedIncrArithmeticFunction(exprId: Lowered.ExprId, operation: EIncrOperation) {
    const expr = this.lr.exprNodes.get(exprId);

    let opStr = "";
    switch (operation) {
      case EIncrOperation.Incr:
        opStr = "incr";
        break;
      case EIncrOperation.Decr:
        opStr = "decr";
        break;
      default:
        assert(false);
    }

    let innerMap = this.incrFunctionsCache.get(operation);
    if (innerMap === undefined) {
      this.incrFunctionsCache.set(operation, new Map());
      innerMap = this.incrFunctionsCache.get(operation)!;
    }

    let functionName = innerMap.get(expr.type);
    if (functionName !== undefined) {
      return functionName;
    }

    const leftType = this.lr.typeUseNodes.get(expr.type);
    const trapFunc = this.makeTrapFunction();

    functionName = `___hz_builtin_${opStr}_${leftType.name.mangledName}`;

    this.out.builtin_declarations.writeLine(
      `static inline _H${leftType.name.mangledName} ${functionName}(_H${leftType.name.mangledName});`
    );
    this.out.builtin_definitions
      .writeLine(
        `static inline _H${leftType.name.mangledName} ${functionName}(_H${leftType.name.mangledName} value) {`
      )
      .pushIndent();
    this.out.builtin_definitions.writeLine(`_H${leftType.name.mangledName} result;`);
    this.out.builtin_definitions
      .writeLine(
        `if (__builtin_expect(__builtin_${
          operation === EIncrOperation.Incr ? "add" : "sub"
        }_overflow(value, 1, &result), 0)) {`
      )
      .pushIndent();
    this.out.builtin_definitions.writeLine(
      `${trapFunc}("Integer overflow in ${opStr} operation");`
    );
    this.out.builtin_definitions.popIndent().writeLine(`}`);
    this.out.builtin_definitions.writeLine(`return result;`);
    this.out.builtin_definitions.popIndent().writeLine("}");

    innerMap.set(expr.type, functionName);
    return functionName;
  }

  makeCheckedBinaryArithmeticFunction(
    leftId: Lowered.ExprId,
    rightId: Lowered.ExprId,
    operation: EBinaryOperation
  ) {
    const left = this.lr.exprNodes.get(leftId);
    const right = this.lr.exprNodes.get(rightId);

    let opStr = "";
    switch (operation) {
      case EBinaryOperation.Add:
        opStr = "add";
        break;
      case EBinaryOperation.Subtract:
        opStr = "sub";
        break;
      case EBinaryOperation.Multiply:
        opStr = "mul";
        break;
      case EBinaryOperation.Divide:
        opStr = "div";
        break;
      case EBinaryOperation.Modulo:
        opStr = "mod";
        break;
      default:
        assert(false);
    }

    let innerMap = this.arithmeticFunctionsCache.get(operation);
    if (innerMap === undefined) {
      this.arithmeticFunctionsCache.set(operation, new Map());
      innerMap = this.arithmeticFunctionsCache.get(operation)!;
    }

    let functionName = innerMap.get(right.type);
    if (functionName !== undefined) {
      return functionName;
    }

    const leftType = this.lr.typeUseNodes.get(left.type);
    const rightType = this.lr.typeUseNodes.get(right.type);
    const leftTypeDef = this.lr.typeDefNodes.get(leftType.type);
    const rightTypeDef = this.lr.typeDefNodes.get(rightType.type);

    const trapFunc = this.makeTrapFunction();

    functionName = `___hz_builtin_${opStr}_${leftType.name.mangledName}${rightType.name.mangledName}`;

    this.out.builtin_declarations.writeLine(
      `_H${leftType.name.mangledName} ${functionName}(_H${leftType.name.mangledName}, _H${rightType.name.mangledName});`
    );
    this.out.builtin_definitions
      .writeLine(
        `_H${leftType.name.mangledName} ${functionName}(_H${leftType.name.mangledName} a, _H${rightType.name.mangledName} b) {`
      )
      .pushIndent();
    if (operation === EBinaryOperation.Divide || operation === EBinaryOperation.Modulo) {
      this.out.builtin_definitions.writeLine(`if (b == 0) ${trapFunc}("Division by zero");`);
      if (
        leftTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
        leftTypeDef.primitive === EPrimitive.i8
      ) {
        this.out.builtin_definitions.writeLine(
          `if (a == INT8_MIN && b == -1) ${trapFunc}("Integer overflow in division");`
        );
      } else if (
        leftTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
        leftTypeDef.primitive === EPrimitive.i16
      ) {
        this.out.builtin_definitions.writeLine(
          `if (a == INT16_MIN && b == -1) ${trapFunc}("Integer overflow in division");`
        );
      } else if (
        leftTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
        leftTypeDef.primitive === EPrimitive.i32
      ) {
        this.out.builtin_definitions.writeLine(
          `if (a == INT32_MIN && b == -1) ${trapFunc}("Integer overflow in division");`
        );
      } else if (
        leftTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
        leftTypeDef.primitive === EPrimitive.i64
      ) {
        this.out.builtin_definitions.writeLine(
          `if (a == INT64_MIN && b == -1) ${trapFunc}("Integer overflow in division");`
        );
      }
      if (operation === EBinaryOperation.Modulo) {
        this.out.builtin_definitions.writeLine(`return a % b;`);
      } else {
        this.out.builtin_definitions.writeLine(`return a / b;`);
      }
    } else {
      this.out.builtin_definitions.writeLine(`_H${leftType.name.mangledName} result;`);
      this.out.builtin_definitions
        .writeLine(`if (__builtin_expect(__builtin_${opStr}_overflow(a, b, &result), 0)) {`)
        .pushIndent();
      this.out.builtin_definitions.writeLine(
        `${trapFunc}("Integer overflow in ${opStr} operation");`
      );
      this.out.builtin_definitions.popIndent().writeLine(`}`);
      this.out.builtin_definitions.writeLine(`return result;`);
    }
    this.out.builtin_definitions.popIndent().writeLine("}");

    innerMap.set(right.type, functionName);
    return functionName;
  }

  emitFunction(symbolId: Lowered.FunctionId) {
    const symbol = this.lr.functionNodes.get(symbolId);
    const ftype = this.lr.typeDefNodes.get(symbol.type);
    assert(ftype.variant === Lowered.ENode.FunctionDatatype);

    let signature = "";
    if (symbol.wasMonomorphized) {
      signature += "static ";
    }
    signature +=
      this.mangleTypeUse(ftype.returnType) + " " + this.mangleFunctionSymbol(symbol) + "(";
    signature += ftype.parameters
      .map((p, i) => `${this.mangleTypeUse(p)} ${symbol.parameterNames[i]}`)
      .join(", ");
    if (ftype.vararg) {
      signature += ", ...";
    }
    signature += ")";

    this.out.function_declarations.writeLine(signature + ";");

    if (symbol.scope) {
      this.out.function_definitions.writeLine(signature + " {").pushIndent();

      const s = this.emitScope(symbol.scope);
      this.out.function_definitions.write(s.temp);
      this.out.function_definitions.write(s.out);

      this.out.function_definitions.popIndent().writeLine("}").writeLine();
    }
  }

  emitScope(scopeId: Lowered.BlockScopeId): { temp: OutputWriter; out: OutputWriter } {
    const scope = this.lr.blockScopeNodes.get(scopeId);

    const tempWriter = new OutputWriter();
    const outWriter = new OutputWriter();

    let returned = false;
    for (const statementId of scope.statements) {
      const statement = this.lr.statementNodes.get(statementId);
      if (returned) {
        printWarningMessage(`Dead code detected and stripped`, statement.sourceloc);
        break;
      }

      if (statement.variant === Lowered.ENode.ReturnStatement) {
        returned = true;
      }

      const s = this.emitStatement(statementId);
      tempWriter.write(s.temp);
      outWriter.write(s.out);
    }

    return { temp: tempWriter, out: outWriter };
  }

  emitStatement(statementId: Lowered.StatementId): {
    temp: OutputWriter;
    out: OutputWriter;
  } {
    const statement = this.lr.statementNodes.get(statementId);

    const tempWriter = new OutputWriter();
    const outWriter = new OutputWriter();
    switch (statement.variant) {
      case Lowered.ENode.ReturnStatement: {
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
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

      case Lowered.ENode.VariableStatement: {
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }
        outWriter.write(`${this.mangleTypeUse(statement.type)} ${this.mangleName(statement.name)}`);

        if (statement.value) {
          const exprWriter = this.emitExpr(statement.value);
          tempWriter.write(exprWriter.temp);
          outWriter.writeLine(` = ${exprWriter.out.get()};`);
        } else {
          const statementType = this.lr.typeUseNodes.get(statement.type);
          const statementTypeDef = this.lr.typeDefNodes.get(statementType.type);
          if (
            statementTypeDef.variant === Lowered.ENode.StructDatatype &&
            statementTypeDef.members.length === 0
          ) {
            outWriter.writeLine(`;`);
          } else {
            outWriter.writeLine(` = {0};`);
          }
        }
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.ExprStatement: {
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }
        const exprWriter = this.emitExpr(statement.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.writeLine(`(void)(${exprWriter.out.get()});`);
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.InlineCStatement: {
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }
        outWriter.writeLine(statement.value);
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.WhileStatement: {
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
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

      case Lowered.ENode.BlockScopeStatement: {
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }
        outWriter.writeLine(`{`).pushIndent();
        const scope = this.emitScope(statement.block);
        tempWriter.write(scope.temp);
        outWriter.write(scope.out);
        outWriter.popIndent().writeLine("}");
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.IfStatement: {
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
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

  emitExpr(exprId: Lowered.ExprId): { temp: OutputWriter; out: OutputWriter } {
    const expr = this.lr.exprNodes.get(exprId);

    if (!expr) {
      throw new InternalError("Expr is null", undefined, 1);
    }
    const tempWriter = new OutputWriter();
    const outWriter = new OutputWriter();
    switch (expr.variant) {
      case Lowered.ENode.ExprCallExpr:
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

      case Lowered.ENode.StructInstantiationExpr: {
        outWriter.writeLine(`((${this.mangleTypeUse(expr.type)}) { `).pushIndent();
        for (const assign of expr.memberAssigns) {
          const exprWriter = this.emitExpr(assign.value);
          tempWriter.write(exprWriter.temp);
          outWriter.writeLine(`.${assign.name} = ${exprWriter.out.get()}, `);
        }
        outWriter.popIndent().write(" })");
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.MemberAccessExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        if (expr.isReference) {
          outWriter.write("(" + exprWriter.out.get() + ")->" + expr.memberName);
        } else {
          outWriter.write("(" + exprWriter.out.get() + ")." + expr.memberName);
        }
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.SymbolValueExpr: {
        outWriter.write(this.mangleName(expr.name));
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.ExplicitCastExpr:
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.write(`((${this.mangleTypeUse(expr.type)})(${exprWriter.out.get()}))`);
        return { out: outWriter, temp: tempWriter };

      case Lowered.ENode.PreIncrExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);

        const e = this.lr.exprNodes.get(expr.expr);
        const exprType = this.lr.typeUseNodes.get(e.type);
        const exprTypeDef = this.lr.typeDefNodes.get(exprType.type);
        if (
          exprTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
          Conversion.isInteger(exprTypeDef.primitive)
        ) {
          const functionName = this.makeCheckedIncrArithmeticFunction(expr.expr, expr.operation);
          outWriter.write(`(${exprWriter.out.get()} = ${functionName}(${exprWriter.out.get()}))`);
        } else {
          outWriter.write(
            "(" +
              (expr.operation === EIncrOperation.Incr ? "++" : "--") +
              exprWriter.out.get() +
              ")"
          );
        }

        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.PostIncrExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);

        const e = this.lr.exprNodes.get(expr.expr);
        const exprType = this.lr.typeUseNodes.get(e.type);
        const exprTypeDef = this.lr.typeDefNodes.get(exprType.type);
        if (
          exprTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
          Conversion.isInteger(exprTypeDef.primitive)
        ) {
          const functionName = this.makeCheckedIncrArithmeticFunction(expr.expr, expr.operation);
          outWriter.write(
            `({ ${this.mangleTypeUse(
              exprType
            )} __tmp = ${exprWriter.out.get()}; ${exprWriter.out.get()} = ${functionName}(${exprWriter.out.get()}); __tmp; })`
          );
        } else {
          outWriter.write(
            "(" +
              (expr.operation === EIncrOperation.Incr ? "++" : "--") +
              exprWriter.out.get() +
              ")"
          );
        }

        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.UnaryExpr:
        switch (expr.operation) {
          case EUnaryOperation.Minus:
          case EUnaryOperation.Plus:
          case EUnaryOperation.Negate: {
            const writer = this.emitExpr(expr.expr);
            tempWriter.write(writer.temp);
            outWriter.write(
              "(" + UnaryOperationToString(expr.operation) + "(" + writer.out.get() + "))"
            );
            break;
          }
          default:
            assert(false);
        }
        return { out: outWriter, temp: tempWriter };

      case Lowered.ENode.BinaryExpr:
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

            const left = this.lr.exprNodes.get(expr.left);
            const leftType = this.lr.typeUseNodes.get(left.type);
            const leftTypeDef = this.lr.typeDefNodes.get(leftType.type);
            const right = this.lr.exprNodes.get(expr.right);
            const rightType = this.lr.typeUseNodes.get(right.type);
            const rightTypeDef = this.lr.typeDefNodes.get(rightType.type);
            assert(
              leftTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
                rightTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
                leftTypeDef.primitive === rightTypeDef.primitive
            );
            if (Conversion.isInteger(leftTypeDef.primitive)) {
              const functionName = this.makeCheckedBinaryArithmeticFunction(
                expr.left,
                expr.right,
                expr.operation
              );
              outWriter.write(
                functionName + "(" + leftWriter.out.get() + ", " + rightWriter.out.get() + ")"
              );
            } else {
              outWriter.write(
                "(" +
                  leftWriter.out.get() +
                  " " +
                  BinaryOperationToString(expr.operation) +
                  " " +
                  rightWriter.out.get() +
                  ")"
              );
            }
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
                ")"
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
                ")"
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
                ")"
            );
            break;
          }
        }
        return { out: outWriter, temp: tempWriter };

      case Lowered.ENode.CallableExpr: {
        const thisExpr = this.emitExpr(expr.thisExpr);
        tempWriter.write(thisExpr.temp);
        outWriter.write(
          `((${this.mangleTypeUse(
            expr.type
          )}) { .thisPtr = ${thisExpr.out.get()}, .fn = ${this.mangleName(expr.functionName)} })`
        );
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.PointerAddressOfExpr: {
        const e = this.emitExpr(expr.expr);
        tempWriter.write(e.temp);
        outWriter.write("&" + e.out.get());
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.PointerDereferenceExpr: {
        const e = this.emitExpr(expr.expr);
        tempWriter.write(e.temp);
        outWriter.write("*" + e.out.get());
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.SizeofExpr: {
        const e = this.emitExpr(expr.value);
        tempWriter.write(e.temp);
        outWriter.write("sizeof(" + e.out.get() + ")");
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.ExprAssignmentExpr: {
        const target = this.emitExpr(expr.target);
        const value = this.emitExpr(expr.value);
        tempWriter.write(target.temp);
        tempWriter.write(value.temp);
        outWriter.write("(" + target.out.get() + " = " + value.out.get() + ")");
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.ArrayLiteralExpr: {
        const values = expr.values.map((v) => {
          const e = this.emitExpr(v);
          tempWriter.write(e.temp);
          return e.out;
        });
        outWriter.write(
          `(${this.mangleTypeUse(expr.type)}){ .data = {${values.map((v) => v.get()).join(", ")}} }`
        );
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.ArraySubscriptExpr: {
        const e = this.emitExpr(expr.expr);
        tempWriter.write(e.temp);
        const index = this.emitExpr(expr.index);
        tempWriter.write(index.temp);
        outWriter.write(`(${e.out.get()}).data[${index.out.get()}]`);
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.ArraySliceExpr: {
        const e = this.emitExpr(expr.expr);
        const sliceType = this.lr.typeUseNodes.get(expr.type);
        const arrayExpr = this.lr.exprNodes.get(expr.expr);
        const arrayExprType = this.lr.typeUseNodes.get(arrayExpr.type);
        const arrayExprTypeDef = this.lr.typeDefNodes.get(arrayExprType.type);
        assert(arrayExpr.variant !== Lowered.ENode.ArrayLiteralExpr);
        assert(arrayExprTypeDef.variant === Lowered.ENode.ArrayDatatype);

        tempWriter.write(e.temp);
        const startIndex = this.emitExpr(expr.start);
        const endIndex = this.emitExpr(expr.end);
        tempWriter.write(startIndex.temp);
        tempWriter.write(endIndex.temp);

        const array = e.out.get();
        outWriter.write(
          `(${this.mangleTypeUse(
            sliceType
          )}){ .data=(${array}).data + ${startIndex.out.get()}, .length=(${endIndex.out.get()} - ${startIndex.out.get()}) }`
        );
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.DatatypeAsValueExpr: {
        outWriter.write(this.mangleTypeUse(expr.type));
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.StringConstructExpr: {
        const data = this.emitExpr(expr.value.data);
        tempWriter.write(data.temp);

        const length = this.emitExpr(expr.value.length);
        tempWriter.write(length.temp);

        outWriter.write(
          `(_H3str){ .data=(const char*)${data.out.get()}, .length=${length.out.get()} }`
        );
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.LiteralExpr: {
        function stringifyWithDecimal(num: number) {
          const s = num.toString();
          return s.includes(".") ? s : s + ".0";
        }

        if (expr.literal.type === EPrimitive.c_str) {
          outWriter.write(`(_H5c_str)(${JSON.stringify(expr.literal.value)})`);
        } else if (expr.literal.type === EPrimitive.str) {
          const value = expr.literal.value;
          outWriter.write(
            `(_H3str){ .data=(const char*)${JSON.stringify(value)}, .length=${value.length} }`
          );
        } else if (expr.literal.type === EPrimitive.bool) {
          outWriter.write(
            `(${this.primitiveToC(expr.literal.type)})(${expr.literal.value ? "1" : "0"})`
          );
        } else if (expr.literal.type === EPrimitive.null) {
          outWriter.write("(_H4null){}");
        } else if (expr.literal.type === EPrimitive.f32) {
          outWriter.write(
            `(${this.primitiveToC(expr.literal.type)})(${stringifyWithDecimal(
              expr.literal.value
            )}f)`
          );
        } else if (expr.literal.type === EPrimitive.f64 || expr.literal.type === EPrimitive.real) {
          outWriter.write(
            `(${this.primitiveToC(expr.literal.type)})(${stringifyWithDecimal(expr.literal.value)})`
          );
        } else {
          let postfix = "";
          switch (expr.literal.type) {
            case EPrimitive.i8:
            case EPrimitive.i16:
              postfix = "";
              break;

            case EPrimitive.i32:
              postfix = "L";
              break;

            case EPrimitive.i64:
            case EPrimitive.int:
              postfix = "LL";
              break;

            case EPrimitive.u8:
            case EPrimitive.u16:
              postfix = "U";
              break;

            case EPrimitive.u32:
              postfix = "UL";
              break;

            case EPrimitive.u64:
            case EPrimitive.usize:
              postfix = "ULL";
              break;
          }
          let value = expr.literal.value.toString() + postfix;
          if (expr.literal.value === -2147483648n) {
            value = "INT_MIN";
          }
          if (expr.literal.value === -9223372036854775808n) {
            value = "LLONG_MIN";
          }
          outWriter.write(`(${this.primitiveToC(expr.literal.type)})(${value})`);
        }
        return { out: outWriter, temp: tempWriter };
      }

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
