import { scaleRadial } from "d3";
import { serializeDatatype, serializeLiteralValue } from "../Semantic/Serialize";
import { EClonability, EExternLanguage } from "../shared/AST";
import { assert } from "../shared/Errors";
import {
  Collect,
  funcSymHasParameterPack,
  printCollectedDatatype,
  type CollectionContext,
} from "./SymbolCollection";

function getNamespaces(
  cc: CollectionContext,
  symbolId: Collect.Id,
  current: string[] = []
): string[] {
  const symbol = cc.nodes.get(symbolId);
  switch (symbol.variant) {
    case Collect.ENode.FunctionSymbol: {
      const overloadGroup = cc.nodes.get(symbol.overloadGroup);
      assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroup);
      return getNamespaces(cc, symbol.parentScope, [overloadGroup.name, ...current]);
    }

    case Collect.ENode.NamespaceScope: {
      const namespace = cc.nodes.get(symbol.owningSymbol);
      assert(namespace.variant === Collect.ENode.NamespaceDefinitionSymbol);
      return getNamespaces(cc, symbol.parentScope, [namespace.name, ...current]);
    }

    case Collect.ENode.FileScope: {
      return current;
    }

    case Collect.ENode.ModuleScope: {
      return current;
    }

    case Collect.ENode.StructScope: {
      return getNamespaces(cc, symbol.owningSymbol, current);
    }

    case Collect.ENode.StructDefinitionSymbol: {
      return getNamespaces(cc, symbol.parentScope, [symbol.name, ...current]);
    }

    default:
      assert(false, symbol.variant.toString());
  }
}

function printType(cc: CollectionContext, typeId: Collect.Id): string {
  const type = cc.nodes.get(typeId);
  switch (type.variant) {
    case Collect.ENode.NamedDatatype: {
      let str = type.name;
      if (type.genericArgs.length !== 0) {
        str += "<" + type.genericArgs.map((g) => printType(cc, g)).join(", ") + ">";
      }
      if (type.innerNested) {
        str += "." + printType(cc, type.innerNested);
      }
      return str;
    }

    case Collect.ENode.PointerDatatype: {
      return `${printType(cc, type.pointee)}*`;
    }

    case Collect.ENode.ReferenceDatatype: {
      return `${printType(cc, type.referee)}&`;
    }

    case Collect.ENode.ArrayDatatype: {
      return `${printType(cc, type.datatype)}[${type.length}]`;
    }

    case Collect.ENode.SliceDatatype: {
      return `${printType(cc, type.datatype)}[]`;
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
      assert(false, type.variant.toString());
  }
}

export function ExportExpr(cc: CollectionContext, exprId: Collect.Id): string {
  const expr = cc.nodes.get(exprId);
  switch (expr.variant) {
    case Collect.ENode.LiteralExpr: {
      return serializeLiteralValue(expr.literal);
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
    const symbol = cc.nodes.get(symbolId);
    switch (symbol.variant) {
      case Collect.ENode.FunctionSymbol: {
        const namespaces = getNamespaces(cc, symbolId);
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
            file += 'extern "C" ';
          }
          if (symbol.noemit) {
            file += "noemit ";
          }
          const overloadGroup = cc.nodes.get(symbol.overloadGroup);
          assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroup);
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
        break;
      }

      case Collect.ENode.StructDefinitionSymbol: {
        const namespaces = getNamespaces(cc, symbolId);
        for (const ns of namespaces.slice(0, -1)) {
          file += "namespace " + ns + " {\n";
        }
        if (symbol.generics.length !== 0) {
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
            file += 'extern "C" ';
          }
          if (symbol.noemit) {
            file += "noemit ";
          }
          file += "struct ";
          if (symbol.clonability === EClonability.Clonable) {
            file += "clonable ";
          } else if (symbol.clonability === EClonability.NonClonableFromAttribute) {
            file += "nonclonable ";
          }
          file += namespaces[namespaces.length - 1] + " {\n";
          const structScope = cc.nodes.get(symbol.structScope);
          assert(structScope.variant === Collect.ENode.StructScope);
          for (const contentId of structScope.symbols) {
            const content = cc.nodes.get(contentId);
            if (content.variant === Collect.ENode.VariableSymbol) {
              assert(content.type);
              const defaultValue = symbol.defaultMemberValues.find((v) => v.name === content.name);
              if (defaultValue) {
                file += `${content.name}: ${printType(cc, content.type)} = ${ExportExpr(
                  cc,
                  defaultValue.value
                )};\n`;
              } else {
                file += `${content.name}: ${printType(cc, content.type)};\n`;
              }
            } else if (content.variant === Collect.ENode.FunctionOverloadGroup) {
              for (const overloadId of content.overloads) {
                const method = cc.nodes.get(overloadId);
                assert(method.variant === Collect.ENode.FunctionSymbol);
                if (method.generics.length !== 0) {
                  file += method.originalSourcecode + "\n";
                } else {
                  const parameters = method.parameters
                    .map((p, i) => `${p.name}: ${printType(cc, p.type)}`)
                    .join(", ");
                  file += `${content.name}(${parameters}): ${printType(cc, method.returnType)};\n`;
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

      case Collect.ENode.AliasTypeSymbol: {
        file += `type ${symbol.name} = ${printType(cc, symbol.target)};\n`;
        break;
      }

      case Collect.ENode.CInjectDirective: {
        file += `__c__("${symbol.value}");\n`;
        break;
      }

      default:
        assert(false, symbol.variant.toString());
    }
  }

  return file;
}
