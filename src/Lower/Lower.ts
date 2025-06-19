import type { Semantic, SemanticResult } from "../Semantic/SemanticSymbols";
import type { CollectResult } from "../SymbolCollection/CollectSymbols";
import type { Lowered } from "./LowerTypes";

export function lower(lr: Lowered.Module) {}

export function LowerModule(cr: CollectResult, sr: SemanticResult): Lowered.Module {
  const lr: Lowered.Module = {
    cr: cr,
    sr: sr,

    cDeclarations: cr.cInjections.map((i) => i.code),

    datatypes: new Map(),
  };

  for (const [id, symbol] of sr.symbolTable.getAll()) {
    console.log(symbol);
    //   lower(sr.)
  }

  return lr;
}
