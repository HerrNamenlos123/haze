import { HAZE_STDLIB_NAME } from "../Module";
import {
  EAssignmentOperation,
  EBinaryOperation,
  EExternLanguage,
  EDatatypeMutability,
  EVariableMutability,
  BinaryOperationToString,
  UnaryOperationToString,
  IncrOperationToString,
} from "../shared/AST";
import {
  BrandedArray,
  EMethodType,
  EPrimitive,
  EVariableContext,
  primitiveToString,
  stringToPrimitive,
  type NameSet,
} from "../shared/common";
import { getModuleGlobalNamespaceName } from "../shared/Config";
import {
  assert,
  CompilerError,
  formatSourceLoc,
  InternalError,
  type SourceLoc,
} from "../shared/Errors";
import {
  Collect,
  funcSymHasParameterPack,
  printCollectedDatatype,
  type CollectionContext,
} from "../SymbolCollection/SymbolCollection";
import { Conversion } from "./Conversion";
import { EvalCTFE, EvalCTFEBoolean } from "./CTFE";
import {
  lookupAndElaborateDatatype,
  makeNullableReferenceDatatypeAvailable,
  makeReferenceDatatypeAvailable,
  elaborateParentSymbolFromCache,
  makeArrayDatatypeAvailable,
  instantiateAndElaborateStructWithGenerics,
  makeSliceDatatypeAvailable,
  makeTypeUse,
  makeRawFunctionDatatypeAvailable,
} from "./LookupDatatype";

import type { EIncrOperation, EOperator, EUnaryOperation } from "../shared/AST";
import { type Brand, type LiteralValue } from "../shared/common";

export function printSubstitutionContext(sr: SemanticResult, context: Semantic.ElaborationContext) {
  console.info(`Substitutions: (${[...context.substitute.values()].length})`);
  for (const [fromId, toId] of context.substitute) {
    console.info(
      `${printCollectedDatatype(sr.cc, fromId)} -> ${Semantic.serializeTypeUse(sr, toId)}`
    );
  }
}

export type SemanticResult = {
  cc: CollectionContext;

  blockScopeNodes: BrandedArray<Semantic.BlockScopeId, Semantic.BlockScope>;
  symbolNodes: BrandedArray<Semantic.SymbolId, Semantic.Symbol>;
  exprNodes: BrandedArray<Semantic.ExprId, Semantic.Expression>;
  statementNodes: BrandedArray<Semantic.StatementId, Semantic.Statement>;
  typeDefNodes: BrandedArray<Semantic.TypeDefId, Semantic.TypeDef>;
  typeUseNodes: BrandedArray<Semantic.TypeUseId, Semantic.TypeUse>;

  overloadedOperators: Semantic.FunctionSymbol[];

  elaboratedFunctionSignatures: Map<Collect.Id, Semantic.SymbolId[]>;
  elaboratedFunctionSignaturesByName: Map<string, Semantic.SymbolId[]>;

  elaboratedStructDatatypes: {
    originalSymbol: Collect.Id;
    generics: Semantic.TypeUseId[];
    substitutionContext: Semantic.ElaborationContext;
    result: Semantic.TypeDefId;
    resultAsTypeDefSymbol: Semantic.SymbolId;
  }[];
  elaboratedFuncdefSymbols: {
    originalSymbol: Collect.Id;
    generics: Semantic.TypeUseId[];
    paramPackTypes: Semantic.TypeUseId[];
    substitutionContext: Semantic.ElaborationContext;
    result: Semantic.SymbolId;
    parentStructOrNS: Semantic.TypeDefId | null;
  }[];
  elaboratedNamespaceSymbols: {
    originalSharedInstance: Collect.Id;
    result: Semantic.TypeDefId;
  }[];
  elaboratedGlobalVariableDefinitions: {
    originalSymbol: Collect.Id;
    result: Semantic.SymbolId;
  }[];
  elaboratedGlobalVariableSymbols: Map<Collect.Id, Semantic.SymbolId>;
  // Function-local variable symbols are cached per function call because they are separate for each generic instance.

  elaboratedPrimitiveTypes: Semantic.TypeDefId[];
  functionTypeCache: Semantic.TypeDefId[];
  nullRefTypeCache: Semantic.TypeDefId[];
  referenceTypeCache: Semantic.TypeDefId[];
  arrayTypeCache: Semantic.TypeDefId[];
  sliceTypeCache: Semantic.TypeDefId[];
  typeInstanceCache: Semantic.TypeUseId[];

  syntheticScopeToVariableMap: Map<Collect.Id, Map<string, Semantic.SymbolId>>;

  exportedCollectedSymbols: Set<number>;

  cInjections: Semantic.SymbolId[];
};

export function makeRawPrimitiveAvailable(
  sr: SemanticResult,
  primitive: EPrimitive
): Semantic.TypeDefId {
  for (const id of sr.elaboratedPrimitiveTypes) {
    const s = sr.typeDefNodes.get(id);
    assert(s.variant === Semantic.ENode.PrimitiveDatatype);
    if (s.primitive === primitive) {
      return id;
    }
  }
  const [s, sId] = Semantic.addType(sr, {
    variant: Semantic.ENode.PrimitiveDatatype,
    primitive: primitive,
    concrete: true,
  });
  sr.elaboratedPrimitiveTypes.push(sId);
  return sId;
}

export function makePrimitiveAvailable(
  sr: SemanticResult,
  primitive: EPrimitive,
  mutability: EDatatypeMutability,
  sourceloc: SourceLoc
): Semantic.TypeUseId {
  return makeTypeUse(sr, makeRawPrimitiveAvailable(sr, primitive), mutability, sourceloc)[1];
}

export function isTypeConcrete(sr: SemanticResult, id: Semantic.TypeUseId) {
  const typeInstance = sr.typeUseNodes.get(id);
  const symbol = sr.typeDefNodes.get(typeInstance.type);
  assert("concrete" in symbol);
  return symbol.concrete;
}

export function IsExprDecisiveForOverloadResolution(sr: SemanticResult, exprId: Collect.Id) {
  const expr = sr.cc.nodes.get(exprId);

  switch (expr.variant) {
    case Collect.ENode.StructInstantiationExpr: {
      return expr.structType !== null;
    }

    case Collect.ENode.ParenthesisExpr: {
      return IsExprDecisiveForOverloadResolution(sr, expr.expr);
    }

    default:
      return true;
  }
}

export namespace Semantic {
  export type SymbolId = Brand<number, "SemanticSymbol">;
  export type StatementId = Brand<number, "SemanticStatement">;
  export type ExprId = Brand<number, "SemanticExpr">;
  export type BlockScopeId = Brand<number, "SemanticBlockScope">;
  export type TypeDefId = Brand<number, "SemanticTypeDef">;
  export type TypeUseId = Brand<number, "SemanticTypeUse">;

  export const enum ENode {
    CInjectDirectiveSymbol,
    // Symbols
    VariableSymbol,
    GlobalVariableDefinitionSymbol,
    FunctionSymbol,
    FunctionSignature,
    StructSignature,
    TypeDefSymbol,
    // Datatypes
    FunctionDatatype,
    BlockScope,
    StructDatatype,
    NullableReferenceDatatype,
    ReferenceDatatype,
    CallableDatatype,
    ParameterPackDatatype,
    PrimitiveDatatype,
    GenericParameterDatatype,
    NamespaceDatatype,
    LiteralValueDatatype,
    ArrayDatatype,
    SliceDatatype,
    // Statements
    InlineCStatement,
    WhileStatement,
    IfStatement,
    VariableStatement,
    ExprStatement,
    BlockScopeStatement,
    ReturnStatement,
    // Expressions
    ParenthesisExpr,
    BinaryExpr,
    LiteralExpr,
    UnaryExpr,
    ExprCallExpr,
    SymbolValueExpr,
    DatatypeAsValueExpr,
    SizeofExpr,
    ExplicitCastExpr,
    MemberAccessExpr,
    CallableExpr,
    AddressOfExpr,
    DereferenceExpr,
    ExprAssignmentExpr,
    RefAssignmentExpr,
    StructInstantiationExpr,
    PreIncrExpr,
    PostIncrExpr,
    ArrayLiteralExpr,
    ArraySubscriptExpr,
    ArraySliceExpr,
    StringConstructExpr,
    // Dummy
    Dummy,
  }

  export function addBlockScope<T extends Semantic.BlockScope>(
    sr: SemanticResult,
    n: T
  ): [T, Semantic.BlockScopeId] {
    if (sr.blockScopeNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      sr.blockScopeNodes.push(undefined as any);
    }
    const id = sr.blockScopeNodes.length as Semantic.BlockScopeId;
    sr.blockScopeNodes.push(n);
    return [n, id];
  }

  export function addTypeInstance<T extends Semantic.TypeUse>(
    sr: SemanticResult,
    n: T
  ): [T, Semantic.TypeUseId] {
    if (sr.typeUseNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      sr.typeUseNodes.push(undefined as any);
    }
    const id = sr.typeUseNodes.length as Semantic.TypeUseId;
    sr.typeUseNodes.push(n);
    return [n, id];
  }

  export function addStatement<T extends Semantic.Statement>(
    sr: SemanticResult,
    n: T
  ): [T, Semantic.StatementId] {
    if (sr.statementNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      sr.statementNodes.push(undefined as any);
    }
    const id = sr.statementNodes.length as Semantic.StatementId;
    sr.statementNodes.push(n);
    return [n, id];
  }

  export function addType<T extends Semantic.TypeDef>(
    sr: SemanticResult,
    n: T
  ): [T, Semantic.TypeDefId] {
    if (sr.typeDefNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      sr.typeDefNodes.push(undefined as any);
    }
    const id = sr.typeDefNodes.length as Semantic.TypeDefId;
    sr.typeDefNodes.push(n);
    return [n, id];
  }

  export function addSymbol<T extends Semantic.Symbol>(
    sr: SemanticResult,
    n: T
  ): [T, Semantic.SymbolId] {
    if (sr.symbolNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      sr.symbolNodes.push(undefined as any);
    }
    const id = sr.symbolNodes.length as Semantic.SymbolId;
    sr.symbolNodes.push(n);
    return [n, id];
  }

  export function addExpr<T extends Semantic.Expression>(
    sr: SemanticResult,
    n: T
  ): [T, Semantic.ExprId] {
    if (sr.exprNodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      sr.exprNodes.push(undefined as any);
    }
    const id = sr.exprNodes.length as Semantic.ExprId;
    sr.exprNodes.push(n);
    return [n, id];
  }

  export type Constraint = {
    variableSymbol: Semantic.SymbolId;
    constraintValue:
      | {
          kind: "comparison";
          operation: EBinaryOperation;
          value: bigint;
        }
      | {
          kind: "variant";
          operation: "is" | "is not";
          variantType: Semantic.TypeUseId;
        };
  };

  export type CInjectDirectiveSymbol = {
    variant: ENode.CInjectDirectiveSymbol;
    value: string;
    sourceloc: SourceLoc;
  };

  export type VariableSymbol = {
    variant: ENode.VariableSymbol;
    name: string;
    memberOfStruct: TypeDefId | null;
    type: TypeUseId | null;
    mutability: EVariableMutability;
    export: boolean;
    extern: EExternLanguage;
    variableContext: EVariableContext;
    parentStructOrNS: TypeDefId | null;
    sourceloc: SourceLoc;
    comptime: boolean;
    comptimeValue: ExprId | null;
    concrete: boolean;
  };

  export type GlobalVariableDefinitionSymbol = {
    variant: ENode.GlobalVariableDefinitionSymbol;
    variableSymbol: SymbolId;
    name: string;
    value: ExprId | null;
    export: boolean;
    extern: EExternLanguage;
    parentStructOrNS: TypeDefId | null;
    sourceloc: SourceLoc;
    comptime: boolean;
    concrete: boolean;
  };

  export type FunctionSignature = {
    variant: ENode.FunctionSignature;
    originalFunction: Collect.Id;
    genericPlaceholders: Semantic.TypeDefId[];
    name: string;
    extern: EExternLanguage;
    parentStructOrNS: TypeDefId | null;
    parameters: {
      name: string;
      type: TypeUseId;
    }[];
    returnType: Semantic.TypeUseId;
  };

  export type FunctionSymbol = {
    variant: ENode.FunctionSymbol;
    staticMethod: boolean;
    name: string;
    type: TypeDefId;
    noemit: boolean;
    generics: Semantic.TypeUseId[];
    parameterNames: string[];
    parameterPack: boolean;
    extern: EExternLanguage;
    isMonomorphized: boolean;
    scope: Semantic.BlockScopeId | null;
    export: boolean;
    methodType: EMethodType;
    methodOf: TypeDefId | null;
    sourceloc: SourceLoc;
    parentStructOrNS: TypeDefId | null;
    concrete: boolean;
  };

  export type TypeDefSymbol = {
    variant: ENode.TypeDefSymbol;
    datatype: TypeDefId;
  };

  export type BlockScope = {
    variant: ENode.BlockScope;
    statements: StatementId[];
    constraints: Constraint[];
  };

  export type FunctionDatatypeDef = {
    variant: ENode.FunctionDatatype;
    parameters: TypeUseId[];
    returnType: TypeUseId;
    vararg: boolean;
    concrete: boolean;
  };

  export type StructDatatypeDef = {
    variant: ENode.StructDatatype;
    name: string;
    noemit: boolean;
    generics: TypeUseId[];
    extern: EExternLanguage;
    members: Semantic.SymbolId[];
    memberDefaultValues: {
      memberName: string;
      value: Semantic.ExprId;
    }[];
    methods: Semantic.SymbolId[];
    nestedStructs: Semantic.TypeDefId[];
    parentStructOrNS: TypeDefId | null;
    sourceloc: SourceLoc;
    concrete: boolean;
    isMonomorphized: boolean;
    collectedSymbol: Collect.Id;
    originalCollectedSymbol: Collect.Id;
  };

  export type NullableReferenceDatatypeDef = {
    variant: ENode.NullableReferenceDatatype;
    referee: TypeUseId;
    concrete: boolean;
  };

  export type ReferenceDatatypeDef = {
    variant: ENode.ReferenceDatatype;
    referee: TypeUseId;
    concrete: boolean;
  };

  export type ParameterPackDatatypeDef = {
    variant: ENode.ParameterPackDatatype;
    parameters: Semantic.SymbolId[] | null;
    concrete: boolean;
  };

  export type CallableDatatypeDef = {
    variant: ENode.CallableDatatype;
    thisExprType?: TypeUseId;
    functionType: TypeDefId;
    concrete: boolean;
  };

  export type PrimitiveDatatypeDef = {
    variant: ENode.PrimitiveDatatype;
    primitive: EPrimitive;
    concrete: boolean;
  };

  export type ArrayDatatypeDef = {
    variant: ENode.ArrayDatatype;
    datatype: TypeUseId;
    length: number;
    concrete: boolean;
  };

  export type SliceDatatypeDef = {
    variant: ENode.SliceDatatype;
    datatype: TypeUseId;
    concrete: boolean;
  };

  export type GenericParameterDatatypeDef = {
    variant: ENode.GenericParameterDatatype;
    name: string;
    collectedParameter: Collect.Id;
    concrete: boolean;
  };

  export type NamespaceDatatypeDef = {
    variant: ENode.NamespaceDatatype;
    name: string;
    parentStructOrNS: TypeDefId | null;
    symbols: Semantic.SymbolId[];
    collectedNamespace: Collect.Id;
    concrete: boolean; // For consistency, always true
  };

  export type LiteralValueDatatypeDef = {
    variant: ENode.LiteralValueDatatype;
    literal: LiteralValue;
    sourceloc: SourceLoc;
    concrete: boolean;
  };

  export type TypeDef =
    | GenericParameterDatatypeDef
    | NamespaceDatatypeDef
    | FunctionDatatypeDef
    | StructDatatypeDef
    | NullableReferenceDatatypeDef
    | ArrayDatatypeDef
    | SliceDatatypeDef
    | ReferenceDatatypeDef
    | ParameterPackDatatypeDef
    | CallableDatatypeDef
    | LiteralValueDatatypeDef
    | PrimitiveDatatypeDef;

  export type TypeUse = {
    type: TypeDefId;
    mutability: EDatatypeMutability;
    sourceloc: SourceLoc;
  };

  export type Symbol =
    | CInjectDirectiveSymbol
    | VariableSymbol
    | GlobalVariableDefinitionSymbol
    | FunctionSignature
    | TypeDefSymbol
    | FunctionSymbol;

  export type ExprMemberAccessExpr = {
    variant: ENode.MemberAccessExpr;
    expr: ExprId;
    memberName: string;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type CallableExpr = {
    variant: ENode.CallableExpr;
    thisExpr: ExprId;
    functionSymbol: SymbolId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type SymbolValueExpr = {
    variant: ENode.SymbolValueExpr;
    symbol: SymbolId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type DatatypeAsValueExpr = {
    variant: ENode.DatatypeAsValueExpr;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type SizeofExpr = {
    variant: ENode.SizeofExpr;
    valueExpr: ExprId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ExprAssignmentExpr = {
    variant: ENode.ExprAssignmentExpr;
    value: ExprId;
    target: ExprId;
    type: TypeUseId;
    operation: EAssignmentOperation;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type RefAssignmentExpr = {
    variant: ENode.RefAssignmentExpr;
    value: ExprId;
    target: ExprId;
    type: TypeUseId;
    operation: "assign" | "reassign";
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type DereferenceExpr = {
    variant: ENode.DereferenceExpr;
    expr: ExprId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type AddressOfExpr = {
    variant: ENode.AddressOfExpr;
    expr: ExprId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ExplicitCastExpr = {
    variant: ENode.ExplicitCastExpr;
    expr: ExprId;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type BinaryExpr = {
    variant: ENode.BinaryExpr;
    left: ExprId;
    right: ExprId;
    operation: EBinaryOperation;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type UnaryExpr = {
    variant: ENode.UnaryExpr;
    expr: ExprId;
    operation: EUnaryOperation;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type PostIncrExpr = {
    variant: ENode.PostIncrExpr;
    expr: ExprId;
    operation: EIncrOperation;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type PreIncrExpr = {
    variant: ENode.PreIncrExpr;
    expr: ExprId;
    operation: EIncrOperation;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ExprCallExpr = {
    variant: ENode.ExprCallExpr;
    calledExpr: ExprId;
    arguments: ExprId[];
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type StructInstantiationExpr = {
    variant: ENode.StructInstantiationExpr;
    assign: {
      name: string;
      value: ExprId;
    }[];
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type LiteralExpr = {
    variant: ENode.LiteralExpr;
    literal: LiteralValue;
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ArrayLiteralExpr = {
    variant: ENode.ArrayLiteralExpr;
    values: ExprId[];
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ArraySubscriptExpr = {
    variant: ENode.ArraySubscriptExpr;
    expr: ExprId;
    indices: ExprId[];
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ArraySliceExpr = {
    variant: ENode.ArraySliceExpr;
    expr: ExprId;
    indices: {
      start: ExprId | null;
      end: ExprId | null;
    }[];
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type StringConstructExpr = {
    variant: ENode.StringConstructExpr;
    value: {
      variant: "data-length";
      data: ExprId;
      length: ExprId;
    };
    type: TypeUseId;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type Expression =
    | ExprMemberAccessExpr
    | SymbolValueExpr
    | DatatypeAsValueExpr
    | SizeofExpr
    | ExprAssignmentExpr
    | RefAssignmentExpr
    | UnaryExpr
    | BinaryExpr
    | CallableExpr
    | PreIncrExpr
    | PostIncrExpr
    | AddressOfExpr
    | DereferenceExpr
    | ExplicitCastExpr
    | ExprCallExpr
    | StructInstantiationExpr
    | LiteralExpr
    | ArrayLiteralExpr
    | ArraySubscriptExpr
    | ArraySliceExpr
    | StringConstructExpr;

  // =============================================

  export type InlineCStatement = {
    variant: ENode.InlineCStatement;
    value: string;
    sourceloc: SourceLoc;
  };

  export type ReturnStatement = {
    variant: ENode.ReturnStatement;
    expr?: ExprId;
    sourceloc: SourceLoc;
  };

  export type IfStatement = {
    variant: ENode.IfStatement;
    condition: ExprId;
    then: BlockScopeId;
    elseIfs: {
      condition: ExprId;
      then: BlockScopeId;
    }[];
    else?: BlockScopeId;
    sourceloc: SourceLoc;
  };

  export type WhileStatement = {
    variant: ENode.WhileStatement;
    condition: ExprId;
    then: BlockScopeId;
    sourceloc: SourceLoc;
  };

  export type VariableStatement = {
    variant: ENode.VariableStatement;
    name: string;
    value: ExprId | null;
    comptime: boolean;
    variableSymbol: SymbolId;
    sourceloc: SourceLoc;
  };

  export type ExprStatement = {
    variant: ENode.ExprStatement;
    expr: ExprId;
    sourceloc: SourceLoc;
  };

  export type BlockScopeStatement = {
    variant: ENode.BlockScopeStatement;
    block: BlockScopeId;
    sourceloc: SourceLoc;
  };

  export type Statement =
    | InlineCStatement
    | ReturnStatement
    | VariableStatement
    | IfStatement
    | WhileStatement
    | BlockScopeStatement
    | ExprStatement;

  export function tryLookupSymbol(
    sr: SemanticResult,
    name: string,
    args: { startLookupInScope: Collect.Id; sourceloc: SourceLoc; pubRequired?: boolean }
  ): { type: "semantic"; id: Semantic.ExprId } | { type: "collect"; id: Collect.Id } | undefined {
    const cc = sr.cc;
    const scope = cc.nodes.get(args.startLookupInScope);

    if (sr.syntheticScopeToVariableMap.has(args.startLookupInScope)) {
      const map = sr.syntheticScopeToVariableMap.get(args.startLookupInScope)!;
      if (map.has(name)) {
        const symbolId = map.get(name)!;
        const symbol = sr.symbolNodes.get(symbolId);
        assert(symbol.variant === Semantic.ENode.VariableSymbol);
        assert(symbol.type);
        return {
          id: Semantic.addExpr(sr, {
            variant: Semantic.ENode.SymbolValueExpr,
            symbol: symbolId,
            type: symbol.type,
            isTemporary: false,
            sourceloc: args.sourceloc,
          })[1],
          type: "semantic",
        };
      }
    }

    const lookupDirect = (symbols: Set<Collect.Id>) => {
      for (const id of symbols) {
        const s = cc.nodes.get(id);
        if (s.variant === Collect.ENode.FunctionOverloadGroup && s.name === name) {
          if (
            [...s.overloads].some((o) => {
              const func = cc.nodes.get(o);
              assert(func.variant === Collect.ENode.FunctionSymbol);
              return !args.pubRequired || func.pub;
            })
          ) {
            return id;
          }
        } else if (s.variant === Collect.ENode.StructDefinitionSymbol && s.name === name) {
          if (!args.pubRequired || s.pub) {
            return id;
          }
        } else if (s.variant === Collect.ENode.NamespaceDefinitionSymbol && s.name === name) {
          if (!args.pubRequired || s.pub) {
            // Caution: This lookup needs to return the actual namespace definition and NOT the shared instance.
            // Because the lookup must also resolve generics and to do that, it needs to know the correct scopes
            // and the parent scope stack must be valid, which is not the case with the shared instance as it has multiple.
            return id;
          }
        } else if (s.variant === Collect.ENode.GenericTypeParameter && s.name === name) {
          return id;
        } else if (s.variant === Collect.ENode.AliasTypeSymbol && s.name === name) {
          return id;
        } else if (s.variant === Collect.ENode.VariableSymbol && s.name === name) {
          if (!args.pubRequired) {
            return id;
          }
        }
      }
    };

    switch (scope.variant) {
      case Collect.ENode.NamespaceScope: {
        const ns = cc.nodes.get(scope.owningSymbol);
        assert(ns.variant === Collect.ENode.NamespaceDefinitionSymbol);
        const instance = cc.nodes.get(ns.sharedInstance);
        assert(instance.variant === Collect.ENode.NamespaceSharedInstance);
        for (const nsScope of instance.namespaceScopes) {
          const sc = cc.nodes.get(nsScope);
          assert(sc.variant === Collect.ENode.NamespaceScope);
          const found = lookupDirect(sc.symbols);
          if (found) {
            return {
              id: found,
              type: "collect",
            };
          }
        }
        return tryLookupSymbol(sr, name, {
          startLookupInScope: scope.parentScope,
          sourceloc: args.sourceloc,
        });
      }

      case Collect.ENode.ModuleScope:
      case Collect.ENode.UnitScope:
      case Collect.ENode.FileScope:
      case Collect.ENode.BlockScope:
      case Collect.ENode.StructScope:
      case Collect.ENode.FunctionScope: {
        const found = lookupDirect(scope.symbols);
        if (found) {
          return {
            id: found,
            type: "collect",
          };
        }

        if (scope.variant === Collect.ENode.ModuleScope) {
          return undefined;
        }

        if (scope.variant === Collect.ENode.FileScope) {
          // File Scope -> Don't go higher but look in adjacent files in the same unit, then go higher
          const unitScope = cc.nodes.get(scope.parentScope);
          assert(unitScope.variant === Collect.ENode.UnitScope);

          for (const file of unitScope.symbols) {
            if (file === args.startLookupInScope) continue; // Prevent infinite recursion with itself

            const fileScope = cc.nodes.get(file);
            assert(fileScope.variant === Collect.ENode.FileScope);

            const found = lookupDirect(fileScope.symbols);
            if (found) {
              return {
                id: found,
                type: "collect",
              };
            }
          }

          return tryLookupSymbol(sr, name, {
            startLookupInScope: scope.parentScope,
            sourceloc: args.sourceloc,
          });
        } else {
          // Not a file scope -> Can go higher
          return tryLookupSymbol(sr, name, {
            startLookupInScope: scope.parentScope,
            sourceloc: args.sourceloc,
          });
        }
      }

      default:
        assert(false, "Unknown scope type: " + scope.variant);
    }
  }

  export function lookupSymbol(
    sr: SemanticResult,
    name: string,
    args: { startLookupInScope: Collect.Id; sourceloc: SourceLoc }
  ) {
    const found = tryLookupSymbol(sr, name, args);
    if (found) return found;
    throw new CompilerError(`Symbol '${name}' was not declared in this scope`, args.sourceloc);
  }

  // export function recursivelyExportCollectedSymbols(
  //   sr: SemanticResult,
  //   symbol: Collect.Node | Collect.Scope
  // ) {
  //   if (sr.exportedCollectedSymbols.has(symbol)) {
  //     return; // Prevent recursion
  //   }

  //   if (symbol instanceof Collect.Scope) {
  //     sr.exportedCollectedSymbols.add(symbol);
  //     if (symbol.parentScope) {
  //       recursivelyExportCollectedSymbols(sr, getScope(sr.cc, symbol.parentScope));
  //     }
  //     for (const s of symbol.symbols) {
  //       recursivelyExportCollectedSymbols(sr, getSymbol(sr.cc, s));
  //     }
  //   } else {
  //     switch (symbol.variant) {
  //       case "FunctionDeclaration":
  //         if (!symbol.export) return;
  //         sr.exportedCollectedSymbols.add(symbol);
  //         if (symbol._collect.definedInScope) {
  //           recursivelyExportCollectedSymbols(sr, getScope(sr.cc, symbol._collect.definedInScope));
  //         }
  //         break;

  //       case "FunctionDefinition":
  //         if (!symbol.export) return;
  //         sr.exportedCollectedSymbols.add(symbol);
  //         if (symbol._collect.definedInScope) {
  //           recursivelyExportCollectedSymbols(sr, getScope(sr.cc, symbol._collect.definedInScope));
  //         }
  //         break;

  //       case "NamespaceDefinition":
  //         for (const d of symbol.declarations) {
  //           recursivelyExportCollectedSymbols(sr, d);
  //         }
  //         break;

  //       case "GenericParameter":
  //       case "StructMethod":
  //       case "VariableDefinitionStatement":
  //         assert(false, "TBD");

  //       case "GlobalVariableDefinition":
  //       case "StructDefinition":
  //         if (!symbol.export) return;
  //         sr.exportedCollectedSymbols.add(symbol);
  //         if (symbol._collect.definedInScope) {
  //           recursivelyExportCollectedSymbols(sr, getScope(sr.cc, symbol._collect.definedInScope));
  //         }
  //         break;
  //     }
  //   }
  // }

  export type ElaborationContext = {
    substitute: Map<Collect.Id, Semantic.TypeUseId>;
    currentScope: Collect.Id; // This is the scope in which we are elaborating and it changes (e.g. A<i32> when elaborating A<i32>.B)
    genericsScope: Collect.Id; // This is the scope for generics which does not change (e.g. A<i32>.B<u8> => i32 and u8 are elaborated in the same scope)
  };

  export function makeElaborationContext(args: {
    currentScope: Collect.Id;
    genericsScope: Collect.Id;
  }): ElaborationContext {
    return {
      substitute: new Map(),
      currentScope: args.currentScope,
      genericsScope: args.genericsScope,
    };
  }

  export function isolateSubstitutionContext(
    parent: ElaborationContext,
    args: {
      currentScope: Collect.Id;
      genericsScope: Collect.Id;
    }
  ): ElaborationContext {
    return {
      substitute: new Map(parent.substitute),
      currentScope: args.currentScope,
      genericsScope: args.genericsScope,
    };
  }

  export function mergeSubstitutionContext(
    a: ElaborationContext,
    b: ElaborationContext,
    args: {
      currentScope: Collect.Id;
      genericsScope: Collect.Id;
    }
  ): ElaborationContext {
    return {
      substitute: new Map([...a.substitute, ...b.substitute]),
      currentScope: args.currentScope,
      genericsScope: args.genericsScope,
    };
  }

  function prepareParameterPackTypes(
    sr: SemanticResult,
    args: {
      functionName: string;
      requiredParameters: Collect.ParameterValue[];
      givenArguments?: {
        index: number;
        exprId: Semantic.ExprId | null;
      }[];
      sourceloc: SourceLoc;
    }
  ) {
    const parameterPackTypes: Semantic.TypeUseId[] = [];

    const hasParameterPack = args.requiredParameters.some((p) => {
      const t = sr.cc.nodes.get(p.type);
      return t.variant === Collect.ENode.ParameterPack;
    });
    if (hasParameterPack) {
      const numParametersWithoutPack = args.requiredParameters.length - 1;

      if (args.givenArguments === undefined) {
        throw new CompilerError(
          `Function ${args.functionName} uses a Parameter Pack, but there is not enough context around the function access to determine the types it is going to be called with`,
          args.sourceloc
        );
      }

      if (args.givenArguments.length < numParametersWithoutPack) {
        throw new CompilerError(
          `Function ${args.functionName} requires at least ${numParametersWithoutPack} parameters, but ${args.givenArguments.length} are given`,
          args.sourceloc
        );
      }

      for (let i = numParametersWithoutPack; i < args.givenArguments.length; i++) {
        const exprId = args.givenArguments[i].exprId;
        assert(exprId);
        const expr = sr.exprNodes.get(exprId);
        parameterPackTypes.push(expr.type);
      }
    }
    return parameterPackTypes;
  }

  function lookupSymbolInNamespaceOrStructScope(
    sr: SemanticResult,
    symbolId: Collect.Id,
    args: {
      name: string;
      expr: Collect.MemberAccessExpr;
      context: ElaborationContext;
      elaboratedVariables: Map<Collect.Id, Semantic.SymbolId>;
      gonnaCallFunctionWithParameterValues?: {
        index: number;
        exprId: Semantic.ExprId | null;
      }[];
      isMonomorphized: boolean;
    }
  ) {
    const symbol = sr.cc.nodes.get(symbolId);
    if (symbol.variant === Collect.ENode.StructDefinitionSymbol && symbol.name === args.name) {
      // A struct nested in a struct
      const instantiated = instantiateAndElaborateStructWithGenerics(sr, {
        definedStructTypeId: symbolId,
        elaboratedVariables: args.elaboratedVariables,
        genericArgs: args.expr.genericArgs.map((g) => {
          return lookupAndElaborateDatatype(sr, {
            typeId: g,
            elaboratedVariables: args.elaboratedVariables,
            context: isolateSubstitutionContext(args.context, {
              currentScope: args.context.currentScope,
              genericsScope: args.context.currentScope,
            }),
            isInCFuncdecl: false,
          });
        }),
        context: args.context,
        sourceloc: args.expr.sourceloc,
      });
      return Semantic.addExpr(sr, {
        variant: Semantic.ENode.DatatypeAsValueExpr,
        symbol: instantiated,
        type: makeTypeUse(sr, instantiated, EDatatypeMutability.Default, args.expr.sourceloc)[1],
        isTemporary: false,
        sourceloc: args.expr.sourceloc,
      });
    } else if (
      symbol.variant === Collect.ENode.FunctionOverloadGroup &&
      symbol.name === args.name
    ) {
      // A method or a namespaced function

      const chosenOverloadId = ChooseFunctionOverload(
        sr,
        symbolId,
        args.gonnaCallFunctionWithParameterValues,
        {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          usageSourceLocation: args.expr.sourceloc,
        }
      );

      const funcsym = sr.cc.nodes.get(chosenOverloadId);
      assert(funcsym.variant === Collect.ENode.FunctionSymbol);

      const paramPackTypes = prepareParameterPackTypes(sr, {
        functionName: args.name,
        requiredParameters: funcsym.parameters,
        givenArguments: args.gonnaCallFunctionWithParameterValues,
        sourceloc: args.expr.sourceloc,
      });

      const functionSymbolId = elaborateFunctionSymbolWithGenerics(
        sr,
        elaborateFunctionSignature(sr, chosenOverloadId, { context: args.context }),
        {
          elaboratedVariables: args.elaboratedVariables,
          paramPackTypes: paramPackTypes,
          genericArgs: args.expr.genericArgs.map((g) => {
            return lookupAndElaborateDatatype(sr, {
              typeId: g,
              elaboratedVariables: args.elaboratedVariables,
              context: isolateSubstitutionContext(args.context, {
                currentScope: args.context.currentScope,
                genericsScope: args.context.currentScope,
              }),
              isInCFuncdecl: false,
            });
          }),
          context: args.context,
          isMonomorphized: args.isMonomorphized,
          parentStructOrNS: elaborateParentSymbolFromCache(sr, {
            context: args.context,
            parentScope: symbol.parentScope,
          }),
          usageSourceLocation: args.expr.sourceloc,
        }
      );
      const functionSymbol = sr.symbolNodes.get(functionSymbolId);
      assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
      return Semantic.addExpr(sr, {
        variant: Semantic.ENode.SymbolValueExpr,
        symbol: functionSymbolId,
        type: makeTypeUse(
          sr,
          functionSymbol.type,
          EDatatypeMutability.Const,
          args.expr.sourceloc
        )[1],
        isTemporary: false,
        sourceloc: args.expr.sourceloc,
      });
    } else {
      return undefined;
    }
  }

  function lookupAndElaborateNamespaceMemberAccess(
    sr: SemanticResult,
    namespaceValueId: Semantic.ExprId,
    args: {
      name: string;
      expr: Collect.MemberAccessExpr;
      context: ElaborationContext;
      elaboratedVariables: Map<Collect.Id, Semantic.SymbolId>;
      gonnaCallFunctionWithParameterValues?: {
        index: number;
        exprId: Semantic.ExprId | null;
      }[];
      isMonomorphized: boolean;
    }
  ) {
    const namespace = sr.exprNodes.get(namespaceValueId);
    assert(namespace.variant === Semantic.ENode.DatatypeAsValueExpr);
    const semanticNamespace = sr.typeDefNodes.get(sr.typeUseNodes.get(namespace.type).type);
    assert(semanticNamespace.variant === Semantic.ENode.NamespaceDatatype);
    const collectedNamespace = sr.cc.nodes.get(semanticNamespace.collectedNamespace);
    assert(collectedNamespace.variant === Collect.ENode.NamespaceDefinitionSymbol);
    const collectedNSSharedInstance = sr.cc.nodes.get(collectedNamespace.sharedInstance);
    assert(collectedNSSharedInstance.variant === Collect.ENode.NamespaceSharedInstance);

    for (const scopeId of collectedNSSharedInstance.namespaceScopes) {
      const scope = sr.cc.nodes.get(scopeId);
      assert(scope.variant === Collect.ENode.NamespaceScope);
      for (const symbolId of scope.symbols) {
        const s = lookupSymbolInNamespaceOrStructScope(sr, symbolId, {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          expr: args.expr,
          name: args.name,
          gonnaCallFunctionWithParameterValues: args.gonnaCallFunctionWithParameterValues,
          isMonomorphized: args.isMonomorphized,
        });
        if (s) {
          return s;
        }
      }
    }
    throw new CompilerError(
      `Namespace '${collectedNamespace.name}' does not define any declarations named '${args.expr.memberName}'`,
      args.expr.sourceloc
    );
  }

  function lookupAndElaborateStaticStructAccess(
    sr: SemanticResult,
    namespaceOrStructValueId: Semantic.ExprId,
    args: {
      name: string;
      expr: Collect.MemberAccessExpr;
      context: ElaborationContext;
      elaboratedVariables: Map<Collect.Id, Semantic.SymbolId>;
      gonnaCallFunctionWithParameterValues?: {
        index: number;
        exprId: Semantic.ExprId | null;
      }[];
      isMonomorphized: boolean;
    }
  ) {
    const namespaceOrStructValue = sr.exprNodes.get(namespaceOrStructValueId);
    assert(namespaceOrStructValue.variant === Semantic.ENode.DatatypeAsValueExpr);
    const semanticStruct = sr.typeDefNodes.get(
      sr.typeUseNodes.get(namespaceOrStructValue.type).type
    );
    assert(semanticStruct.variant === Semantic.ENode.StructDatatype);
    const collectedStruct = sr.cc.nodes.get(semanticStruct.collectedSymbol);
    assert(collectedStruct.variant === Collect.ENode.StructDefinitionSymbol);
    const structScope = sr.cc.nodes.get(collectedStruct.structScope);
    assert(structScope.variant === Collect.ENode.StructScope);

    const elaboratedStructCache = sr.elaboratedStructDatatypes.find((d) => {
      return d.result === sr.typeUseNodes.get(namespaceOrStructValue.type).type;
    });
    assert(elaboratedStructCache);

    for (const symbolId of structScope.symbols) {
      const s = lookupSymbolInNamespaceOrStructScope(sr, symbolId, {
        context: mergeSubstitutionContext(elaboratedStructCache.substitutionContext, args.context, {
          currentScope: args.context.currentScope,
          genericsScope: args.context.currentScope,
        }),
        elaboratedVariables: args.elaboratedVariables,
        expr: args.expr,
        name: args.name,
        isMonomorphized: args.isMonomorphized,
        gonnaCallFunctionWithParameterValues: args.gonnaCallFunctionWithParameterValues,
      });
      if (s) {
        const symbol = sr.exprNodes.get(s[1]);
        assert(symbol.variant === Semantic.ENode.SymbolValueExpr);
        const sym = sr.symbolNodes.get(symbol.symbol);

        if (sym.variant === Semantic.ENode.FunctionSymbol) {
          if (!sym.staticMethod) {
            throw new CompilerError(
              `Method ${serializeFullSymbolName(
                sr,
                symbol.symbol
              )} is not static but is used in a static context`,
              args.expr.sourceloc
            );
          }
        }
        return s;
      }
    }
    throw new CompilerError(
      `Struct '${collectedStruct.name}' does not define any declarations named '${args.expr.memberName}'`,
      args.expr.sourceloc
    );
  }

  export function makeStructInstantiation(
    sr: SemanticResult,
    structId: Semantic.TypeDefId,
    args: {
      sourceloc: SourceLoc;
      blockScope: Semantic.BlockScope | null;
      elaboratedVariables: Map<Collect.Id, Semantic.SymbolId>;
      isMonomorphized: boolean;
      memberValues: {
        name: string;
        value: Collect.Id;
      }[];
      context: ElaborationContext;
    }
  ): [Semantic.Expression, Semantic.ExprId] {
    const struct = sr.typeDefNodes.get(structId);
    assert(struct.variant === Semantic.ENode.StructDatatype);

    let remainingMembers = struct.members.map((mId) => {
      const m = sr.symbolNodes.get(mId);
      assert(m.variant === Semantic.ENode.VariableSymbol);
      return m.name;
    });
    const assignedMembers: string[] = [];
    const assign: {
      name: string;
      value: Semantic.ExprId;
    }[] = [];
    for (const m of args.memberValues) {
      const variableId = struct.members.find((mmId) => {
        const mm = sr.symbolNodes.get(mmId);
        assert(mm.variant === Semantic.ENode.VariableSymbol);
        return mm.name === m.name;
      });

      if (!variableId) {
        throw new CompilerError(
          `${serializeTypeDef(sr, structId)} does not have a member named '${m.name}'`,
          args.sourceloc
        );
      }
      const variable = sr.symbolNodes.get(variableId);
      assert(variable.variant === Semantic.ENode.VariableSymbol);

      if (assignedMembers.includes(m.name)) {
        throw new CompilerError(`Cannot assign member ${m.name} twice`, args.sourceloc);
      }

      const [e, eId] = elaborateExpr(sr, m.value, {
        context: args.context,
        scope: args.context.currentScope,
        blockScope: args.blockScope,
        elaboratedVariables: args.elaboratedVariables,
        gonnaInstantiateStructWithType: variable.type || undefined,
        isMonomorphized: args.isMonomorphized,
      });

      assert(variable.type);
      const convertedExprId = Conversion.MakeConversion(
        sr,
        eId,
        variable.type,
        args.blockScope?.constraints || [],
        args.sourceloc,
        Conversion.Mode.Implicit
      );

      remainingMembers = remainingMembers.filter((mm) => mm !== m.name);
      assign.push({
        value: convertedExprId,
        name: m.name,
      });
      assignedMembers.push(m.name);
    }

    for (const m of remainingMembers) {
      const defaultValue = struct.memberDefaultValues.find((v) => v.memberName === m);
      if (defaultValue) {
        remainingMembers = remainingMembers.filter((mm) => mm !== m);
        assign.push({
          name: m,
          value: defaultValue.value,
        });
        assignedMembers.push(m);
      }
    }

    if (remainingMembers.length > 0) {
      throw new CompilerError(
        `Members ${remainingMembers.join(", ")} were not assigned and no default value is known`,
        args.sourceloc
      );
    }

    return Semantic.addExpr(sr, {
      variant: Semantic.ENode.StructInstantiationExpr,
      assign: assign,
      type: makeTypeUse(sr, structId, EDatatypeMutability.Const, args.sourceloc)[1],
      sourceloc: args.sourceloc,
      isTemporary: true,
    });
  }

  export function elaborateFunctionSignature(
    sr: SemanticResult,
    functionSymbolId: Collect.Id,
    args: {
      context: ElaborationContext;
    }
  ): Semantic.SymbolId {
    const functionSymbol = sr.cc.nodes.get(functionSymbolId);
    assert(functionSymbol.variant === Collect.ENode.FunctionSymbol);

    const genericPlaceholders = functionSymbol.generics.map((gId) => {
      const g = sr.cc.nodes.get(gId);
      assert(g.variant === Collect.ENode.GenericTypeParameter);
      return Semantic.addType(sr, {
        variant: Semantic.ENode.GenericParameterDatatype,
        name: g.name,
        collectedParameter: gId,
        concrete: false,
      })[1];
    });

    if (sr.elaboratedFunctionSignatures.has(functionSymbolId)) {
      const signatures = sr.elaboratedFunctionSignatures.get(functionSymbolId)!;
      for (const signatureId of signatures) {
        const signature = sr.symbolNodes.get(signatureId);
        assert(signature.variant === Semantic.ENode.FunctionSignature);
        if (
          signature.genericPlaceholders.length === genericPlaceholders.length &&
          signature.genericPlaceholders.every((g, i) => g === genericPlaceholders[i])
        ) {
          return signatureId;
        }
      }
    }

    const parent = elaborateParentSymbolFromCache(sr, {
      context: args.context,
      parentScope: functionSymbol.parentScope,
    });

    const cacheCodename = (parent ? serializeTypeDef(sr, parent) + "." : "") + functionSymbol.name;

    const [signature, signatureId] = Semantic.addSymbol(sr, {
      variant: Semantic.ENode.FunctionSignature,
      genericPlaceholders: genericPlaceholders,
      originalFunction: functionSymbolId,
      extern: functionSymbol.extern,
      name: functionSymbol.name,
      parentStructOrNS: parent,
      parameters: functionSymbol.parameters.map((p) => {
        const type = lookupAndElaborateDatatype(sr, {
          typeId: p.type,
          context: isolateSubstitutionContext(args.context, {
            currentScope: functionSymbol.functionScope || functionSymbol.parentScope,
            genericsScope: functionSymbol.functionScope || functionSymbol.parentScope,
          }),
          elaboratedVariables: new Map(),
          isInCFuncdecl: functionSymbol.extern === EExternLanguage.Extern_C,
        });
        return {
          name: p.name,
          type: type,
        };
      }),
      returnType: lookupAndElaborateDatatype(sr, {
        typeId: functionSymbol.returnType,
        context: isolateSubstitutionContext(args.context, {
          currentScope: functionSymbol.functionScope || functionSymbol.parentScope,
          genericsScope: functionSymbol.functionScope || functionSymbol.parentScope,
        }),
        elaboratedVariables: new Map(),
        isInCFuncdecl: functionSymbol.extern === EExternLanguage.Extern_C,
      }),
    });

    for (const sigId of sr.elaboratedFunctionSignaturesByName.get(cacheCodename) || []) {
      const sig = sr.symbolNodes.get(sigId);
      assert(sig.variant === Semantic.ENode.FunctionSignature);
      if (
        sig.name === signature.name &&
        sig.parentStructOrNS === signature.parentStructOrNS &&
        sig.parameters.length === signature.parameters.length &&
        sig.parameters.every((p, i) => signature.parameters[i].type === p.type)
      ) {
        const ori = sr.cc.nodes.get(sig.originalFunction);
        assert(ori.variant === Collect.ENode.FunctionSymbol);
        throw new CompilerError(
          `A conflicting function with the same signature is already defined.${
            ori.sourceloc ? " Existing definition at: " + formatSourceLoc(ori.sourceloc) : ""
          }`,
          functionSymbol.sourceloc
        );
      }
    }

    if (!sr.elaboratedFunctionSignatures.get(functionSymbolId)) {
      sr.elaboratedFunctionSignatures.set(functionSymbolId, []);
    }
    sr.elaboratedFunctionSignatures.get(functionSymbolId)!.push(signatureId);

    if (!sr.elaboratedFunctionSignaturesByName.get(cacheCodename)) {
      sr.elaboratedFunctionSignaturesByName.set(cacheCodename, []);
    }
    sr.elaboratedFunctionSignaturesByName.get(cacheCodename)!.push(signatureId);

    return signatureId;
  }

  export function ChooseFunctionOverload(
    sr: SemanticResult,
    overloadGroupId: Collect.Id,
    calledWithArgs: { index: number; exprId: Semantic.ExprId | null }[] | undefined,
    args: {
      context: ElaborationContext;
      elaboratedVariables: Map<Collect.Id, Semantic.SymbolId>;
      usageSourceLocation: SourceLoc;
    }
  ) {
    const overloadGroup = sr.cc.nodes.get(overloadGroupId);
    assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroup);

    if (overloadGroup.overloads.size === 1) {
      return [...overloadGroup.overloads][0];
    }

    if (calledWithArgs === undefined) {
      throw new CompilerError(
        `Function '${overloadGroup.name}' is overloaded but not directly called, so there is not enough context to disambiguate the overload. Overloaded functions must be immediately called to disambiguate the call using the given arguments`,
        args.usageSourceLocation
      );
    }

    // First find exact matches
    const matchingSignatures = [] as {
      matches: boolean;
      signature: Semantic.SymbolId;
      reason: string | null;
    }[];
    for (const overloadId of overloadGroup.overloads) {
      const overload = sr.cc.nodes.get(overloadId);
      assert(overload.variant === Collect.ENode.FunctionSymbol);

      const signatureId = elaborateFunctionSignature(sr, overloadId, {
        context: args.context,
      });
      const signature = sr.symbolNodes.get(signatureId);
      assert(signature.variant === Semantic.ENode.FunctionSignature);

      // if (signature.parameters.length !== calledWithArgs.length) {
      //   exactCandidateSignatures.push({
      //     matches: false,
      //     signature: signatureId,
      //     reason: `Expects ${signature.parameters.length} arguments instead of ${calledWithArgs.length}`,
      //   });
      //   continue;
      // }

      if (funcSymHasParameterPack(sr.cc, overloadId)) {
        matchingSignatures.push({
          matches: false,
          signature: signatureId,
          reason: `Contains a parameter pack (exact match not possible)`,
        });
        continue;
      }

      let maxArgIndex = 0;
      for (const arg of calledWithArgs) {
        if (arg.index > maxArgIndex) maxArgIndex = arg.index;
      }

      if (maxArgIndex >= signature.parameters.length) {
        matchingSignatures.push({
          matches: false,
          signature: signatureId,
          reason: `Too many parameters given`,
        });
        continue;
      }

      if (maxArgIndex < signature.parameters.length - 1) {
        matchingSignatures.push({
          matches: false,
          signature: signatureId,
          reason: `Not enough parameters given`,
        });
        continue;
      }

      let matches = true;
      let reason = null as string | null;
      signature.parameters.forEach((p, i) => {
        const passed = calledWithArgs.find((a) => a.index === i);
        if (!passed || !passed.exprId) {
          // This parameter is not passed or is not concrete, so hope that the others are enough for a match
          // matches = false;
          // reason = `Parameter #${i + 1} does not have a concrete type`;
          return;
        }

        const expression = sr.exprNodes.get(passed.exprId);
        if (expression.type !== p.type) {
          matches = false;
          reason = `Parameter #${i + 1} has unrelated type: ${serializeTypeUse(
            sr,
            expression.type
          )} != ${serializeTypeUse(sr, p.type)}`;
          return;
        }
        // Else it fits
      });

      matchingSignatures.push({
        matches: matches,
        signature: signatureId,
        reason: reason,
      });
    }

    if (matchingSignatures.filter((s) => s.matches).length === 1) {
      const signature = sr.symbolNodes.get(matchingSignatures.find((s) => s.matches)!.signature);
      assert(signature.variant === Semantic.ENode.FunctionSignature);
      return signature.originalFunction;
    }

    if (matchingSignatures.filter((s) => s.matches).length === 0) {
      let str = `No candidate for call to overloaded function '${overloadGroup.name}' matches arguments\n`;
      for (const candidate of matchingSignatures) {
        const signature = sr.symbolNodes.get(candidate.signature);
        assert(signature.variant === Semantic.ENode.FunctionSignature);
        const originalFunction = sr.cc.nodes.get(signature.originalFunction);
        assert(originalFunction.variant === Collect.ENode.FunctionSymbol);
        str += `Candidate at ${
          originalFunction.sourceloc ? formatSourceLoc(originalFunction.sourceloc) : "?"
        }: ${serializeFullSymbolName(sr, candidate.signature)} -> `;
        assert(candidate.reason);
        str += `Failed because: ${candidate.reason}\n`;
      }
      throw new CompilerError(str, args.usageSourceLocation);
    } else {
      let str = `Call to overloaded function '${overloadGroup.name}' is ambiguous: Multiple functions fit the criteria:\n`;
      for (const candidate of matchingSignatures) {
        if (!candidate.matches) continue;
        const signature = sr.symbolNodes.get(candidate.signature);
        assert(signature.variant === Semantic.ENode.FunctionSignature);
        const originalFunction = sr.cc.nodes.get(signature.originalFunction);
        assert(originalFunction.variant === Collect.ENode.FunctionSymbol);
        str += `Candidate at ${
          originalFunction.sourceloc ? formatSourceLoc(originalFunction.sourceloc) : "?"
        }: ${serializeFullSymbolName(sr, candidate.signature)}\n`;
      }
      str += "You must use explicit struct initializations in order to disambiguate the call\n";
      throw new CompilerError(str, args.usageSourceLocation);
    }
  }

  export function elaborateExpr(
    sr: SemanticResult,
    exprId: Collect.Id,
    args: {
      context: ElaborationContext;
      scope: Collect.Id;
      elaboratedVariables: Map<Collect.Id, Semantic.SymbolId>;
      gonnaCallFunctionWithParameterValues?: {
        index: number;
        exprId: Semantic.ExprId | null;
      }[];
      gonnaInstantiateStructWithType?: Semantic.TypeUseId;
      blockScope: Semantic.BlockScope | null;
      isMonomorphized: boolean;
    }
  ): [Semantic.Expression, Semantic.ExprId] {
    const expr = sr.cc.nodes.get(exprId);

    args.context = isolateSubstitutionContext(args.context, {
      currentScope: args.scope,
      genericsScope: args.scope,
    });

    switch (expr.variant) {
      case Collect.ENode.BinaryExpr: {
        let [left, leftId] = elaborateExpr(sr, expr.left, {
          context: args.context,
          scope: args.context.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          blockScope: args.blockScope,
          isMonomorphized: args.isMonomorphized,
        });
        let [right, rightId] = elaborateExpr(sr, expr.right, {
          context: args.context,
          scope: args.context.currentScope,
          blockScope: args.blockScope,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
        });

        if (
          (expr.operation === EBinaryOperation.Equal ||
            expr.operation === EBinaryOperation.Unequal) &&
          left.variant === Semantic.ENode.DatatypeAsValueExpr &&
          right.variant === Semantic.ENode.DatatypeAsValueExpr
        ) {
          const value = expr.operation === EBinaryOperation.Equal && left.type === right.type;
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.LiteralExpr,
            literal: {
              type: EPrimitive.bool,
              value: value,
            },
            sourceloc: expr.sourceloc,
            isTemporary: true,
            type: makePrimitiveAvailable(
              sr,
              EPrimitive.bool,
              EDatatypeMutability.Const,
              expr.sourceloc
            ),
          });
        }

        let resultType = undefined as Semantic.TypeUseId | undefined;
        if (
          expr.operation === EBinaryOperation.BoolAnd ||
          expr.operation === EBinaryOperation.BoolOr
        ) {
          const boolType = makePrimitiveAvailable(
            sr,
            EPrimitive.bool,
            EDatatypeMutability.Const,
            expr.sourceloc
          );
          leftId = Conversion.MakeConversion(
            sr,
            leftId,
            boolType,
            args.blockScope?.constraints || [],
            right.sourceloc,
            Conversion.Mode.Implicit
          );
          rightId = Conversion.MakeConversion(
            sr,
            rightId,
            boolType,
            args.blockScope?.constraints || [],
            right.sourceloc,
            Conversion.Mode.Implicit
          );
          resultType = boolType;
        } else {
          resultType = Conversion.makeBinaryResultType(
            sr,
            leftId,
            rightId,
            expr.operation,
            expr.sourceloc
          );
        }

        if (!resultType) {
          throw new CompilerError(`BINARY UNKNOWN ERROR: FIX THIS`, expr.sourceloc);
        }

        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.BinaryExpr,
          left: leftId,
          operation: expr.operation,
          right: rightId,
          type: resultType,
          isTemporary: true,
          sourceloc: expr.sourceloc,
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================
      case Collect.ENode.UnaryExpr: {
        const [e, eId] = elaborateExpr(sr, expr.expr, {
          context: args.context,
          scope: args.context.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
          blockScope: args.blockScope,
        });
        console.log("TODO: Implement runtime overflow checking for unary negating signed integers");

        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.UnaryExpr,
          expr: eId,
          operation: expr.operation,
          type: Conversion.makeUnaryResultType(sr, e.type, expr.operation, expr.sourceloc),
          isTemporary: true,
          sourceloc: expr.sourceloc,
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.LiteralExpr: {
        if (
          expr.literal.type === EPrimitive.u8 ||
          expr.literal.type === EPrimitive.u16 ||
          expr.literal.type === EPrimitive.u32 ||
          expr.literal.type === EPrimitive.u64 ||
          expr.literal.type === EPrimitive.usize ||
          expr.literal.type === EPrimitive.i8 ||
          expr.literal.type === EPrimitive.i16 ||
          expr.literal.type === EPrimitive.i32 ||
          expr.literal.type === EPrimitive.i64 ||
          expr.literal.type === EPrimitive.int
        ) {
          const [min, max] = Conversion.getIntegerMinMax(expr.literal.type);
          if (expr.literal.value < min || expr.literal.value > max) {
            throw new CompilerError(
              `Value ${expr.literal.value} is out of range for literal type ${primitiveToString(
                expr.literal.type
              )}`,
              expr.sourceloc
            );
          }
        }

        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.LiteralExpr,
          literal: expr.literal,
          sourceloc: expr.sourceloc,
          isTemporary: true,
          type: makePrimitiveAvailable(
            sr,
            expr.literal.type,
            EDatatypeMutability.Const,
            expr.sourceloc
          ),
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ParenthesisExpr: {
        return elaborateExpr(sr, expr.expr, {
          elaboratedVariables: args.elaboratedVariables,
          context: args.context,
          scope: args.context.currentScope,
          gonnaCallFunctionWithParameterValues: args.gonnaCallFunctionWithParameterValues,
          gonnaInstantiateStructWithType: args.gonnaInstantiateStructWithType,
          blockScope: args.blockScope,
          isMonomorphized: args.isMonomorphized,
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ExprCallExpr: {
        const collectedExpr = sr.cc.nodes.get(expr.calledExpr);
        if (collectedExpr.variant === Collect.ENode.SymbolValueExpr) {
          if (collectedExpr.name === "typeof") {
            const callingArguments = expr.arguments.map(
              (a, i) =>
                elaborateExpr(sr, a, {
                  elaboratedVariables: args.elaboratedVariables,
                  context: args.context,
                  blockScope: args.blockScope,
                  scope: args.context.currentScope,
                  isMonomorphized: args.isMonomorphized,
                })[1]
            );
            if (collectedExpr.genericArgs.length !== 0) {
              throw new CompilerError(
                "The typeof function cannot take any type parameters",
                collectedExpr.sourceloc
              );
            }
            if (callingArguments.length !== 1) {
              throw new CompilerError(
                "The typeof function can only take exactly one parameter",
                collectedExpr.sourceloc
              );
            }
            const value = sr.exprNodes.get(callingArguments[0]);
            return Semantic.addExpr(sr, {
              variant: Semantic.ENode.DatatypeAsValueExpr,
              elaboratedType: value.type,
              collectedType: null,
              sourceloc: collectedExpr.sourceloc,
              isTemporary: false,
              type: value.type,
            });
          }
          if (collectedExpr.name === "sizeof") {
            const callingArguments = expr.arguments.map(
              (a, i) =>
                elaborateExpr(sr, a, {
                  elaboratedVariables: args.elaboratedVariables,
                  context: args.context,
                  blockScope: args.blockScope,
                  scope: args.context.currentScope,
                  isMonomorphized: args.isMonomorphized,
                })[1]
            );
            if (collectedExpr.genericArgs.length !== 0) {
              throw new CompilerError(
                "The sizeof function cannot take any type parameters",
                collectedExpr.sourceloc
              );
            }
            if (callingArguments.length !== 1) {
              throw new CompilerError(
                "The sizeof function can only take exactly one parameter",
                collectedExpr.sourceloc
              );
            }
            return Semantic.addExpr(sr, {
              variant: Semantic.ENode.SizeofExpr,
              sourceloc: collectedExpr.sourceloc,
              isTemporary: false,
              type: makePrimitiveAvailable(
                sr,
                EPrimitive.usize,
                EDatatypeMutability.Const,
                expr.sourceloc
              ),
              valueExpr: callingArguments[0],
            });
          }
          if (collectedExpr.name === "assign" || collectedExpr.name === "reassign") {
            const callingArguments = expr.arguments.map(
              (a, i) =>
                elaborateExpr(sr, a, {
                  elaboratedVariables: args.elaboratedVariables,
                  context: args.context,
                  blockScope: args.blockScope,
                  scope: args.context.currentScope,
                  isMonomorphized: args.isMonomorphized,
                })[1]
            );
            if (collectedExpr.genericArgs.length !== 0) {
              throw new CompilerError(
                "The builtin assign/reassign functions cannot take any type parameters",
                collectedExpr.sourceloc
              );
            }
            if (callingArguments.length !== 2) {
              throw new CompilerError(
                "The builtin assign/reassign functions require exactly two parameters",
                collectedExpr.sourceloc
              );
            }
            const ref = sr.exprNodes.get(callingArguments[0]);
            const refType = sr.typeDefNodes.get(sr.typeUseNodes.get(ref.type).type);
            const value = sr.exprNodes.get(callingArguments[1]);
            if (refType.variant !== Semantic.ENode.ReferenceDatatype) {
              throw new CompilerError(
                `The builtin assign/reassign functions require the first parameter to be a reference`,
                expr.sourceloc
              );
            }
            if (collectedExpr.name === "assign") {
              // Assigning the pointee
              return Semantic.addExpr(sr, {
                variant: Semantic.ENode.RefAssignmentExpr,
                sourceloc: collectedExpr.sourceloc,
                isTemporary: false,
                type: makePrimitiveAvailable(
                  sr,
                  EPrimitive.void,
                  EDatatypeMutability.Const,
                  expr.sourceloc
                ),
                operation: "assign",
                target: callingArguments[0],
                value: Conversion.MakeConversion(
                  sr,
                  callingArguments[1],
                  refType.referee,
                  args.blockScope?.constraints || [],
                  expr.sourceloc,
                  Conversion.Mode.Implicit
                ),
              });
            } else {
              // Reassigning the reference
              return Semantic.addExpr(sr, {
                variant: Semantic.ENode.RefAssignmentExpr,
                sourceloc: collectedExpr.sourceloc,
                isTemporary: false,
                type: makePrimitiveAvailable(
                  sr,
                  EPrimitive.void,
                  EDatatypeMutability.Const,
                  expr.sourceloc
                ),
                operation: "reassign",
                target: callingArguments[0],
                value: Conversion.MakeConversion(
                  sr,
                  callingArguments[1],
                  ref.type,
                  args.blockScope?.constraints || [],
                  expr.sourceloc,
                  Conversion.Mode.Implicit
                ),
              });
            }
          }
          if (collectedExpr.name === "static_assert") {
            const callingArguments = expr.arguments.map(
              (a, i) =>
                elaborateExpr(sr, a, {
                  elaboratedVariables: args.elaboratedVariables,
                  context: args.context,
                  scope: args.context.currentScope,
                  blockScope: args.blockScope,
                  isMonomorphized: args.isMonomorphized,
                })[1]
            );
            if (collectedExpr.genericArgs.length !== 0) {
              throw new CompilerError(
                "The static_assert function cannot take any type parameters",
                collectedExpr.sourceloc
              );
            }
            if (callingArguments.length < 1 || callingArguments.length > 2) {
              throw new CompilerError(
                "The static_assert function can only take one or two parameters",
                collectedExpr.sourceloc
              );
            }
            let second = undefined as Semantic.LiteralExpr | undefined;
            if (callingArguments.length > 1) {
              const s = sr.exprNodes.get(callingArguments[1]);
              if (
                s.variant !== Semantic.ENode.LiteralExpr ||
                (s.literal.type !== EPrimitive.str && s.literal.type !== EPrimitive.c_str)
              ) {
                throw new CompilerError(
                  "The static_assert function requires the second parameter to be a string, or omitted",
                  collectedExpr.sourceloc
                );
              } else {
                second = s;
              }
            }
            const value = EvalCTFEBoolean(sr, callingArguments[0]);
            if (value) {
              return Semantic.addExpr(sr, {
                variant: Semantic.ENode.LiteralExpr,
                sourceloc: collectedExpr.sourceloc,
                type: makePrimitiveAvailable(
                  sr,
                  EPrimitive.bool,
                  EDatatypeMutability.Const,
                  expr.sourceloc
                ),
                literal: {
                  type: EPrimitive.bool,
                  value: true,
                },
                isTemporary: true,
              });
            } else {
              throw new CompilerError(
                `static_assert evaluated to false${
                  second ? ": " + serializeLiteralValue(second?.literal) : ""
                }`,
                expr.sourceloc
              );
            }
          }

          const primitive = stringToPrimitive(collectedExpr.name);
          if (primitive) {
            const callingArguments = expr.arguments.map(
              (a, i) =>
                elaborateExpr(sr, a, {
                  elaboratedVariables: args.elaboratedVariables,
                  context: args.context,
                  scope: args.context.currentScope,
                  blockScope: args.blockScope,
                  isMonomorphized: args.isMonomorphized,
                })[1]
            );
            if (collectedExpr.genericArgs.length !== 0) {
              throw new CompilerError(
                "Primitive constructors cannot take any type parameters",
                collectedExpr.sourceloc
              );
            }
            if (primitive === EPrimitive.str) {
              if (callingArguments.length < 1 || callingArguments.length > 2) {
                throw new CompilerError(
                  "'str' constructor must take one or two parameters",
                  collectedExpr.sourceloc
                );
              }
              const first = sr.exprNodes.get(callingArguments[0]);
              const firstType = sr.typeDefNodes.get(sr.typeUseNodes.get(first.type).type);
              const second =
                callingArguments.length > 1 ? sr.exprNodes.get(callingArguments[1]) : null;
              const secondType =
                callingArguments.length > 1 && second
                  ? sr.typeDefNodes.get(sr.typeUseNodes.get(second.type).type)
                  : null;
              if (
                firstType.variant === Semantic.ENode.PrimitiveDatatype &&
                firstType.primitive === EPrimitive.str &&
                callingArguments.length === 1
              ) {
                return [first, callingArguments[0]];
              }
              if (
                callingArguments.length === 2 &&
                second &&
                secondType &&
                firstType.variant === Semantic.ENode.NullableReferenceDatatype &&
                sr.typeUseNodes.get(firstType.referee).type ===
                  makeRawPrimitiveAvailable(sr, EPrimitive.u8) &&
                secondType.variant === Semantic.ENode.PrimitiveDatatype &&
                Conversion.isInteger(secondType.primitive)
              ) {
                return Semantic.addExpr(sr, {
                  variant: Semantic.ENode.StringConstructExpr,
                  type: makePrimitiveAvailable(
                    sr,
                    EPrimitive.str,
                    EDatatypeMutability.Const,
                    expr.sourceloc
                  ),
                  value: {
                    variant: "data-length",
                    data: callingArguments[0],
                    length: callingArguments[1],
                  },
                  isTemporary: true,
                  sourceloc: expr.sourceloc,
                });
              }
              throw new CompilerError(
                `Primitive ${primitiveToString(
                  primitive
                )} constructor does not provide an overload that can take following types: (${callingArguments
                  .map((a) => {
                    return serializeTypeUse(sr, sr.exprNodes.get(a).type);
                  })
                  .join(", ")})`,
                expr.sourceloc
              );
            }
            throw new CompilerError(
              `Primitive ${primitiveToString(primitive)} is not constructible`,
              expr.sourceloc
            );
          }
        }

        let decisiveArguments = [] as {
          index: number;
          exprId: Semantic.ExprId | null;
        }[];
        expr.arguments.forEach((p, i) => {
          if (IsExprDecisiveForOverloadResolution(sr, p)) {
            decisiveArguments.push({
              index: i,
              exprId: elaborateExpr(sr, p, {
                elaboratedVariables: args.elaboratedVariables,
                context: args.context,
                blockScope: args.blockScope,
                scope: args.context.currentScope,
                isMonomorphized: args.isMonomorphized,
              })[1],
            });
          } else {
            decisiveArguments.push({
              index: i,
              exprId: null,
            });
          }
        });

        // Choose all arguments that can contribute to disambiguating an overloaded function call
        const [calledExpr, calledExprId] = elaborateExpr(sr, expr.calledExpr, {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          gonnaCallFunctionWithParameterValues: decisiveArguments,
          blockScope: args.blockScope,
          scope: args.context.currentScope,
          isMonomorphized: args.isMonomorphized,
        });
        const calledExprType = sr.typeDefNodes.get(sr.typeUseNodes.get(calledExpr.type).type);

        const convertArgs = (
          givenArgs: Semantic.ExprId[],
          requiredTypes: Semantic.TypeUseId[],
          vararg: boolean
        ) => {
          const newRequiredTypes = requiredTypes.filter((t) => {
            const tt = sr.typeDefNodes.get(sr.typeUseNodes.get(t).type);
            return tt.variant !== Semantic.ENode.ParameterPackDatatype;
          });
          if (vararg || requiredTypes.length !== newRequiredTypes.length) {
            if (givenArgs.length < newRequiredTypes.length) {
              throw new CompilerError(
                `This call requires at least ${newRequiredTypes.length} arguments but only ${givenArgs.length} were given`,
                calledExpr.sourceloc
              );
            }
          } else {
            if (givenArgs.length !== newRequiredTypes.length) {
              throw new CompilerError(
                `This call requires ${newRequiredTypes.length} arguments but ${givenArgs.length} were given`,
                calledExpr.sourceloc
              );
            }
          }
          return givenArgs.map((a, index) => {
            if (index < newRequiredTypes.length) {
              return Conversion.MakeConversion(
                sr,
                a,
                newRequiredTypes[index],
                args.blockScope?.constraints || [],
                expr.sourceloc,
                Conversion.Mode.Implicit
              );
            } else {
              return a;
            }
          });
        };

        const getActualCallingArguments = (
          expectedParameterTypes: Semantic.TypeUseId[]
        ): Semantic.ExprId[] => {
          return expr.arguments.map((a, i) => {
            const alreadyKnown = decisiveArguments.find((d) => d.index === i);
            if (alreadyKnown && alreadyKnown.exprId) {
              return alreadyKnown.exprId;
            } else {
              let structType = undefined as Semantic.TypeUseId | undefined;
              if (i < expectedParameterTypes.length) {
                structType = expectedParameterTypes[i];
              }
              return elaborateExpr(sr, a, {
                elaboratedVariables: args.elaboratedVariables,
                context: args.context,
                blockScope: args.blockScope,
                scope: args.context.currentScope,
                gonnaInstantiateStructWithType: structType,
                isMonomorphized: args.isMonomorphized,
              })[1];
            }
          });
        };

        if (calledExprType.variant === Semantic.ENode.CallableDatatype) {
          const ftype = sr.typeDefNodes.get(calledExprType.functionType);
          assert(ftype.variant === Semantic.ENode.FunctionDatatype);
          let parametersWithoutThis = ftype.parameters;
          if (calledExprType.thisExprType) {
            parametersWithoutThis = parametersWithoutThis.slice(1);
          }
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.ExprCallExpr,
            calledExpr: calledExprId,
            arguments: convertArgs(
              getActualCallingArguments(parametersWithoutThis),
              parametersWithoutThis,
              ftype.vararg
            ),
            isTemporary: true,
            type: ftype.returnType,
            sourceloc: expr.sourceloc,
          });
        }

        if (calledExprType.variant === Semantic.ENode.FunctionDatatype) {
          const args = convertArgs(
            getActualCallingArguments(calledExprType.parameters),
            calledExprType.parameters,
            calledExprType.vararg
          );
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.ExprCallExpr,
            calledExpr: calledExprId,
            arguments: args,
            type: calledExprType.returnType,
            sourceloc: expr.sourceloc,
            isTemporary: true,
          });
        } else if (calledExprType.variant === Semantic.ENode.StructDatatype) {
          assert(
            sr.cc.nodes.get(calledExprType.originalCollectedSymbol).variant ===
              Collect.ENode.StructDefinitionSymbol
          );
          const constructorId = [...calledExprType.methods].find((methodId) => {
            const method = sr.symbolNodes.get(methodId);
            assert(method.variant === Semantic.ENode.FunctionSymbol);
            return method.name === "constructor";
          });
          if (!constructorId) {
            throw new CompilerError(
              `Struct ${calledExprType.name} is called, but it does not provide a constructor`,
              expr.sourceloc
            );
          }
          const constructor = sr.symbolNodes.get(constructorId);
          assert(constructor.variant === Semantic.ENode.FunctionSymbol);

          const constructorFunctype = sr.typeDefNodes.get(constructor.type);
          assert(constructorFunctype.variant === Semantic.ENode.FunctionDatatype);
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.ExprCallExpr,
            calledExpr: Semantic.addExpr(sr, {
              variant: Semantic.ENode.SymbolValueExpr,
              symbol: constructorId,
              type: makeTypeUse(sr, constructor.type, EDatatypeMutability.Const, expr.sourceloc)[1],
              sourceloc: expr.sourceloc,
              isTemporary: false,
            })[1],
            arguments: convertArgs(
              getActualCallingArguments(constructorFunctype.parameters),
              constructorFunctype.parameters,
              constructorFunctype.vararg
            ),
            type: constructorFunctype.returnType,
            isTemporary: true,
            sourceloc: expr.sourceloc,
          });
        } else if (calledExprType.variant === Semantic.ENode.PrimitiveDatatype) {
          throw new CompilerError(
            `Expression of type ${primitiveToString(calledExprType.primitive)} is not callable`,
            expr.sourceloc
          );
        } else if (
          calledExprType.variant === Semantic.ENode.NullableReferenceDatatype ||
          calledExprType.variant === Semantic.ENode.ReferenceDatatype
        ) {
          throw new CompilerError(`Reference Expression is not callable`, expr.sourceloc);
        }
        assert(false && "All cases handled");
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.SymbolValueExpr: {
        if (expr.name === "null") {
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.LiteralExpr,
            literal: {
              type: EPrimitive.null,
            },
            isTemporary: true,
            sourceloc: expr.sourceloc,
            type: makePrimitiveAvailable(
              sr,
              EPrimitive.null,
              EDatatypeMutability.Const,
              expr.sourceloc
            ),
          });
        }

        const primitive = stringToPrimitive(expr.name);
        if (primitive) {
          if (expr.genericArgs.length > 0) {
            throw new CompilerError(`Type ${expr.name} is not generic`, expr.sourceloc);
          }
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.DatatypeAsValueExpr,
            type: makePrimitiveAvailable(sr, primitive, EDatatypeMutability.Const, expr.sourceloc),
            sourceloc: expr.sourceloc,
            isTemporary: false,
          });
        }

        if (expr.name === "nullptr") {
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.ExplicitCastExpr,
            type: makeNullableReferenceDatatypeAvailable(
              sr,
              makePrimitiveAvailable(
                sr,
                EPrimitive.void,
                EDatatypeMutability.Const,
                expr.sourceloc
              ),
              EDatatypeMutability.Const,
              expr.sourceloc
            ),
            expr: Semantic.addExpr(sr, {
              variant: Semantic.ENode.LiteralExpr,
              literal: {
                type: EPrimitive.int,
                value: 0n,
                unit: null,
              },
              sourceloc: expr.sourceloc,
              type: makePrimitiveAvailable(
                sr,
                EPrimitive.int,
                EDatatypeMutability.Const,
                expr.sourceloc
              ),
              isTemporary: true,
            })[1],
            sourceloc: expr.sourceloc,
            isTemporary: true,
          });
        }

        let foundResult = lookupSymbol(sr, expr.name, {
          startLookupInScope: args.context.currentScope,
          sourceloc: expr.sourceloc,
        });

        if (foundResult.type === "semantic") {
          const found = sr.exprNodes.get(foundResult.id);
          if (found.variant === Semantic.ENode.SymbolValueExpr) {
            const variable = sr.symbolNodes.get(found.symbol);
            if (
              variable.variant === Semantic.ENode.VariableSymbol &&
              variable.comptime &&
              variable.comptimeValue
            ) {
              return [sr.exprNodes.get(variable.comptimeValue), variable.comptimeValue];
            }
          }
          return [sr.exprNodes.get(foundResult.id), foundResult.id];
        }

        let symbolId = foundResult.id;
        let symbol = sr.cc.nodes.get(symbolId);

        if (symbol.variant === Collect.ENode.AliasTypeSymbol) {
          const newId = lookupAndElaborateDatatype(sr, {
            typeId: symbol.target,
            isInCFuncdecl: false,
            elaboratedVariables: args.elaboratedVariables,
            context: isolateSubstitutionContext(args.context, {
              currentScope: symbol.inScope,
              genericsScope: symbol.inScope,
            }),
          });
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.DatatypeAsValueExpr,
            type: newId,
            sourceloc: expr.sourceloc,
            isTemporary: false,
          });
        }

        if (symbol.variant === Collect.ENode.VariableSymbol) {
          if (expr.genericArgs.length !== 0) {
            throw new CompilerError(
              `A variable access cannot have a type parameter list`,
              expr.sourceloc
            );
          }
          let elaboratedSymbolId = undefined as Semantic.SymbolId | undefined;
          if (symbol.variableContext === EVariableContext.Global) {
            // In case it's not elaborated yet, may happen
            elaborateTopLevelSymbol(sr, symbolId, {
              context: args.context,
            });
            elaboratedSymbolId = sr.elaboratedGlobalVariableSymbols.get(symbolId);
          } else {
            elaboratedSymbolId = args.elaboratedVariables.get(symbolId);
          }
          assert(elaboratedSymbolId, "Variable was not elaborated here: " + symbol.name);
          const elaboratedSymbol = sr.symbolNodes.get(elaboratedSymbolId);
          if (elaboratedSymbol.variant === Semantic.ENode.VariableSymbol) {
            // assert(elaboratedSymbol.type);
            if (!elaboratedSymbol.type) {
              throw new CompilerError(
                `Symbol '${elaboratedSymbol.name}' cannot be used before it's declared`,
                expr.sourceloc
              );
            }
            if (elaboratedSymbol.comptime && elaboratedSymbol.comptimeValue) {
              return [
                sr.exprNodes.get(elaboratedSymbol.comptimeValue),
                elaboratedSymbol.comptimeValue,
              ];
            }
            return Semantic.addExpr(sr, {
              variant: Semantic.ENode.SymbolValueExpr,
              symbol: elaboratedSymbolId,
              type: elaboratedSymbol.type,
              sourceloc: expr.sourceloc,
              isTemporary: false,
            });
          } else if (
            elaboratedSymbol.variant === Semantic.ENode.TypeDefSymbol &&
            sr.typeDefNodes.get(elaboratedSymbol.datatype).variant ===
              Semantic.ENode.ParameterPackDatatype
          ) {
            return Semantic.addExpr(sr, {
              variant: Semantic.ENode.SymbolValueExpr,
              symbol: elaboratedSymbolId,
              type: makeTypeUse(
                sr,
                elaboratedSymbol.datatype,
                EDatatypeMutability.Const,
                expr.sourceloc
              )[1],
              sourceloc: expr.sourceloc,
              isTemporary: false,
            });
          } else {
            assert(false);
          }
        } else if (symbol.variant === Collect.ENode.GlobalVariableDefinition) {
          const [elaboratedSymbolId] = elaborateTopLevelSymbol(sr, symbolId, {
            context: args.context,
          });
          assert(elaboratedSymbolId);
          const elaboratedSymbol = sr.symbolNodes.get(elaboratedSymbolId);
          assert(elaboratedSymbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol);
          const variableSymbol = sr.symbolNodes.get(elaboratedSymbol.variableSymbol);
          assert(variableSymbol.variant === Semantic.ENode.VariableSymbol && variableSymbol.type);
          if (expr.genericArgs.length !== 0) {
            throw new CompilerError(
              `A variable access cannot have a type parameter list`,
              expr.sourceloc
            );
          }
          if (variableSymbol.comptime && variableSymbol.comptimeValue) {
            return [sr.exprNodes.get(variableSymbol.comptimeValue), variableSymbol.comptimeValue];
          }
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.SymbolValueExpr,
            symbol: elaboratedSymbolId,
            type: variableSymbol.type,
            sourceloc: expr.sourceloc,
            isTemporary: false,
          });
        } else if (symbol.variant === Collect.ENode.FunctionOverloadGroup) {
          const chosenOverloadId = ChooseFunctionOverload(
            sr,
            symbolId,
            args.gonnaCallFunctionWithParameterValues,
            {
              context: args.context,
              elaboratedVariables: args.elaboratedVariables,
              usageSourceLocation: expr.sourceloc,
            }
          );

          const chosenOverload = sr.cc.nodes.get(chosenOverloadId);
          assert(chosenOverload.variant === Collect.ENode.FunctionSymbol);

          if (chosenOverload.methodType === EMethodType.Method) {
            throw new CompilerError(
              `Function '${chosenOverload.name}' was accessed directly by name, but it is a method, which must be accessed through 'this.${chosenOverload.name}'`,
              expr.sourceloc
            );
          }

          const parameterPackTypes = prepareParameterPackTypes(sr, {
            functionName: symbol.name,
            requiredParameters: chosenOverload.parameters,
            givenArguments: args.gonnaCallFunctionWithParameterValues,
            sourceloc: expr.sourceloc,
          });

          const elaboratedSymbolId = elaborateFunctionSymbolWithGenerics(
            sr,
            elaborateFunctionSignature(sr, chosenOverloadId, { context: args.context }),
            {
              elaboratedVariables: args.elaboratedVariables,
              paramPackTypes: parameterPackTypes,
              genericArgs: expr.genericArgs.map((g) => {
                return lookupAndElaborateDatatype(sr, {
                  typeId: g,
                  context: args.context,
                  elaboratedVariables: args.elaboratedVariables,
                  isInCFuncdecl: false,
                });
              }),
              usageSourceLocation: expr.sourceloc,
              context: args.context,
              parentStructOrNS: elaborateParentSymbolFromCache(sr, {
                context: args.context,
                parentScope: symbol.parentScope,
              }),
              isMonomorphized: args.isMonomorphized,
            }
          );
          assert(elaboratedSymbolId);
          const elaboratedSymbol = sr.symbolNodes.get(elaboratedSymbolId);
          assert(elaboratedSymbol.variant === Semantic.ENode.FunctionSymbol);
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.SymbolValueExpr,
            symbol: elaboratedSymbolId,
            type: makeTypeUse(
              sr,
              elaboratedSymbol.type,
              EDatatypeMutability.Const,
              expr.sourceloc
            )[1],
            sourceloc: expr.sourceloc,
            isTemporary: false,
          });
        } else if (symbol.variant === Collect.ENode.NamespaceDefinitionSymbol) {
          // This is for static function calls like Arena.create(); -> "Arena" is now a NamespaceValue
          const [elaboratedSymbolId] = elaborateTopLevelSymbol(sr, symbolId, {
            context: args.context,
          });
          assert(elaboratedSymbolId);
          const elaboratedSymbol = sr.symbolNodes.get(elaboratedSymbolId);
          assert(elaboratedSymbol.variant === Semantic.ENode.TypeDefSymbol);
          const type = sr.typeDefNodes.get(elaboratedSymbol.datatype);
          assert(
            type.variant === Semantic.ENode.NamespaceDatatype ||
              type.variant === Semantic.ENode.StructDatatype
          );
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.DatatypeAsValueExpr,
            type: makeTypeUse(
              sr,
              elaboratedSymbol.datatype,
              EDatatypeMutability.Const,
              expr.sourceloc
            )[1],
            sourceloc: expr.sourceloc,
            isTemporary: false,
          });
        } else if (symbol.variant === Collect.ENode.StructDefinitionSymbol) {
          // This is for static function calls like Arena.create(); -> "Arena" is now a NamespaceValue
          const genericArgs = expr.genericArgs.map((a) =>
            lookupAndElaborateDatatype(sr, {
              typeId: a,
              context: isolateSubstitutionContext(args.context, {
                currentScope: args.context.currentScope,
                genericsScope: args.context.currentScope,
              }),
              elaboratedVariables: args.elaboratedVariables,
              isInCFuncdecl: false,
            })
          );
          const elaboratedSymbolId = instantiateAndElaborateStructWithGenerics(sr, {
            definedStructTypeId: symbolId,
            context: args.context,
            genericArgs: genericArgs,
            elaboratedVariables: args.elaboratedVariables,
            sourceloc: expr.sourceloc,
          });
          assert(elaboratedSymbolId);
          const elaboratedSymbol = sr.typeDefNodes.get(elaboratedSymbolId);
          assert(
            elaboratedSymbol.variant === Semantic.ENode.NamespaceDatatype ||
              elaboratedSymbol.variant === Semantic.ENode.StructDatatype
          );
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.DatatypeAsValueExpr,
            type: makeTypeUse(sr, elaboratedSymbolId, EDatatypeMutability.Const, expr.sourceloc)[1],
            sourceloc: expr.sourceloc,
            isTemporary: false,
          });
        } else if (symbol.variant === Collect.ENode.GenericTypeParameter) {
          const mappedTo = args.context.substitute.get(symbolId);
          if (mappedTo) {
            return Semantic.addExpr(sr, {
              variant: Semantic.ENode.DatatypeAsValueExpr,
              isTemporary: false,
              type: mappedTo,
              sourceloc: expr.sourceloc,
            });
          } else {
            const [generic, genericId] = Semantic.addType(sr, {
              variant: Semantic.ENode.GenericParameterDatatype,
              name: symbol.name,
              collectedParameter: symbolId,
              concrete: false,
            });
            return Semantic.addExpr(sr, {
              variant: Semantic.ENode.DatatypeAsValueExpr,
              isTemporary: false,
              type: makeTypeUse(sr, genericId, EDatatypeMutability.Const, expr.sourceloc)[1],
              sourceloc: expr.sourceloc,
            });
          }
        } else {
          throw new CompilerError(
            `Symbol cannot be used as a value: Code ${symbol.variant}`,
            expr.sourceloc
          );
        }
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.AddressOfExpr: {
        const [_expr, exprId] = elaborateExpr(sr, expr.expr, {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          scope: args.context.currentScope,
          isMonomorphized: args.isMonomorphized,
          blockScope: args.blockScope,
        });
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.AddressOfExpr,
          type: makeNullableReferenceDatatypeAvailable(
            sr,
            _expr.type,
            EDatatypeMutability.Const,
            expr.sourceloc
          ),
          expr: exprId,
          sourceloc: expr.sourceloc,
          isTemporary: true,
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.DereferenceExpr: {
        const [_expr, _exprId] = elaborateExpr(sr, expr.expr, {
          elaboratedVariables: args.elaboratedVariables,
          context: args.context,
          blockScope: args.blockScope,
          scope: args.context.currentScope,
          isMonomorphized: args.isMonomorphized,
        });
        const exprType = sr.typeDefNodes.get(sr.typeUseNodes.get(_expr.type).type);
        if (
          exprType.variant !== Semantic.ENode.NullableReferenceDatatype &&
          exprType.variant !== Semantic.ENode.ReferenceDatatype
        ) {
          throw new CompilerError(
            `This expression is not a reference and cannot be dereferenced`,
            expr.sourceloc
          );
        }
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.DereferenceExpr,
          type: exprType.referee,
          expr: _exprId,
          sourceloc: expr.sourceloc,
          isTemporary: true,
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ExplicitCastExpr: {
        const [castedExpr, castedExprId] = elaborateExpr(sr, expr.expr, {
          context: args.context,
          scope: args.context.currentScope,
          blockScope: args.blockScope,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
        });
        const targetType = lookupAndElaborateDatatype(sr, {
          typeId: expr.targetType,
          elaboratedVariables: args.elaboratedVariables,
          isInCFuncdecl: false,
          context: args.context,
        });
        const result = Conversion.MakeConversion(
          sr,
          castedExprId,
          targetType,
          args.blockScope?.constraints || [],
          expr.sourceloc,
          Conversion.Mode.Explicit
        );
        return [sr.exprNodes.get(result), result];
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.PostIncrExpr: {
        const [e, eId] = elaborateExpr(sr, expr.expr, {
          elaboratedVariables: args.elaboratedVariables,
          scope: args.context.currentScope,
          context: args.context,
          blockScope: args.blockScope,
          isMonomorphized: args.isMonomorphized,
        });
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.PostIncrExpr,
          type: e.type,
          expr: eId,
          operation: expr.operation,
          sourceloc: expr.sourceloc,
          isTemporary: true,
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.PreIncrExpr: {
        const [e, eId] = elaborateExpr(sr, expr.expr, {
          context: args.context,
          blockScope: args.blockScope,
          elaboratedVariables: args.elaboratedVariables,
          scope: args.context.currentScope,
          isMonomorphized: args.isMonomorphized,
        });
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.PreIncrExpr,
          type: e.type,
          expr: eId,
          operation: expr.operation,
          sourceloc: expr.sourceloc,
          isTemporary: true,
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.MemberAccessExpr: {
        const [object, objectId] = elaborateExpr(sr, expr.expr, {
          scope: args.context.currentScope,
          context: args.context,
          blockScope: args.blockScope,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
        });
        let objectType = sr.typeDefNodes.get(sr.typeUseNodes.get(object.type).type);

        if (objectType.variant === Semantic.ENode.ReferenceDatatype) {
          objectType = sr.typeDefNodes.get(sr.typeUseNodes.get(objectType.referee).type);
        }

        if (object.variant === Semantic.ENode.DatatypeAsValueExpr) {
          const datatypeValueInstance = sr.typeUseNodes.get(object.type);
          const datatypeValue = sr.typeDefNodes.get(datatypeValueInstance.type);
          if (datatypeValue.variant === Semantic.ENode.NamespaceDatatype) {
            return lookupAndElaborateNamespaceMemberAccess(sr, objectId, {
              expr: expr,
              context: args.context,
              elaboratedVariables: args.elaboratedVariables,
              isMonomorphized: args.isMonomorphized,
              name: expr.memberName,
              gonnaCallFunctionWithParameterValues: args.gonnaCallFunctionWithParameterValues,
            });
          } else if (datatypeValue.variant === Semantic.ENode.StructDatatype) {
            return lookupAndElaborateStaticStructAccess(sr, objectId, {
              expr: expr,
              context: args.context,
              elaboratedVariables: args.elaboratedVariables,
              isMonomorphized: args.isMonomorphized,
              name: expr.memberName,
              gonnaCallFunctionWithParameterValues: args.gonnaCallFunctionWithParameterValues,
            });
          } else if (datatypeValue.variant === Semantic.ENode.PrimitiveDatatype) {
            if (
              datatypeValue.primitive === EPrimitive.u8 ||
              datatypeValue.primitive === EPrimitive.u16 ||
              datatypeValue.primitive === EPrimitive.u32 ||
              datatypeValue.primitive === EPrimitive.u64 ||
              datatypeValue.primitive === EPrimitive.usize ||
              datatypeValue.primitive === EPrimitive.i8 ||
              datatypeValue.primitive === EPrimitive.i16 ||
              datatypeValue.primitive === EPrimitive.i32 ||
              datatypeValue.primitive === EPrimitive.i64 ||
              datatypeValue.primitive === EPrimitive.int
            ) {
              if (expr.memberName === "min") {
                return Semantic.addExpr(sr, {
                  variant: Semantic.ENode.LiteralExpr,
                  literal: {
                    type: datatypeValue.primitive,
                    unit: null,
                    value: Conversion.getIntegerMinMax(datatypeValue.primitive)[0],
                  },
                  type: object.type,
                  sourceloc: expr.sourceloc,
                  isTemporary: true,
                });
              }
              if (expr.memberName === "max") {
                return Semantic.addExpr(sr, {
                  variant: Semantic.ENode.LiteralExpr,
                  literal: {
                    type: datatypeValue.primitive,
                    unit: null,
                    value: Conversion.getIntegerMinMax(datatypeValue.primitive)[1],
                  },
                  type: object.type,
                  sourceloc: expr.sourceloc,
                  isTemporary: true,
                });
              }
            }

            throw new CompilerError(
              `Datatype ${serializeTypeUse(sr, object.type)} does not have a member named '${
                expr.memberName
              }'`,
              expr.sourceloc
            );
          } else {
            assert(false, datatypeValue.variant.toString());
          }
        }

        if (objectType.variant === Semantic.ENode.ParameterPackDatatype) {
          if (expr.memberName === "length") {
            if (objectType.parameters === null) {
              throw new CompilerError(
                `Parameter Pack is not substituted yet and does not have enough context to know its length`,
                expr.sourceloc
              );
            }
            return Semantic.addExpr(sr, {
              variant: Semantic.ENode.LiteralExpr,
              isTemporary: true,
              literal: {
                type: EPrimitive.usize,
                unit: null,
                value: BigInt(objectType.parameters.length),
              },
              sourceloc: expr.sourceloc,
              type: makePrimitiveAvailable(
                sr,
                EPrimitive.usize,
                EDatatypeMutability.Const,
                expr.sourceloc
              ),
            });
          }
          throw new CompilerError(
            `Parameter Pack does not have a member named '${expr.memberName}'`,
            expr.sourceloc
          );
        }

        if (
          objectType.variant === Semantic.ENode.PrimitiveDatatype &&
          objectType.primitive === EPrimitive.str
        ) {
          if (expr.memberName === "length") {
            return Semantic.addExpr(sr, {
              variant: Semantic.ENode.MemberAccessExpr,
              isTemporary: true,
              sourceloc: expr.sourceloc,
              type: makePrimitiveAvailable(
                sr,
                EPrimitive.usize,
                EDatatypeMutability.Const,
                expr.sourceloc
              ),
              expr: objectId,
              memberName: "length",
            });
          }
          if (expr.memberName === "data") {
            return Semantic.addExpr(sr, {
              variant: Semantic.ENode.MemberAccessExpr,
              isTemporary: true,
              sourceloc: expr.sourceloc,
              type: makeNullableReferenceDatatypeAvailable(
                sr,
                makePrimitiveAvailable(
                  sr,
                  EPrimitive.u8,
                  EDatatypeMutability.Const,
                  expr.sourceloc
                ),
                EDatatypeMutability.Const,
                expr.sourceloc
              ),
              expr: objectId,
              memberName: "data",
            });
          }
          throw new CompilerError(
            `Datatype '${serializeTypeUse(sr, object.type)}' does not have a member named '${
              expr.memberName
            }'`,
            expr.sourceloc
          );
        }

        if (objectType.variant === Semantic.ENode.SliceDatatype) {
          if (expr.memberName === "length") {
            return Semantic.addExpr(sr, {
              variant: Semantic.ENode.MemberAccessExpr,
              isTemporary: true,
              sourceloc: expr.sourceloc,
              type: makePrimitiveAvailable(
                sr,
                EPrimitive.usize,
                EDatatypeMutability.Const,
                expr.sourceloc
              ),
              expr: objectId,
              memberName: "length",
            });
          }
          throw new CompilerError(
            `Datatype '${serializeTypeUse(sr, object.type)}' does not have a member named '${
              expr.memberName
            }'`,
            expr.sourceloc
          );
        }

        if (objectType.variant !== Semantic.ENode.StructDatatype) {
          throw new CompilerError(
            "Cannot access member of non-structural type " + serializeTypeUse(sr, object.type),
            expr.sourceloc
          );
        }

        const memberId = objectType.members.find((mId) => {
          const m = sr.symbolNodes.get(mId);
          assert(m.variant === Semantic.ENode.VariableSymbol);
          return m.name === expr.memberName;
        });

        if (memberId) {
          if (expr.genericArgs.length > 0) {
            throw new CompilerError(
              `Member '${expr.memberName}' does not expect any type arguments, but ${expr.genericArgs.length} are given`,
              expr.sourceloc
            );
          }
          const member = sr.symbolNodes.get(memberId);
          assert(member.variant === Semantic.ENode.VariableSymbol && member.type);
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.MemberAccessExpr,
            expr: objectId,
            memberName: expr.memberName,
            type: member.type,
            sourceloc: expr.sourceloc,
            isTemporary: false,
          });
          // console.log(Semantic.serializeTypeUse(sr, memberAccess.type));
          // // Promote the datatype because by default, every struct member is fully mutable.
          // console.log(
          //   "TODO: This mutability promotion is only allowed if the struct itself (this) is mutable"
          // );
          // return Semantic.addExpr(sr, {
          //   variant: Semantic.ENode.ExplicitCastExpr,
          //   expr: memberAccessId,
          //   isTemporary: true,
          //   sourceloc: expr.sourceloc,
          //   type: makeTypeUse(
          //     sr,
          //     sr.typeUseNodes.get(memberAccess.type).type,
          //     EDatatypeMutability.Mut,
          //     expr.sourceloc
          //   )[1],
          // });
        }

        const collectedStruct = sr.cc.nodes.get(objectType.originalCollectedSymbol);
        assert(collectedStruct.variant === Collect.ENode.StructDefinitionSymbol);
        const structScope = sr.cc.nodes.get(collectedStruct.structScope);
        assert(structScope.variant === Collect.ENode.StructScope);
        const overloadGroupId = [...structScope.symbols].find((mId) => {
          const m = sr.cc.nodes.get(mId);
          return m.variant === Collect.ENode.FunctionOverloadGroup && m.name === expr.memberName;
        });

        if (overloadGroupId) {
          const overloadGroup = sr.cc.nodes.get(overloadGroupId);
          assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroup);

          const chosenOverloadId = ChooseFunctionOverload(
            sr,
            overloadGroupId,
            args.gonnaCallFunctionWithParameterValues,
            {
              context: args.context,
              elaboratedVariables: args.elaboratedVariables,
              usageSourceLocation: expr.sourceloc,
            }
          );

          const collectedMethod = sr.cc.nodes.get(chosenOverloadId);
          assert(collectedMethod.variant === Collect.ENode.FunctionSymbol);

          let wasReference = false;
          let objectTypeId = object.type;
          const objectType = sr.typeDefNodes.get(sr.typeUseNodes.get(objectTypeId).type);
          if (objectType.variant === Semantic.ENode.ReferenceDatatype) {
            objectTypeId = objectType.referee;
            wasReference = true;
          }

          const elaboratedStructCache = sr.elaboratedStructDatatypes.find(
            (d) => d.result === sr.typeUseNodes.get(objectTypeId).type
          );
          assert(elaboratedStructCache);

          const parameterPackTypes = prepareParameterPackTypes(sr, {
            functionName: overloadGroup.name,
            requiredParameters: collectedMethod.parameters,
            givenArguments: args.gonnaCallFunctionWithParameterValues,
            sourceloc: expr.sourceloc,
          });

          const elaboratedMethodId = elaborateFunctionSymbolWithGenerics(
            sr,
            elaborateFunctionSignature(sr, chosenOverloadId, { context: args.context }),
            {
              context: mergeSubstitutionContext(
                elaboratedStructCache.substitutionContext,
                args.context,
                {
                  currentScope: args.context.currentScope,
                  genericsScope: args.context.currentScope,
                }
              ),
              paramPackTypes: parameterPackTypes,
              genericArgs: expr.genericArgs.map((g) => {
                return lookupAndElaborateDatatype(sr, {
                  typeId: g,
                  context: isolateSubstitutionContext(elaboratedStructCache.substitutionContext, {
                    currentScope: args.context.currentScope,
                    genericsScope: args.context.currentScope,
                  }),
                  elaboratedVariables: args.elaboratedVariables,
                  isInCFuncdecl: false,
                });
              }),
              usageSourceLocation: expr.sourceloc,
              elaboratedVariables: args.elaboratedVariables,
              parentStructOrNS: sr.typeUseNodes.get(objectTypeId).type,
              isMonomorphized: args.isMonomorphized,
            }
          );
          assert(elaboratedMethodId);
          const elaboratedMethod = sr.symbolNodes.get(elaboratedMethodId);
          assert(elaboratedMethod.variant === Semantic.ENode.FunctionSymbol);

          if (elaboratedMethod.staticMethod) {
            throw new CompilerError(
              `Method ${serializeFullSymbolName(
                sr,
                elaboratedMethodId
              )} is static but is called through an object`,
              expr.sourceloc
            );
          }

          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.CallableExpr,
            thisExpr: objectId,
            functionSymbol: elaboratedMethodId,
            type: makeTypeUse(
              sr,
              Semantic.addType(sr, {
                variant: Semantic.ENode.CallableDatatype,
                thisExprType: wasReference
                  ? object.type
                  : makeReferenceDatatypeAvailable(
                      sr,
                      object.type,
                      EDatatypeMutability.Const,
                      expr.sourceloc
                    ),
                functionType: elaboratedMethod.type,
                concrete: sr.typeDefNodes.get(elaboratedMethod.type).concrete,
              })[1],
              EDatatypeMutability.Const,
              expr.sourceloc
            )[1],
            sourceloc: expr.sourceloc,
            isTemporary: true,
          });
        }

        throw new CompilerError(
          `No attribute named '${expr.memberName}' in struct ${objectType.name}`,
          expr.sourceloc
        );
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ExprAssignmentExpr: {
        const [value, valueId] = elaborateExpr(sr, expr.value, {
          context: args.context,
          blockScope: args.blockScope,
          elaboratedVariables: args.elaboratedVariables,
          scope: args.context.currentScope,
          isMonomorphized: args.isMonomorphized,
        });
        const [target, targetId] = elaborateExpr(sr, expr.expr, {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          scope: args.context.currentScope,
          blockScope: args.blockScope,
          isMonomorphized: args.isMonomorphized,
        });

        const targetType = sr.typeDefNodes.get(sr.typeUseNodes.get(target.type).type);
        if (targetType.variant === Semantic.ENode.ReferenceDatatype) {
          throw new CompilerError(
            `Assigning values to references is not allowed, use builtin functions instead. To assign a new value to the place the reference points to, use 'assign(ref, ...)', to instead reassign the reference to point to a new location, use 'reassign(ref, ...)' intead.`,
            expr.sourceloc
          );
        }

        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.ExprAssignmentExpr,
          value: Conversion.MakeConversion(
            sr,
            valueId,
            target.type,
            args.blockScope?.constraints || [],
            expr.sourceloc,
            Conversion.Mode.Implicit
          ),
          target: targetId,
          type: target.type,
          operation: expr.operation,
          sourceloc: expr.sourceloc,
          isTemporary: true,
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ArrayLiteralExpr: {
        const values = expr.values.map((v) =>
          elaborateExpr(sr, v, {
            blockScope: args.blockScope,
            context: args.context,
            scope: args.context.currentScope,
            elaboratedVariables: args.elaboratedVariables,
            isMonomorphized: args.isMonomorphized,
          })
        );
        let type = null as Semantic.TypeUseId | null;
        for (let i = 0; i < values.length; i++) {
          const [value, valueId] = values[i];
          if (type === null) {
            type = value.type;
          }
          if (type !== value.type) {
            throw new CompilerError(
              `Array type mismatch: Value #${i + 1} has type ${serializeTypeUse(
                sr,
                value.type
              )}, but ${serializeTypeUse(
                sr,
                type
              )} was expected. Cannot deduce array type from multiple different value types.`,
              expr.sourceloc
            );
          }
        }
        if (values.length === 0) {
          throw new CompilerError(`Array literal must contain at least one value`, expr.sourceloc);
        }
        assert(type);
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.ArrayLiteralExpr,
          values: values.map((v) => v[1]),
          type: makeArrayDatatypeAvailable(
            sr,
            type,
            values.length,
            EDatatypeMutability.Const,
            expr.sourceloc
          ),
          sourceloc: expr.sourceloc,
          isTemporary: true,
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ArraySubscriptExpr: {
        if (expr.indices.length > 1) {
          throw new CompilerError(
            `Multidimensional array subscripting is not implemented yet`,
            expr.sourceloc
          );
        }
        const [value, valueId] = elaborateExpr(sr, expr.expr, {
          context: args.context,
          scope: args.context.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
          blockScope: args.blockScope,
        });

        const [index, indexId] = elaborateExpr(sr, expr.indices[0], {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          blockScope: args.blockScope,
          scope: args.context.currentScope,
          isMonomorphized: args.isMonomorphized,
        });
        const indexType = sr.typeDefNodes.get(sr.typeUseNodes.get(index.type).type);
        if (
          indexType.variant !== Semantic.ENode.PrimitiveDatatype ||
          !Conversion.isInteger(indexType.primitive)
        ) {
          throw new CompilerError(`Only integers can be used to index arrays`, expr.sourceloc);
        }

        const valueType = sr.typeDefNodes.get(sr.typeUseNodes.get(value.type).type);
        if (
          valueType.variant !== Semantic.ENode.ArrayDatatype &&
          valueType.variant !== Semantic.ENode.SliceDatatype
        ) {
          throw new CompilerError(
            `Expression of type ${serializeTypeUse(sr, value.type)} cannot be subscripted`,
            expr.sourceloc
          );
        }

        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.ArraySubscriptExpr,
          expr: valueId,
          indices: [indexId],
          type: valueType.datatype,
          sourceloc: expr.sourceloc,
          isTemporary: true,
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ArraySliceExpr: {
        if (expr.indices.length > 1) {
          throw new CompilerError(
            `Multidimensional array subscripting is not implemented yet`,
            expr.sourceloc
          );
        }
        const [value, valueId] = elaborateExpr(sr, expr.expr, {
          context: args.context,
          scope: args.context.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
          blockScope: args.blockScope,
        });

        const indices: {
          start: Semantic.ExprId | null;
          end: Semantic.ExprId | null;
        }[] = [
          {
            end: null,
            start: null,
          },
        ];

        if (expr.indices[0].start) {
          const [startIndex, startIndexId] = elaborateExpr(sr, expr.indices[0].start, {
            context: args.context,
            elaboratedVariables: args.elaboratedVariables,
            blockScope: args.blockScope,
            scope: args.context.currentScope,
            isMonomorphized: args.isMonomorphized,
          });
          indices[0].start = startIndexId;
          const startIndexType = sr.typeDefNodes.get(sr.typeUseNodes.get(startIndex.type).type);
          if (
            startIndexType.variant !== Semantic.ENode.PrimitiveDatatype ||
            !Conversion.isInteger(startIndexType.primitive)
          ) {
            throw new CompilerError(`Only integers can be used to index arrays`, expr.sourceloc);
          }
        }
        if (expr.indices[0].end) {
          const [endIndex, endIndexId] = elaborateExpr(sr, expr.indices[0].end, {
            context: args.context,
            elaboratedVariables: args.elaboratedVariables,
            blockScope: args.blockScope,
            scope: args.context.currentScope,
            isMonomorphized: args.isMonomorphized,
          });
          indices[0].end = endIndexId;
          const endIndexType = sr.typeDefNodes.get(sr.typeUseNodes.get(endIndex.type).type);
          if (
            endIndexType.variant !== Semantic.ENode.PrimitiveDatatype ||
            !Conversion.isInteger(endIndexType.primitive)
          ) {
            throw new CompilerError(`Only integers can be used to index arrays`, expr.sourceloc);
          }
        }

        const valueType = sr.typeDefNodes.get(sr.typeUseNodes.get(value.type).type);
        if (
          valueType.variant !== Semantic.ENode.ArrayDatatype &&
          valueType.variant !== Semantic.ENode.SliceDatatype
        ) {
          throw new CompilerError(
            `Expression of type ${serializeTypeUse(sr, value.type)} cannot be subscripted`,
            expr.sourceloc
          );
        }

        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.ArraySliceExpr,
          expr: valueId,
          indices: indices,
          type: makeSliceDatatypeAvailable(
            sr,
            valueType.datatype,
            EDatatypeMutability.Const,
            expr.sourceloc
          ),
          sourceloc: expr.sourceloc,
          isTemporary: true,
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.StructInstantiationExpr: {
        let structId = undefined as Semantic.TypeUseId | undefined;
        if (expr.structType) {
          structId = lookupAndElaborateDatatype(sr, {
            typeId: expr.structType,
            elaboratedVariables: args.elaboratedVariables,
            isInCFuncdecl: false,
            context: isolateSubstitutionContext(args.context, {
              currentScope: args.context.currentScope,
              genericsScope: args.context.currentScope,
            }),
          });
        } else if (args.gonnaInstantiateStructWithType) {
          structId = args.gonnaInstantiateStructWithType;
        }

        if (!structId) {
          throw new CompilerError(
            `This struct is anonymous and must be type-inferred, but there is not enough context to infer it. Either it is not directly passed to something that expects a specific type, or it is being passed to an overloaded function.`,
            expr.sourceloc
          );
        }

        const struct = sr.typeDefNodes.get(sr.typeUseNodes.get(structId).type);
        if (struct.variant !== Semantic.ENode.StructDatatype) {
          throw new CompilerError(
            `Non-structural type '${serializeTypeUse(
              sr,
              structId
            )}' cannot be instantiated as a struct`,
            expr.sourceloc
          );
        }

        return makeStructInstantiation(sr, sr.typeUseNodes.get(structId).type, {
          blockScope: args.blockScope,
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
          sourceloc: expr.sourceloc,
          memberValues: expr.members,
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.TypeLiteralExpr: {
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.DatatypeAsValueExpr,
          isTemporary: false,
          type: lookupAndElaborateDatatype(sr, {
            typeId: expr.datatype,
            context: args.context,
            elaboratedVariables: args.elaboratedVariables,
            isInCFuncdecl: false,
          }),
          sourceloc: expr.sourceloc,
        });
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      default:
        throw new InternalError("Unhandled variant: " + expr.variant);
    }
  }

  function applyBinaryExprConstraints(
    sr: SemanticResult,
    constraints: Semantic.Constraint[],
    symbolValueExpr: Semantic.SymbolValueExpr,
    literalExpr: Semantic.LiteralExpr,
    operation: EBinaryOperation
  ) {
    const symbol = sr.symbolNodes.get(symbolValueExpr.symbol);
    if (symbol.variant !== Semantic.ENode.VariableSymbol || !symbol.type) {
      return;
    }

    const symbolType = sr.typeDefNodes.get(sr.typeUseNodes.get(symbol.type).type);
    if (
      symbolType.variant !== Semantic.ENode.PrimitiveDatatype ||
      !Conversion.isIntegerById(sr, sr.typeUseNodes.get(symbol.type).type)
    ) {
      return;
    }

    if (
      !Conversion.isIntegerById(sr, sr.typeUseNodes.get(literalExpr.type).type) ||
      (literalExpr.literal.type !== EPrimitive.i8 &&
        literalExpr.literal.type !== EPrimitive.i16 &&
        literalExpr.literal.type !== EPrimitive.i32 &&
        literalExpr.literal.type !== EPrimitive.i64 &&
        literalExpr.literal.type !== EPrimitive.int &&
        literalExpr.literal.type !== EPrimitive.usize &&
        literalExpr.literal.type !== EPrimitive.u8 &&
        literalExpr.literal.type !== EPrimitive.u16 &&
        literalExpr.literal.type !== EPrimitive.u32 &&
        literalExpr.literal.type !== EPrimitive.u64)
    ) {
      return;
    }

    switch (operation) {
      case EBinaryOperation.Equal:
      case EBinaryOperation.Unequal:
      case EBinaryOperation.GreaterEqual:
      case EBinaryOperation.GreaterThan:
      case EBinaryOperation.LessEqual:
      case EBinaryOperation.LessThan:
        constraints.push({
          constraintValue: {
            kind: "comparison",
            operation: operation,
            value: literalExpr.literal.value,
          },
          variableSymbol: symbolValueExpr.symbol,
        });
    }
  }

  function buildConstraints(
    sr: SemanticResult,
    constraints: Semantic.Constraint[],
    exprId: Semantic.ExprId
  ) {
    const expr = sr.exprNodes.get(exprId);

    if (expr.variant === Semantic.ENode.BinaryExpr) {
      if (expr.operation === EBinaryOperation.BoolAnd) {
        buildConstraints(sr, constraints, expr.left);
        buildConstraints(sr, constraints, expr.right);
      } else {
        const leftExpr = sr.exprNodes.get(expr.left);
        const rightExpr = sr.exprNodes.get(expr.right);
        if (
          leftExpr.variant === Semantic.ENode.SymbolValueExpr &&
          rightExpr.variant === Semantic.ENode.LiteralExpr
        ) {
          applyBinaryExprConstraints(sr, constraints, leftExpr, rightExpr, expr.operation);
        } else if (
          rightExpr.variant === Semantic.ENode.SymbolValueExpr &&
          leftExpr.variant === Semantic.ENode.LiteralExpr
        ) {
          applyBinaryExprConstraints(sr, constraints, rightExpr, leftExpr, expr.operation);
        }
      }
    }
  }

  export function elaborateStatement(
    sr: SemanticResult,
    statementId: Collect.Id,
    args: {
      expectedReturnType: Semantic.TypeUseId;
      context: ElaborationContext;
      elaboratedVariables: Map<Collect.Id, Semantic.SymbolId>;
      isMonomorphized: boolean;
      blockScope: Semantic.BlockScope;
      parentConstraints: Semantic.Constraint[];
    }
  ): Semantic.StatementId {
    const s = sr.cc.nodes.get(statementId);

    switch (s.variant) {
      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.InlineCStatement:
        return Semantic.addStatement(sr, {
          variant: Semantic.ENode.InlineCStatement,
          value: s.value,
          sourceloc: s.sourceloc,
        })[1];

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.BlockScopeStatement: {
        const [scope, scopeId] = Semantic.addBlockScope(sr, {
          variant: Semantic.ENode.BlockScope,
          statements: [],
          constraints: [...args.parentConstraints],
        });
        elaborateBlockScope(sr, {
          targetScopeId: scopeId,
          sourceScopeId: s.blockscope,
          expectedReturnType: args.expectedReturnType,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
          context: isolateSubstitutionContext(args.context, {
            currentScope: s.owningScope,
            genericsScope: s.owningScope,
          }),
        });
        return Semantic.addStatement(sr, {
          variant: Semantic.ENode.BlockScopeStatement,
          block: scopeId,
          sourceloc: s.sourceloc,
        })[1];
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.IfStatement: {
        const [condition, conditionId] = elaborateExpr(sr, s.condition, {
          context: args.context,
          scope: s.owningScope,
          blockScope: args.blockScope,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
        });
        if (s.comptime) {
          const conditionValue = EvalCTFEBoolean(sr, conditionId);
          if (conditionValue) {
            const [thenScope, thenScopeId] = Semantic.addBlockScope(sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              constraints: [...args.parentConstraints],
            });
            elaborateBlockScope(sr, {
              targetScopeId: thenScopeId,
              sourceScopeId: s.thenBlock,
              expectedReturnType: args.expectedReturnType,
              elaboratedVariables: args.elaboratedVariables,
              isMonomorphized: args.isMonomorphized,
              context: args.context,
            });
            return Semantic.addStatement(sr, {
              variant: Semantic.ENode.BlockScopeStatement,
              block: thenScopeId,
              sourceloc: s.sourceloc,
            })[1];
          }

          for (const elif of s.elseif) {
            const [condition, conditionId] = elaborateExpr(sr, elif.condition, {
              context: args.context,
              scope: s.owningScope,
              blockScope: args.blockScope,
              elaboratedVariables: args.elaboratedVariables,
              isMonomorphized: args.isMonomorphized,
            });
            if (EvalCTFEBoolean(sr, conditionId)) {
              const [thenScope, thenScopeId] = Semantic.addBlockScope(sr, {
                variant: Semantic.ENode.BlockScope,
                statements: [],
                constraints: [...args.parentConstraints],
              });
              elaborateBlockScope(sr, {
                targetScopeId: thenScopeId,
                sourceScopeId: elif.thenBlock,
                expectedReturnType: args.expectedReturnType,
                elaboratedVariables: args.elaboratedVariables,
                context: args.context,
                isMonomorphized: args.isMonomorphized,
              });
              return Semantic.addStatement(sr, {
                variant: Semantic.ENode.BlockScopeStatement,
                block: thenScopeId,
                sourceloc: s.sourceloc,
              })[1];
            }
          }

          if (s.elseBlock) {
            const [thenScope, thenScopeId] = Semantic.addBlockScope(sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              constraints: [...args.parentConstraints],
            });
            elaborateBlockScope(sr, {
              targetScopeId: thenScopeId,
              sourceScopeId: s.elseBlock,
              expectedReturnType: args.expectedReturnType,
              elaboratedVariables: args.elaboratedVariables,
              isMonomorphized: args.isMonomorphized,
              context: args.context,
            });
            return Semantic.addStatement(sr, {
              variant: Semantic.ENode.BlockScopeStatement,
              block: thenScopeId,
              sourceloc: s.sourceloc,
            })[1];
          }

          // Nothing was true, emit empty scope statement
          return Semantic.addStatement(sr, {
            variant: Semantic.ENode.BlockScopeStatement,
            block: Semantic.addBlockScope(sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              constraints: [...args.parentConstraints],
            })[1],
            sourceloc: s.sourceloc,
          })[1];
        } else {
          const [thenScope, thenScopeId] = Semantic.addBlockScope(sr, {
            variant: Semantic.ENode.BlockScope,
            statements: [],
            constraints: [...args.parentConstraints],
          });
          buildConstraints(sr, thenScope.constraints, conditionId);
          elaborateBlockScope(sr, {
            targetScopeId: thenScopeId,
            sourceScopeId: s.thenBlock,
            expectedReturnType: args.expectedReturnType,
            elaboratedVariables: args.elaboratedVariables,
            isMonomorphized: args.isMonomorphized,
            context: args.context,
          });
          const elseIfs = s.elseif.map((e) => {
            const [innerThenScope, innerThenScopeId] = Semantic.addBlockScope(sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              constraints: [...args.parentConstraints],
            });
            elaborateBlockScope(sr, {
              targetScopeId: innerThenScopeId,
              sourceScopeId: e.thenBlock,
              isMonomorphized: args.isMonomorphized,
              expectedReturnType: args.expectedReturnType,
              elaboratedVariables: args.elaboratedVariables,
              context: args.context,
            });
            return {
              condition: elaborateExpr(sr, e.condition, {
                context: args.context,
                blockScope: args.blockScope,
                scope: s.owningScope,
                elaboratedVariables: args.elaboratedVariables,
                isMonomorphized: args.isMonomorphized,
              })[1],
              then: innerThenScopeId,
            };
          });

          let [elseScope, elseScopeId] = [
            undefined as undefined | Semantic.BlockScope,
            undefined as Semantic.BlockScopeId | undefined,
          ];
          if (s.elseBlock) {
            [elseScope, elseScopeId] = Semantic.addBlockScope(sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              constraints: [...args.parentConstraints],
            });
            elaborateBlockScope(sr, {
              targetScopeId: elseScopeId,
              sourceScopeId: s.elseBlock,
              expectedReturnType: args.expectedReturnType,
              isMonomorphized: args.isMonomorphized,
              elaboratedVariables: args.elaboratedVariables,
              context: args.context,
            });
          }
          return Semantic.addStatement(sr, {
            variant: Semantic.ENode.IfStatement,
            condition: conditionId,
            then: thenScopeId,
            elseIfs: elseIfs,
            else: elseScopeId,
            sourceloc: s.sourceloc,
          })[1];
        }
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.WhileStatement: {
        const [condition, conditionId] = elaborateExpr(sr, s.condition, {
          blockScope: args.blockScope,
          context: args.context,
          scope: s.owningScope,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
        });
        const [thenScope, thenScopeId] = Semantic.addBlockScope(sr, {
          variant: Semantic.ENode.BlockScope,
          statements: [],
          constraints: [...args.parentConstraints],
        });
        elaborateBlockScope(sr, {
          targetScopeId: thenScopeId,
          sourceScopeId: s.block,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
          expectedReturnType: args.expectedReturnType,
          context: args.context,
        });
        return Semantic.addStatement(sr, {
          variant: Semantic.ENode.WhileStatement,
          condition: conditionId,
          then: thenScopeId,
          sourceloc: s.sourceloc,
        })[1];
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ReturnStatement: {
        if (s.expr) {
          return Semantic.addStatement(sr, {
            variant: Semantic.ENode.ReturnStatement,
            expr: Conversion.MakeConversion(
              sr,
              elaborateExpr(sr, s.expr, {
                context: args.context,
                scope: s.owningScope,
                blockScope: args.blockScope,
                elaboratedVariables: args.elaboratedVariables,
                isMonomorphized: args.isMonomorphized,
              })[1],
              args.expectedReturnType,
              args.blockScope.constraints || [],
              s.sourceloc,
              Conversion.Mode.Implicit
            ),
            sourceloc: s.sourceloc,
          })[1];
        } else {
          return Semantic.addStatement(sr, {
            variant: Semantic.ENode.ReturnStatement,
            sourceloc: s.sourceloc,
          })[1];
        }
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.VariableDefinitionStatement: {
        let uninitialized = false;
        if (s.value) {
          const value = sr.cc.nodes.get(s.value);
          if (value.variant === Collect.ENode.SymbolValueExpr && value.name === "uninitialized") {
            if (value.genericArgs.length !== 0) {
              throw new CompilerError(
                `The 'uninitialized' directive requires 0 type arguments`,
                s.sourceloc
              );
            }
            uninitialized = true;
          }
        }

        const collectedVariableSymbol = sr.cc.nodes.get(s.variableSymbol);
        assert(collectedVariableSymbol.variant === Collect.ENode.VariableSymbol);
        const variableSymbolId = args.elaboratedVariables.get(s.variableSymbol);
        assert(variableSymbolId);
        const variableSymbol = sr.symbolNodes.get(variableSymbolId);
        assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);

        if (collectedVariableSymbol.type) {
          variableSymbol.type = lookupAndElaborateDatatype(sr, {
            typeId: collectedVariableSymbol.type,
            elaboratedVariables: args.elaboratedVariables,
            isInCFuncdecl: false,
            context: isolateSubstitutionContext(args.context, {
              currentScope: s.owningScope,
              genericsScope: s.owningScope,
            }),
          });
          assert(variableSymbol.type);
        }

        let valueId: Semantic.ExprId | undefined;
        if (s.value) {
          const sValue = sr.cc.nodes.get(s.value);
          if (sValue.variant === Collect.ENode.SymbolValueExpr && sValue.name === "default") {
            if (sValue.genericArgs.length !== 0) {
              throw new CompilerError(
                `'default' initializer cannot take any generics`,
                s.sourceloc
              );
            }
            if (!variableSymbol.type) {
              throw new CompilerError(
                `Variable initializations with a 'default' initializer require an explicit datatype to be specified`,
                s.sourceloc
              );
            }
            valueId = Conversion.MakeDefaultValue(sr, variableSymbol.type, s.sourceloc);
          } else {
            valueId =
              (!uninitialized &&
                s.value &&
                elaborateExpr(sr, s.value, {
                  context: args.context,
                  scope: s.owningScope,
                  elaboratedVariables: args.elaboratedVariables,
                  blockScope: args.blockScope,
                  isMonomorphized: args.isMonomorphized,
                })[1]) ||
              undefined;
          }
        }
        const value = valueId && sr.exprNodes.get(valueId);

        if (value?.variant === Semantic.ENode.DatatypeAsValueExpr) {
          throw new CompilerError(
            `A struct/namespace datatype cannot be written into a variable`,
            value.sourceloc
          );
        }

        if ((!valueId || !value) && !uninitialized) {
          throw new CompilerError(
            `Variable '${variableSymbol.name}' requires an initialization value`,
            s.sourceloc
          );
        }

        if (!variableSymbol.type) {
          variableSymbol.type = value?.type || null;
          if (variableSymbol.type && value) {
            const variableSymbolType = sr.typeUseNodes.get(variableSymbol.type);
            const variableSymbolTypeDef = sr.typeDefNodes.get(variableSymbolType.type);
            if (variableSymbol.mutability === EVariableMutability.Const) {
            } else {
              // If a const T value is assigned to a let variable,
              // a copy is made which makes the copied value fully mutable.
              variableSymbol.type = makeTypeUse(
                sr,
                variableSymbolType.type,
                EDatatypeMutability.Mut,
                s.sourceloc
              )[1];
            }
          }
        }
        assert(variableSymbol.type);
        variableSymbol.concrete = sr.typeDefNodes.get(
          sr.typeUseNodes.get(variableSymbol.type).type
        ).concrete;
        const variableSymbolType = sr.typeUseNodes.get(variableSymbol.type);
        const variableSymbolTypeDef = sr.typeDefNodes.get(variableSymbolType.type);

        if (variableSymbol.mutability === EVariableMutability.Const) {
          // assert(false, "TODO");
        } else {
          // if (variableSymbol)
        }

        if (variableSymbol.comptime) {
          assert(valueId);
          variableSymbol.comptimeValue = EvalCTFE(sr, valueId)[1];
        }

        // if (value) {
        //   const valueType = sr.typeDefNodes.get(sr.typeUseNodes.get(value.type).type);
        //   if (
        //     variableSymbolTypeDef.variant === Semantic.ENode.StructDatatype &&
        //     valueType.variant === Semantic.ENode.StructDatatype &&
        //     (valueType.clonability === EClonability.NonClonableFromAttribute ||
        //       valueType.clonability === EClonability.NonClonableFromMembers) &&
        //     !value.isTemporary
        //   ) {
        //     const msg =
        //       valueType.clonability === EClonability.NonClonableFromAttribute
        //         ? "marked as 'nonclonable'"
        //         : "non-clonable because it contains raw pointers or other non-clonable structures";
        //     throw new CompilerError(
        //       `This assignment of type '${serializeTypeUse(
        //         sr,
        //         value.type
        //       )}' would create a copy of the struct, but the struct definition is ${msg}`,
        //       s.sourceloc
        //     );
        //   }
        // }

        return Semantic.addStatement(sr, {
          variant: Semantic.ENode.VariableStatement,
          mutability: variableSymbol.mutability,
          comptime: collectedVariableSymbol.comptime,
          name: variableSymbol.name,
          variableSymbol: variableSymbolId,
          value:
            (valueId &&
              Conversion.MakeConversion(
                sr,
                valueId,
                variableSymbol.type,
                args.blockScope.constraints || [],
                s.sourceloc,
                Conversion.Mode.Implicit
              )) ||
            null,
          sourceloc: s.sourceloc,
        })[1];
      }

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ExprStatement:
        return Semantic.addStatement(sr, {
          variant: Semantic.ENode.ExprStatement,
          expr: elaborateExpr(sr, s.expr, {
            context: args.context,
            scope: s.owningScope,
            isMonomorphized: args.isMonomorphized,
            elaboratedVariables: args.elaboratedVariables,
            blockScope: args.blockScope,
          })[1],
          sourceloc: s.sourceloc,
        })[1];

      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.ForEachStatement: {
        if (s.comptime) {
          const [value, valueId] = elaborateExpr(sr, s.value, {
            context: args.context,
            scope: s.owningScope,
            elaboratedVariables: args.elaboratedVariables,
            isMonomorphized: args.isMonomorphized,
            blockScope: args.blockScope,
          });
          const [comptimeValue, comptimeValueId] = EvalCTFE(sr, valueId);
          if (comptimeValue.variant !== Semantic.ENode.SymbolValueExpr) {
            throw new CompilerError(
              `For each loop over something other than a parameter pack is not implemented yet`,
              s.sourceloc
            );
          }
          const comptimeExpr = sr.typeDefNodes.get(sr.typeUseNodes.get(comptimeValue.type).type);
          if (comptimeExpr.variant !== Semantic.ENode.ParameterPackDatatype) {
            throw new CompilerError(
              `For each loop over something other than a parameter pack is not implemented yet`,
              s.sourceloc
            );
          }

          if (!sr.syntheticScopeToVariableMap.has(s.body)) {
            sr.syntheticScopeToVariableMap.set(s.body, new Map());
          }
          const syntheticMap = sr.syntheticScopeToVariableMap.get(s.body)!;

          assert(comptimeExpr.parameters);

          let loopIndex: undefined | Semantic.VariableSymbol = undefined;
          let loopIndexId: undefined | Semantic.SymbolId = undefined;
          if (s.indexVariable) {
            [loopIndex, loopIndexId] = Semantic.addSymbol(sr, {
              variant: Semantic.ENode.VariableSymbol,
              comptime: true,
              comptimeValue: null,
              concrete: true,
              export: false,
              extern: EExternLanguage.None,
              memberOfStruct: null,
              mutability: EVariableMutability.Const,
              name: s.indexVariable,
              parentStructOrNS: null,
              sourceloc: s.sourceloc,
              type: makePrimitiveAvailable(
                sr,
                EPrimitive.usize,
                EDatatypeMutability.Const,
                s.sourceloc
              ),
              variableContext: EVariableContext.FunctionLocal,
            } satisfies Semantic.VariableSymbol);
          }

          const allScopes: Semantic.StatementId[] = [];
          for (let i = 0; i < comptimeExpr.parameters.length; i++) {
            const [thenScope, thenScopeId] = Semantic.addBlockScope(sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
              constraints: [...args.parentConstraints],
            });

            const semanticParamId = comptimeExpr.parameters[i];
            const paramValue = sr.symbolNodes.get(semanticParamId);
            assert(paramValue.variant === Semantic.ENode.VariableSymbol);
            assert(paramValue.type);

            syntheticMap.set(s.loopVariable, semanticParamId);
            if (s.indexVariable) {
              assert(loopIndexId && loopIndex);
              loopIndex.comptimeValue = Semantic.addExpr(sr, {
                variant: Semantic.ENode.LiteralExpr,
                isTemporary: true,
                literal: {
                  type: EPrimitive.usize,
                  unit: null,
                  value: BigInt(i),
                },
                type: makePrimitiveAvailable(
                  sr,
                  EPrimitive.usize,
                  EDatatypeMutability.Const,
                  s.sourceloc
                ),
                sourceloc: s.sourceloc,
              })[1];
              syntheticMap.set(s.indexVariable, loopIndexId);
            }
            elaborateBlockScope(sr, {
              targetScopeId: thenScopeId,
              sourceScopeId: s.body,
              expectedReturnType: args.expectedReturnType,
              isMonomorphized: args.isMonomorphized,
              elaboratedVariables: args.elaboratedVariables,
              context: args.context,
            });
            if (s.indexVariable) {
              syntheticMap.delete(s.indexVariable);
            }
            syntheticMap.delete(s.loopVariable);

            allScopes.push(
              Semantic.addStatement(sr, {
                variant: Semantic.ENode.BlockScopeStatement,
                block: thenScopeId,
                sourceloc: s.sourceloc,
              })[1]
            );
          }

          return Semantic.addStatement(sr, {
            variant: Semantic.ENode.BlockScopeStatement,
            block: Semantic.addBlockScope(sr, {
              variant: Semantic.ENode.BlockScope,
              statements: allScopes,
              constraints: [...args.parentConstraints],
            })[1],
            sourceloc: s.sourceloc,
          })[1];
        } else {
          assert(false, "Non-comptime for each not implemented yet");
        }
      }

      default:
        assert(false);
    }
  }

  function elaborateVariableSymbolInScope(
    sr: SemanticResult,
    variableSymbolId: Collect.Id,
    args: {
      elaboratedVariables: Map<Collect.Id, Semantic.SymbolId>;
      isMonomorphized: boolean;
      context: ElaborationContext;
    }
  ) {
    const symbol = sr.cc.nodes.get(variableSymbolId);
    switch (symbol.variant) {
      case Collect.ENode.VariableSymbol: {
        let variableContext = EVariableContext.FunctionLocal;
        let type: Semantic.TypeUseId | null = null;
        if (symbol.variableContext === EVariableContext.FunctionParameter) {
          variableContext = EVariableContext.FunctionParameter;
          if (!symbol.type) {
            throw new InternalError("Parameter needs datatype");
          }
          const symbolType = sr.cc.nodes.get(symbol.type);
          if (symbolType.variant === Collect.ENode.ParameterPack) {
            // Is elaborated directly in function
            break;
          }
          type = lookupAndElaborateDatatype(sr, {
            typeId: symbol.type,
            isInCFuncdecl: false,
            elaboratedVariables: args.elaboratedVariables,
            context: isolateSubstitutionContext(args.context, {
              genericsScope: symbol.inScope,
              currentScope: symbol.inScope,
            }),
          });
        } else if (symbol.variableContext === EVariableContext.ThisReference) {
          if (args.elaboratedVariables.has(variableSymbolId)) {
            break;
          } else {
            assert(
              false,
              "Variable definition statement for This-Reference was encountered, but it's not yet in the variableMap. It should already be elaborated by the parent."
            );
          }
        }
        const [variable, variableId] = Semantic.addSymbol(sr, {
          variant: Semantic.ENode.VariableSymbol,
          export: false,
          extern: EExternLanguage.None,
          mutability: symbol.mutability,
          name: symbol.name,
          sourceloc: symbol.sourceloc,
          memberOfStruct: null,
          parentStructOrNS: elaborateParentSymbolFromCache(sr, {
            context: args.context,
            parentScope: symbol.inScope,
          }),
          comptime: symbol.comptime,
          comptimeValue: null,
          variableContext: variableContext,
          type: type,
          concrete: false,
        });
        args.elaboratedVariables.set(variableSymbolId, variableId);
        break;
      }

      default:
        assert(false, symbol.variant.toString());
    }
  }

  export function elaborateBlockScope(
    sr: SemanticResult,
    args: {
      sourceScopeId: Collect.Id;
      targetScopeId: Semantic.BlockScopeId;
      expectedReturnType: Semantic.TypeUseId;
      elaboratedVariables: Map<Collect.Id, Semantic.SymbolId>;
      isMonomorphized: boolean;
      context: ElaborationContext;
    }
  ) {
    const scope = sr.cc.nodes.get(args.sourceScopeId);
    assert(scope.variant === Collect.ENode.BlockScope);

    const newElaboratedVariables = new Map<Collect.Id, Semantic.SymbolId>(args.elaboratedVariables);

    for (const sId of scope.symbols) {
      elaborateVariableSymbolInScope(sr, sId, {
        elaboratedVariables: newElaboratedVariables,
        isMonomorphized: args.isMonomorphized,
        context: args.context,
      });
    }

    const blockScope = sr.blockScopeNodes.get(args.targetScopeId);
    assert(blockScope.variant === Semantic.ENode.BlockScope);

    for (const sId of scope.statements) {
      const statement = elaborateStatement(sr, sId, {
        expectedReturnType: args.expectedReturnType,
        elaboratedVariables: newElaboratedVariables,
        context: args.context,
        blockScope: blockScope,
        isMonomorphized: args.isMonomorphized,
        parentConstraints: blockScope.constraints,
      });
      blockScope.statements.push(statement);
    }
  }

  export function elaborateFunctionSymbolWithGenerics(
    sr: SemanticResult,
    functionSignatureId: Semantic.SymbolId,
    args: {
      genericArgs: Semantic.TypeUseId[];
      usageSourceLocation: SourceLoc;
      parentStructOrNS: Semantic.TypeDefId | null;
      paramPackTypes: Semantic.TypeUseId[];
      elaboratedVariables: Map<Collect.Id, Semantic.SymbolId>;
      isMonomorphized: boolean;
      context: ElaborationContext;
    }
  ) {
    const functionSignature = sr.symbolNodes.get(functionSignatureId);
    assert(functionSignature.variant === Semantic.ENode.FunctionSignature);
    const func = sr.cc.nodes.get(functionSignature.originalFunction);
    assert(func.variant === Collect.ENode.FunctionSymbol);

    if (func.generics.length !== args.genericArgs.length) {
      throw new CompilerError(
        `Function ${func.name} expects ${func.generics.length} type parameters but got ${args.genericArgs.length}`,
        args.usageSourceLocation
      );
    }

    if (
      !func.functionScope &&
      (func.generics.length !== 0 ||
        funcSymHasParameterPack(sr.cc, functionSignature.originalFunction))
    ) {
      throw new CompilerError(
        `Non-Extern function '${func.name}' is generic or uses a parameter pack, but does not define a body. (Generic functions cannot be forward declared)`,
        func.sourceloc
      );
    }

    if (
      func.generics.length !== 0 ||
      funcSymHasParameterPack(sr.cc, functionSignature.originalFunction)
    ) {
      assert(func.functionScope);
      args.context = isolateSubstitutionContext(args.context, {
        currentScope: args.context.currentScope,
        genericsScope: args.context.currentScope,
      });
      for (let i = 0; i < func.generics.length; i++) {
        args.context.substitute.set(func.generics[i], args.genericArgs[i]);
      }
    }

    return elaborateFunctionSymbol(sr, functionSignatureId, {
      context: args.context,
      elaboratedVariables: args.elaboratedVariables,
      isMonomorphized: args.isMonomorphized,
      paramPackTypes: args.paramPackTypes,
      parentStructOrNS: functionSignature.parentStructOrNS,
    });
  }

  export function elaborateFunctionSymbol(
    sr: SemanticResult,
    functionSignatureId: Semantic.SymbolId,
    args: {
      parentStructOrNS: Semantic.TypeDefId | null;
      paramPackTypes: Semantic.TypeUseId[];
      elaboratedVariables: Map<Collect.Id, Semantic.SymbolId>;
      isMonomorphized: boolean;
      context: ElaborationContext;
    }
  ): Semantic.SymbolId {
    const functionSignature = sr.symbolNodes.get(functionSignatureId);
    assert(functionSignature.variant === Semantic.ENode.FunctionSignature);

    const func = sr.cc.nodes.get(functionSignature.originalFunction);
    assert(func.variant === Collect.ENode.FunctionSymbol);

    // The way this works is that first we define all generic substitutions outside of the function in the context,
    // and then we elaborate the function symbol here. For that, we get the raw generics and retrieve substitutions
    // for all of them. All substitutions must be available. This means that the system works very well, because
    // if we elaborate a generic function from itself recursively, we automatically get the correct substitution.
    const genericArgs = func.generics.map((g) => {
      const substitute = args.context.substitute.get(g);
      assert(substitute);
      return substitute;
    });

    for (const s of sr.elaboratedFuncdefSymbols) {
      if (
        s.generics.length === genericArgs.length &&
        s.generics.every((g, index) => g === genericArgs[index]) &&
        s.paramPackTypes.length === args.paramPackTypes.length &&
        s.paramPackTypes.every((g, index) => g === args.paramPackTypes[index]) &&
        s.originalSymbol === functionSignature.originalFunction &&
        s.parentStructOrNS === args.parentStructOrNS
      ) {
        return s.result;
      }
    }

    const expectedReturnType = lookupAndElaborateDatatype(sr, {
      typeId: func.returnType,
      context: isolateSubstitutionContext(args.context, {
        genericsScope: func.functionScope || func.parentScope,
        currentScope: func.functionScope || func.parentScope,
      }),
      elaboratedVariables: args.elaboratedVariables,
      isInCFuncdecl: false,
    });

    if (func.vararg && func.extern !== EExternLanguage.Extern_C) {
      throw new CompilerError(
        `A C-Style Vararg parameter pack may only be used on extern "C" functions`,
        func.sourceloc
      );
    }

    let parameterPack = false;
    const parameterNames = func.parameters.map((p) => p.name);
    const parameters = func.parameters
      .map((p, i) => {
        const paramType = sr.cc.nodes.get(p.type);
        if (paramType.variant === Collect.ENode.ParameterPack) {
          if (i !== func.parameters.length - 1) {
            throw new CompilerError(
              `A Parameter Pack may only appear at the very end of the parameter list`,
              func.sourceloc
            );
          }
          if (func.extern !== EExternLanguage.None) {
            throw new CompilerError(
              `A Parameter Pack may not be used on an exported function`,
              func.sourceloc
            );
          }
          parameterPack = true;

          assert(func.functionScope);
          const functionScope = sr.cc.nodes.get(func.functionScope);
          assert(functionScope.variant === Collect.ENode.FunctionScope);
          const packVariable = [...functionScope.symbols].find((s) => {
            const sym = sr.cc.nodes.get(s);
            return sym.variant === Collect.ENode.VariableSymbol && sym.name === p.name;
          });
          assert(packVariable);

          const [paramPack, paramPackId] = Semantic.addType(sr, {
            variant: Semantic.ENode.ParameterPackDatatype,
            parameters: args.paramPackTypes.map((t, i) => {
              const [variable, variableId] = Semantic.addSymbol(sr, {
                variant: Semantic.ENode.VariableSymbol,
                comptime: false,
                comptimeValue: null,
                concrete: true,
                name: `__param_pack_${i}`,
                export: false,
                extern: EExternLanguage.None,
                memberOfStruct: null,
                mutability: EVariableMutability.Default,
                parentStructOrNS: null,
                type: t,
                variableContext: EVariableContext.FunctionParameter,
                sourceloc: func.sourceloc,
              });
              return variableId;
            }),
            concrete: true,
          });
          const [paramPackVariable, paramPackVariableId] = Semantic.addSymbol(sr, {
            variant: Semantic.ENode.VariableSymbol,
            comptime: false,
            comptimeValue: null,
            concrete: true,
            name: `__param_pack`,
            export: false,
            extern: EExternLanguage.None,
            memberOfStruct: null,
            mutability: EVariableMutability.Default,
            parentStructOrNS: null,
            type: makeTypeUse(sr, paramPackId, EDatatypeMutability.Const, func.sourceloc)[1],
            variableContext: EVariableContext.FunctionParameter,
            sourceloc: func.sourceloc,
          });
          args.elaboratedVariables.set(packVariable, paramPackVariableId);
          return makeTypeUse(sr, paramPackId, EDatatypeMutability.Const, func.sourceloc)[1];
        }
        return lookupAndElaborateDatatype(sr, {
          typeId: p.type,
          context: isolateSubstitutionContext(args.context, {
            genericsScope: func.functionScope || func.parentScope,
            currentScope: func.functionScope || func.parentScope,
          }),
          elaboratedVariables: args.elaboratedVariables,
          isInCFuncdecl: false,
        });
      })
      .filter((p) => Boolean(p))
      .map((p) => p!);

    if (func.methodType === EMethodType.Method && !func.staticMethod) {
      parameterNames.unshift("this");
      assert(args.parentStructOrNS);
      parameters.unshift(
        makeReferenceDatatypeAvailable(
          sr,
          makeTypeUse(sr, args.parentStructOrNS, EDatatypeMutability.Mut, func.sourceloc)[1],
          EDatatypeMutability.Const,
          func.sourceloc
        )
      );
    }

    const ftype = makeRawFunctionDatatypeAvailable(sr, {
      parameters: parameters,
      returnType: expectedReturnType,
      vararg: func.vararg,
      sourceloc: func.sourceloc,
    });

    let [symbol, symbolId] = Semantic.addSymbol<Semantic.FunctionSymbol>(sr, {
      variant: Semantic.ENode.FunctionSymbol,
      type: ftype,
      export: func.export,
      generics: genericArgs,
      staticMethod: func.staticMethod,
      parameterPack: parameterPack,
      methodOf: args.parentStructOrNS,
      methodType: func.methodType,
      parentStructOrNS: args.parentStructOrNS,
      noemit: func.noemit,
      isMonomorphized: parameterPack || func.generics.length > 0 || args.isMonomorphized,
      extern: func.extern,
      parameterNames: parameterNames,
      name: func.name,
      sourceloc: func.sourceloc,
      scope: null,
      concrete: sr.typeDefNodes.get(ftype).concrete,
    });

    if (symbol.concrete) {
      sr.elaboratedFuncdefSymbols.push({
        generics: genericArgs,
        originalSymbol: functionSignature.originalFunction,
        substitutionContext: args.context,
        paramPackTypes: args.paramPackTypes,
        parentStructOrNS: args.parentStructOrNS,
        result: symbolId,
      });

      if (func.functionScope) {
        const [bodyScope, bodyScopeId] = Semantic.addBlockScope(sr, {
          variant: Semantic.ENode.BlockScope,
          statements: [],
          constraints: [],
        });

        const functionScope = sr.cc.nodes.get(func.functionScope);
        assert(functionScope.variant === Collect.ENode.FunctionScope);

        const newElaboratedVariables = new Map<Collect.Id, Semantic.SymbolId>(
          args.elaboratedVariables
        );

        if (symbol.methodType === EMethodType.Method) {
          const collectedThisRefId = [...functionScope.symbols].find((sId) => {
            const sym = sr.cc.nodes.get(sId);
            return sym.variant === Collect.ENode.VariableSymbol && sym.name === "this";
          });
          assert(collectedThisRefId);
          const collectedThisRef = sr.cc.nodes.get(collectedThisRefId);
          assert(collectedThisRef.variant === Collect.ENode.VariableSymbol);

          assert(symbol.methodOf);
          if (sr.typeDefNodes.get(symbol.methodOf).variant === Semantic.ENode.ReferenceDatatype) {
            assert(false);
          }
          const thisRef = makeReferenceDatatypeAvailable(
            sr,
            makeTypeUse(sr, symbol.methodOf, EDatatypeMutability.Mut, func.sourceloc)[1],
            EDatatypeMutability.Const,
            func.sourceloc
          );
          const [variable, variableId] = Semantic.addSymbol(sr, {
            variant: Semantic.ENode.VariableSymbol,
            memberOfStruct: symbol.methodOf,
            mutability: EVariableMutability.Default,
            name: collectedThisRef.name,
            type: thisRef,
            comptime: false,
            comptimeValue: null,
            concrete: isTypeConcrete(sr, thisRef),
            export: false,
            extern: EExternLanguage.None,
            parentStructOrNS: symbol.parentStructOrNS,
            sourceloc: symbol.sourceloc,
            variableContext: EVariableContext.FunctionParameter,
          });
          newElaboratedVariables.set(collectedThisRefId, variableId);
        }

        for (const sId of functionScope.symbols) {
          const symbol = sr.cc.nodes.get(sId);
          if (symbol.variant === Collect.ENode.VariableSymbol) {
            elaborateVariableSymbolInScope(sr, sId, {
              elaboratedVariables: newElaboratedVariables,
              context: args.context,
              isMonomorphized: args.isMonomorphized,
            });
          }
        }

        symbol.scope = bodyScopeId;
        elaborateBlockScope(sr, {
          targetScopeId: bodyScopeId,
          sourceScopeId: functionScope.blockScope,
          expectedReturnType: expectedReturnType,
          elaboratedVariables: newElaboratedVariables,
          isMonomorphized: symbol.isMonomorphized,
          context: args.context,
        });
      }
    }

    return symbolId;
  }

  export function elaborateNamespace(
    sr: SemanticResult,
    namespaceId: Collect.Id,
    args: {
      context: ElaborationContext;
    }
  ): Semantic.TypeDefId {
    const namespace = sr.cc.nodes.get(namespaceId);
    assert(namespace.variant === Collect.ENode.NamespaceDefinitionSymbol);
    const sharedInstance = sr.cc.nodes.get(namespace.sharedInstance);
    assert(sharedInstance.variant === Collect.ENode.NamespaceSharedInstance);

    for (const s of sr.elaboratedNamespaceSymbols) {
      if (s.originalSharedInstance === namespace.sharedInstance) {
        return s.result;
      }
    }

    // const elaborateNestedNamespace = (namespaceId: Collect.Id): Semantic.Id => {
    //   const namespace = sr.cc.nodes.get(namespaceId);
    //   assert(namespace.variant === Collect.ENode.NamespaceDefinitionSymbol);

    //   let parentNamespace = -1 as Semantic.Id;
    //   const parentScope = sr.cc.nodes.get(namespace.parentScope);
    //   if (parentScope.variant === Collect.ENode.NamespaceScope) {
    //     parentNamespace = elaborateNestedNamespace(parentScope.owningSymbol);
    //   }

    // };

    let parentNamespace = null as Semantic.TypeDefId | null;
    const parentScope = sr.cc.nodes.get(namespace.parentScope);
    if (parentScope.variant === Collect.ENode.NamespaceScope) {
      parentNamespace = elaborateNamespace(sr, parentScope.owningSymbol, {
        context: args.context,
      });
    }

    const [ns, nsId] = Semantic.addType<Semantic.NamespaceDatatypeDef>(sr, {
      variant: Semantic.ENode.NamespaceDatatype,
      name: namespace.name,
      parentStructOrNS: parentNamespace,
      symbols: [],
      concrete: true,
      collectedNamespace: namespaceId,
    });
    sr.elaboratedNamespaceSymbols.push({
      originalSharedInstance: namespace.sharedInstance,
      result: nsId,
    });

    for (const scopeId of sharedInstance.namespaceScopes) {
      const nsScope = sr.cc.nodes.get(scopeId);
      assert(nsScope.variant === Collect.ENode.NamespaceScope);
      for (const symbolId of nsScope.symbols) {
        const sym = elaborateTopLevelSymbol(sr, symbolId, {
          context: makeElaborationContext({
            currentScope: scopeId,
            genericsScope: scopeId,
          }),
        });
        for (const s of sym) {
          ns.symbols.push(s);
        }
      }
    }
    return nsId;
  }

  export function elaborateTopLevelSymbol(
    sr: SemanticResult,
    nodeId: Collect.Id,
    args: {
      context: ElaborationContext;
    }
  ): Semantic.SymbolId[] {
    const node = sr.cc.nodes.get(nodeId);
    switch (node.variant) {
      // =================================================================================================================
      // =================================================================================================================
      // =================================================================================================================

      case Collect.ENode.NamespaceDefinitionSymbol: {
        return [
          Semantic.addSymbol(sr, {
            variant: Semantic.ENode.TypeDefSymbol,
            datatype: elaborateNamespace(sr, nodeId, {
              context: args.context,
            }),
          })[1],
        ];
      }

      case Collect.ENode.FunctionOverloadGroup: {
        const functionSymbols: Semantic.SymbolId[] = [];
        for (const id of node.overloads) {
          const func = sr.cc.nodes.get(id);
          assert(func.variant === Collect.ENode.FunctionSymbol);
          if (func.generics.length === 0 && !funcSymHasParameterPack(sr.cc, id)) {
            const signature = elaborateFunctionSignature(sr, id, { context: args.context });
            const sId = elaborateFunctionSymbol(sr, signature, {
              paramPackTypes: [],
              parentStructOrNS: elaborateParentSymbolFromCache(sr, {
                parentScope: func.parentScope,
                context: args.context,
              }),
              isMonomorphized: false,
              elaboratedVariables: new Map(),
              context: args.context,
            });
            functionSymbols.push(sId);
          }
        }
        return functionSymbols;
      }

      case Collect.ENode.StructDefinitionSymbol: {
        // If it's concrete, act as if we tried to use it to elaborate it. If generic, skip
        if (node.generics.length !== 0) {
          return [];
        }
        return [
          Semantic.addSymbol(sr, {
            variant: Semantic.ENode.TypeDefSymbol,
            datatype: instantiateAndElaborateStructWithGenerics(sr, {
              definedStructTypeId: nodeId,
              context: args.context,
              genericArgs: [],
              elaboratedVariables: new Map(),
              sourceloc: node.sourceloc,
            }),
          })[1],
        ];
      }

      case Collect.ENode.VariableSymbol: {
        assert(node.variableContext === EVariableContext.Global);
        if (sr.elaboratedGlobalVariableSymbols.has(nodeId)) {
          return [sr.elaboratedGlobalVariableSymbols.get(nodeId)!];
        }

        const type =
          (node.type &&
            lookupAndElaborateDatatype(sr, {
              typeId: node.type,
              elaboratedVariables: new Map(),
              isInCFuncdecl: false,
              context: args.context,
            })) ||
          null;

        const variableId = Semantic.addSymbol(sr, {
          variant: Semantic.ENode.VariableSymbol,
          type: type,
          export: false,
          extern: EExternLanguage.None,
          comptime: node.comptime,
          comptimeValue: null,
          name: node.name,
          memberOfStruct: null,
          mutability: node.mutability,
          variableContext: EVariableContext.Global,
          parentStructOrNS: elaborateParentSymbolFromCache(sr, {
            parentScope: node.inScope,
            context: args.context,
          }),
          sourceloc: node.sourceloc,
          concrete: true,
        })[1];
        sr.elaboratedGlobalVariableSymbols.set(nodeId, variableId);
        return [variableId];
      }

      case Collect.ENode.GlobalVariableDefinition: {
        for (const s of sr.elaboratedGlobalVariableDefinitions) {
          if (s.originalSymbol === nodeId) {
            return [s.result];
          }
        }
        let [elaboratedValue, elaboratedValueId] = [
          undefined as Semantic.Expression | undefined,
          null as Semantic.ExprId | null,
        ];

        const [variableSymbolId] = elaborateTopLevelSymbol(sr, node.variableSymbol, {
          context: args.context,
        });
        assert(variableSymbolId);
        const variableSymbol = sr.symbolNodes.get(variableSymbolId);
        assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);

        if (!variableSymbol.type && elaboratedValue) {
          variableSymbol.type = elaboratedValue.type;
        }
        assert(variableSymbol.type);
        assert(isTypeConcrete(sr, variableSymbol.type));

        if (node.value) {
          const value = sr.cc.nodes.get(node.value);
          if (value.variant === Collect.ENode.SymbolValueExpr && value.name === "default") {
            if (value.genericArgs.length !== 0) {
              throw new CompilerError(
                `'default' initializer cannot take any generics`,
                node.sourceloc
              );
            }
            elaboratedValueId = Conversion.MakeDefaultValue(
              sr,
              variableSymbol.type,
              node.sourceloc
            );
            assert(elaboratedValueId);
            elaboratedValue = sr.exprNodes.get(elaboratedValueId);
          } else {
            [elaboratedValue, elaboratedValueId] = elaborateExpr(sr, node.value, {
              scope: args.context.currentScope,
              elaboratedVariables: new Map(),
              context: args.context,
              blockScope: null,
              isMonomorphized: false,
            });
          }
        }

        if (variableSymbol.comptime) {
          assert(elaboratedValueId);
          variableSymbol.comptimeValue = EvalCTFE(sr, elaboratedValueId)[1];
        }

        const [s, sId] = Semantic.addSymbol(sr, {
          variant: Semantic.ENode.GlobalVariableDefinitionSymbol,
          export: variableSymbol.export,
          extern: variableSymbol.extern,
          name: variableSymbol.name,
          comptime: variableSymbol.comptime,
          value: elaboratedValueId,
          sourceloc: node.sourceloc,
          variableSymbol: variableSymbolId,
          parentStructOrNS: variableSymbol.parentStructOrNS,
          concrete: true,
        });
        sr.elaboratedGlobalVariableDefinitions.push({
          originalSymbol: nodeId,
          result: sId,
        });
        return [sId];
      }

      case Collect.ENode.CInjectDirective: {
        const [directive, directiveId] = Semantic.addSymbol(sr, {
          variant: Semantic.ENode.CInjectDirectiveSymbol,
          value: node.value,
          sourceloc: node.sourceloc,
        });
        sr.cInjections.push(directiveId);
        return [directiveId];
      }

      case Collect.ENode.UnitScope: {
        for (const symbolId of node.symbols) {
          elaborateTopLevelSymbol(sr, symbolId, {
            context: makeElaborationContext({
              currentScope: nodeId,
              genericsScope: nodeId,
            }),
          });
        }
        return [];
      }

      case Collect.ENode.FileScope: {
        for (const symbolId of node.symbols) {
          elaborateTopLevelSymbol(sr, symbolId, {
            context: makeElaborationContext({
              currentScope: nodeId,
              genericsScope: nodeId,
            }),
          });
        }
        return [];
      }

      case Collect.ENode.AliasTypeSymbol:
      case Collect.ENode.TypeAliasStatement:
      case Collect.ENode.ModuleImport:
      case Collect.ENode.SymbolImport: {
        return [];
      }

      default:
        assert(false, "Global Symbol " + node.variant);
    }
  }

  export function SemanticallyAnalyze(
    cc: CollectionContext,
    isLibrary: boolean,
    moduleName: string,
    moduleVersion: string
  ) {
    const sr: SemanticResult = {
      overloadedOperators: [],
      cc: cc,

      elaboratedFunctionSignatures: new Map(),
      elaboratedFunctionSignaturesByName: new Map(),

      elaboratedStructDatatypes: [],
      elaboratedFuncdefSymbols: [],
      elaboratedPrimitiveTypes: [],
      elaboratedNamespaceSymbols: [],
      elaboratedGlobalVariableDefinitions: [],
      functionTypeCache: [],
      nullRefTypeCache: [],
      referenceTypeCache: [],
      arrayTypeCache: [],
      sliceTypeCache: [],
      typeInstanceCache: [],

      blockScopeNodes: new BrandedArray<Semantic.BlockScopeId, Semantic.BlockScope>([]),
      symbolNodes: new BrandedArray<Semantic.SymbolId, Semantic.Symbol>([]),
      typeDefNodes: new BrandedArray<Semantic.TypeDefId, Semantic.TypeDef>([]),
      statementNodes: new BrandedArray<Semantic.StatementId, Semantic.Statement>([]),
      typeUseNodes: new BrandedArray<Semantic.TypeUseId, Semantic.TypeUse>([]),
      exprNodes: new BrandedArray<Semantic.ExprId, Semantic.Expression>([]),

      syntheticScopeToVariableMap: new Map(),

      exportedCollectedSymbols: new Set(),
      elaboratedGlobalVariableSymbols: new Map(),

      cInjections: [],
    };

    const moduleScope = cc.nodes.get(0 as Collect.Id);
    assert(moduleScope.variant === Collect.ENode.ModuleScope);
    for (const symbolId of moduleScope.symbols) {
      elaborateTopLevelSymbol(sr, symbolId, {
        context: makeElaborationContext({
          currentScope: 0 as Collect.Id,
          genericsScope: 0 as Collect.Id,
        }),
      });
    }

    if (moduleName !== HAZE_STDLIB_NAME) {
      const mainGlobalScope = sr.elaboratedNamespaceSymbols.find((s) => {
        const symbol = sr.typeDefNodes.get(s.result) as Semantic.NamespaceDatatypeDef;
        return symbol.name === getModuleGlobalNamespaceName(moduleName, moduleVersion);
      });
      console.info("TODO: Narrow this down so it's not just the name, because it might be nested");
      const mainFunction = sr.elaboratedFuncdefSymbols.find((s) => {
        const symbol = sr.symbolNodes.get(s.result) as Semantic.FunctionSymbol;
        return symbol.name === "main" && symbol.parentStructOrNS === mainGlobalScope?.result;
      });
      if (!isLibrary) {
        if (!mainFunction) {
          throw new CompilerError("No main function is defined in global scope", null);
        }

        const mainFunctionSymbol = sr.symbolNodes.get(mainFunction.result);
        assert(mainFunctionSymbol.variant === Semantic.ENode.FunctionSymbol);
        const mainFunctionType = sr.typeDefNodes.get(mainFunctionSymbol.type);
        assert(mainFunctionType.variant === Semantic.ENode.FunctionDatatype);
        const returnType = sr.typeDefNodes.get(
          sr.typeUseNodes.get(mainFunctionType.returnType).type
        );
        if (
          returnType.variant !== Semantic.ENode.PrimitiveDatatype ||
          returnType.primitive !== EPrimitive.int
        ) {
          throw new CompilerError("Main function must return int", mainFunctionSymbol.sourceloc);
        }
      } else {
        if (mainFunction) {
          throw new CompilerError(
            "main function is defined, but not allowed because module is built as library",
            null
          );
        }
      }
    }

    return sr;
  }

  export function serializeMutability(m: EDatatypeMutability) {
    if (m === EDatatypeMutability.Const) {
      return "const ";
    } else if (m === EDatatypeMutability.Mut) {
      return "mut ";
    } else {
      return "";
    }
  }

  export function serializeTypeUse(sr: SemanticResult, datatypeId: Semantic.TypeUseId): string {
    const datatype = sr.typeUseNodes.get(datatypeId);
    return serializeMutability(datatype.mutability) + serializeTypeDef(sr, datatype.type);
  }

  export function serializeLiteralValue(value: LiteralValue) {
    if (value.type === EPrimitive.str) {
      return `${JSON.stringify(value.value)}`;
    } else if (value.type === EPrimitive.c_str) {
      return `${JSON.stringify(value.value)}`;
    } else if (value.type === EPrimitive.bool) {
      return `${value.value ? "true" : "false"}`;
    } else {
      if (value.type === EPrimitive.int || value.type === EPrimitive.real) {
        return `${value.value}`;
      } else if (value.type === EPrimitive.null) {
        return `null`;
      } else {
        return `${primitiveToString(value.type)}(${value.value})`;
      }
    }
  }

  export function getNamespaceChainFromDatatype(sr: SemanticResult, typeId: Semantic.TypeDefId) {
    const type = sr.typeDefNodes.get(typeId);
    assert(
      type.variant === Semantic.ENode.StructDatatype ||
        type.variant === Semantic.ENode.NamespaceDatatype
    );

    let current = {
      pretty: type.name,
      mangled: type.name.length + type.name,
    };
    if (type.variant === Semantic.ENode.StructDatatype && type.generics.length > 0) {
      current.pretty += `<${type.generics.map((g) => serializeTypeUse(sr, g)).join(", ")}>`;
      current.mangled += `I${type.generics.map((g) => mangleTypeUse(sr, g).name).join("")}E`;
    }

    let fragments = [current];
    if (type.parentStructOrNS) {
      fragments = [...getNamespaceChainFromDatatype(sr, type.parentStructOrNS), current];
    }
    return fragments;
  }

  export function getNamespaceChainFromSymbol(sr: SemanticResult, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.FunctionSignature ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol
    );

    let current = {
      pretty: symbol.name,
      mangled: symbol.name.length + symbol.name,
    };
    if (symbol.variant === Semantic.ENode.FunctionSymbol && symbol.generics.length > 0) {
      current.pretty += `<${symbol.generics.map((g) => serializeTypeUse(sr, g)).join(", ")}>`;
      current.mangled += `I${symbol.generics.map((g) => mangleTypeUse(sr, g).name).join("")}E`;
    }

    let fragments = [current];
    if (symbol.parentStructOrNS) {
      fragments = [...getNamespaceChainFromDatatype(sr, symbol.parentStructOrNS), current];
    }
    return fragments;
  }

  export function serializeTypeDef(sr: SemanticResult, datatypeId: Semantic.TypeDefId): string {
    const datatype = sr.typeDefNodes.get(datatypeId);

    switch (datatype.variant) {
      case Semantic.ENode.PrimitiveDatatype:
        return primitiveToString(datatype.primitive);

      case Semantic.ENode.NullableReferenceDatatype:
        return "*" + serializeTypeUse(sr, datatype.referee);

      case Semantic.ENode.ReferenceDatatype:
        return "&" + serializeTypeUse(sr, datatype.referee);

      case Semantic.ENode.GenericParameterDatatype:
        return datatype.name;

      case Semantic.ENode.StructDatatype:
        if (datatype.extern === EExternLanguage.Extern_C) {
          return datatype.name;
        }
        return getNamespaceChainFromDatatype(sr, datatypeId)
          .map((n) => n.pretty)
          .join(".");

      case Semantic.ENode.FunctionDatatype:
        return `(${datatype.parameters.map((p) => serializeTypeUse(sr, p)).join(", ")}${
          datatype.vararg ? ", ..." : ""
        }) => ${serializeTypeUse(sr, datatype.returnType)}`;

      case Semantic.ENode.CallableDatatype:
        return `Callable<${serializeTypeDef(sr, datatype.functionType)}>(this=${
          datatype.thisExprType ? serializeTypeUse(sr, datatype.thisExprType) : ""
        })`;

      case Semantic.ENode.NamespaceDatatype:
        return getNamespaceChainFromDatatype(sr, datatypeId)
          .map((n) => n.pretty)
          .join(".");

      case Semantic.ENode.LiteralValueDatatype:
        return serializeLiteralValue(datatype.literal);

      case Semantic.ENode.ArrayDatatype:
        return `[${datatype.length}]${serializeTypeUse(sr, datatype.datatype)}`;

      case Semantic.ENode.SliceDatatype:
        return `${serializeMutability(datatype.datatype)}[]${serializeTypeUse(
          sr,
          datatype.datatype
        )}`;

      case Semantic.ENode.ParameterPackDatatype:
        if (datatype.parameters === null) {
          return "...";
        } else {
          return `Pack[${datatype.parameters.map((p) => {
            const param = sr.symbolNodes.get(p);
            assert(param.variant === Semantic.ENode.VariableSymbol);
            assert(param.type);
            return `${param.name}: ${serializeTypeUse(sr, param.type)}`;
          })}]`;
        }

      default:
        throw new InternalError("Not handled: ");
    }
  }

  export function serializeFullSymbolName(sr: SemanticResult, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.FunctionSignature ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol
    );

    if (symbol.extern === EExternLanguage.Extern_C) {
      return symbol.name;
    }

    const names = getNamespaceChainFromSymbol(sr, symbolId);
    return names.map((n) => n.pretty).join(".");
  }

  export function mangleSymbol(sr: SemanticResult, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol
    );

    if (symbol.extern === EExternLanguage.Extern_C) {
      return {
        name: symbol.name,
        wasMangled: false,
      };
    }

    let functionParameterPart = "";
    if (symbol.variant === Semantic.ENode.FunctionSymbol) {
      const ftype = sr.typeDefNodes.get(symbol.type);
      assert(ftype.variant === Semantic.ENode.FunctionDatatype);
      functionParameterPart += ftype.parameters.map((p) => mangleTypeUse(sr, p).name).join("");
      if (ftype.parameters.length === 0 && !ftype.vararg) {
        functionParameterPart += "v";
      }
      if (ftype.vararg) {
        functionParameterPart += "V";
      }
    }

    const names = getNamespaceChainFromSymbol(sr, symbolId);
    if (names.length === 1) {
      return {
        name: names[0].mangled + functionParameterPart,
        wasMangled: true,
      };
    } else {
      return {
        name: `N${names.map((n) => n.mangled).join("")}E` + functionParameterPart,
        wasMangled: true,
      };
    }
  }

  let CallableUniqueCounter = 1;
  const CallableManglingHashStore = new Map<Semantic.CallableDatatypeDef, number>();

  export function makeNameSetSymbol(sr: SemanticResult, symbolId: Semantic.SymbolId): NameSet {
    const mangled = mangleSymbol(sr, symbolId);
    const pretty = serializeFullSymbolName(sr, symbolId);
    return {
      mangledName: mangled.name,
      prettyName: pretty,
      wasMangled: mangled.wasMangled,
    };
  }

  export function makeNameSetTypeDef(sr: SemanticResult, typeDefId: Semantic.TypeDefId): NameSet {
    const mangled = mangleTypeDef(sr, typeDefId);
    const pretty = serializeTypeDef(sr, typeDefId);
    return {
      mangledName: mangled.name,
      prettyName: pretty,
      wasMangled: mangled.wasMangled,
    };
  }

  export function makeNameSetTypeUse(sr: SemanticResult, typeUseId: Semantic.TypeUseId): NameSet {
    const mangled = mangleTypeUse(sr, typeUseId);
    const pretty = serializeTypeUse(sr, typeUseId);
    return {
      mangledName: mangled.name,
      prettyName: pretty,
      wasMangled: mangled.wasMangled,
    };
  }

  export function mangleTypeUse(sr: SemanticResult, typeInstanceId: Semantic.TypeUseId) {
    const typeInstance = sr.typeUseNodes.get(typeInstanceId);

    const def = mangleTypeDef(sr, typeInstance.type);

    if (sr.typeDefNodes.get(typeInstance.type).variant !== Semantic.ENode.ParameterPackDatatype) {
      if (typeInstance.mutability === EDatatypeMutability.Const) {
        if (def.wasMangled) {
          def.name = "c" + def.name;
        }
      } else if (typeInstance.mutability === EDatatypeMutability.Mut) {
        if (def.wasMangled) {
          def.name = "m" + def.name;
        }
      }
    }

    return def;
  }

  export function mangleTypeDef(
    sr: SemanticResult,
    typeId: Semantic.TypeDefId
  ): { name: string; wasMangled: boolean } {
    const type = sr.typeDefNodes.get(typeId);

    switch (type.variant) {
      case Semantic.ENode.StructDatatype: {
        if (type.extern === EExternLanguage.Extern_C) {
          return {
            name: type.name,
            wasMangled: false,
          };
        }

        const names = getNamespaceChainFromDatatype(sr, typeId);
        if (names.length === 1) {
          return {
            name: names[0].mangled,
            wasMangled: true,
          };
        } else {
          return {
            name: `N${names.map((n) => n.mangled).join("")}E`,
            wasMangled: true,
          };
        }
      }

      case Semantic.ENode.CallableDatatype: {
        if (!CallableManglingHashStore.has(type)) {
          CallableManglingHashStore.set(type, CallableUniqueCounter++);
        }
        const uniqueID = CallableManglingHashStore.get(type);
        assert(uniqueID);
        return {
          name: "__Callable__" + uniqueID.toString(),
          wasMangled: true,
        };
      }

      case Semantic.ENode.PrimitiveDatatype: {
        const name = primitiveToString(type.primitive);
        return {
          name: name.length + name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.FunctionDatatype: {
        let params = "";
        for (const p of type.parameters) {
          const ppt = sr.typeUseNodes.get(p);
          const pp = sr.typeDefNodes.get(ppt.type);
          if (pp.variant === Semantic.ENode.ParameterPackDatatype) {
            assert(pp.parameters !== null, "Cannot mangle an unresolved parameter pack");
            for (const packParam of pp.parameters) {
              const packParamS = sr.symbolNodes.get(packParam);
              assert(packParamS.variant === Semantic.ENode.VariableSymbol);
              assert(packParamS.type);
              params += mangleTypeUse(sr, packParamS.type).name;
            }
          } else {
            params += mangleTypeUse(sr, p).name;
          }
        }
        return {
          name: "F" + params + "E" + mangleTypeUse(sr, type.returnType).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.NullableReferenceDatatype: {
        return {
          name: "P" + mangleTypeUse(sr, type.referee).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.ReferenceDatatype: {
        return {
          name: "R" + mangleTypeUse(sr, type.referee).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.ArrayDatatype: {
        return {
          name: "A" + type.length + "_" + mangleTypeUse(sr, type.datatype).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.SliceDatatype: {
        return {
          name: "S" + mangleTypeUse(sr, type.datatype).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.ParameterPackDatatype: {
        assert(type.parameters !== null);
        return {
          name: type.parameters
            .map((p) => {
              const sym = sr.symbolNodes.get(p);
              assert(sym.variant === Semantic.ENode.VariableSymbol && sym.type);
              return mangleTypeUse(sr, sym.type).name;
            })
            .join(""),
          wasMangled: true,
        };
      }

      case Semantic.ENode.LiteralValueDatatype: {
        const literalType = type.literal.type;
        if (literalType === EPrimitive.bool) {
          return {
            name: `Lb${type.literal.value ? "1" : "0"}E`,
            wasMangled: true,
          };
        } else if (literalType === EPrimitive.str || literalType === EPrimitive.c_str) {
          const utf8 = new TextEncoder().encode(type.literal.value);
          let base64 = btoa(String.fromCharCode(...utf8));
          // make it C-identifier-safe: base64 → base64url (replace +/ with _)
          base64 = base64.replace(/\+/g, "_").replace(/\//g, "_").replace(/=+$/, "");
          return {
            name: `Ls${base64}E`,
            wasMangled: true,
          };
        } else if (literalType === EPrimitive.null) {
          return {
            name: "nl",
            wasMangled: true,
          };
        } else {
          if (Number.isInteger(literalType)) {
            return {
              name: literalType < 0 ? `Lin${-type.literal.value}E` : `Li${type.literal.value}E`,
              wasMangled: true,
            };
          } else {
            const repr = type.literal.value.toString().replace("-", "n").replace(".", "_");
            return {
              name: `Lf${repr}E`,
              wasMangled: true,
            };
          }
        }
      }

      default:
        throw new InternalError("Unhandled variant: " + type.variant);
    }
  }

  export function serializeExpr(sr: SemanticResult, exprId: Semantic.ExprId): string {
    const expr = sr.exprNodes.get(exprId);

    switch (expr.variant) {
      case Semantic.ENode.BinaryExpr:
        return `(${serializeExpr(sr, expr.left)} ${BinaryOperationToString(
          expr.operation
        )} ${serializeExpr(sr, expr.left)})`;

      case Semantic.ENode.UnaryExpr:
        return `(${UnaryOperationToString(expr.operation)} ${serializeExpr(sr, expr.expr)})`;

      case Semantic.ENode.SizeofExpr:
        return `sizeof(${serializeExpr(sr, expr.valueExpr)})`;

      case Semantic.ENode.ExplicitCastExpr:
        return `(${serializeExpr(sr, expr.expr)} as ${serializeTypeUse(sr, expr.type)})`;

      case Semantic.ENode.ExprCallExpr:
        return `(${serializeExpr(sr, expr.calledExpr)}(${expr.arguments
          .map((a) => serializeExpr(sr, a))
          .join(", ")}))`;

      case Semantic.ENode.PostIncrExpr:
        return `((${serializeExpr(sr, expr.expr)})${IncrOperationToString(expr.operation)})`;

      case Semantic.ENode.PreIncrExpr:
        return `(${IncrOperationToString(expr.operation)}(${serializeExpr(sr, expr.expr)}))`;

      case Semantic.ENode.SymbolValueExpr: {
        const symbol = sr.symbolNodes.get(expr.symbol);
        if (symbol.variant === Semantic.ENode.VariableSymbol) {
          return symbol.name;
        } else if (symbol.variant === Semantic.ENode.FunctionSymbol) {
          const generic =
            symbol.generics.length > 0
              ? "<" + symbol.generics.map((g) => serializeTypeUse(sr, g)).join(", ") + ">"
              : "";
          return serializeFullSymbolName(sr, expr.symbol) + generic;
        }
        throw new InternalError("Symbol not supported: " + symbol.variant);
      }

      case Semantic.ENode.StructInstantiationExpr:
        return `${serializeTypeUse(sr, expr.type)} { ${expr.assign
          .map((a) => `${a.name}: ${serializeExpr(sr, a.value)}`)
          .join(", ")} }`;

      case Semantic.ENode.LiteralExpr: {
        return serializeLiteralValue(expr.literal);
      }

      case Semantic.ENode.MemberAccessExpr:
        return `(${serializeExpr(sr, expr.expr)}.${expr.memberName})`;

      case Semantic.ENode.CallableExpr:
        return `Callable(${serializeFullSymbolName(sr, expr.functionSymbol)}, this=${serializeExpr(
          sr,
          expr.thisExpr
        )})`;

      case Semantic.ENode.AddressOfExpr:
        return `&${serializeExpr(sr, expr.expr)}`;

      case Semantic.ENode.DereferenceExpr:
        return `*${serializeExpr(sr, expr.expr)}`;

      case Semantic.ENode.ExprAssignmentExpr:
        return `${serializeExpr(sr, expr.target)} = ${serializeExpr(sr, expr.value)}`;

      case Semantic.ENode.DatatypeAsValueExpr:
        return `${serializeTypeUse(sr, expr.type)}`;

      case Semantic.ENode.ArrayLiteralExpr:
        return `[${expr.values.map((v) => serializeExpr(sr, v)).join(", ")}]`;

      case Semantic.ENode.ArraySubscriptExpr: {
        const indices: string[] = [];
        for (const index of expr.indices) {
          indices.push(serializeExpr(sr, index));
        }
        return `${serializeExpr(sr, expr.expr)}[${indices.join(", ")}]`;
      }

      case Semantic.ENode.StringConstructExpr: {
        if (expr.value.variant === "data-length") {
          return `str(${serializeExpr(sr, expr.value.data)}, ${serializeExpr(
            sr,
            expr.value.length
          )})`;
        } else {
          assert(false);
        }
      }

      case Semantic.ENode.ArraySliceExpr: {
        const indices: string[] = [];
        for (const index of expr.indices) {
          if (index.start && index.end) {
            indices.push(serializeExpr(sr, index.start) + ":" + serializeExpr(sr, index.end));
          } else if (index.start) {
            indices.push(serializeExpr(sr, index.start));
          } else if (index.end) {
            indices.push(serializeExpr(sr, index.end));
          } else {
            assert(false);
          }
        }
        return `${serializeExpr(sr, expr.expr)}[${indices.join(", ")}]`;
      }

      default:
        assert(false, expr.variant.toString());
    }
  }
}

// const gray = "\x1b[90m";
// const reset = "\x1b[0m";

// const print = (str: string, indent = 0, color = reset) => {
//   console.info(color + " ".repeat(indent) + str + reset);
// };

// function printSymbol(sr: SemanticResult, symbolId: Semantic.SymbolId, indent: number) { const symbol = sr.symbolNodes.get(symbolId);
//   switch (symbol.variant) {
//     case Semantic.ENode.NamespaceDatatype:
//       print(`Namespace ${symbol.name} {`, indent);
//       for (const s of symbol.symbols) {
//         printSymbol(sr, s, indent + 2);
//       }
//       print(`}`, indent);
//       break;

//     case Semantic.ENode.VariableSymbol:
//       print(`Variable Symbol ${symbol.name};`, indent);
//       break;

//     case Semantic.ENode.FunctionSymbol:
//       if (symbol.scope) {
//         print(
//           `Function ${getParentNames(sr, symbolId)}: ${serializeDatatype(sr, symbol.type)} {`,
//           indent
//         );
//         printSymbol(sr, symbol.scope, indent + 2);
//         print(`}`, indent);
//       } else {
//         print(
//           `Function ${getParentNames(sr, symbolId)}: ${serializeDatatype(sr, symbol.type)};`,
//           indent
//         );
//       }
//       break;

//     case Semantic.ENode.PrimitiveDatatype:
//       print(`${serializeDatatype(sr, symbolId)}`, indent);
//       break;

//     case Semantic.ENode.StructDatatype: {
//       print(`Struct ${serializeDatatype(sr, symbolId)} {`, indent);
//       for (const memberId of symbol.members) {
//         const member = sr.nodes.get(memberId);
//         assert(member.variant === Semantic.ENode.VariableSymbol);
//         assert(member.type);
//         print(`${member.name}: ${serializeDatatype(sr, member.type)}`, indent + 2);
//       }
//       for (const method of symbol.methods) {
//         printSymbol(sr, method, indent + 2);
//       }
//       print(`}`, indent);
//       break;
//     }

//     case Semantic.ENode.InlineCStatement:
//       print(`InlineC "${symbol.value}"`, indent);
//       break;

//     case Semantic.ENode.ReturnStatement:
//       print(`Return ${symbol.expr ? serializeExpr(sr, symbol.expr) : ""}`, indent);
//       break;

//     case Semantic.ENode.VariableStatement: {
//       const variableSymbol = sr.nodes.get(symbol.variableSymbol);
//       assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);
//       assert(variableSymbol.type);
//       print(
//         `var ${symbol.name}: ${serializeDatatype(sr, variableSymbol.type)} ${
//           symbol.value ? "= " + serializeExpr(sr, symbol.value) : ""
//         }`,
//         indent
//       );
//       break;
//     }

//     case Semantic.ENode.IfStatement:
//       print(`If ${serializeExpr(sr, symbol.condition)}`, indent);
//       printSymbol(sr, symbol.then, indent + 2);
//       for (const elseif of symbol.elseIfs) {
//         print(`else if ${serializeExpr(sr, elseif.condition)}`, indent);
//         printSymbol(sr, elseif.then, indent + 2);
//       }
//       if (symbol.else) {
//         print(`else`, indent);
//         printSymbol(sr, symbol.else, indent + 2);
//       }
//       break;

//     case Semantic.ENode.WhileStatement:
//       print(`While ${serializeExpr(sr, symbol.condition)}`, indent);
//       printSymbol(sr, symbol.then, indent + 2);
//       break;

//     case Semantic.ENode.ExprStatement:
//       print(`Expr ${serializeExpr(sr, symbol.expr)};`, indent);
//       break;

//     case Semantic.ENode.BlockScope:
//       print("Block {", indent);
//       for (const sId of symbol.statements) {
//         printSymbol(sr, sId, indent + 2);
//       }
//       print("}", indent);
//       break;

//     case Semantic.ENode.BlockScopeStatement:
//       printSymbol(sr, symbol.block, indent + 2);
//       break;

//     default:
//       assert(false, "Unhandled case " + symbol.variant);
//   }
// }

// export function PrettyPrintAnalyzed(sr: SemanticResult) {
//   // printSymbol(sr.globalNamespace, 0);

//   print("");
//   print("Elaborated Structs:");
//   for (const symbol of sr.elaboratedStructDatatypes) {
//     print("");
//     printSymbol(sr, symbol.resultSymbol, 0);
//   }

//   print("Elaborated Functions:");
//   for (const symbol of sr.elaboratedFuncdefSymbols) {
//     print("");
//     printSymbol(sr, symbol.resultSymbol, 0);
//   }
//   print("\n");
// }
