import { Semantic, type SemanticResult } from "../Semantic/Elaborate";
import { EExternLanguage } from "../shared/AST";
import { EMethodType } from "../shared/common";
import { assert, formatSourceLoc } from "../shared/Errors";
import {
  Collect,
  funcSymHasParameterPack,
  printCollectedDatatype,
  printCollectedExpr,
  type CollectionContext,
} from "./SymbolCollection";

export function ExportCollectedTypeDefAlias(
  sr: SemanticResult,
  typedefId: Collect.TypeDefId,
  nested: boolean
) {
  const typedef = sr.cc.typeDefNodes.get(typedefId);
  assert(typedef.variant === Collect.ENode.TypeDefAlias);
  const generics = typedef.generics.map((g) => {
    const symbol = sr.cc.symbolNodes.get(g);
    assert(symbol.variant === Collect.ENode.GenericTypeParameterSymbol);
    return symbol.name;
  });
  const genericsString = generics.length > 0 ? `<${generics.join(", ")}>` : "";
  return (
    "type " +
    typedef.name +
    genericsString +
    " = " +
    printCollectedDatatype(sr.cc, typedef.target) +
    ";\n"
  );
}

export function ExportTypeDef(
  sr: SemanticResult,
  typedefId: Semantic.TypeDefId,
  nested: boolean
): string {
  let file = "";
  const typedef = sr.typeDefNodes.get(typedefId);
  switch (typedef.variant) {
    case Semantic.ENode.StructDatatype: {
      const namespaces = Semantic.getNamespaceChainFromDatatype(sr, typedefId);
      if (!nested) {
        for (const ns of namespaces.slice(0, -1)) {
          file += "namespace " + ns.pretty + " {\n";
        }
      }
      assert(typedef.generics.length === 0);
      if (typedef.extern === EExternLanguage.Extern) {
        file += "extern ";
      } else if (typedef.extern === EExternLanguage.Extern_C) {
        file += "extern C ";
      }
      if (typedef.noemit) {
        file += "noemit ";
      }
      if (typedef.opaque) {
        file += "opaque ";
      }
      if (typedef.plain) {
        file += "plain ";
      }
      file += "struct ";
      file += namespaces[namespaces.length - 1].pretty + " {\n";
      for (const member of typedef.members) {
        const content = sr.symbolNodes.get(member);
        assert(content.variant === Semantic.ENode.VariableSymbol);
        const defaultValue = typedef.memberDefaultValues.find((v) => v.memberName === content.name);
        assert(content.type);
        if (defaultValue) {
          file += `${content.name}: ${Semantic.serializeTypeUse(
            sr,
            content.type
          )} = ${Semantic.serializeExpr(sr, defaultValue.value)};\n`;
        } else {
          file += `${content.name}: ${Semantic.serializeTypeUse(sr, content.type)};\n`;
        }
      }
      for (const methodId of typedef.methods) {
        const method = sr.symbolNodes.get(methodId);
        assert(method.variant === Semantic.ENode.FunctionSymbol);
        if (method.generics.length !== 0) {
          const originalFunc = sr.cc.symbolNodes.get(method.originalCollectedFunction);
          assert(originalFunc.variant === Collect.ENode.FunctionSymbol);
          file += originalFunc.originalSourcecode + "\n";
        } else {
          const functype = sr.typeDefNodes.get(method.type);
          assert(functype.variant === Semantic.ENode.FunctionDatatype);
          let rawParams = functype.parameters;
          if (!method.staticMethod && method.methodType !== EMethodType.Constructor) {
            rawParams = rawParams.slice(1, undefined);
          }
          const parameters = rawParams
            .map(
              (p, i) =>
                `${method.parameterNames[i + 1]}${
                  p.optional ? "?" : ""
                }: ${Semantic.serializeTypeUse(sr, p.type)}`
            )
            .join(", ");
          if (functype.returnType) {
            file += `${method.name}(${parameters}): (${Semantic.serializeTypeUse(
              sr,
              functype.returnType
            )})`;
            file += " :: final";
            if (functype.requires.pure) {
              file += ", pure";
            }
            if (functype.requires.noreturn) {
              file += ", noreturn";
            }
            if (functype.requires.noreturnIf) {
              file += `, noreturn_if(${printCollectedExpr(
                sr.cc,
                functype.requires.noreturnIf.expr
              )})`;
            }
            file += `;\n`;
          } else {
            file += `${method.name}(${parameters});\n`;
          }
        }
      }
      for (const inner of typedef.nestedStructs) {
        file += ExportTypeDef(sr, inner, true) + "\n\n";
      }
      file += "}\n";
      if (!nested) {
        for (const ns of namespaces.slice(0, -1)) {
          file += "}\n";
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
      if (typedef.extern === EExternLanguage.Extern) {
        file += "extern ";
      } else if (typedef.extern === EExternLanguage.Extern_C) {
        file += "extern C ";
      }
      if (typedef.noemit) {
        file += "noemit ";
      }
      file += "enum ";
      file += typedef.name + " {\n";
      for (const value of typedef.values) {
        file += `${value.name} = ${Semantic.serializeExpr(sr, value.valueExpr)},\n`;
      }
      file += "}\n";
      break;
    }

    default:
      assert(false);
  }
  return file;
}

export function ExportSymbol(
  sr: SemanticResult,
  symbolId: Semantic.SymbolId,
  nested: boolean
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
          !funcSymHasParameterPack(sr.cc, symbol.originalCollectedFunction)
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
          .map(
            (p, i) =>
              `${symbol.parameterNames[i]}${p.optional ? "?" : ""}: ${Semantic.serializeTypeUse(
                sr,
                p.type
              )}`
          )
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
  current: string[] = []
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

function getNamespacesFromSymbol(
  cc: CollectionContext,
  symbolId: Collect.SymbolId,
  current: string[] = []
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

export function ExportCollectedSymbols(sr: SemanticResult) {
  let file = "";

  for (const symbolId of sr.exportedSymbols) {
    file += ExportSymbol(sr, symbolId, false);
  }

  for (const id of sr.exportedTypeAliases) {
    file += ExportCollectedTypeDefAlias(sr, id, false);
  }

  for (const symbolId of sr.cc.exportedGenericSymbols) {
    const symbol = sr.cc.symbolNodes.get(symbolId);

    // if (symbol.sourceloc) {
    //   file += `#source ${formatSourceLoc(symbol.sourceloc)} {\n`;
    // }
    const namespaces = getNamespacesFromSymbol(sr.cc, symbolId);
    for (const ns of namespaces.slice(0, -1)) {
      file += "namespace " + ns + " {\n";
    }

    if (symbol.variant === Collect.ENode.FunctionSymbol) {
      let code = symbol.originalSourcecode;
      if (code.startsWith(" export ")) {
        code = code.replace(" export ", "");
      }
      if (code.startsWith("export ")) {
        code = code.replace("export ", "");
      }
      file += code + "\n";
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
        file += code + "\n";
      } else {
        assert(false);
      }
    } else {
      assert(false);
    }

    for (const ns of namespaces.slice(0, -1)) {
      file += "}\n";
    }
  }

  return file;
}
