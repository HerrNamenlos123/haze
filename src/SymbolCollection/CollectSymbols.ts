import { assert, CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import type {
  ASTFunctionDeclaration,
  ASTFunctionDefinition,
  ASTGlobalVariableDefinition,
  ASTNamespaceDefinition,
  ASTStatement,
  ASTStructDefinition,
  ASTStructMethodDefinition,
  ASTVariableDefinitionStatement,
} from "../shared/AST";

export type CollectionContext = {
  moduleName: string;
  globalScope: string;
  scopes: Map<string, Collect.Scope>;
  cInjections: { code: string; sourceloc: SourceLoc }[];
};

export namespace Collect {
  export type GenericParameter = {
    variant: "GenericParameter";
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
    | GenericParameter;

  export type Statement = ASTStatement;

  export class Scope {
    id: string;
    rawStatements: ASTStatement[] = [];
    symbols: Symbol[] = [];

    private static nextId = 1;

    constructor(
      public cc: CollectionContext,
      public sourceloc: SourceLoc,
      public parentScope?: string,
    ) {
      this.id = `${cc.moduleName}.scope.${Scope.nextId++} `;
    }

    defineSymbol(symbol: Symbol) {
      if (this.tryLookupSymbolHere(symbol.name)) {
        throw new InternalError(
          `Symbol '${symbol.name}' already exists in symbol table`,
          undefined,
          1,
        );
      }
      this.symbols.push(symbol);
    }

    tryLookupSymbol(name: string, loc: SourceLoc): Symbol | undefined {
      const symbol = this.symbols.find((s) => "name" in s && s.name === name);
      if (symbol) {
        return symbol;
      }

      if (this.parentScope) {
        const parent = this.cc.scopes.get(this.parentScope);
        assert(parent);
        return parent.tryLookupSymbol(name, loc);
      }
      return undefined;
    }

    tryLookupSymbolHere(name: string): Symbol | undefined {
      return this.symbols.find((s) => "name" in s && s.name === name);
    }

    lookupSymbol(name: string, loc: SourceLoc): Symbol {
      const symbol = this.tryLookupSymbol(name, loc);
      if (symbol) {
        return symbol;
      }
      throw new CompilerError(`Symbol '${name}' was not declared in this scope`, loc);
    }
  }
}
