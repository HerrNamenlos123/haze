import { CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import type {
  ASTFunctionDeclaration,
  ASTFunctionDefinition,
  ASTGlobalVariableDefinition,
  ASTNamedDatatype,
  ASTNamespaceDefinition,
  ASTStatement,
  ASTStructDefinition,
  ASTStructMethodDefinition,
  ASTVariableDefinitionStatement,
} from "../shared/AST";

export type CollectResult = {
  globalScope: Collect.Scope;
  cInjections: { code: string; sourceloc: SourceLoc }[];
};

export namespace Collect {
  export type GenericParameter = {
    variant: "GenericParameter";
    name: string;
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

  export class SymbolTable {
    symbols: Symbol[] = [];

    constructor(public parentTable?: SymbolTable) { }

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
    public rawStatements: ASTStatement[] = [];
    public symbolTable: SymbolTable;

    constructor(
      public sourceloc: SourceLoc,
      public parentScope?: Scope,
    ) {
      this.symbolTable = new SymbolTable(parentScope?.symbolTable);
    }
  }
}
