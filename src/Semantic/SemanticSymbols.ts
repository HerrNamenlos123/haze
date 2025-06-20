import { CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import type { ASTStructDefinition, EBinaryOperation, EExternLanguage } from "../shared/AST";
import { EVariableContext, type EMethodType, type EPrimitive } from "../shared/common";
import {
  makeSemanticScopeId,
  makeSemanticSymbolId,
  makeSemanticTypeId,
  type CollectScopeId,
  type SemanticScopeId,
  type SemanticSymbolId,
  type SemanticTypeId,
} from "../shared/store";
import type { Collect } from "../SymbolCollection/CollectSymbols";

export type SemanticResult = {
  symbolTable: Semantic.SymbolTable;
  typeTable: Semantic.TypeTable;
};

export namespace Semantic {
  export type FunctionDatatype = {
    id: SemanticTypeId;
    variant: "Function";
    generics: SemanticSymbolId[];
    functionParameters: {
      name: string;
      type: SemanticSymbolId;
    }[];
    functionReturnValue: SemanticSymbolId;
    vararg: boolean;
    concrete: boolean;
  };

  export type StructDatatype = {
    id: SemanticTypeId;
    variant: "Struct";
    name: string;
    namespaces: string[];
    fullNamespacedName: string[];
    genericSymbols: SemanticSymbolId[];
    externLanguage: EExternLanguage;
    members: SemanticSymbolId[];
    methods: SemanticSymbolId[];
    definedInNamespaceOrStruct: SemanticSymbolId | null;
    concrete: boolean;
  };

  export type RawPointerDatatype = {
    id: SemanticTypeId;
    variant: "RawPointer";
    pointee: SemanticSymbolId;
    concrete: boolean;
  };

  export type ReferenceDatatype = {
    id: SemanticTypeId;
    variant: "Reference";
    referee: SemanticSymbolId;
    concrete: boolean;
  };

  export type CallableDatatype = {
    id: SemanticTypeId;
    variant: "Callable";
    thisExprType: SemanticSymbolId;
    functionType: SemanticSymbolId;
    concrete: boolean;
  };

  export type DeferredDatatype = {
    id: SemanticTypeId;
    variant: "Deferred";
    concrete: boolean;
  };

  export type PrimitiveDatatype = {
    id: SemanticTypeId;
    variant: "Primitive";
    primitive: EPrimitive;
    concrete: boolean;
  };

  export type NamespaceDatatype = {
    id: SemanticTypeId;
    variant: "Namespace";
    name: string;
    nestedParentTypeSymbol?: SemanticSymbolId;
    concrete: boolean;
  };

  export type Datatype =
    | FunctionDatatype
    | DeferredDatatype
    | CallableDatatype
    | StructDatatype
    | RawPointerDatatype
    | ReferenceDatatype
    | PrimitiveDatatype
    | NamespaceDatatype;

  export type DatatypeWithoutId =
    | (Omit<FunctionDatatype, "id"> & { variant: "Function" })
    | (Omit<DeferredDatatype, "id"> & { variant: "Deferred" })
    | (Omit<CallableDatatype, "id"> & { variant: "Callable" })
    | (Omit<StructDatatype, "id"> & { variant: "Struct" })
    | (Omit<RawPointerDatatype, "id"> & { variant: "RawPointer" })
    | (Omit<ReferenceDatatype, "id"> & { variant: "Reference" })
    | (Omit<PrimitiveDatatype, "id"> & { variant: "Primitive" })
    | (Omit<NamespaceDatatype, "id"> & { variant: "Namespace" });

  export type VariableSymbol = {
    id: SemanticSymbolId;
    variant: "Variable";
    name: string;
    memberOfType?: SemanticTypeId;
    typeSymbol: SemanticSymbolId;
    definedInScope: CollectScopeId | SemanticScopeId;
    mutable: boolean;
    export: boolean;
    externLanguage: EExternLanguage;
    variableContext: EVariableContext;
    sourceLoc: SourceLoc;
    concrete: boolean;
  };

  export type GenericParameterSymbol = {
    id: SemanticSymbolId;
    variant: "GenericParameter";
    name: string;
    belongsToStruct: string[];
    sourceloc: SourceLoc;
    concrete: boolean;
  };

  export type FunctionDefinitionSymbol = {
    id: SemanticSymbolId;
    variant: "FunctionDefinition";
    name: string;
    typeSymbol: SemanticSymbolId;
    externLanguage: EExternLanguage;
    scope: Semantic.Scope;
    export: boolean;
    method: EMethodType;
    methodOfSymbol?: SemanticSymbolId;
    sourceloc: SourceLoc;
    nestedParentTypeSymbol?: SemanticSymbolId;
    concrete: boolean;
  };

  export type FunctionDeclarationSymbol = {
    id: SemanticSymbolId;
    variant: "FunctionDeclaration";
    name: string;
    typeSymbol: SemanticSymbolId;
    externLanguage: EExternLanguage;
    export: boolean;
    method: EMethodType;
    sourceloc: SourceLoc;
    nestedParentTypeSymbol?: SemanticSymbolId;
    concrete: boolean;
  };

  export type DatatypeSymbol = {
    id: SemanticSymbolId;
    variant: "Datatype";
    type: SemanticTypeId;
    export: boolean;
    concrete: boolean;
  };

  export type NamespaceSymbol = {
    id: SemanticSymbolId;
    variant: "Namespace";
    name: string;
    declarations: SemanticSymbolId[];
    nestedParentTypeSymbol: SemanticSymbolId | null;
    concrete: boolean;
  };

  export type Symbol =
    | VariableSymbol
    | GenericParameterSymbol
    | FunctionDefinitionSymbol
    | FunctionDeclarationSymbol
    | DatatypeSymbol
    | NamespaceSymbol;

  export type SymbolWithoutId =
    | (Omit<VariableSymbol, "id"> & { variant: "Variable" })
    | (Omit<GenericParameterSymbol, "id"> & { variant: "GenericParameter" })
    | (Omit<FunctionDefinitionSymbol, "id"> & { variant: "FunctionDefinition" })
    | (Omit<FunctionDeclarationSymbol, "id"> & { variant: "FunctionDeclaration" })
    | (Omit<DatatypeSymbol, "id"> & { variant: "Datatype" })
    | (Omit<NamespaceSymbol, "id"> & { variant: "Namespace" });

  export type ExprMemberAccessExpr = {
    variant: "ExprMemberAccess";
    expr: Expression;
    method?: SemanticSymbolId;
    memberName: string;
    typeSymbol: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type CallableExpr = {
    variant: "CallableExpr";
    thisExpr: Expression;
    functionSymbol: SemanticSymbolId;
    typeSymbol: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type SymbolValueExpr = {
    variant: "SymbolValue";
    symbol: SemanticSymbolId;
    typeSymbol: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type SymbolValueThisPtrExpr = {
    variant: "SymbolValueThisPointer";
    typeSymbol: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type BinaryExpr = {
    variant: "BinaryExpr";
    left: Expression;
    right: Expression;
    operation: EBinaryOperation;
    typeSymbol: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type ExprCallExpr = {
    variant: "ExprCall";
    calledExpr: Expression;
    arguments: Expression[];
    typeSymbol: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type StructInstantiationExpr = {
    variant: "StructInstantiation";
    assign: {
      name: string;
      value: Expression;
    }[];
    typeSymbol: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type ConstantExpr = {
    variant: "Constant";
    value: number | string | boolean;
    typeSymbol: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type Expression =
    | ExprMemberAccessExpr
    | SymbolValueExpr
    | SymbolValueThisPtrExpr
    | BinaryExpr
    | CallableExpr
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
    variableSymbol: SemanticSymbolId;
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
    private symbols: Map<SemanticSymbolId, Symbol> = new Map();

    constructor() {}

    defineSymbol(symbol: SymbolWithoutId): Symbol {
      const _symbol = symbol as Symbol;
      _symbol.id = makeSemanticSymbolId();
      this.symbols.set(_symbol.id, _symbol);
      return _symbol;
    }

    getAll() {
      return this.symbols;
    }

    get(id: SemanticSymbolId, errorPropagationSteps = 0) {
      const s = this.symbols.get(id);
      if (!s) {
        throw new InternalError(
          "Symbol with id " + id + " does not exist in symbol table",
          undefined,
          errorPropagationSteps + 1,
        );
      }
      return s;
    }

    makeSymbolAvailable(symbol: SymbolWithoutId) {
      const s = this.findSymbol(symbol);
      if (s) {
        return s;
      } else {
        return this.defineSymbol(symbol);
      }
    }

    makeDatatypeSymbolAvailable(datatype: SemanticTypeId, concrete: boolean) {
      return this.makeSymbolAvailable({
        variant: "Datatype",
        export: false,
        type: datatype,
        concrete: concrete,
      });
    }

    findSymbol(symbol: SymbolWithoutId): Symbol | undefined {
      switch (symbol.variant) {
        case "Datatype":
          return [...this.symbols.values()].find(
            (s) => s.variant === "Datatype" && s.type === symbol.type,
          );

        case "Variable":
          return [...this.symbols.values()].find(
            (s) =>
              s.variant === "Variable" &&
              s.name === symbol.name &&
              s.memberOfType === symbol.memberOfType &&
              s.definedInScope === symbol.definedInScope,
          );

        case "GenericParameter":
          return [...this.symbols.values()].find(
            (s) =>
              s.variant === "GenericParameter" &&
              s.name === symbol.name &&
              s.belongsToStruct.toString() === symbol.belongsToStruct.toString(),
          );

        case "FunctionDefinition":
          return [...this.symbols.values()].find(
            (s) =>
              s.variant === "FunctionDefinition" &&
              s.name === symbol.name &&
              s.nestedParentTypeSymbol === symbol.nestedParentTypeSymbol,
          );

        case "FunctionDeclaration":
          return [...this.symbols.values()].find(
            (s) =>
              s.variant === "FunctionDeclaration" &&
              s.name === symbol.name &&
              s.nestedParentTypeSymbol === symbol.nestedParentTypeSymbol,
          );

        case "Namespace":
          return [...this.symbols.values()].find(
            (s) =>
              s.variant === "Namespace" &&
              s.name === symbol.name &&
              s.nestedParentTypeSymbol === symbol.nestedParentTypeSymbol,
          );

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
    private datatypes: Map<SemanticTypeId, Datatype> = new Map();

    constructor() {}

    defineDatatype(datatype: DatatypeWithoutId): Datatype {
      if (this.exists(datatype)) {
        throw new InternalError(`Symbol already exists in symbol table`);
      }
      const _datatype = datatype as Datatype;
      _datatype.id = makeSemanticTypeId();
      this.datatypes.set(_datatype.id, _datatype);
      return _datatype;
    }

    exists(datatype: DatatypeWithoutId) {
      return Boolean(this.findDatatype(datatype));
    }

    getAll() {
      return this.datatypes;
    }

    get(id: SemanticTypeId, errorPropagationSteps = 0) {
      const s = this.datatypes.get(id);
      if (!s) {
        throw new InternalError(
          "Type with id " + id + " does not exist in type table",
          undefined,
          1 + errorPropagationSteps,
        );
      }
      return s;
    }

    findDatatype(datatype: DatatypeWithoutId) {
      switch (datatype.variant) {
        case "Function":
          return [...this.datatypes.values()].find(
            (f) =>
              f.variant === "Function" &&
              f.functionParameters.toString() === datatype.functionParameters.toString() &&
              f.functionReturnValue === datatype.functionReturnValue &&
              f.generics.toString() === datatype.generics.toString() &&
              f.vararg === datatype.vararg,
          );

        case "Primitive":
          return [...this.datatypes.values()].find(
            (d) => d.variant === "Primitive" && d.primitive === datatype.primitive,
          );

        case "Struct":
          return [...this.datatypes.values()].find(
            (d) =>
              d.variant === "Struct" &&
              d.name === datatype.name &&
              d.definedInNamespaceOrStruct === datatype.definedInNamespaceOrStruct &&
              d.genericSymbols.toString() === datatype.genericSymbols.toString(),
          );

        case "Deferred":
          return [...this.datatypes.values()].find((d) => d.variant === "Deferred");

        case "RawPointer":
          return [...this.datatypes.values()].find(
            (d) => d.variant === "RawPointer" && d.pointee === datatype.pointee,
          );

        case "Reference":
          return [...this.datatypes.values()].find(
            (d) => d.variant === "Reference" && d.referee === datatype.referee,
          );

        case "Callable": {
          return [...this.datatypes.values()].find(
            (d) =>
              d.variant === "Callable" &&
              d.functionType === datatype.functionType &&
              d.thisExprType === datatype.thisExprType,
          );
        }

        default:
          throw new InternalError("Unexpected symbol type");
      }
    }

    makeDatatypeAvailable(datatype: DatatypeWithoutId) {
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
    public id: SemanticScopeId;
    public statements: Semantic.Statement[] = [];
    public symbolTable: SymbolTable;
    public returnedTypes: (SemanticSymbolId | undefined)[] = [];

    constructor(
      public sourceloc: SourceLoc,
      public collectScope: Collect.Scope,
      public parentScope?: Scope,
    ) {
      this.id = makeSemanticScopeId();
      this.symbolTable = new SymbolTable();
    }
  }

  export type GenericContext = {
    symbolToSymbol: Map<SemanticSymbolId, SemanticSymbolId>;
    elaborateCurrentStructOrNamespace?: SemanticSymbolId | null;
    datatypesDone: Map<SemanticTypeId, SemanticTypeId>;
  };
}

export function getType(sr: SemanticResult, id: SemanticTypeId) {
  if (!id) throw new InternalError("ID is undefined", undefined, 1);
  const type = sr.typeTable.get(id, 1);
  if (!type) {
    throw new InternalError("Type does not exist " + id);
  }
  return type;
}

export function getSymbol(sr: SemanticResult, id: SemanticSymbolId, errorPropagationSteps = 0) {
  if (!id) throw new InternalError("ID is undefined", undefined, 1);
  const symbol = sr.symbolTable.get(id, 1 + errorPropagationSteps);
  if (!symbol) {
    throw new InternalError("Symbol does not exist " + id);
  }
  return symbol;
}

export function getTypeFromSymbol(
  sr: SemanticResult,
  id: SemanticSymbolId,
  errorPropagationSteps = 0,
) {
  if (!id) throw new InternalError("ID is undefined", undefined, 1 + errorPropagationSteps);
  const symbol = getSymbol(sr, id, 1 + errorPropagationSteps);
  if (!symbol.id) {
    throw new InternalError("Symbol id is null");
  }
  if (symbol.variant !== "Datatype")
    return sr.typeTable.makeDatatypeAvailable({ variant: "Deferred", concrete: false });
  return getType(sr, symbol.type);
}
