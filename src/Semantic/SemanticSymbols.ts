import { CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import type { ASTStructDefinition, EBinaryOperation, EExternLanguage } from "../shared/AST";
import { EVariableContext, type EMethodType, type EPrimitive } from "../shared/common";
import {
  makeSemanticScopeId,
  makeSemanticSymbolId,
  type CollectScopeId,
  type SemanticScopeId,
  type SemanticSymbolId,
} from "../shared/store";
import type { Collect } from "../SymbolCollection/CollectSymbols";

export type SemanticResult = {
  symbolTable: Semantic.SymbolTable;
};

export namespace Semantic {
  export type VariableSymbol = {
    id: SemanticSymbolId;
    variant: "Variable";
    name: string;
    memberOf?: SemanticSymbolId;
    type: SemanticSymbolId;
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
    type: SemanticSymbolId;
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
    type: SemanticSymbolId;
    externLanguage: EExternLanguage;
    export: boolean;
    method: EMethodType;
    sourceloc: SourceLoc;
    nestedParentTypeSymbol?: SemanticSymbolId;
    concrete: boolean;
  };

  export type FunctionDatatypeSymbol = {
    id: SemanticSymbolId;
    variant: "FunctionDatatype";
    generics: SemanticSymbolId[];
    functionParameters: {
      name: string;
      type: SemanticSymbolId;
    }[];
    functionReturnValue: SemanticSymbolId;
    vararg: boolean;
    concrete: boolean;
  };

  export type StructDatatypeSymbol = {
    id: SemanticSymbolId;
    variant: "StructDatatype";
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

  export type RawPointerDatatypeSymbol = {
    id: SemanticSymbolId;
    variant: "RawPointerDatatype";
    pointee: SemanticSymbolId;
    concrete: boolean;
  };

  export type ReferenceDatatypeSymbol = {
    id: SemanticSymbolId;
    variant: "ReferenceDatatype";
    referee: SemanticSymbolId;
    concrete: boolean;
  };

  export type CallableDatatypeSymbol = {
    id: SemanticSymbolId;
    variant: "CallableDatatype";
    thisExprType?: SemanticSymbolId;
    functionType: SemanticSymbolId;
    concrete: boolean;
  };

  export type DeferredDatatypeSymbol = {
    id: SemanticSymbolId;
    variant: "DeferredDatatype";
    concrete: boolean;
  };

  export type PrimitiveDatatypeSymbol = {
    id: SemanticSymbolId;
    variant: "PrimitiveDatatype";
    primitive: EPrimitive;
    concrete: boolean;
  };

  export type NamespaceSymbol = {
    id: SemanticSymbolId;
    variant: "Namespace";
    name: string;
    declarations: SemanticSymbolId[];
    nestedParentTypeSymbol?: SemanticSymbolId;
    concrete: boolean;
  };

  export type Symbol =
    | VariableSymbol
    | GenericParameterSymbol
    | FunctionDefinitionSymbol
    | FunctionDeclarationSymbol
    | NamespaceSymbol
    | FunctionDatatypeSymbol
    | StructDatatypeSymbol
    | RawPointerDatatypeSymbol
    | ReferenceDatatypeSymbol
    | CallableDatatypeSymbol
    | DeferredDatatypeSymbol
    | PrimitiveDatatypeSymbol;

  export type SymbolWithoutId =
    | (Omit<VariableSymbol, "id"> & { variant: "Variable" })
    | (Omit<GenericParameterSymbol, "id"> & { variant: "GenericParameter" })
    | (Omit<FunctionDefinitionSymbol, "id"> & { variant: "FunctionDefinition" })
    | (Omit<FunctionDeclarationSymbol, "id"> & { variant: "FunctionDeclaration" })
    | (Omit<NamespaceSymbol, "id"> & { variant: "Namespace" })
    | (Omit<FunctionDatatypeSymbol, "id"> & { variant: "FunctionDatatype" })
    | (Omit<StructDatatypeSymbol, "id"> & { variant: "StructDatatype" })
    | (Omit<RawPointerDatatypeSymbol, "id"> & { variant: "RawPointerDatatype" })
    | (Omit<ReferenceDatatypeSymbol, "id"> & { variant: "ReferenceDatatype" })
    | (Omit<CallableDatatypeSymbol, "id"> & { variant: "CallableDatatype" })
    | (Omit<DeferredDatatypeSymbol, "id"> & { variant: "DeferredDatatype" })
    | (Omit<PrimitiveDatatypeSymbol, "id"> & { variant: "PrimitiveDatatype" });

  export type ExprMemberAccessExpr = {
    variant: "ExprMemberAccess";
    expr: Expression;
    method?: SemanticSymbolId;
    memberName: string;
    isReference: boolean;
    type: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type CallableExpr = {
    variant: "CallableExpr";
    thisExpr: Expression;
    functionSymbol: SemanticSymbolId;
    type: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type SymbolValueExpr = {
    variant: "SymbolValue";
    symbol: SemanticSymbolId;
    type: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type ExplicitCastExpr = {
    variant: "ExplicitCast";
    expr: Expression;
    type: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type SymbolValueThisPtrExpr = {
    variant: "SymbolValueThisPointer";
    type: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type BinaryExpr = {
    variant: "BinaryExpr";
    left: Expression;
    right: Expression;
    operation: EBinaryOperation;
    type: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type ExprCallExpr = {
    variant: "ExprCall";
    calledExpr: Expression;
    arguments: Expression[];
    type: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type StructInstantiationExpr = {
    variant: "StructInstantiation";
    assign: {
      name: string;
      value: Expression;
    }[];
    type: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type ConstantExpr = {
    variant: "Constant";
    value: number | string | boolean;
    type: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type Expression =
    | ExprMemberAccessExpr
    | SymbolValueExpr
    | SymbolValueThisPtrExpr
    | BinaryExpr
    | CallableExpr
    | ExplicitCastExpr
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

    makePrimitiveAvailable(primitive: EPrimitive) {
      return this.makeSymbolAvailable({
        variant: "PrimitiveDatatype",
        primitive: primitive,
        concrete: true,
      });
    }

    findSymbol(symbol: SymbolWithoutId): Symbol | undefined {
      switch (symbol.variant) {
        case "Variable":
          return [...this.symbols.values()].find(
            (s) =>
              s.variant === "Variable" &&
              s.name === symbol.name &&
              s.memberOf === symbol.memberOf &&
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

        case "FunctionDatatype":
          return [...this.symbols.values()].find(
            (f) =>
              f.variant === "FunctionDatatype" &&
              f.functionParameters.toString() === symbol.functionParameters.toString() &&
              f.functionReturnValue === symbol.functionReturnValue &&
              f.generics.toString() === symbol.generics.toString() &&
              f.vararg === symbol.vararg,
          );

        case "PrimitiveDatatype":
          return [...this.symbols.values()].find(
            (d) => d.variant === "PrimitiveDatatype" && d.primitive === symbol.primitive,
          );

        case "StructDatatype":
          return [...this.symbols.values()].find(
            (d) =>
              d.variant === "StructDatatype" &&
              d.name === symbol.name &&
              d.definedInNamespaceOrStruct === symbol.definedInNamespaceOrStruct &&
              d.genericSymbols.toString() === symbol.genericSymbols.toString(),
          );

        case "DeferredDatatype":
          return [...this.symbols.values()].find((d) => d.variant === "DeferredDatatype");

        case "RawPointerDatatype":
          return [...this.symbols.values()].find(
            (d) => d.variant === "RawPointerDatatype" && d.pointee === symbol.pointee,
          );

        case "ReferenceDatatype":
          return [...this.symbols.values()].find(
            (d) => d.variant === "ReferenceDatatype" && d.referee === symbol.referee,
          );

        case "CallableDatatype": {
          return [...this.symbols.values()].find(
            (d) =>
              d.variant === "CallableDatatype" &&
              d.functionType === symbol.functionType &&
              d.thisExprType === symbol.thisExprType,
          );
        }

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

    // lookupByName(name: string): Symboll | undefined {
    //   const symbol = [...this.datatypes.values()].find((s) => "name" in s && s.name === name);
    //   if (symbol) {
    //     return symbol;
    //   }
    //   return undefined;
    // }

    // makePrimitiveDatatypeAvailable(primitive: EPrimitive) {
    //   return this.makeDatatypeAvailable({
    //     variant: "Primitive",
    //     primitive: primitive,
    //     concrete: true,
    //   });
    // }
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
    elaborateCurrentStructOrNamespace: SemanticSymbolId | null;
    datatypesDone: Map<SemanticSymbolId, SemanticSymbolId>;
  };
}

export function getSymbol(sr: SemanticResult, id: SemanticSymbolId, errorPropagationSteps = 0) {
  if (!id) throw new InternalError("ID is undefined", undefined, 1);
  const symbol = sr.symbolTable.get(id, 1 + errorPropagationSteps);
  if (!symbol) {
    throw new InternalError("Symbol does not exist " + id);
  }
  return symbol;
}
