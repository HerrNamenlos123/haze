import { CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import type { ASTStructDefinition, EBinaryOperation, EExternLanguage } from "../shared/AST";
import { EVariableContext, type EMethodType, type EPrimitive } from "../shared/common";
import { makeScopeId, makeSymbolId, makeTypeId, type ID } from "../shared/store";
import type { Collect } from "../SymbolCollection/CollectSymbols";

export type SemanticResult = {
  symbolTable: Semantic.SymbolTable;
  typeTable: Semantic.TypeTable;
};

export namespace Semantic {
  export type FunctionDatatype = {
    id?: ID;
    variant: "Function";
    generics: ID[];
    functionParameters: {
      name: string;
      type: ID;
    }[];
    functionReturnValue: ID;
    vararg: boolean;
    concrete: boolean;
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
    definedInNamespaceOrStruct: ID | null;
    concrete: boolean;
  };

  export type RawPointerDatatype = {
    id?: ID;
    variant: "RawPointer";
    pointee: ID;
    concrete: boolean;
  };

  export type DeferredDatatype = {
    id?: ID;
    variant: "Deferred";
    concrete: boolean;
  };

  export type PrimitiveDatatype = {
    id?: ID;
    variant: "Primitive";
    primitive: EPrimitive;
    concrete: boolean;
  };

  export type NamespaceDatatype = {
    id?: ID;
    variant: "Namespace";
    name: string;
    nestedParentTypeSymbol?: ID;
    concrete: boolean;
  };

  export type Datatype =
    | FunctionDatatype
    | DeferredDatatype
    | StructDatatype
    | RawPointerDatatype
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
    variableContext: EVariableContext;
    sourceLoc: SourceLoc;
    concrete: boolean;
  };

  export type GenericParameterSymbol = {
    id?: ID;
    variant: "GenericParameter";
    name: string;
    belongsToStruct: string[];
    sourceloc: SourceLoc;
    concrete: boolean;
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
    concrete: boolean;
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
    concrete: boolean;
  };

  export type DatatypeSymbol = {
    id?: ID;
    variant: "Datatype";
    type: ID;
    export: boolean;
    concrete: boolean;
  };

  export type NamespaceSymbol = {
    id?: ID;
    variant: "Namespace";
    name: string;
    declarations: ID[];
    nestedParentTypeSymbol: ID | null;
    concrete: boolean;
  };

  export type Symbol =
    | VariableSymbol
    | GenericParameterSymbol
    | FunctionDefinitionSymbol
    | FunctionDeclarationSymbol
    | DatatypeSymbol
    | NamespaceSymbol;

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

  export type BinaryExpr = {
    variant: "BinaryExpr";
    left: Expression;
    right: Expression;
    operation: EBinaryOperation;
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
    | BinaryExpr
    | ExprCallExpr
    | StructInstantiationExpr
    | ConstantExpr;

  export type InlineCStatement = {
    variant: "InlineCStatement";
    value: string;
    sourceloc: SourceLoc;
  };

  export type ReturnStatement = {
    variant: "ReturnStatement";
    expr?: Expression;
    sourceloc: SourceLoc;
  };

  export type IfStatement = {
    variant: "IfStatement";
    condition: Expression;
    then: Scope;
    elseIfs: {
      condition: Expression;
      then: Scope;
    }[];
    else?: Scope;
    sourceloc: SourceLoc;
  };

  export type WhileStatement = {
    variant: "WhileStatement";
    condition: Expression;
    then: Scope;
    sourceloc: SourceLoc;
  };

  export type VariableStatement = {
    variant: "VariableStatement";
    name: string;
    value?: Expression;
    mutable: boolean;
    variableSymbol: ID;
    sourceloc: SourceLoc;
  };

  export type ExprStatement = {
    variant: "ExprStatement";
    expr: Expression;
    sourceloc: SourceLoc;
  };

  export type Statement =
    | InlineCStatement
    | ReturnStatement
    | VariableStatement
    | IfStatement
    | WhileStatement
    | ExprStatement;

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
        throw new InternalError(
          "Symbol with id " + id + " does not exist in symbol table",
          undefined,
          1,
        );
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

    makeDatatypeSymbolAvailable(datatype: ID, concrete: boolean) {
      return this.makeSymbolAvailable({
        variant: "Datatype",
        export: false,
        type: datatype,
        concrete: concrete,
      });
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
            (s) =>
              s.variant === "FunctionDefinition" &&
              s.name === symbol.name &&
              s.nestedParentTypeSymbol === symbol.nestedParentTypeSymbol,
          ) as (Symbol & { id: ID }) | undefined;

        case "FunctionDeclaration":
          return [...this.symbols.values()].find(
            (s) =>
              s.variant === "FunctionDeclaration" &&
              s.name === symbol.name &&
              s.nestedParentTypeSymbol === symbol.nestedParentTypeSymbol,
          ) as (Symbol & { id: ID }) | undefined;

        case "Namespace":
          return [...this.symbols.values()].find(
            (s) =>
              s.variant === "Namespace" &&
              s.name === symbol.name &&
              s.nestedParentTypeSymbol === symbol.nestedParentTypeSymbol,
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
              d.name === datatype.name &&
              d.definedInNamespaceOrStruct === datatype.definedInNamespaceOrStruct &&
              d.genericSymbols.toString() === datatype.genericSymbols.toString(),
          ) as (Datatype & { id: ID }) | undefined;

        case "Deferred":
          return [...this.datatypes.values()].find((d) => d.variant === "Deferred") as
            | (Datatype & { id: ID })
            | undefined;

        case "RawPointer":
          return [...this.datatypes.values()].find(
            (d) => d.variant === "RawPointer" && d.pointee === datatype.pointee,
          ) as (Datatype & { id: ID }) | undefined;

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

    makePrimitiveDatatypeAvailable(primitive: EPrimitive) {
      return this.makeDatatypeAvailable({
        variant: "Primitive",
        primitive: primitive,
        concrete: true,
      });
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
    public returnedTypes: (ID | undefined)[] = [];

    constructor(
      public sourceloc: SourceLoc,
      public collectScope: Collect.Scope,
      public parentScope?: Scope,
    ) {
      this.id = makeScopeId();
      this.symbolTable = new SymbolTable();
    }
  }

  export type GenericContext = {
    symbolToSymbol: Map<ID, ID>;
    elaborateCurrentStructOrNamespace?: ID | null;
    datatypesDone: Map<ID, ID>;
  };
}

export function getType(sr: SemanticResult, id: ID) {
  if (!id) throw new InternalError("ID is undefined", undefined, 1);
  const type = sr.typeTable.get(id);
  if (!type) {
    throw new InternalError("Type does not exist " + id);
  }
  return type;
}

export function getSymbol(sr: SemanticResult, id: ID): Semantic.Symbol & { id: ID } {
  if (!id) throw new InternalError("ID is undefined", undefined, 1);
  const symbol = sr.symbolTable.get(id);
  if (!symbol) {
    throw new InternalError("Symbol does not exist " + id);
  }
  return symbol as Semantic.Symbol & { id: ID };
}

export function getTypeFromSymbol(sr: SemanticResult, id: ID): Semantic.Datatype & { id: ID } {
  if (!id) throw new InternalError("ID is undefined", undefined, 1);
  const symbol = getSymbol(sr, id);
  if (!symbol.id) {
    throw new InternalError("Symbol id is null");
  }
  if (symbol.variant !== "Datatype")
    return sr.typeTable.makeDatatypeAvailable({ variant: "Deferred", concrete: false });
  return getType(sr, symbol.type) as Semantic.Datatype & { id: ID };
}
