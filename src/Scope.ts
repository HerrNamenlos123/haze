import {
  CompilerError,
  getCallerLocation,
  InternalError,
  type Location,
} from "./Errors";
import type { Statement } from "./Statement";
import { mangleSymbol, type DatatypeSymbol, type Symbol } from "./Symbol";

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

  defineSymbol(symbol: Symbol) {
    if (
      symbol.variant === "StringConstant" ||
      symbol.variant === "BooleanConstant" ||
      symbol.variant === "LiteralConstant"
    ) {
      throw new CompilerError(
        `Cannot define a constant symbol`,
        symbol.location,
      );
    }
    if (this.tryLookupSymbolHere(symbol.name)) {
      throw new CompilerError(
        `Symbol '${symbol.name}' was already defined in this scope`,
        symbol.location,
      );
    }
    this.symbols.push(symbol);
  }

  removeSymbol(name: string) {
    this.symbols = this.symbols.filter((s) => "name" in s && s.name === name);
  }

  getSymbols() {
    return this.symbols;
  }

  tryLookupSymbol(name: string, loc: Location): Symbol | undefined {
    let symbol = this.symbols.find((s) => "name" in s && s.name === name);
    if (symbol) {
      return symbol;
    }

    if (this.parentScope) {
      return this.parentScope.tryLookupSymbol(name, loc);
    }
    return undefined;
  }

  tryLookupSymbolHere(name: string): Symbol | undefined {
    return this.symbols.find((s) => "name" in s && s.name === name);
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

  lookupDatatypeSymbol(name: string, loc: Location): DatatypeSymbol {
    const symbol = this.lookupSymbol(name, loc);
    if (symbol.variant !== "Datatype") {
      throw new CompilerError(
        `Expected Datatype but found symbol of variant ${symbol.variant}`,
        loc,
      );
    }
    return symbol;
  }
}
