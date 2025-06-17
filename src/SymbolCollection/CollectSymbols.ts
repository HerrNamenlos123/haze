import { CompilerError, InternalError, type SourceLoc } from "../Errors";
import type {
  ASTFunctionDeclaration,
  ASTFunctionDefinition,
  ASTGlobalVariableDefinition,
  ASTNamespaceDefinition,
  ASTStatement,
  ASTStructDefinition,
  ASTVariableDefinitionStatement,
  EExternLanguage,
  ELiteralUnit,
} from "../shared/AST";
import type { EVariableContext, EVariableMutability } from "../shared/common";
import type { ID } from "../shared/store";

export type CollectResult = {
  globalScope: Collect.Scope;
  cInjections: { code: string; sourceloc: SourceLoc }[];
};

export namespace Collect {
  export type VariableSymbol = {
    variant: "Variable";
    name: string;
    type: ID;
    variableType: EVariableMutability;
    variableContext: EVariableContext;
    isExported: boolean;
    externLanguage: EExternLanguage;
    sourceloc: SourceLoc;
    parentSymbol?: ID;
  };

  export type GenericParameterSymbol = {
    variant: "GenericParameter";
    name: string;
    visibleName: string;
    sourceloc: SourceLoc;
    parentSymbol?: ID;
  };

  export type DatatypeSymbol = {
    variant: "Datatype";
    name: string;
    type: ID;
    definedInScope: ID;
    isExported: boolean;
    sourceloc: SourceLoc;
    parentSymbol?: ID;
  };

  export type ConstantSymbol = {
    variant: "Constant";
    constant:
      | {
          variant: "String";
          type: ID;
          value: string;
          location: SourceLoc;
        }
      | {
          variant: "Boolean";
          type: ID;
          value: boolean;
          location: SourceLoc;
        }
      | {
          variant: "Literal";
          type: ID;
          value: number;
          unit?: ELiteralUnit;
          location: SourceLoc;
        };
    location: SourceLoc;
  };

  export type Symbol =
    | ASTFunctionDeclaration
    | ASTFunctionDefinition
    | ASTNamespaceDefinition
    | ASTVariableDefinitionStatement
    | ASTGlobalVariableDefinition
    | ASTStructDefinition;

  export class SymbolTable {
    symbols: Symbol[] = [];

    constructor(public parentTable?: SymbolTable) {}

    defineSymbol(symbol: Symbol) {
      if (this.tryLookupSymbolHere(symbol.name)) {
        throw new InternalError(
          `Symbol '${symbol.name}' already exists in symbol table`,
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
      throw new CompilerError(
        `Symbol '${name}' was not declared in this scope`,
        loc,
      );
    }
  }

  export class Scope {
    public statements: ASTStatement[] = [];
    public symbolTable: SymbolTable;

    constructor(
      public location: SourceLoc,
      public parentScope?: Scope,
    ) {
      this.symbolTable = new SymbolTable(parentScope?.symbolTable);
    }
  }
}
