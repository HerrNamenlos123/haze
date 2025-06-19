import { CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
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
import { makeScopeId, type ID } from "../shared/store";

export type CollectResult = {
  globalScope: Collect.Scope;
  cInjections: { code: string; sourceloc: SourceLoc }[];
};

export namespace Collect {
  export type GenericPlaceholder = {
    variant: "GenericPlaceholder";
    name: string;
    belongsToSymbol: Symbol;
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
    | GenericPlaceholder;

  export class SymbolTable {
    symbols: Symbol[] = [];

    constructor(public parentTable?: SymbolTable) {}

    defineSymbol(symbol: Symbol) {
      if (this.tryLookupSymbolHere(symbol.name)) {
        throw new InternalError(`Symbol '${symbol.name}' already exists in symbol table`);
      }
      this.symbols.push(symbol);
    }

    tryLookupSymbol(name: string, loc: SourceLoc): Symbol | undefined {
      const symbol = this.symbols.find((s) => "name" in s && s.name === name);
      if (symbol) {
        return symbol;
      }

      if (this.parentTable) {
        return this.parentTable.tryLookupSymbol(name, loc);
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

  export class Scope {
    public id: ID;
    public statements: ASTStatement[] = [];
    public symbolTable: SymbolTable;
    public _semantic: {
      forFunctionSymbol?: ID;
    } = {};

    constructor(
      public sourceloc: SourceLoc,
      public parentScope?: Scope,
    ) {
      this.id = makeScopeId();
      this.symbolTable = new SymbolTable(parentScope?.symbolTable);
    }
  }
}
