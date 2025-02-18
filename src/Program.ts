import type { Datatype } from "./Datatype";
import { Location } from "./Errors";
import { Scope } from "./Scope";
import type { FunctionSymbol } from "./Symbol";

export class Program {
  globalScope: Scope;
  resolvedFunctions: { [name: string]: FunctionSymbol };
  resolvedDatatypes: { [name: string]: Datatype };
  filename: string;

  constructor(filename: string) {
    this.filename = filename;
    this.globalScope = new Scope(new Location("global", 0, 0));
    this.resolvedFunctions = {};
    this.resolvedDatatypes = {};
  }
}
