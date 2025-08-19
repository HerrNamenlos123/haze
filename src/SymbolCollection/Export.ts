import { assert } from "../shared/Errors";
import { Collect, type CollectionContext } from "./SymbolCollection";

export function ExportCollectedSymbols(cc: CollectionContext) {
  let file = "";

  for (const symbolId of cc.exportedSymbols.exported) {
    const symbol = cc.nodes.get(symbolId);
    switch (symbol.variant) {
      case Collect.ENode.FunctionSymbol: {
        file += symbol.originalSourcecode;
        break;
      }

      default:
        assert(false, symbol.variant.toString());
    }
  }

  return file;
}
