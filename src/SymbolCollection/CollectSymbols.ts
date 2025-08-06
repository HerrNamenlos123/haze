import { assert, CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import type {
  ASTFunctionDeclaration,
  ASTFunctionDefinition,
  ASTGlobalVariableDefinition,
  ASTNamespaceDefinition,
  ASTStatement,
  ASTStructDefinition,
  ASTStructMemberDefinition,
  ASTStructMethodDefinition,
  ASTVariableDefinitionStatement,
} from "../shared/AST";
import type { ModuleConfig } from "../shared/Config";
import { getScope, getSymbol } from "./SymbolCollection";

export type CollectionContext = {
  config: ModuleConfig;
  globalScope: string;
  scopes: Map<string, Collect.Scope>;
  symbols: Map<string, Collect.Symbol>;
  cInjections: { code: string; sourceloc: SourceLoc }[];
};

export namespace Collect {
  export type GenericParameter = {
    variant: "GenericParameter";
    id: string;
    name: string;
    sourceloc: SourceLoc;
  };

  export type Symbol =
    | ASTFunctionDeclaration
    | ASTFunctionDefinition
    | ASTNamespaceDefinition
    | ASTVariableDefinitionStatement
    | ASTGlobalVariableDefinition
    | ASTStructDefinition
    | ASTStructMethodDefinition
    | ASTStructMemberDefinition
    | GenericParameter;

  export type Statement = ASTStatement;

  export class Scope {
    variant = "Collect.ScopeClass" as const;
    id: string;
    rawStatements: ASTStatement[] = [];
    symbols: string[] = [];

    private static nextId = 1;

    constructor(
      modulePrefix: string,
      public sourceloc: SourceLoc,
      public parentScope?: string,
    ) {
      this.id = `${modulePrefix}.scope.${Scope.nextId++} `;
    }

    static rebuild(input: Scope) {
      // Rebuild class instance if it was JSON deserialized
      const scope = new Scope("", null, undefined);
      Scope.nextId--;
      scope.variant = input.variant;
      scope.id = input.id;
      scope.rawStatements = input.rawStatements;
      scope.symbols = input.symbols;
      scope.sourceloc = input.sourceloc;
      scope.parentScope = input.parentScope;
      return scope;
    }

    defineSymbol(cc: CollectionContext, symbol: Symbol) {
      if (this.tryLookupSymbolHere(cc, symbol.name)) {
        throw new InternalError(
          `Symbol '${symbol.name}' already exists in symbol table`,
          undefined,
          1,
        );
      }
      this.symbols.push(symbol.id);
    }

    tryLookupSymbol(cc: CollectionContext, name: string, loc: SourceLoc): Symbol | undefined {
      const _symbol = this.symbols.find((s) => {
        const sym = getSymbol(cc, s);
        return "name" in sym && sym.name === name;
      });
      const symbol = _symbol && getSymbol(cc, _symbol);
      if (symbol) {
        return symbol;
      }

      if (this.parentScope) {
        const parent = cc.scopes.get(this.parentScope);
        assert(parent);
        return parent.tryLookupSymbol(cc, name, loc);
      }
      return undefined;
    }

    tryLookupSymbolHere(cc: CollectionContext, name: string): Symbol | undefined {
      const symbol = this.symbols.find((s) => {
        const sym = getSymbol(cc, s);
        return "name" in sym && sym.name === name;
      });
      if (symbol) {
        return getSymbol(cc, symbol);
      }
      return undefined;
    }

    lookupSymbol(cc: CollectionContext, name: string, loc: SourceLoc): Symbol {
      const symbol = this.tryLookupSymbol(cc, name, loc);
      if (symbol) {
        return symbol;
      }
      throw new CompilerError(`Symbol '${name}' was not declared in this scope`, loc);
    }
  }
}
