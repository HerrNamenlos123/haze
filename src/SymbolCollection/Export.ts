import { Semantic } from "../Semantic/Elaborate";
import { EExternLanguage } from "../shared/AST";
import { assert, formatSourceLoc } from "../shared/Errors";
import {
  Collect,
  funcSymHasParameterPack,
  printCollectedDatatype,
  printCollectedExpr,
  type CollectionContext,
} from "./SymbolCollection";

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

    case Collect.ENode.StructScope: {
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

function printType(cc: CollectionContext, typeId: Collect.TypeUseId): string {
  const type = cc.typeUseNodes.get(typeId);
  switch (type.variant) {
    case Collect.ENode.NamedDatatype: {
      let str = type.name;
      if (type.genericArgs.length !== 0) {
        str +=
          "<" +
          type.genericArgs
            .map((g) => {
              const expr = cc.exprNodes.get(g);
              if (expr.variant === Collect.ENode.TypeLiteralExpr) {
                return printCollectedDatatype(cc, expr.datatype);
              } else if (expr.variant === Collect.ENode.LiteralExpr) {
                return Semantic.serializeLiteralValue(expr.literal);
              } else {
                assert(false);
              }
            })
            .join(", ") +
          ">";
      }
      if (type.innerNested) {
        str += "." + printType(cc, type.innerNested);
      }
      return str;
    }

    case Collect.ENode.NullableReferenceDatatype: {
      return `?&${printType(cc, type.referee)}`;
    }

    case Collect.ENode.ReferenceDatatype: {
      return `&${printType(cc, type.referee)}`;
    }

    case Collect.ENode.StackArrayDatatype: {
      return `[${type.length}]${printType(cc, type.datatype)}`;
    }

    case Collect.ENode.DynamicArrayDatatype: {
      return `[]${printType(cc, type.datatype)}`;
    }

    case Collect.ENode.ParameterPack: {
      return "...";
    }

    case Collect.ENode.FunctionDatatype: {
      return `(${type.parameters.map((p, i) => `param${i}: ${printType(cc, p)}`).join(", ")}${
        type.vararg ? ", ..." : ""
      }) => ${printType(cc, type.returnType)}`;
    }

    default:
      assert(false, (type as any).variant.toString());
  }
}

export function ExportExpr(cc: CollectionContext, exprId: Collect.ExprId): string {
  const expr = cc.exprNodes.get(exprId);
  switch (expr.variant) {
    case Collect.ENode.LiteralExpr: {
      return Semantic.serializeLiteralValue(expr.literal);
    }

    case Collect.ENode.StructInstantiationExpr: {
      let str = `${expr.structType ? printCollectedDatatype(cc, expr.structType) : ""} {`;
      for (const m of expr.members) {
        str += `${m.name}: ${ExportExpr(cc, m.value)}`;
      }
      str += "}";
      return str;
    }

    case Collect.ENode.SymbolValueExpr: {
      if (expr.genericArgs.length > 0) {
        return expr.name + "<" + expr.genericArgs.map((g) => ExportExpr(cc, g)).join(", ") + ">";
      } else {
        return expr.name;
      }
    }

    default:
      assert(false, expr.variant.toString());
  }
}

export function ExportCollectedSymbols(cc: CollectionContext) {
  let file = "";

  for (const symbolId of cc.exportedSymbols.exported) {
    const symbol = cc.symbolNodes.get(symbolId);
    switch (symbol.variant) {
      case Collect.ENode.FunctionSymbol: {
        if (symbol.sourceloc) {
          file += `#source ${formatSourceLoc(symbol.sourceloc)} {\n`;
        }
        const namespaces = getNamespacesFromSymbol(cc, symbolId);
        for (const ns of namespaces.slice(0, -1)) {
          file += "namespace " + ns + " {\n";
        }
        if (symbol.generics.length !== 0 || funcSymHasParameterPack(cc, symbolId)) {
          // This is very ugly
          let code = symbol.originalSourcecode;
          if (code.startsWith(" export ")) {
            code = code.replace(" export ", "");
          }
          if (code.startsWith("export ")) {
            code = code.replace("export ", "");
          }
          file += code + "\n";
        } else {
          if (symbol.extern === EExternLanguage.Extern) {
            file += "extern ";
          } else if (symbol.extern === EExternLanguage.Extern_C) {
            file += "extern C ";
          }
          if (symbol.noemit) {
            file += "noemit ";
          }
          const overloadGroup = cc.symbolNodes.get(symbol.overloadGroup);
          assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroupSymbol);
          file += namespaces[namespaces.length - 1];
          file +=
            "(" +
            symbol.parameters.map((p, i) => `${p.name}: ${printType(cc, p.type)}`).join(", ") +
            (symbol.vararg ? ", ..." : "") +
            "): " +
            printType(cc, symbol.returnType);
          file += ";\n";
        }
        for (const ns of namespaces.slice(0, -1)) {
          file += "}\n";
        }
        if (symbol.sourceloc) {
          file += `}\n`;
        }
        break;
      }

      case Collect.ENode.TypeDefSymbol: {
        const typedef = cc.typeDefNodes.get(symbol.typeDef);
        if (typedef.sourceloc) {
          file += `#source ${formatSourceLoc(typedef.sourceloc)} {\n`;
        }
        switch (typedef.variant) {
          case Collect.ENode.StructTypeDef: {
            const namespaces = getNamespacesFromSymbol(cc, symbolId);
            for (const ns of namespaces.slice(0, -1)) {
              file += "namespace " + ns + " {\n";
            }
            if (typedef.generics.length !== 0) {
              // This is very ugly
              let code = typedef.originalSourcecode;
              if (code.startsWith(" export ")) {
                code = code.replace(" export ", "");
              }
              if (code.startsWith("export ")) {
                code = code.replace("export ", "");
              }
              file += code + "\n";
            } else {
              if (typedef.extern === EExternLanguage.Extern) {
                file += "extern ";
              } else if (typedef.extern === EExternLanguage.Extern_C) {
                file += "extern C ";
              }
              if (typedef.noemit) {
                file += "noemit ";
              }
              file += "struct ";
              file += namespaces[namespaces.length - 1] + " {\n";
              const structScope = cc.scopeNodes.get(typedef.structScope);
              assert(structScope.variant === Collect.ENode.StructScope);
              for (const contentId of structScope.symbols) {
                const content = cc.symbolNodes.get(contentId);
                if (content.variant === Collect.ENode.VariableSymbol) {
                  assert(content.type);
                  const defaultValue = typedef.defaultMemberValues.find(
                    (v) => v.name === content.name
                  );
                  if (defaultValue) {
                    file += `${content.name}: ${printType(cc, content.type)} = ${ExportExpr(
                      cc,
                      defaultValue.value
                    )};\n`;
                  } else {
                    file += `${content.name}: ${printType(cc, content.type)};\n`;
                  }
                } else if (content.variant === Collect.ENode.FunctionOverloadGroupSymbol) {
                  for (const overloadId of content.overloads) {
                    const method = cc.symbolNodes.get(overloadId);
                    assert(method.variant === Collect.ENode.FunctionSymbol);
                    if (method.generics.length !== 0) {
                      file += method.originalSourcecode + "\n";
                    } else {
                      const parameters = method.parameters
                        .map((p, i) => `${p.name}: ${printType(cc, p.type)}`)
                        .join(", ");
                      file += `${content.name}(${parameters}): ${printType(
                        cc,
                        method.returnType
                      )};\n`;
                    }
                  }
                } else {
                  assert(false, content.variant.toString());
                }
              }
              file += "}\n";
            }
            for (const ns of namespaces.slice(0, -1)) {
              file += "}\n";
            }
            break;
          }

          case Collect.ENode.TypeDefAlias: {
            file += `type ${symbol.name} = ${printType(cc, typedef.target)};\n`;
            break;
          }
          default:
            assert(false);
        }
        if (typedef.sourceloc) {
          file += `}\n`;
        }
        break;
      }

      case Collect.ENode.CInjectDirective: {
        if (symbol.sourceloc) {
          file += `#source ${formatSourceLoc(symbol.sourceloc)} {\n`;
        }
        file += `__c__("${symbol.value}");\n`;
        if (symbol.sourceloc) {
          file += `}\n`;
        }
        break;
      }

      default:
        assert(false, symbol.variant.toString());
    }
  }

  return file;
}
