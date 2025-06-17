import type { SourceLoc } from "../Errors";
import type { Collect } from "../shared/CollectSymbols";

export type CollectResult = {
  globalScope: Collect.Scope;
  cInjections: { code: string; sourceloc: SourceLoc }[];
};
