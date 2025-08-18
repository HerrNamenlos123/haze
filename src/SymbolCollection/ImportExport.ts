import type { ExportNode } from "../shared/Config";
import { assert } from "../shared/Errors";
import { Collect, type CollectionContext } from "./SymbolCollection";

function addNode<T extends Collect.Node>(
  cc: CollectionContext,
  node: T
): [ExportNode<T>, Collect.Id] {
  const id = cc.exportedSymbols.nodes.length as Collect.Id;
  cc.exportedSymbols.nodes.push({
    ...node,
    exportMode: "implicit",
  });
  return [cc.exportedSymbols.nodes[id] as unknown as ExportNode<T>, id];
}

function promoteToExplicit(cc: CollectionContext, id: number) {
  if (cc.exportedSymbols.nodes[id].exportMode === "implicit") {
    cc.exportedSymbols.nodes[id].exportMode = "explicit";
  }
}

function getExportScope(cc: CollectionContext) {
  if (cc.exportedSymbols.nodes.length === 0) {
    const [scope, id] = addNode<Collect.ExportScope>(cc, {
      variant: Collect.ENode.ExportScope,
      symbols: [],
    });
    promoteToExplicit(cc, id);
    return id;
  }

  const filescope = cc.exportedSymbols.nodes[0];
  assert(filescope.variant === Collect.ENode.ExportScope);
  return 0 as Collect.Id;
}

function makeFunctionOverloadGroup(cc: CollectionContext, name: string) {
  for (let i = 0; i < cc.exportedSymbols.nodes.length; i++) {
    const node = cc.exportedSymbols.nodes[i];
    if (node.variant === Collect.ENode.FunctionOverloadGroup && node.name === name) {
      return [node, i as Collect.Id] as const;
    }
  }

  return addNode<Collect.FunctionOverloadGroup>(cc, {
    variant: Collect.ENode.FunctionOverloadGroup,
    name: name,
    overloads: [],
    parentScope: getExportScope(cc),
  });
}

function makeFunctionSymbol(
  cc: CollectionContext,
  symbol: Collect.FunctionSymbol,
  parentScope: Collect.Id,
  overloadGroup: Collect.Id
) {
  const [functionSymbol, functionSymbolId] = addNode<Collect.FunctionSymbol>(cc, {
    variant: Collect.ENode.FunctionSymbol,
    export: symbol.export,
    extern: symbol.extern,
    functionScope: -1 as Collect.Id,
    generics: symbol.generics.map((g) => ExportCollectedSymbol(cc, g)),
    methodType: symbol.methodType,
    noemit: symbol.noemit,
    overloadGroup: overloadGroup,
    parameters: symbol.parameters.map((p) => ({
      name: p.name,
      sourceloc: p.sourceloc,
      type: ExportCollectedSymbol(cc, p.type),
    })),
    parentScope: parentScope,
    pub: symbol.pub,
    returnType: ExportCollectedSymbol(cc, symbol.returnType),
    sourceloc: symbol.sourceloc,
    vararg: symbol.vararg,
  });
  const [functionScope, functionScopeId] = addNode<Collect.FunctionScope>(cc, {
    variant: Collect.ENode.FunctionScope,
    blockScope: -1 as Collect.Id,
    owningSymbol: functionSymbolId,
    parentScope: parentScope,
    sourceloc: symbol.sourceloc,
    symbols: [],
  });
  functionSymbol.functionScope = functionScopeId;
  return [functionSymbol, functionSymbolId] as const;
}

export function ExportCollectedSymbol(cc: CollectionContext, symbolId: Collect.Id): Collect.Id {
  if (cc.exportCache.has(symbolId)) {
    return cc.exportCache.get(symbolId)!;
  }

  const symbol = cc.nodes.get(symbolId);
  switch (symbol.variant) {
    case Collect.ENode.FunctionSymbol: {
      const internalOverloadGroup = cc.nodes.get(symbol.overloadGroup);
      assert(internalOverloadGroup.variant === Collect.ENode.FunctionOverloadGroup);
      const [overloadGroup, overloadGroupId] = makeFunctionOverloadGroup(
        cc,
        internalOverloadGroup.name
      );
      promoteToExplicit(cc, overloadGroupId);

      const [functionSymbol, functionSymbolId] = makeFunctionSymbol(
        cc,
        symbol,
        getExportScope(cc),
        overloadGroupId
      );
      return functionSymbolId;
    }

    // case Collect.ENode.NamedDatatype: {
    //   return;
    // }

    case Collect.ENode.GenericTypeParameter: {
      return addNode(cc, {
        variant: Collect.ENode.GenericTypeParameter,
        name: symbol.name,
        sourceloc: symbol.sourceloc,
        owningSymbol: ExportCollectedSymbol(cc, symbol.owningSymbol),
      })[1];
    }

    default:
      assert(false, "" + symbol.variant);
  }
}
