import { CompilerError, type SourceLoc } from "./Errors";
import type { Module } from "./Module";
import type { ParsedSymbol } from "./ParsedTypes";
import type { Statement } from "./Statement";
import type { ScopeId } from "./store";

export class ResolvedScope {
  private symbols: ParsedSymbol.Symbol[] = [];
  public statements: Statement[] = [];
  public terminated: boolean = false;

  constructor(
    public id: ScopeId,
    public location: SourceLoc,
    public parentScope?: ScopeId,
  ) {}

  defineSymbol(symbol: ParsedSymbol.Symbol) {
    if (symbol.variant === "Constant") {
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

  getAllSymbols() {
    return this.symbols;
  }

  tryLookupSymbol(
    module: Module,
    name: string,
    loc: SourceLoc,
  ): ParsedSymbol.Symbol | undefined {
    let symbol = this.symbols.find((s) => "name" in s && s.name === name);
    if (symbol) {
      return symbol;
    }

    if (this.parentScope) {
      return module.parsedStore
        .getScope(this.parentScope)
        .tryLookupSymbol(module, name, loc);
    }
    return undefined;
  }

  tryLookupSymbolHere(name: string): ParsedSymbol.Symbol | undefined {
    return this.symbols.find((s) => "name" in s && s.name === name);
  }

  lookupSymbol(
    module: Module,
    name: string,
    loc: SourceLoc,
  ): ParsedSymbol.Symbol {
    let symbol = this.tryLookupSymbol(module, name, loc);
    if (symbol) {
      return symbol;
    }
    if (this.parentScope) {
      return module.parsedStore
        .getScope(this.parentScope)
        .lookupSymbol(module, name, loc);
    }
    throw new CompilerError(
      `Symbol '${name}' was not declared in this scope`,
      loc,
    );
  }
}
