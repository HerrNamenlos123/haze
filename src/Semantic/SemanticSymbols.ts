import { CompilerError, InternalError, type SourceLoc } from "../Errors";
import type { EExternLanguage } from "../shared/AST";
import { type EMethodType, type EPrimitive } from "../shared/common";
import { makeScopeId, makeSymbolId, makeTypeId, type ID } from "../shared/store";

export type SemanticResult = {
  symbolTable: Semantic.SymbolTable;
  typeTable: Semantic.TypeTable;
};

export namespace Semantic {
  export type FunctionDatatype = {
    id?: ID;
    variant: "Function";
    generics: ID[];
    functionParameters: ID[];
    functionReturnValue: ID;
    vararg: boolean;
  };

  export type StructDatatype = {
    id?: ID;
    variant: "Struct";
    name: string;
    namespaces: string[];
    fullNamespacedName: string[];
    genericSymbols: ID[];
    externLanguage: EExternLanguage;
    members: ID[];
    methods: ID[];
  };

  export type DeferredDatatype = {
    id?: ID;
    variant: "Deferred";
  };

  export type PrimitiveDatatype = {
    id?: ID;
    variant: "Primitive";
    primitive: EPrimitive;
  };

  export type NamespaceDatatype = {
    id?: ID;
    variant: "Namespace";
    name: string;
    nestedParentTypeSymbol?: ID;
  };

  export type Datatype =
    | FunctionDatatype
    | DeferredDatatype
    | StructDatatype
    | PrimitiveDatatype
    | NamespaceDatatype;

  export type VariableSymbol = {
    id?: ID;
    variant: "Variable";
    name: string;
    memberOfType?: ID;
    typeSymbol: ID;
    definedInCollectorScope: ID;
    mutable: boolean;
    export: boolean;
    externLanguage: EExternLanguage;
    sourceLoc: SourceLoc;
  };

  export type GenericParameterSymbol = {
    id?: ID;
    variant: "GenericParameter";
    name: string;
    belongsToStruct: string[];
    sourceloc: SourceLoc;
  };

  export type FunctionDefinitionSymbol = {
    id?: ID;
    variant: "FunctionDefinition";
    name: string;
    typeSymbol: ID;
    externLanguage: EExternLanguage;
    scope: Semantic.Scope;
    export: boolean;
    method: EMethodType;
    methodOfSymbol?: ID;
    sourceloc: SourceLoc;
    nestedParentTypeSymbol?: ID;
  };

  export type FunctionDeclarationSymbol = {
    id?: ID;
    variant: "FunctionDeclaration";
    name: string;
    typeSymbol: ID;
    externLanguage: EExternLanguage;
    export: boolean;
    method: EMethodType;
    sourceloc: SourceLoc;
    nestedParentTypeSymbol?: ID;
  };

  export type DatatypeSymbol = {
    id?: ID;
    variant: "Datatype";
    type: ID;
    export: boolean;
    sourceloc: SourceLoc;
  };

  export type Symbol =
    | VariableSymbol
    | GenericParameterSymbol
    | FunctionDefinitionSymbol
    | FunctionDeclarationSymbol
    | DatatypeSymbol;

  export type ExprMemberAccessExpr = {
    variant: "ExprMemberAccess";
    expr: Expression;
    method?: ID;
    memberName: string;
    typeSymbol: ID;
  };

  export type SymbolValueExpr = {
    variant: "SymbolValue";
    symbol: ID;
    typeSymbol: ID;
  };

  export type SymbolValueThisPtrExpr = {
    variant: "SymbolValueThisPointer";
    typeSymbol: ID;
  };

  export type ExprCallExpr = {
    variant: "ExprCall";
    calledExpr: Expression;
    arguments: Expression[];
    typeSymbol: ID;
  };

  export type StructInstantiationExpr = {
    variant: "StructInstantiation";
    assign: {
      name: string;
      value: Expression;
    }[];
    typeSymbol: ID;
  };

  export type ConstantExpr = {
    variant: "Constant";
    value: number | string | boolean;
    typeSymbol: ID;
  };

  export type Expression =
    | ExprMemberAccessExpr
    | SymbolValueExpr
    | SymbolValueThisPtrExpr
    | ExprCallExpr
    | StructInstantiationExpr
    | ConstantExpr;

  export type InlineCStatement = {
    variant: "InlineC";
    value: string;
    sourceloc: SourceLoc;
  };

  export type ReturnStatement = {
    variant: "Return";
    expr: Expression;
    sourceloc: SourceLoc;
  };

  export type IfStatement = {
    variant: "If";
  };

  export type WhileStatement = {
    variant: "While";
  };

  export type VariableStatement = {
    variant: "Variable";
    name: string;
    value?: Expression;
    mutable: boolean;
    typeSymbol: ID;
  };

  export type Statement =
    | InlineCStatement
    | ReturnStatement
    | VariableStatement
    | IfStatement
    | WhileStatement;

  export class SymbolTable {
    private symbols: Map<ID, Symbol> = new Map();

    constructor() {}

    defineSymbol(symbol: Symbol): Symbol & { id: ID } {
      symbol.id = makeSymbolId();
      this.symbols.set(symbol.id, symbol);
      return symbol as Symbol & { id: ID };
    }

    getAll() {
      return this.symbols;
    }

    get(id: ID) {
      const s = this.symbols.get(id);
      if (!s) {
        throw new InternalError("Symbol with id " + id + " does not exist in symbol table");
      }
      return s;
    }

    makeSymbolAvailable(symbol: Symbol) {
      const s = this.findSymbol(symbol);
      if (s) {
        return s;
      } else {
        return this.defineSymbol(symbol);
      }
    }

    findSymbol(symbol: Symbol): (Symbol & { id: ID }) | undefined {
      switch (symbol.variant) {
        case "Datatype":
          return [...this.symbols.values()].find(
            (s) => s.variant === "Datatype" && s.type === symbol.type,
          ) as (Symbol & { id: ID }) | undefined;

        case "Variable":
          return [...this.symbols.values()].find(
            (s) =>
              s.variant === "Variable" &&
              s.name === symbol.name &&
              s.memberOfType === symbol.memberOfType &&
              s.definedInCollectorScope === symbol.definedInCollectorScope,
          ) as (Symbol & { id: ID }) | undefined;

        case "GenericParameter":
          return [...this.symbols.values()].find(
            (s) =>
              s.variant === "GenericParameter" &&
              s.name === symbol.name &&
              s.belongsToStruct.toString() === symbol.belongsToStruct.toString(),
          ) as (Symbol & { id: ID }) | undefined;

        case "FunctionDefinition":
          return [...this.symbols.values()].find(
            (s) => s.variant === "FunctionDefinition" && s.name === symbol.name,
          ) as (Symbol & { id: ID }) | undefined;

        case "FunctionDeclaration":
          return [...this.symbols.values()].find(
            (s) => s.variant === "FunctionDeclaration" && s.name === symbol.name,
          ) as (Symbol & { id: ID }) | undefined;

        default:
          throw new InternalError("Unexpected symbol type");
      }
    }

    tryLookupSymbol(name: string): Symbol | undefined {
      const symbol = [...this.symbols.values()].find((s) => "name" in s && s.name === name);
      if (symbol) {
        return symbol;
      }
      return undefined;
    }

    lookupSymbol(name: string, loc: SourceLoc): Symbol {
      const symbol = this.tryLookupSymbol(name);
      if (symbol) {
        return symbol;
      }
      throw new CompilerError(`Symbol '${name}' was not declared in this scope`, loc);
    }
  }

  export class TypeTable {
    private datatypes: Map<ID, Datatype> = new Map();

    constructor() {}

    defineDatatype(datatype: Datatype): Datatype & { id: ID } {
      if (this.exists(datatype)) {
        throw new InternalError(`Symbol already exists in symbol table`);
      }
      datatype.id = makeTypeId();
      this.datatypes.set(datatype.id, datatype);
      return datatype as Datatype & { id: ID };
    }

    exists(datatype: Datatype) {
      return Boolean(this.findDatatype(datatype));
    }

    getAll() {
      return this.datatypes;
    }

    get(id: ID) {
      const s = this.datatypes.get(id);
      if (!s) {
        throw new InternalError("Type with id " + id + " does not exist in type table");
      }
      return s;
    }

    findDatatype(datatype: Datatype): (Datatype & { id: ID }) | undefined {
      switch (datatype.variant) {
        case "Function":
          return [...this.datatypes.values()].find(
            (f) =>
              f.variant === "Function" &&
              f.functionParameters.toString() === datatype.functionParameters.toString() &&
              f.functionReturnValue === datatype.functionReturnValue &&
              f.generics.toString() === datatype.generics.toString() &&
              f.vararg === datatype.vararg,
          ) as (Datatype & { id: ID }) | undefined;

        case "Primitive":
          return [...this.datatypes.values()].find(
            (d) => d.variant === "Primitive" && d.primitive === datatype.primitive,
          ) as (Datatype & { id: ID }) | undefined;

        case "Struct":
          return [...this.datatypes.values()].find(
            (d) =>
              d.variant === "Struct" &&
              d.fullNamespacedName === datatype.fullNamespacedName &&
              d.genericSymbols.toString() === datatype.genericSymbols.toString(),
          ) as (Datatype & { id: ID }) | undefined;

        case "Deferred":
          return [...this.datatypes.values()].find((d) => d.variant === "Deferred") as
            | (Datatype & { id: ID })
            | undefined;

        default:
          throw new InternalError("Unexpected symbol type");
      }
    }

    makeDatatypeAvailable(datatype: Datatype) {
      const dt = this.findDatatype(datatype);
      if (dt) {
        return dt;
      } else {
        return this.defineDatatype(datatype);
      }
    }

    lookupByName(name: string): Datatype | undefined {
      const symbol = [...this.datatypes.values()].find((s) => "name" in s && s.name === name);
      if (symbol) {
        return symbol;
      }
      return undefined;
    }
  }

  export class Scope {
    public id: ID;
    public statements: Semantic.Statement[] = [];
    public symbolTable: SymbolTable;

    constructor(public location: SourceLoc) {
      this.id = makeScopeId();
      this.symbolTable = new SymbolTable();
    }
  }
}
