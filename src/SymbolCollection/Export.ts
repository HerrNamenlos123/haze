import { EExternLanguage } from "../shared/AST";
import { assert } from "../shared/Errors";
import { Collect, funcSymHasParameterPack, type CollectionContext } from "./SymbolCollection";

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
      return `${printType(cc, type.referee)}*`;
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
          // TODO: If the function is generic and has "export", then the "export" keyword should not appear
          // in the generated import code.
          file += symbol.originalSourcecode;
        } else {
          if (symbol.noemit) {
            file += "noemit ";
          }
          if (symbol.extern === EExternLanguage.Extern) {
            file += "extern ";
          } else if (symbol.extern === EExternLanguage.Extern_C) {
            file += 'extern "C" ';
          }
          const overloadGroup = cc.nodes.get(symbol.overloadGroup);
          assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroup);
          file += namespaces[namespaces.length - 1];
          file +=
            "(" +
            symbol.parameters.map((p, i) => `${p.name}: ${printType(cc, p.type)}`).join(", ") +
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
          // TODO: If the function is generic and has "export", then the "export" keyword should not appear
          // in the generated import code.
          file += symbol.originalSourcecode;
        } else {
          if (symbol.noemit) {
            file += "noemit ";
          }
          if (symbol.extern === EExternLanguage.Extern) {
            file += "extern ";
          } else if (symbol.extern === EExternLanguage.Extern_C) {
            file += 'extern "C" ';
          }
          file += "struct " + namespaces[namespaces.length - 1] + " {\n";
          const structScope = cc.nodes.get(symbol.structScope);
          assert(structScope.variant === Collect.ENode.StructScope);
          for (const symbolId of structScope.symbols) {
            const symbol = cc.nodes.get(symbolId);
            if (symbol.variant === Collect.ENode.VariableSymbol) {
              assert(symbol.type);
              file += `${symbol.name}: ${printType(cc, symbol.type)};\n`;
            } else if (symbol.variant === Collect.ENode.FunctionOverloadGroup) {
              for (const overloadId of symbol.overloads) {
                const method = cc.nodes.get(overloadId);
                assert(method.variant === Collect.ENode.FunctionSymbol);
                const parameters = method.parameters
                  .map((p, i) => `${p.name}: ${printType(cc, p.type)}`)
                  .join(", ");
                file += `${symbol.name}(${parameters}): ${printType(cc, method.returnType)};\n`;
              }
            } else {
              assert(false, symbol.variant.toString());
            }
          }
          file += "}\n";
        }
        for (const ns of namespaces.slice(0, -1)) {
          file += "}\n";
        }
        break;
      }

      default:
        assert(false, symbol.variant.toString());
    }
  }

  return file;
}
