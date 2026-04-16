import { OutputWriter } from "../Codegen/OutputWriter";
import { Semantic } from "../Semantic/SemanticTypes";
import { EDatatypeMutability, EExternLanguage, EOverloadedOperator } from "../shared/AST";
import { EMethodType } from "../shared/common";
import { getModuleGlobalNamespaceName } from "../shared/Config";
import { assert, formatSourceLoc } from "../shared/Errors";
import {
  Collect,
  funcSymHasParameterPack,
  printCollectedDatatype,
  printCollectedExpr,
  type CollectionContext,
} from "./SymbolCollection";

export function ExportCollectedTypeDefAlias(
  sr: Semantic.Context,
  typedefId: Collect.TypeDefId,
  nested: boolean,
) {
  const typedef = sr.cc.typeDefNodes.get(typedefId);
  assert(typedef.variant === Collect.ENode.TypeDefAlias);
  const generics = typedef.generics.map((g) => {
    const symbol = sr.cc.symbolNodes.get(g);
    assert(symbol.variant === Collect.ENode.GenericTypeParameterSymbol);
    return symbol.name;
  });
  const genericsString = generics.length > 0 ? `<${generics.join(", ")}>` : "";

  let alias = new OutputWriter(4);

  if (sr.cc.config.name !== "haze-stdlib") {
    const moduleName = getModuleGlobalNamespaceName(sr.cc.config.name, sr.cc.config.version);
    alias.writeLine(`namespace ${moduleName} {`).pushIndent();
  }

  const namespaces = getNamespacesFromTypeDefSymbol(sr.cc, typedefId);
  for (const ns of namespaces.slice(0, -1)) {
    alias.writeLine(`namespace ${ns} {`).pushIndent();
  }

  if (typedef.sourceloc) {
    alias.writeLine(`#source ${formatSourceLoc(typedef.sourceloc)} {`).pushIndent();
  }

  alias.writeLine(
    "type " +
      typedef.name +
      genericsString +
      " = " +
      printCollectedDatatype(sr.cc, typedef.target) +
      ";",
  );

  if (typedef.sourceloc) {
    alias.popIndent().writeLine(`}`);
  }

  for (const ns of namespaces.slice(0, -1)) {
    alias.popIndent().writeLine(`}`);
  }

  if (sr.cc.config.name !== "haze-stdlib") {
    alias.popIndent().writeLine(`}`);
  }

  return alias;
}

export function ExportTypeDef(
  sr: Semantic.Context,
  typedefId: Semantic.TypeDefId,
  nested: boolean,
): string {
  let file = new OutputWriter(4);
  const typedef = sr.typeDefNodes.get(typedefId);
  switch (typedef.variant) {
    case Semantic.ENode.StructDatatype: {
      const namespaces = Semantic.getNamespaceChainFromDatatype(sr, typedefId);
      if (!nested) {
        for (const ns of namespaces.slice(0, -1)) {
          file.writeLine("namespace " + ns.pretty + " {").pushIndent();
        }
      }
      assert(typedef.generics.length === 0);
      if (typedef.extern === EExternLanguage.Extern) {
        file.write("extern ");
      } else if (typedef.extern === EExternLanguage.Extern_C) {
        file.write("extern C ");
      }
      if (typedef.noemit) {
        file.write("noemit ");
      }
      if (typedef.opaque) {
        file.write("opaque ");
      }
      if (typedef.plain) {
        file.write("plain ");
      }
      if (typedef.inlineByDefault) {
        file.write("inline ");
      }
      file.write("struct ");
      file.writeLine(namespaces[namespaces.length - 1].pretty + " {").pushIndent();
      for (const member of typedef.members) {
        const content = sr.symbolNodes.get(member);
        assert(content.variant === Semantic.ENode.VariableSymbol);
        const defaultValue = typedef.memberDefaultValues.find((v) => v.memberName === content.name);
        assert(content.type);
        if (defaultValue) {
          file.writeLine(
            `${content.name}: ${Semantic.serializeTypeUse(
              sr,
              content.type,
            )} = ${Semantic.serializeExpr(sr, defaultValue.value)};`,
          );
        } else {
          file.writeLine(`${content.name}: ${Semantic.serializeTypeUse(sr, content.type)};`);
        }
      }
      for (const methodId of typedef.methods) {
        const method = sr.symbolNodes.get(methodId);
        assert(method.variant === Semantic.ENode.FunctionSymbol);
        if (method.generics.length !== 0) {
          const originalFunc = sr.cc.symbolNodes.get(method.originalCollectedFunction);
          assert(originalFunc.variant === Collect.ENode.FunctionSymbol);
          file.writeLine(originalFunc.originalSourcecode);
        } else {
          const functype = sr.typeDefNodes.get(method.type);
          assert(functype.variant === Semantic.ENode.FunctionDatatype);
          const parameters = functype.parameters
            .map(
              (p, i) =>
                `${method.parameterNames[i]}${
                  p.optional ? "?" : ""
                }: ${Semantic.serializeTypeUse(sr, p.type)}`,
            )
            .join(", ");
          let methodName = method.name;

          if (method.overloadedOperator === undefined) {
            // Nothing
          } else if (method.overloadedOperator === EOverloadedOperator.Assign) {
            methodName = "operator:=";
          } else if (method.overloadedOperator === EOverloadedOperator.LessThan) {
            methodName = "operator<";
          } else if (method.overloadedOperator === EOverloadedOperator.LessThanOrEqual) {
            methodName = "operator<=";
          } else if (method.overloadedOperator === EOverloadedOperator.GreaterThan) {
            methodName = "operator>";
          } else if (method.overloadedOperator === EOverloadedOperator.GreaterThanOrEqual) {
            methodName = "operator>=";
          } else if (method.overloadedOperator === EOverloadedOperator.Equal) {
            methodName = "operator==";
          } else if (method.overloadedOperator === EOverloadedOperator.NotEqual) {
            methodName = "operator!=";
          } else if (method.overloadedOperator === EOverloadedOperator.Subscript) {
            methodName = "operator[]";
          } else {
            assert(false);
          }

          if (method.staticMethod) {
            file.write("static ");
          }

          if (method.methodRequiredMutability === EDatatypeMutability.Mut) {
            file.write("mut ");
          } else if (method.methodRequiredMutability === EDatatypeMutability.Const) {
            file.write("const ");
          }

          if (functype.returnType) {
            file.write(
              `${methodName}(${parameters}): (${Semantic.serializeTypeUse(
                sr,
                functype.returnType,
              )})`,
            );
            file.write(" :: final");
            if (functype.requires.pure) {
              file.write(", pure");
            }
            if (functype.requires.noreturn) {
              file.write(", noreturn");
            }
            if (functype.requires.noreturnIf) {
              file.write(
                `, noreturn_if(${printCollectedExpr(sr.cc, functype.requires.noreturnIf.expr)})`,
              );
            }
            file.writeLine(`;`);
          } else {
            file.writeLine(`${methodName}(${parameters});`);
          }
        }
      }

      // Emit generic methods. Those are NOT elaborated yet, so we have to workaround through the collected symbol.
      const collected = sr.cc.symbolNodes.get(typedef.originalCollectedSymbol);
      assert(collected.variant === Collect.ENode.TypeDefSymbol);
      const collectedStruct = sr.cc.typeDefNodes.get(collected.typeDef);
      assert(collectedStruct.variant === Collect.ENode.StructTypeDef);
      const lexicalScope = sr.cc.scopeNodes.get(collectedStruct.lexicalScope);
      assert(lexicalScope.variant === Collect.ENode.StructLexicalScope);
      for (const symbolId of lexicalScope.symbols) {
        const symbol = sr.cc.symbolNodes.get(symbolId);
        if (symbol.variant === Collect.ENode.FunctionOverloadGroupSymbol) {
          for (const overloadId of symbol.overloads) {
            const overload = sr.cc.symbolNodes.get(overloadId);
            if (overload.variant === Collect.ENode.FunctionSymbol) {
              if (overload.generics.length > 0) {
                file.writeLine(overload.originalSourcecode);
              }
            }
          }
        }
      }

      for (const inner of typedef.nestedStructs) {
        file.writeLine(ExportTypeDef(sr, inner, true)).writeLine();
      }
      file.popIndent().writeLine("}");
      if (!nested) {
        for (const ns of namespaces.slice(0, -1)) {
          file.popIndent().writeLine("}");
        }
      }
      break;
    }

    // case Semantic.ENode.TypeDefSymbol: {
    //   const generics =
    //     typedef.generics.length > 0
    //       ? `<${typedef.generics
    //           .map((g) => {
    //             const sym = cc.symbolNodes.get(g);
    //             assert(sym.variant === Collect.ENode.GenericTypeParameterSymbol);
    //             return sym.name;
    //           })
    //           .join(", ")}>`
    //       : "";
    //   file += `type ${symbol.name}${generics} = ${printType(cc, typedef.target)};\n`;
    //   break;
    // }

    case Semantic.ENode.EnumDatatype: {
      const namespaces = Semantic.getNamespaceChainFromDatatype(sr, typedefId);
      if (!nested) {
        for (const ns of namespaces.slice(0, -1)) {
          file.writeLine("namespace " + ns.pretty + " {").pushIndent();
        }
      }

      if (typedef.extern === EExternLanguage.Extern) {
        file.write("extern ");
      } else if (typedef.extern === EExternLanguage.Extern_C) {
        file.write("extern C ");
      }
      if (typedef.noemit) {
        file.write("noemit ");
      }
      file.write("enum ");
      if (typedef.unscoped) {
        file.write("unscoped ");
      }
      if (typedef.bitflag) {
        file.write("bitflag ");
      }
      file.writeLine(typedef.name + " {").pushIndent();
      for (const value of typedef.values) {
        file.writeLine(`${value.name} = ${Semantic.serializeExpr(sr, value.valueExpr)},`);
      }
      file.popIndent().writeLine("}");

      if (!nested) {
        for (const ns of namespaces.slice(0, -1)) {
          file.popIndent().writeLine("}");
        }
      }
      break;
    }

    default:
      assert(false);
  }
  return file.get();
}

export function ExportSymbol(
  sr: Semantic.Context,
  symbolId: Semantic.SymbolId,
  nested: boolean,
): string {
  let file = "";

  const symbol = sr.symbolNodes.get(symbolId);
  switch (symbol.variant) {
    case Semantic.ENode.FunctionSymbol: {
      if (symbol.sourceloc) {
        file += `#source ${formatSourceLoc(symbol.sourceloc)} {\n`;
      }
      const namespaces = Semantic.getNamespaceChainFromSymbol(sr, symbolId);
      for (const ns of namespaces.slice(0, -1)) {
        file += "namespace " + ns.pretty + " {\n";
      }
      assert(
        symbol.generics.length === 0 &&
          !funcSymHasParameterPack(sr.cc, symbol.originalCollectedFunction),
      );
      const functype = sr.typeDefNodes.get(symbol.type);
      assert(functype.variant === Semantic.ENode.FunctionDatatype);
      // console.log(symbol.name, symbol);
      if (symbol.extern === EExternLanguage.Extern) {
        file += "extern ";
      } else if (symbol.extern === EExternLanguage.Extern_C) {
        file += "extern C ";
      }
      if (symbol.noemit) {
        file += "noemit ";
      }
      file += symbol.name;
      file +=
        "(" +
        functype.parameters
          .map((p, i) => {
            let paramStr = `${symbol.parameterNames[i]}${p.optional ? "?" : ""}: ${Semantic.serializeTypeUse(
              sr,
              p.type,
            )}`;
            // Add default value if present
            const defaultValue = symbol.parameterDefaultValues.find(
              (dv) => dv.parameterName === symbol.parameterNames[i],
            );
            if (defaultValue) {
              paramStr += ` = ${Semantic.serializeExpr(sr, defaultValue.value)}`;
            }
            return paramStr;
          })
          .join(", ") +
        (functype.vararg ? ", ..." : "") +
        ")" +
        (functype.returnType
          ? ": (" + Semantic.serializeTypeUse(sr, functype.returnType) + ")"
          : " ");
      file += " :: final";
      if (functype.requires.pure) {
        file += ", pure";
      }
      if (functype.requires.noreturn) {
        file += ", noreturn";
      }
      if (functype.requires.noreturnIf) {
        file += `, noreturn_if(${printCollectedExpr(sr.cc, functype.requires.noreturnIf.expr)})`;
      }
      file += ";\n";
      for (const ns of namespaces.slice(0, -1)) {
        file += "}\n";
      }
      if (symbol.sourceloc) {
        file += `}\n`;
      }
      break;
    }

    case Semantic.ENode.TypeDefSymbol: {
      file += ExportTypeDef(sr, symbol.datatype, nested);
      break;
    }

    case Semantic.ENode.CInjectDirectiveSymbol: {
      if (symbol.sourceloc) {
        file += `#source ${formatSourceLoc(symbol.sourceloc)} {\n`;
      }
      file += `__c__(${JSON.stringify(symbol.value)});\n`;
      if (symbol.sourceloc) {
        file += `}\n`;
      }
      break;
    }

    default:
      assert(false, symbol.variant.toString());
  }

  return file;
}

function getNamespacesFromScope(
  cc: CollectionContext,
  scopeId: Collect.ScopeId,
  current: string[] = [],
): string[] {
  const scope = cc.scopeNodes.get(scopeId);
  switch (scope.variant) {
    case Collect.ENode.NamespaceScope: {
      const namespace = cc.symbolNodes.get(scope.owningSymbol);
      assert(namespace.variant === Collect.ENode.TypeDefSymbol);
      const ns = cc.typeDefNodes.get(namespace.typeDef);
      assert(ns.variant === Collect.ENode.NamespaceTypeDef);
      return getNamespacesFromScope(cc, scope.parentScope, [namespace.name, ...current]);
    }

    case Collect.ENode.FileScope: {
      return current;
    }

    case Collect.ENode.ModuleScope: {
      return current;
    }

    case Collect.ENode.StructLexicalScope: {
      return getNamespacesFromSymbol(cc, scope.owningSymbol, current);
    }

    default:
      assert(false, scope.variant.toString());
  }
}

function getNamespacesFromTypeDefSymbol(
  cc: CollectionContext,
  typedefId: Collect.TypeDefId,
  current: string[] = [],
) {
  const typedef = cc.typeDefNodes.get(typedefId);
  assert(typedef.variant === Collect.ENode.TypeDefAlias);
  return getNamespacesFromScope(cc, typedef.inScope, [typedef.name, ...current]);
}

function getNamespacesFromSymbol(
  cc: CollectionContext,
  symbolId: Collect.SymbolId,
  current: string[] = [],
): string[] {
  const symbol = cc.symbolNodes.get(symbolId);
  switch (symbol.variant) {
    case Collect.ENode.FunctionSymbol: {
      const overloadGroup = cc.symbolNodes.get(symbol.overloadGroup);
      assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroupSymbol);
      return getNamespacesFromScope(cc, symbol.parentScope, [overloadGroup.name, ...current]);
    }

    case Collect.ENode.TypeDefSymbol: {
      const s = cc.typeDefNodes.get(symbol.typeDef);
      assert(s.variant === Collect.ENode.StructTypeDef);
      return getNamespacesFromScope(cc, s.parentScope, [symbol.name, ...current]);
    }

    default:
      assert(false, symbol.variant.toString());
  }
}

export function ExportCollectedSymbols(sr: Semantic.Context) {
  let file = new OutputWriter(4);

  for (const symbolId of sr.exportedSymbols) {
    file.writeLine(ExportSymbol(sr, symbolId, false));
  }

  for (const id of sr.exportedTypeAliases) {
    file.writeLine(ExportCollectedTypeDefAlias(sr, id, false));
  }

  for (const symbolId of sr.cc.exportedGenericSymbols) {
    const symbol = sr.cc.symbolNodes.get(symbolId);

    // if (symbol.sourceloc) {
    //   file += `#source ${formatSourceLoc(symbol.sourceloc)} {\n`;
    // }
    const namespaces = getNamespacesFromSymbol(sr.cc, symbolId);
    for (const ns of namespaces.slice(0, -1)) {
      file.writeLine("namespace " + ns + " {");
    }

    if (symbol.variant === Collect.ENode.FunctionSymbol) {
      let code = symbol.originalSourcecode;
      if (code.startsWith(" export ")) {
        code = code.replace(" export ", "");
      }
      if (code.startsWith("export ")) {
        code = code.replace("export ", "");
      }
      file.writeLine(code);
    } else if (symbol.variant === Collect.ENode.TypeDefSymbol) {
      const typedef = sr.cc.typeDefNodes.get(symbol.typeDef);
      if (typedef.variant === Collect.ENode.StructTypeDef) {
        let code = typedef.originalSourcecode;
        if (code.startsWith(" export ")) {
          code = code.replace(" export ", "");
        }
        if (code.startsWith("export ")) {
          code = code.replace("export ", "");
        }
        file.writeLine(code);
      } else {
        assert(false);
      }
    } else {
      assert(false);
    }

    for (const ns of namespaces.slice(0, -1)) {
      file.writeLine("}");
    }
  }

  return file.get();
}
