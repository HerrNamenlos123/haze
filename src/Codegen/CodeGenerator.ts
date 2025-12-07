import { Lowered, lowerExpr, lowerTypeDef } from "../Lower/Lower";
import { Conversion } from "../Semantic/Conversion";
import { Semantic } from "../Semantic/Elaborate";
import {
  BinaryOperationToString,
  EBinaryOperation,
  EDatatypeMutability,
  EIncrOperation,
  EUnaryOperation,
  UnaryOperationToString,
} from "../shared/AST";
import { EPrimitive, primitiveToString, type NameSet } from "../shared/common";
import { getModuleGlobalNamespaceName, ModuleType, type ModuleConfig } from "../shared/Config";
import { assert, InternalError, printWarningMessage } from "../shared/Errors";
import { OutputWriter } from "./OutputWriter";

function makeUnionMappingName(from: Lowered.TypeUseId, to: Lowered.TypeUseId) {
  return `_H_Union_Mapping_${from}_to_${to}_`;
}

function escapeStringForC(str: string): [string, number] {
  let escaped = "";
  let byteLength = 0;

  for (const char of str) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;

    switch (char) {
      case '"':
        escaped += '\\"';
        byteLength += 1;
        break;
      case "\\":
        escaped += "\\\\";
        byteLength += 1;
        break;
      case "\n":
        escaped += "\\n";
        byteLength += 1;
        break;
      case "\r":
        escaped += "\\r";
        byteLength += 1;
        break;
      case "\t":
        escaped += "\\t";
        byteLength += 1;
        break;
      case "\0":
        escaped += "\\0";
        byteLength += 1;
        break;
      default:
        if (code >= 0x20 && code <= 0x7e) {
          // Printable ASCII
          escaped += char;
          byteLength += 1;
        } else if (code <= 0xffff) {
          escaped += `\\u${code.toString(16).padStart(4, "0")}`;
          byteLength += Buffer.from(char).length;
        } else {
          // code > 0xffff, surrogate pair
          escaped += `\\U${code.toString(16).padStart(8, "0")}`;
          byteLength += Buffer.from(char).length;
        }
    }
  }

  return [escaped, byteLength];
}

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
      this.out.function_definitions.writeLine("hzstd_initialize();");
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
        // .writeLine(`hzstd_arena_cleanup_and_free(parent_arena->arenaImpl);`)
        // .writeLine(`return __hz_result;`)
        .popIndent()
        .writeLine("}\n");
    }
  }

  includeSystemHeader(filename: string) {
    this.out.includes.writeLine(`#include <${filename}>`);
  }

  includeLocalHeader(filename: string) {
    this.out.includes.writeLine(`#include "${filename}"`);
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

    writer.write("\n\n// Global Variable section\n");
    writer.write(this.out.global_variables);
    writer.writeLine();

    writer.write("\n\n// Function definition section\n");
    writer.write(this.out.function_definitions);
    writer.writeLine();

    return writer.get();
  }

  generate() {
    this.includeSystemHeader("stdlib.h");
    this.includeSystemHeader("stdint.h");
    this.includeSystemHeader("inttypes.h");
    this.includeSystemHeader("stdbool.h");
    this.includeSystemHeader("stdalign.h");
    this.includeSystemHeader("stdio.h");
    this.includeSystemHeader("limits.h");
    this.includeSystemHeader("string.h");
    this.includeSystemHeader("math.h");

    if (this.config.hzstdLocation) {
      this.includeLocalHeader(this.config.hzstdLocation + "/hzstd/hzstd.h");
    } else {
      this.includeLocalHeader("hzstd.h");
    }

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
        // All primitives are handled in hzstd
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
          if (symbol.members.length === 0) {
            this.out.type_definitions.writeLine(`hzstd_u8_t dummy;`);
          }
          this.out.type_definitions.popIndent().writeLine(`};`).writeLine();
        }
      } else if (symbol.variant === Lowered.ENode.PointerDatatype) {
        this.out.type_declarations.writeLine(
          `typedef ${this.mangleTypeUse(symbol.referee)}* ${this.mangleTypeDef(symbol)};`
        );
      } else if (
        symbol.variant === Lowered.ENode.UntaggedUnionDatatype ||
        symbol.variant === Lowered.ENode.TaggedUnionDatatype
      ) {
        if (symbol.optimizeAsRawPointer) {
          this.out.type_declarations.writeLine(
            `typedef ${this.mangleTypeUse(symbol.optimizeAsRawPointer)} ${this.mangleTypeDef(
              symbol
            )};`
          );
        } else {
          this.out.type_declarations.writeLine(
            `typedef struct ${this.mangleTypeDef(symbol)} ${this.mangleTypeDef(symbol)};`
          );
          this.out.type_definitions
            .writeLine(`struct ${this.mangleTypeDef(symbol)} {`)
            .pushIndent();
          this.out.type_definitions.writeLine(`uint8_t tag;`);
          this.out.type_definitions.writeLine(`union {`).pushIndent();
          const members =
            symbol.variant === Lowered.ENode.UntaggedUnionDatatype
              ? symbol.members
              : symbol.members.map((m) => m.type);
          members.forEach((m, i) => {
            this.out.type_definitions.writeLine(`${this.mangleTypeUse(m)} as_tag_${i};`);
          });
          this.out.type_definitions.writeLine(`char as_bytes[sizeof(union{`).pushIndent();
          members.forEach((m, i) => {
            this.out.type_definitions.writeLine(`${this.mangleTypeUse(m)} as_tag_${i};`);
          });
          this.out.type_definitions.popIndent().writeLine(`})];`);
          this.out.type_definitions.popIndent().writeLine(`};`);
          this.out.type_definitions.popIndent().writeLine(`};`);
        }
      } else if (symbol.variant === Lowered.ENode.FixedArrayDatatype) {
        this.out.type_declarations.writeLine(
          `typedef struct ${this.mangleTypeDef(symbol)} ${this.mangleTypeDef(symbol)};`
        );
        this.out.type_definitions.writeLine(`struct ${this.mangleTypeDef(symbol)} {`).pushIndent();
        this.out.type_definitions.writeLine(
          `${this.mangleTypeUse(symbol.datatype)} data[${symbol.length}];`
        );
        this.out.type_definitions.popIndent().writeLine(`};`);
      } else if (symbol.variant === Lowered.ENode.DynamicArrayDatatype) {
        this.out.type_declarations.writeLine(
          `typedef hzstd_dynamic_array_t ${this.mangleTypeDef(symbol)};`
        );
        // this.out.type_definitions.writeLine(`struct ${this.mangleTypeDef(symbol)} {`).pushIndent();
        // this.out.type_definitions.writeLine(`hzstd_dynamic_array_t data;`);
        // this.out.type_definitions.popIndent().writeLine(`};`);
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
        if (symbol.pointer) {
          this.out.type_declarations.writeLine(
            `typedef ${this.mangleTypeDef(symbol.type)}* ${this.mangleTypeUse(symbol)};`
          );
        } else {
          const a = this.mangleTypeDef(symbol.type);
          const b = this.mangleTypeUse(symbol);
          if (a !== b) {
            this.out.type_declarations.writeLine(`typedef ${a} ${b};`);
          }
        }
      } else if (symbol.variant === Lowered.ENode.EnumDatatype) {
        if (!symbol.noemit) {
          this.out.type_declarations.writeLine(`typedef enum {`).pushIndent();
          for (const value of symbol.values) {
            this.out.type_declarations.writeLine(
              `${this.mangleName(value.loweredName)} = ${this.emitExpr(value.value).out.get()},`
            );
          }
          this.out.type_declarations.popIndent().writeLine(`} ${this.mangleName(symbol.name)} ;`);
        }
      } else {
        assert(false);
      }
    }

    for (const [id, symbol] of this.lr.loweredGlobalVariables) {
      // TODO
    }

    for (const mapping of this.lr.loweredUnionMappings) {
      this.out.type_declarations
        .writeLine(`static const uint8_t ${makeUnionMappingName(mapping.from, mapping.to)}[] = {`)
        .pushIndent();
      for (const [from, to] of mapping.mapping) {
        this.out.type_declarations.writeLine(`[${from}] = ${to},`);
      }
      this.out.type_declarations.popIndent().writeLine(`};`);
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
        sortedLoweredTypes.push(type);
        for (const m of type.members) {
          const type = this.lr.typeUseNodes.get(m.type);
          const typeDef = this.lr.typeDefNodes.get(type.type);
          // Pointer do not matter, only direct usages are bad.
          if (typeDef.variant !== Lowered.ENode.PointerDatatype) {
            processTypeUse(m.type);
          }
        }
      } else if (type.variant === Lowered.ENode.PrimitiveDatatype) {
        appliedTypes.add(type);
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.PointerDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.referee);
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.FixedArrayDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.datatype);
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.DynamicArrayDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.datatype);
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.UntaggedUnionDatatype) {
        appliedTypes.add(type);
        for (const m of type.members) {
          processTypeUse(m);
        }
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.TaggedUnionDatatype) {
        appliedTypes.add(type);
        for (const m of type.members) {
          processTypeUse(m.type);
        }
        sortedLoweredTypes.push(type);
      } else if (type.variant === Lowered.ENode.EnumDatatype) {
        appliedTypes.add(type);
        processTypeUse(type.type);
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
    for (const [id, t] of this.lr.loweredPointers) {
      processTypeDef(t);
    }
  }

  primitiveToC(primitive: EPrimitive) {
    assert(primitive !== EPrimitive.null, "null should be handled specially");
    return "hzstd_" + primitiveToString(primitive) + "_t";
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

  makeCheckedBinaryArithmeticFunction(
    leftId: Lowered.ExprId,
    rightId: Lowered.ExprId,
    plainResultTypeId: Lowered.TypeDefId,
    operation: EBinaryOperation
  ) {
    const left = this.lr.exprNodes.get(leftId);
    const right = this.lr.exprNodes.get(rightId);
    const plainResultType = this.lr.typeDefNodes.get(plainResultTypeId);

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

    const leftType = this.lr.typeUseNodes.get(left.type);
    const rightType = this.lr.typeUseNodes.get(right.type);

    return `hzstd_arithmetic_${opStr}_${this.mangleName(plainResultType.name)}`;
  }

  emitFunction(symbolId: Lowered.FunctionId) {
    const symbol = this.lr.functionNodes.get(symbolId);
    const ftype = this.lr.typeDefNodes.get(symbol.type);
    assert(ftype.variant === Lowered.ENode.FunctionDatatype);

    let signature = "";
    if (symbol.isLibraryLocal) {
      signature += "static ";
    }

    if (symbol.noreturn) {
      signature += "_Noreturn ";
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
        assert(false, "Dead code should have been stripped in lowering phase");
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

  emitStatement(
    statementId: Lowered.StatementId,
    noSourceloc = false
  ): {
    temp: OutputWriter;
    out: OutputWriter;
  } {
    const statement = this.lr.statementNodes.get(statementId);

    const tempWriter = new OutputWriter();
    const outWriter = new OutputWriter();
    switch (statement.variant) {
      case Lowered.ENode.ReturnStatement: {
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc && !noSourceloc) {
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
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc && !noSourceloc) {
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
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc && !noSourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }

        const statementExpr = this.lr.exprNodes.get(statement.expr);
        const statementExprTypeUse = this.lr.typeUseNodes.get(statementExpr.type);
        const statementExprTypeDef = this.lr.typeDefNodes.get(statementExprTypeUse.type);
        const isVoid =
          statementExprTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
          statementExprTypeDef.primitive === EPrimitive.void;

        const exprWriter = this.emitExpr(statement.expr);
        tempWriter.write(exprWriter.temp);

        if (isVoid) {
          outWriter.writeLine(`${exprWriter.out.get()};`);
        } else {
          outWriter.writeLine(`(void)(${exprWriter.out.get()});`);
        }
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.InlineCStatement: {
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc && !noSourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }
        outWriter.writeLine(statement.value);
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.ForStatement: {
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc && !noSourceloc) {
          outWriter.writeLine(
            `#line ${statement.sourceloc.start.line} ${JSON.stringify(
              statement.sourceloc.filename
            )}`
          );
        }

        const loopCondition = statement.loopCondition
          ? this.emitExpr(statement.loopCondition)
          : null;
        if (loopCondition) tempWriter.write(loopCondition.temp);

        const loopIncrement = statement.loopIncrement
          ? this.emitExpr(statement.loopIncrement)
          : null;
        if (loopIncrement) tempWriter.write(loopIncrement.temp);

        const initStatements = statement.initStatements.map((s) => {
          const a = this.emitStatement(s, true);
          tempWriter.write(a.temp);
          return a.out.get();
        });
        assert(
          initStatements.length === 1,
          "The init statement in a for loop cannot be so complex that it requires multiple statements in C"
        );

        outWriter
          .writeLine(
            `for (${initStatements[0] ?? ""} ${loopCondition ? loopCondition.out.get() : ""}; ${
              loopIncrement ? "(void)(" + loopIncrement.out.get() + ")" : ""
            }) {`
          )
          .pushIndent();

        const scope = this.emitScope(statement.body);
        tempWriter.write(scope.temp);
        outWriter.write(scope.out);
        outWriter.popIndent().writeLine("}");
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.WhileStatement: {
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc && !noSourceloc) {
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

      case Lowered.ENode.IfStatement: {
        if (statement.sourceloc && this.lr.sr.cc.config.includeSourceloc && !noSourceloc) {
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

      case Lowered.ENode.StructLiteralExpr: {
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

        const e = this.lr.exprNodes.get(expr.expr);
        const eTypeUse = this.lr.typeUseNodes.get(e.type);
        const eTypeDef = this.lr.typeDefNodes.get(eTypeUse.type);

        if (eTypeDef.variant === Lowered.ENode.StructDatatype) {
          if (expr.requiresDeref) {
            outWriter.write("(" + exprWriter.out.get() + ")->" + expr.memberName);
          } else {
            outWriter.write("(" + exprWriter.out.get() + ")." + expr.memberName);
          }
        } else if (
          eTypeDef.variant === Lowered.ENode.PrimitiveDatatype &&
          eTypeDef.primitive === EPrimitive.str &&
          expr.memberName === "length"
        ) {
          outWriter.write("(" + exprWriter.out.get() + ")." + expr.memberName);
        } else if (
          eTypeDef.variant === Lowered.ENode.CallableDatatype &&
          (expr.memberName === "thisPtr" || expr.memberName === "fn")
        ) {
          outWriter.write("(" + exprWriter.out.get() + ")." + expr.memberName);
        } else if (
          eTypeDef.variant === Lowered.ENode.DynamicArrayDatatype &&
          expr.memberName === "length"
        ) {
          outWriter.write("hzstd_dynamic_array_size(" + exprWriter.out.get() + ")");
        } else {
          assert(false);
        }

        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.SymbolValueExpr: {
        outWriter.write(this.mangleName(expr.name));
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.BlockScopeExpr: {
        const block = this.lr.blockScopeNodes.get(expr.block);
        if (block.emittedExpr) {
          outWriter.writeLine(`({`).pushIndent();
          const scope = this.emitScope(expr.block);
          tempWriter.write(scope.temp);
          outWriter.write(scope.out);
          const emitted = this.emitExpr(block.emittedExpr);
          outWriter
            .writeLine(emitted.out.get() + ";")
            .popIndent()
            .write("})");
        } else {
          outWriter.writeLine(`({`).pushIndent();
          const scope = this.emitScope(expr.block);
          tempWriter.write(scope.temp);
          outWriter.write(scope.out);
          outWriter.popIndent().write("})");
        }
        return { temp: tempWriter, out: outWriter };
      }

      case Lowered.ENode.ExplicitCastExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        outWriter.write(`((${this.mangleTypeUse(expr.type)})(${exprWriter.out.get()}))`);
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.ValueToUnionCastExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        const typeUse = this.lr.typeUseNodes.get(expr.type);
        const union = this.lr.typeDefNodes.get(typeUse.type);
        assert(
          union.variant === Lowered.ENode.UntaggedUnionDatatype ||
            union.variant === Lowered.ENode.TaggedUnionDatatype
        );

        if (union.optimizeAsRawPointer) {
          if (expr.optimizeExprToNullptr) {
            outWriter.write(`((${this.mangleTypeUse(expr.type)})(0))`);
          } else {
            outWriter.write(
              `((${this.mangleTypeUse(expr.type)})(${this.emitExpr(expr.expr).out.get()}))`
            );
          }
        } else {
          outWriter.write(
            `((${this.mangleTypeUse(expr.type)}) { .tag = ${expr.index}, .as_tag_${
              expr.index
            } = ${this.emitExpr(expr.expr).out.get()} })`
          );
        }
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.UnionToValueCastExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        const typeUse = this.lr.typeUseNodes.get(this.lr.exprNodes.get(expr.expr).type);
        const union = this.lr.typeDefNodes.get(typeUse.type);
        assert(
          union.variant === Lowered.ENode.UntaggedUnionDatatype ||
            union.variant === Lowered.ENode.TaggedUnionDatatype
        );

        if (union.optimizeAsRawPointer) {
          outWriter.write(`(${this.emitExpr(expr.expr).out.get()})`);
        } else {
          outWriter.write(`((${this.emitExpr(expr.expr).out.get()}).as_tag_${expr.index})`);
        }
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.UnionToUnionCastExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        const typeUse = this.lr.typeUseNodes.get(expr.type);
        const union = this.lr.typeDefNodes.get(typeUse.type);
        assert(
          union.variant === Lowered.ENode.UntaggedUnionDatatype ||
            union.variant === Lowered.ENode.TaggedUnionDatatype
        );

        if (union.optimizeAsRawPointer) {
          assert(false, "not implemented yet");
        } else {
          const sourceUnionExpr = this.lr.exprNodes.get(expr.expr);
          const sourceUnionExprType = this.lr.typeDefNodes.get(
            this.lr.typeUseNodes.get(sourceUnionExpr.type).type
          );

          outWriter.write(
            `({ ${this.mangleName(sourceUnionExprType.name)} source = ${this.emitExpr(
              expr.expr
            ).out.get()}; ${this.mangleName(union.name)} target = { .tag = ${makeUnionMappingName(
              expr.tagMapping.from,
              expr.tagMapping.to
            )}[source.tag] }; memcpy(&target.as_bytes, &source.as_bytes, sizeof(source.as_bytes)); target; })`
          );
        }
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.UnionTagCheckExpr: {
        const exprWriter = this.emitExpr(expr.expr);
        tempWriter.write(exprWriter.temp);
        const typeUse = this.lr.typeUseNodes.get(this.lr.exprNodes.get(expr.expr).type);
        const union = this.lr.typeDefNodes.get(typeUse.type);
        assert(
          union.variant === Lowered.ENode.UntaggedUnionDatatype ||
            union.variant === Lowered.ENode.TaggedUnionDatatype
        );

        let operator = expr.invertCheck ? "!=" : "==";
        if (union.optimizeAsRawPointer) {
          assert(expr.optimizeExprToNullptr);
          outWriter.write(`((${this.emitExpr(expr.expr).out.get()}) ${operator} NULL)`);
        } else {
          if (expr.tags.length === 1) {
            outWriter.write(
              `((${this.emitExpr(expr.expr).out.get()}).tag ${operator} ${expr.tags[0]})`
            );
          } else {
            const exprType = this.lr.typeUseNodes.get(expr.type);
            outWriter.write(
              `({ ${this.mangleName(exprType.name)} __value = ${this.emitExpr(
                expr.expr
              ).out.get()}; ${expr.tags
                .map((t) => `value.tag ${operator} ${t}`)
                .join(expr.invertCheck ? "&&" : "||")};)`
            );
          }
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
                expr.plainResultType,
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

      case Lowered.ENode.AddressOfExpr: {
        const e = this.emitExpr(expr.expr);
        tempWriter.write(e.temp);
        outWriter.write("&" + e.out.get());
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.DereferenceExpr: {
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

      case Lowered.ENode.AlignofExpr: {
        const e = this.emitExpr(expr.value);
        tempWriter.write(e.temp);
        outWriter.write("alignof(" + e.out.get() + ")");
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.ExprAssignmentExpr: {
        const target = this.emitExpr(expr.target);
        const value = this.emitExpr(expr.value);
        tempWriter.write(target.temp);
        tempWriter.write(value.temp);

        const targetExpr = this.lr.exprNodes.get(expr.target);
        const typeUse = this.lr.typeUseNodes.get(targetExpr.type);
        const typeDef = this.lr.typeDefNodes.get(typeUse.type);

        if (typeDef.variant === Lowered.ENode.PrimitiveDatatype) {
          outWriter.write("(" + target.out.get() + " = " + value.out.get() + ")");
        } else if (
          typeDef.variant === Lowered.ENode.StructDatatype ||
          typeDef.variant === Lowered.ENode.DynamicArrayDatatype
        ) {
          if (expr.assignRefTarget) {
            outWriter.write("(*" + target.out.get() + " = " + value.out.get() + ")");
          } else {
            outWriter.write("(" + target.out.get() + " = " + value.out.get() + ")");
          }
        } else {
          console.log(targetExpr, typeUse, typeDef);
          assert(false);
        }

        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.ArrayLiteralExpr: {
        const values = expr.values.map((v) => {
          const e = this.emitExpr(v);
          tempWriter.write(e.temp);
          return e.out;
        });

        const typeUse = this.lr.typeUseNodes.get(expr.type);
        const typeDef = this.lr.typeDefNodes.get(typeUse.type);
        if (typeDef.variant === Lowered.ENode.FixedArrayDatatype) {
          outWriter.write(
            `(${this.mangleTypeUse(expr.type)}){ .data = {${values
              .map((v) => v.get())
              .join(", ")}} }`
          );
        } else if (typeDef.variant === Lowered.ENode.DynamicArrayDatatype) {
          assert(false, "should have been transpiled away");
        } else {
          assert(false);
        }

        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.ArraySubscriptExpr: {
        const e = this.emitExpr(expr.expr);
        tempWriter.write(e.temp);
        const index = this.emitExpr(expr.index);

        const typeUse = this.lr.typeUseNodes.get(this.lr.exprNodes.get(expr.expr).type);
        const typeDef = this.lr.typeDefNodes.get(typeUse.type);
        assert(
          typeDef.variant === Lowered.ENode.FixedArrayDatatype ||
            typeDef.variant === Lowered.ENode.DynamicArrayDatatype
        );

        const elementType = this.lr.typeUseNodes.get(typeDef.datatype);

        if (typeDef.variant === Lowered.ENode.FixedArrayDatatype) {
          tempWriter.write(index.temp);
          outWriter.write(`HZSTD_ARRAY_GET(${e.out.get()}, ${index.out.get()}, ${typeDef.length})`);
          return { out: outWriter, temp: tempWriter };
        } else if (typeDef.variant === Lowered.ENode.DynamicArrayDatatype) {
          tempWriter.write(index.temp);
          outWriter.write(
            `HZSTD_DYNAMIC_ARRAY_GET(${e.out.get()}, ${this.mangleName(
              elementType.name
            )}, ${index.out.get()})`
          );
          return { out: outWriter, temp: tempWriter };
        } else {
          assert(false);
        }
      }

      case Lowered.ENode.ArraySliceExpr: {
        const e = this.emitExpr(expr.expr);
        const sliceType = this.lr.typeUseNodes.get(expr.type);
        const arrayExpr = this.lr.exprNodes.get(expr.expr);
        const arrayExprType = this.lr.typeUseNodes.get(arrayExpr.type);
        const arrayExprTypeDef = this.lr.typeDefNodes.get(arrayExprType.type);
        assert(arrayExpr.variant !== Lowered.ENode.ArrayLiteralExpr);
        assert(arrayExprTypeDef.variant === Lowered.ENode.FixedArrayDatatype);

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

        // outWriter.write(
        //   `(hzstd_str_t){ .data=(hzstd_ccstr_t)${data.out.get()}, .length=${length.out.get()} }`
        // );
        outWriter.write(`HZSTD_STRING(${data.out.get()}, ${length.out.get()})`);
        return { out: outWriter, temp: tempWriter };
      }

      case Lowered.ENode.LiteralExpr: {
        function stringifyWithDecimal(num: number) {
          const s = num.toString();
          return s.includes(".") ? s : s + ".0";
        }

        if (expr.literal.type === EPrimitive.cstr) {
          outWriter.write(`(hzstd_cstr_t)(${JSON.stringify(expr.literal.value)})`);
        } else if (expr.literal.type === EPrimitive.ccstr) {
          outWriter.write(`(hzstd_ccstr_t)(${JSON.stringify(expr.literal.value)})`);
        } else if (expr.literal.type === EPrimitive.str) {
          const [value, length] = escapeStringForC(expr.literal.value);
          outWriter.write(`HZSTD_STRING("${value}", ${length})`);
        } else if (expr.literal.type === EPrimitive.bool) {
          outWriter.write(
            `(${this.primitiveToC(expr.literal.type)})(${expr.literal.value ? "1" : "0"})`
          );
        } else if (expr.literal.type === EPrimitive.null) {
          outWriter.write("(hzstd_null_t){}");
        } else if (expr.literal.type === EPrimitive.none) {
          outWriter.write("(hzstd_none_t){}");
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
        } else if (expr.literal.type === "enum") {
          const enumTypeId = lowerTypeDef(this.lr, expr.literal.enumType);
          const enumType = this.lr.typeDefNodes.get(enumTypeId);
          assert(enumType.variant === Lowered.ENode.EnumDatatype);
          const value = enumType.values.find((v) => {
            assert(expr.literal.type === "enum");
            return v.originalName === expr.literal.valueName;
          });
          assert(value);
          outWriter.write(`(${this.emitExpr(value.value).out.get()})`);
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
        assert(false, "All cases handled: " + Lowered.ENode[(expr as any).variant]);
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
