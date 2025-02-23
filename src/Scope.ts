import { CompilerError, type Location } from "./Errors";
import type { Statement } from "./Statement";
import { mangleSymbol, type Symbol } from "./Symbol";

export class Scope {
  public location: Location;
  public parentScope?: Scope;
  public statements: Statement[];
  public terminated: boolean = false;
  private symbols: Symbol[];

  constructor(location: Location, parentScope?: Scope) {
    this.symbols = [];
    this.location = location;
    this.parentScope = parentScope;
    this.statements = [];
  }

  defineSymbol(symbol: Symbol, loc: Location) {
    if (symbol.variant === "Constant") {
      throw new CompilerError(`Cannot define a constant symbol`, loc);
    }
    if (this.tryLookupSymbol(symbol.name, loc)) {
      throw new CompilerError(
        `Symbol '${symbol.name}' was already defined in this scope`,
        loc,
      );
    }
    this.symbols.push(symbol);
  }

  removeSymbol(name: string) {
    this.symbols = this.symbols.filter(
      (s) => s.variant !== "Constant" && s.name !== name,
    );
  }

  getSymbols() {
    return this.symbols;
  }

  tryLookupSymbol(name: string, loc: Location): Symbol | undefined {
    let symbol = this.symbols.find(
      (s) => s.variant !== "Constant" && s.name === name,
    );
    if (symbol) {
      return symbol;
    }

    if (this.parentScope) {
      return this.parentScope.tryLookupSymbol(name, loc);
    }
    return undefined;
  }

  lookupSymbol(name: string, loc: Location): Symbol {
    let symbol = this.tryLookupSymbol(name, loc);
    if (symbol) {
      return symbol;
    }
    if (this.parentScope) {
      return this.parentScope.lookupSymbol(name, loc);
    }
    throw new CompilerError(
      `Symbol '${name}' was not declared in this scope`,
      loc,
    );
  }
}
