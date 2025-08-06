import type { Collect } from "./CollectSymbols";

export function ExportCollectedSymbols(symbol: Collect.Scope | Collect.Symbol) {
    console.log(symbol);
}