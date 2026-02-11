import { HAZE_STDLIB_NAME, type ModuleCompiler } from "../Module";
import {
  BinaryOperationToString,
  EDatatypeMutability,
  EExternLanguage,
  IncrOperationToString,
  UnaryOperationToString,
  type EAssignmentOperation,
  type EBinaryOperation,
  type EIncrOperation,
  type EOverloadedOperator,
  type EUnaryOperation,
  type EVariableMutability,
} from "../shared/AST";
import {
  BrandedArray,
  EPrimitive,
  primitiveToString,
  type Brand,
  type EMethodType,
  type EVariableContext,
  type LiteralValue,
  type NameSet,
} from "../shared/common";
import { assert, CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import {
  Collect,
  printCollectedExpr,
  type CollectionContext,
} from "../SymbolCollection/SymbolCollection";
import { ConstraintSet } from "./Constraint";
import { SemanticElaborator } from "./Elaborate";
import { SemanticBuilder } from "./SemanticBuilder";

export namespace Semantic {
  export type SymbolId = Brand<number, "SemanticSymbol">;
  export type StatementId = Brand<number, "SemanticStatement">;
  export type ExprId = Brand<number, "SemanticExpr">;
  export type BlockScopeId = Brand<number, "SemanticBlockScope">;
  export type TypeDefId = Brand<number, "SemanticTypeDef">;
  export type TypeUseId = Brand<number, "SemanticTypeUse">;
  export type InstanceId = Brand<number, "SemanticInstance">;

  export enum ENode {
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
    DeferredFunctionDatatype,
    BlockScope,
    EnumDatatype,
    StructDatatype,
    CallableDatatype,
    ParameterPackDatatype,
    PrimitiveDatatype,
    GenericParameterDatatype,
    NamespaceDatatype,
    FixedArrayDatatype,
    DynamicArrayDatatype,
    SliceDatatype,
    UntaggedUnionDatatype,
    TaggedUnionDatatype,
    UnionTagRefDatatype,
    // Statements
    InlineCStatement,
    WhileStatement,
    IfStatement,
    ForStatement,
    ForEachStatement,
    VariableStatement,
    ExprStatement,
    BlockScopeExpr,
    ReturnStatement,
    RaiseStatement,
    // Expressions
    ParenthesisExpr,
    AttemptErrorPropagationExpr,
    BinaryExpr,
    LiteralExpr,
    UnaryExpr,
    TernaryExpr,
    ExprCallExpr,
    SymbolValueExpr,
    DatatypeAsValueExpr,
    UnionTagReferenceExpr,
    SizeofExpr,
    AlignofExpr,
    ExplicitCastExpr,
    AttemptExpr,
    ValueToUnionCastExpr,
    UnionToValueCastExpr,
    UnionToUnionCastExpr,
    UnionTagCheckExpr,
    MemberAccessExpr,
    CallableExpr,
    AddressOfExpr,
    DereferenceExpr,
    ExprAssignmentExpr,
    StructLiteralExpr,
    PreIncrExpr,
    PostIncrExpr,
    ArrayLiteralExpr,
    ArraySubscriptExpr,
    ArraySliceExpr,
    StringSubscriptExpr,
    StringConstructExpr,
    // Dummy
    Dummy,
  }

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
    requiresHoisting: boolean;
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
    originalFunction: Collect.SymbolId;
    genericPlaceholders: Semantic.TypeDefId[];
    name: string;
    extern: EExternLanguage;
    parentStructOrNS: TypeDefId | null;
    parameters: {
      name: string;
      type: TypeUseId;
    }[];
    returnType: Semantic.TypeUseId | null;
  };

  export type FunctionSymbol = {
    variant: ENode.FunctionSymbol;
    staticMethod: boolean;
    name: string;
    type: TypeDefId;
    noemit: boolean;
    generics: Semantic.ExprId[];
    parameterNames: string[];
    parameterPack: boolean;
    methodRequiredMutability: EDatatypeMutability.Const | EDatatypeMutability.Mut | null;
    extern: EExternLanguage;
    scope: Semantic.BlockScopeId | null;
    overloadedOperator?: EOverloadedOperator;
    export: boolean;
    envType: EnvBlockType;
    createsInstanceIds: Set<Semantic.InstanceId>;
    returnsInstanceIds: Set<Semantic.InstanceId>;
    returnStatements: Set<Semantic.StatementId>;
    isImpure: boolean;
    returnedDatatypes: Set<Semantic.TypeUseId>;
    instanceDepsSnapshot: InstanceDeps;
    annotatedReturnType: Semantic.TypeUseId | null;
    methodType: EMethodType;
    methodOf: TypeDefId | null;
    sourceloc: SourceLoc;
    parentStructOrNS: TypeDefId | null;
    originalCollectedFunction: Collect.SymbolId;
    concrete: boolean;
  };

  export type TypeDefSymbol = {
    variant: ENode.TypeDefSymbol;
    datatype: TypeDefId;
  };

  export type BlockScope = {
    variant: ENode.BlockScope;
    statements: StatementId[];
    emittedExpr: ExprId;
    sourceloc: SourceLoc;
  };

  export type FunctionRequireBlock = {
    final: boolean;
    pure: boolean;
    noreturn: boolean;
    noreturnIf: {
      expr: Collect.ExprId;
      argIndex: number | null;
      operation: "noreturn-if-truthy" | "noreturn-if-falsy" | null;
    } | null;
  };

  export type FunctionDatatypeDef = {
    variant: ENode.FunctionDatatype;
    parameters: {
      optional: boolean;
      type: TypeUseId;
    }[];
    returnType: TypeUseId;
    vararg: boolean;
    requires: FunctionRequireBlock;
    concrete: boolean;
  };

  export type DeferredFunctionDatatypeDef = {
    variant: ENode.DeferredFunctionDatatype;
    parameters: {
      optional: boolean;
      type: TypeUseId;
    }[];
    vararg: boolean;
    concrete: boolean;
  };

  export type EnumValue = {
    name: string;
    type: TypeUseId;
    valueExpr: ExprId; // This is the actual integer value, used for code generation (e.g. 0 or "red")
    literalExpr: ExprId; // This is the high level literal, used for further elaboration (e.g. Color.Red)
  };

  export type EnumDatatypeDef = {
    variant: ENode.EnumDatatype;
    name: string;
    noemit: boolean;
    export: boolean;
    unscoped: boolean;
    bitflag: boolean;
    extern: EExternLanguage;
    values: EnumValue[];
    parentStructOrNS: TypeDefId | null;
    sourceloc: SourceLoc;
    type: TypeUseId;
    concrete: boolean;
    originalCollectedSymbol: Collect.TypeDefId;
  };

  export type StructDatatypeDef = {
    variant: ENode.StructDatatype;
    name: string;
    noemit: boolean;
    generics: ExprId[];
    opaque: boolean;
    plain: boolean;
    inlineByDefault: boolean;
    export: boolean;
    extern: EExternLanguage;
    members: Semantic.SymbolId[];
    membersBuilt: boolean;
    membersFinalized: boolean;
    memberDefaultValues: {
      memberName: string;
      value: Semantic.ExprId;
    }[];
    methods: Semantic.SymbolId[];
    methodsInProgress: boolean;
    methodsFinalized: boolean;
    nestedStructs: Semantic.TypeDefId[];
    parentStructOrNS: TypeDefId | null;
    sourceloc: SourceLoc;
    concrete: boolean;
    originalCollectedDefinition: Collect.TypeDefId;
    originalCollectedSymbol: Collect.SymbolId;
  };

  export type ParameterPackDatatypeDef = {
    variant: ENode.ParameterPackDatatype;
    parameters: Semantic.SymbolId[] | null;
    concrete: boolean;
  };

  export type CallableDatatypeDef = {
    variant: ENode.CallableDatatype;
    functionType: TypeDefId;
    envType: EnvBlockType;
    concrete: boolean;
  };

  export type PrimitiveDatatypeDef = {
    variant: ENode.PrimitiveDatatype;
    primitive: EPrimitive;
    concrete: boolean;
  };

  export type FixedArrayDatatypeDef = {
    variant: ENode.FixedArrayDatatype;
    datatype: TypeUseId;
    length: bigint;
    concrete: boolean;
    syntheticFields: SymbolId[];
  };

  export type DynamicArrayDatatypeDef = {
    variant: ENode.DynamicArrayDatatype;
    datatype: TypeUseId;
    concrete: boolean;
    syntheticFields: SymbolId[];
  };

  export type SliceDatatypeDef = {
    variant: ENode.SliceDatatype;
    datatype: TypeUseId;
    concrete: boolean;
  };

  export type UntaggedUnionDatatypeDef = {
    variant: ENode.UntaggedUnionDatatype;
    members: TypeUseId[];
    concrete: boolean;
  };

  export type TaggedUnionDatatypeDef = {
    variant: ENode.TaggedUnionDatatype;
    members: {
      tag: string;
      type: TypeUseId;
    }[];
    nodiscard: boolean;
    concrete: boolean;
  };

  export type UnionTagRefDatatypeDef = {
    variant: ENode.UnionTagRefDatatype;
    concrete: boolean;
  };

  export type GenericParameterDatatypeDef = {
    variant: ENode.GenericParameterDatatype;
    name: string;
    collectedParameter: Collect.SymbolId;
    concrete: boolean;
  };

  export type NamespaceDatatypeDef = {
    variant: ENode.NamespaceDatatype;
    name: string;
    export: boolean;
    parentStructOrNS: TypeDefId | null;
    symbols: Semantic.SymbolId[];
    collectedNamespace: Collect.TypeDefId;
    concrete: boolean; // For consistency, always true
  };

  export type TypeDef =
    | GenericParameterDatatypeDef
    | NamespaceDatatypeDef
    | DeferredFunctionDatatypeDef
    | FunctionDatatypeDef
    | StructDatatypeDef
    | EnumDatatypeDef
    | FixedArrayDatatypeDef
    | DynamicArrayDatatypeDef
    | SliceDatatypeDef
    | ParameterPackDatatypeDef
    | UntaggedUnionDatatypeDef
    | TaggedUnionDatatypeDef
    | CallableDatatypeDef
    | PrimitiveDatatypeDef
    | UnionTagRefDatatypeDef;

  export type TypeUse = {
    type: TypeDefId;
    mutability: EDatatypeMutability;
    inline: boolean;
    sourceloc: SourceLoc;
  };

  export type Symbol =
    | CInjectDirectiveSymbol
    | VariableSymbol
    | GlobalVariableDefinitionSymbol
    | FunctionSignature
    | TypeDefSymbol
    | FunctionSymbol;

  export type BaseExpr = {
    type: TypeUseId;
    flow: FlowResult;
    writes: WriteResult;
    isTemporary: boolean;
    sourceloc: SourceLoc;
  };

  export type ExprMemberAccessExpr = BaseExpr & {
    variant: ENode.MemberAccessExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    memberName: string;
  };

  export type EnvBlockType =
    | {
        type: "method";
        thisExprType: TypeUseId;
      }
    | {
        type: "lambda";
        captures: {
          name: string;
          type: TypeUseId;
          capturedSymbol: SymbolId;
        }[];
      }
    | null;

  export type EnvBlockValue =
    | {
        type: "method";
        thisExpr: ExprId;
      }
    | {
        type: "lambda";
        captures: {
          variable: SymbolId;
          value: ExprId;
        }[];
      }
    | null;

  export type CallableExpr = BaseExpr & {
    variant: ENode.CallableExpr;
    instanceIds: InstanceId[];
    envType: EnvBlockType;
    envValue: EnvBlockValue;
    functionSymbol: SymbolId;
  };

  export type SymbolValueExpr = BaseExpr & {
    variant: ENode.SymbolValueExpr;
    instanceIds: InstanceId[];
    symbol: SymbolId;
  };

  export type DatatypeAsValueExpr = BaseExpr & {
    variant: ENode.DatatypeAsValueExpr;
    instanceIds: InstanceId[];
  };

  export type UnionTagReferenceExpr = BaseExpr & {
    variant: ENode.UnionTagReferenceExpr;
    instanceIds: InstanceId[];
    unionType: TypeDefId;
    tag: string;
  };

  export type SizeofExpr = BaseExpr & {
    variant: ENode.SizeofExpr;
    instanceIds: InstanceId[];
    valueExpr: ExprId;
  };

  export type AlignofExpr = BaseExpr & {
    variant: ENode.AlignofExpr;
    instanceIds: InstanceId[];
    valueExpr: ExprId;
  };

  export type ExprAssignmentExpr = BaseExpr & {
    variant: ENode.ExprAssignmentExpr;
    instanceIds: InstanceId[];
    value: ExprId;
    target: ExprId;
    operation: EAssignmentOperation;
  };

  export type DereferenceExpr = BaseExpr & {
    variant: ENode.DereferenceExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
  };

  export type AddressOfExpr = BaseExpr & {
    variant: ENode.AddressOfExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
  };

  export type ExplicitCastExpr = BaseExpr & {
    variant: ENode.ExplicitCastExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
  };

  export type AttemptExpr = BaseExpr & {
    variant: ENode.AttemptExpr;
    instanceIds: InstanceId[];
    attemptScopeExpr: ExprId;
    attemptScopeReturnsType: TypeUseId | null;
    elseScopeExpr: ExprId;
    elseScopeReturnsType: TypeUseId | null;
    errorTypesCaught: Set<TypeUseId>;
    errorLabel: string;
    resultLabel: string;
    errorResultVarname: string;
    errorUnionType: TypeUseId;
    uniqueId: bigint;
    hasErrorVar: boolean;
  };

  export type ValueToUnionCastExpr = BaseExpr & {
    variant: ENode.ValueToUnionCastExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    index: number;
  };

  export type UnionToValueCastExpr = BaseExpr & {
    variant: ENode.UnionToValueCastExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    canBeUnwrappedForLHS: boolean; // This is if the cast originates from a constrained symbol value access
    tag: number;
  };

  export type UnionToUnionCastExpr = BaseExpr & {
    variant: ENode.UnionToUnionCastExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    castComesFromNarrowingAndMayBeUnwrapped: boolean;
  };

  export type UnionTagCheckExpr = BaseExpr & {
    variant: ENode.UnionTagCheckExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    comparisonTypesAnd: TypeUseId[];
    invertCheck: boolean;
  };

  export type AttemptErrorPropagationExpr = BaseExpr & {
    variant: ENode.AttemptErrorPropagationExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    srcOkTagIndex: number;
    srcOkTagType: TypeUseId;
    srcErrTagIndex: number;
    srcErrTagType: TypeUseId;
    toAttemptExpr: ExprId;
  };

  export type BinaryExpr = BaseExpr & {
    variant: ENode.BinaryExpr;
    instanceIds: InstanceId[];
    left: ExprId;
    right: ExprId;
    operation: EBinaryOperation;
  };

  export type UnaryExpr = BaseExpr & {
    variant: ENode.UnaryExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    operation: EUnaryOperation;
  };

  export type PostIncrExpr = BaseExpr & {
    variant: ENode.PostIncrExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    operation: EIncrOperation;
  };

  export type PreIncrExpr = BaseExpr & {
    variant: ENode.PreIncrExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    operation: EIncrOperation;
  };

  export type TernaryExpr = BaseExpr & {
    variant: ENode.TernaryExpr;
    instanceIds: InstanceId[];
    condition: ExprId;
    then: ExprId;
    else: ExprId;
    thenProducesValue: boolean;
    elseProducesValue: boolean;
  };

  export type ExprCallExpr = BaseExpr & {
    variant: ENode.ExprCallExpr;
    instanceIds: InstanceId[];
    calledExpr: ExprId;
    arguments: ExprId[];
  };

  export type StructLiteralExpr = BaseExpr & {
    variant: ENode.StructLiteralExpr;
    instanceIds: InstanceId[];
    assign: {
      name: string;
      value: ExprId;
    }[];
    inFunction: SymbolId | null;
    allocator: ExprId | null;
  };

  export type LiteralExpr = BaseExpr & {
    variant: ENode.LiteralExpr;
    instanceIds: InstanceId[];
    literal: LiteralValue;
  };

  export type ArrayLiteralExpr = BaseExpr & {
    variant: ENode.ArrayLiteralExpr;
    instanceIds: InstanceId[];
    elements: ExprId[];
    inFunction: SymbolId | null;
    allocator: ExprId | null;
  };

  export type ArraySubscriptExpr = BaseExpr & {
    variant: ENode.ArraySubscriptExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    indices: ExprId[];
  };

  export type ArraySliceExpr = BaseExpr & {
    variant: ENode.ArraySliceExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    indices: {
      start: ExprId | null;
      end: ExprId | null;
    }[];
  };

  export type StringSubscriptExpr = BaseExpr & {
    variant: ENode.StringSubscriptExpr;
    instanceIds: InstanceId[];
    expr: ExprId;
    index: ExprId;
  };

  export type StringConstructExpr = BaseExpr & {
    variant: ENode.StringConstructExpr;
    instanceIds: InstanceId[];
    value: {
      variant: "data-length";
      data: ExprId;
      length: ExprId;
    };
  };

  export type BlockScopeExpr = BaseExpr & {
    variant: ENode.BlockScopeExpr;
    instanceIds: InstanceId[];
    block: BlockScopeId;
  };

  export type Expression =
    | ExprMemberAccessExpr
    | SymbolValueExpr
    | DatatypeAsValueExpr
    | UnionTagReferenceExpr
    | SizeofExpr
    | AlignofExpr
    | BlockScopeExpr
    | ExprAssignmentExpr
    | UnaryExpr
    | BinaryExpr
    | CallableExpr
    | PreIncrExpr
    | PostIncrExpr
    | AddressOfExpr
    | DereferenceExpr
    | ExplicitCastExpr
    | AttemptExpr
    | ValueToUnionCastExpr
    | StringSubscriptExpr
    | UnionToValueCastExpr
    | UnionToUnionCastExpr
    | UnionTagCheckExpr
    | AttemptErrorPropagationExpr
    | TernaryExpr
    | ExprCallExpr
    | StructLiteralExpr
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

  export type RaiseStatement = {
    variant: ENode.RaiseStatement;
    expr: ExprId;
    toAttemptExpr: ExprId;
    sourceloc: SourceLoc;
  };

  export type IfStatement = {
    variant: ENode.IfStatement;
    isLetBinding: boolean;
    condition: ExprId;
    then: BlockScopeId;
    elseIfs: {
      condition: ExprId;
      then: BlockScopeId;
    }[];
    else?: BlockScopeId;
    sourceloc: SourceLoc;
  };

  export type ForStatement = {
    variant: ENode.ForStatement;
    initStatement: StatementId | null;
    loopCondition: ExprId | null;
    loopIncrement: ExprId | null;
    body: BlockScopeId;
    sourceloc: SourceLoc;
  };

  export type ForEachStatement = {
    variant: ENode.ForEachStatement;
    arrayExpr: ExprId;
    loopVariable: SymbolId;
    indexVariable: SymbolId | null;
    body: BlockScopeId;
    sourceloc: SourceLoc;
  };

  export type WhileStatement = {
    variant: ENode.WhileStatement;
    isLetBinding: boolean;
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

  export type Statement =
    | InlineCStatement
    | ReturnStatement
    | RaiseStatement
    | VariableStatement
    | IfStatement
    | ForStatement
    | ForEachStatement
    | WhileStatement
    | ExprStatement;

  export type Inference =
    | undefined
    | {
        gonnaCallFunctionWithParameterValues?: {
          index: number;
          exprId: Semantic.ExprId | null;
        }[];
        gonnaInstantiateStructWithType?: Semantic.TypeUseId;
        unsafe?: boolean;
      };

  export type RegexData = {
    pattern: string;
    flags: Set<string>;
    id: bigint;
  };

  export type EnumDef = {
    substitutionContext: Semantic.ElaborationContext;
    parentStructOrNS: Semantic.TypeDefId | null;
    result: Semantic.TypeDefId;
    resultAsTypeDefSymbol: Semantic.SymbolId;
  };
  export type EnumDefCache = Map<Collect.TypeDefId, EnumDef[]>;

  export type StructDef = {
    canonicalizedGenerics: string[];
    substitutionContext: Semantic.ElaborationContext;
    parentStructOrNS: Semantic.TypeDefId | null;
    result: Semantic.TypeDefId;
    resultAsTypeDefSymbol: Semantic.SymbolId;
  };
  export type StructDefCache = Map<Collect.TypeDefId, StructDef[]>;

  export type FuncDef = {
    canonicalizedGenerics: string[];
    paramPackTypes: Semantic.TypeUseId[];
    substitutionContext: Semantic.ElaborationContext;
    result: Semantic.SymbolId;
    parentStructOrNS: Semantic.TypeDefId | null;
  };
  export type FuncDefCache = Map<Collect.SymbolId, FuncDef[]>;

  export type Context = {
    cc: CollectionContext;

    moduleCompiler: ModuleCompiler;

    e: SemanticElaborator; // "e" = "Elaborator"
    b: SemanticBuilder; // "b" = "Builder"

    nextInstanceId: Semantic.InstanceId;

    blockScopeNodes: BrandedArray<Semantic.BlockScopeId, Semantic.BlockScope>;
    symbolNodes: BrandedArray<Semantic.SymbolId, Semantic.Symbol>;
    exprNodes: BrandedArray<Semantic.ExprId, Semantic.Expression>;
    statementNodes: BrandedArray<Semantic.StatementId, Semantic.Statement>;
    typeDefNodes: BrandedArray<Semantic.TypeDefId, Semantic.TypeDef>;
    typeUseNodes: BrandedArray<Semantic.TypeUseId, Semantic.TypeUse>;

    overloadedOperators: Semantic.FunctionSymbol[];

    elaboratedFunctionSignatures: Map<Collect.SymbolId, Semantic.SymbolId[]>;
    elaboratedFunctionSignaturesByName: Map<string, Semantic.SymbolId[]>;

    elaboratedStructDatatypes: StructDefCache;
    elaboratedFuncdefSymbols: FuncDefCache;
    elaboratedUntaggedUnions: Map<string, Semantic.TypeDefId>;
    elaboratedTaggedUnions: Map<string, Semantic.TypeDefId>;
    elaboratedNamespaceSymbols: {
      originalSharedInstance: Collect.NSSharedInstanceId;
      substitutionContext: Semantic.ElaborationContext;
      result: Semantic.TypeDefId;
    }[];
    elaboratedEnumSymbols: EnumDefCache;

    // Those are GlobalVariableDefinitionSymbols
    elaboratedGlobalVariableDefinitionSymbols: Set<Semantic.SymbolId>;

    // Those are VariableSymbols
    elaboratedGlobalVariableSymbols: Map<Collect.SymbolId, Semantic.SymbolId>;
    // Function-local variable symbols are cached per function call because they are separate for each generic instance.

    elaboratedPrimitiveTypes: Semantic.TypeDefId[];
    functionTypeCache: Semantic.TypeDefId[];
    deferredFunctionTypeCache: Semantic.TypeDefId[];
    fixedArrayTypeCache: Semantic.TypeDefId[];
    dynamicArrayTypeCache: Semantic.TypeDefId[];
    typeInstanceCache: Semantic.TypeUseId[];

    syntheticFunctions: Map<string, Semantic.SymbolId>;

    syntheticScopeToVariableMap: Map<Collect.ScopeId, Map<string, Semantic.SymbolId>>;

    nextRegexId: bigint;
    elaboratedRegexInternMap: Map<string, bigint>; // This maps the pattern/flag key to the ID
    elaboratedRegexTable: Map<bigint, RegexData>; // This maps the regex ID to the actual data

    exportedCollectedSymbols: Set<number>;

    exportedSymbols: Set<Semantic.SymbolId>;
    exportedTypeAliases: Set<Collect.TypeDefId>;

    cInjections: Semantic.SymbolId[];
    globalMainFunction: Semantic.SymbolId | null;
  };

  export function canonicalizeGenericExpr(sr: Semantic.Context, exprId: Semantic.ExprId) {
    const expr = sr.exprNodes.get(exprId);
    if (expr.variant === Semantic.ENode.DatatypeAsValueExpr) {
      return expr.type.toString();
    } else if (expr.variant === Semantic.ENode.LiteralExpr) {
      if (expr.literal.type === EPrimitive.null) {
        return "null";
      } else if (expr.literal.type === EPrimitive.none) {
        return "none";
      } else if (expr.literal.type === EPrimitive.Regex) {
        return "Regex";
      } else if (expr.literal.type === "enum") {
        return expr.literal.enumType.toString() + "|" + expr.literal.valueName;
      } else {
        return primitiveToString(expr.literal.type) + "_" + expr.literal.value.toString();
      }
    } else {
      throw new CompilerError(
        `This expression is not suitable as a generic type argument or literal value`,
        expr.sourceloc,
      );
    }
  }

  export function tryLookupSymbol(
    sr: Semantic.Context,
    name: string,
    args: { startLookupInScope: Collect.ScopeId; sourceloc: SourceLoc; pubRequired?: boolean },
  ):
    | { type: "semantic"; id: Semantic.ExprId }
    | { type: "collect"; id: Collect.SymbolId; crossedLambdaScope: Collect.ScopeId | null }
    | undefined {
    const cc = sr.cc;
    const scope = cc.scopeNodes.get(args.startLookupInScope);

    if (sr.syntheticScopeToVariableMap.has(args.startLookupInScope)) {
      const map = sr.syntheticScopeToVariableMap.get(args.startLookupInScope)!;
      if (map.has(name)) {
        const symbolId = map.get(name)!;
        const symbol = sr.symbolNodes.get(symbolId);
        assert(symbol.variant === Semantic.ENode.VariableSymbol);
        assert(symbol.type);
        return {
          id: sr.b.symbolValue(symbolId, args.sourceloc)[1],
          type: "semantic",
        };
      }
    }

    const lookupDirect = (symbols: Set<Collect.SymbolId>) => {
      for (const id of symbols) {
        const s = cc.symbolNodes.get(id);
        if (s.variant === Collect.ENode.FunctionOverloadGroupSymbol && s.name === name) {
          if (
            [...s.overloads].some((o) => {
              const func = cc.symbolNodes.get(o);
              assert(func.variant === Collect.ENode.FunctionSymbol);
              return !args.pubRequired || func.pub;
            })
          ) {
            return id;
          }
        } else if (s.variant === Collect.ENode.TypeDefSymbol && s.name === name) {
          const typedef = sr.cc.typeDefNodes.get(s.typeDef);
          if (typedef.variant === Collect.ENode.StructTypeDef && typedef.name === name) {
            if (!args.pubRequired || typedef.pub) {
              return id;
            }
          } else if (typedef.variant === Collect.ENode.NamespaceTypeDef && typedef.name === name) {
            if (!args.pubRequired || typedef.pub) {
              // Caution: This lookup needs to return the actual namespace definition and NOT the shared instance.
              // Because the lookup must also resolve generics and to do that, it needs to know the correct scopes
              // and the parent scope stack must be valid, which is not the case with the shared instance as it has multiple.
              return id;
            }
          } else if (typedef.variant === Collect.ENode.TypeDefAlias && typedef.name === name) {
            return id;
          } else if (typedef.variant === Collect.ENode.EnumTypeDef && typedef.name === name) {
            return id;
          }
        } else if (s.variant === Collect.ENode.GenericTypeParameterSymbol && s.name === name) {
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
        const ns = cc.symbolNodes.get(scope.owningSymbol);
        assert(ns.variant === Collect.ENode.TypeDefSymbol);
        const nsTd = cc.typeDefNodes.get(ns.typeDef);
        assert(nsTd.variant === Collect.ENode.NamespaceTypeDef);
        const instance = cc.nsSharedInstances.get(nsTd.sharedInstance);
        assert(instance.variant === Collect.ENode.NamespaceSharedInstance);
        for (const nsScope of instance.namespaceScopes) {
          const sc = cc.scopeNodes.get(nsScope);
          assert(sc.variant === Collect.ENode.NamespaceScope);
          const found = lookupDirect(sc.symbols);
          if (found) {
            return {
              id: found,
              type: "collect",
              crossedLambdaScope: null,
            };
          }
        }
        return tryLookupSymbol(sr, name, {
          startLookupInScope: scope.parentScope,
          sourceloc: args.sourceloc,
        });
      }

      case Collect.ENode.LambdaScope:
      case Collect.ENode.ModuleScope:
      case Collect.ENode.UnitScope:
      case Collect.ENode.FileScope:
      case Collect.ENode.BlockScope:
      case Collect.ENode.TypeDefScope:
      case Collect.ENode.StructLexicalScope:
      case Collect.ENode.FunctionScope: {
        const found = lookupDirect(scope.symbols);
        if (found) {
          return {
            id: found,
            type: "collect",
            crossedLambdaScope: null, // Lambda scope doesn't have symbols
          };
        }

        if (scope.variant === Collect.ENode.ModuleScope) {
          return undefined;
        }

        if (scope.variant === Collect.ENode.FileScope) {
          // File Scope -> Don't go higher but look in adjacent files in the same unit, then go higher
          const unitScope = cc.scopeNodes.get(scope.parentScope);
          assert(unitScope.variant === Collect.ENode.UnitScope);

          for (const file of unitScope.scopes) {
            if (file === args.startLookupInScope) continue; // Prevent infinite recursion with itself

            const fileScope = cc.scopeNodes.get(file);
            assert(fileScope.variant === Collect.ENode.FileScope);

            const found = lookupDirect(fileScope.symbols);
            if (found) {
              return {
                id: found,
                type: "collect",
                crossedLambdaScope: null,
              };
            }
          }

          return tryLookupSymbol(sr, name, {
            startLookupInScope: scope.parentScope,
            sourceloc: args.sourceloc,
          });
        } else {
          // Not a file scope -> Can go higher
          const result = tryLookupSymbol(sr, name, {
            startLookupInScope: scope.parentScope,
            sourceloc: args.sourceloc,
          });

          if (scope.variant === Collect.ENode.LambdaScope && result?.type === "collect") {
            // Intentionally overwrite because it is written on exit of recursion and we want
            // the first match, which will be the last one to be applied
            result.crossedLambdaScope = args.startLookupInScope;
          }

          return result;
        }
      }

      default:
        assert(false, "Unknown scope type: " + (scope as any).variant);
    }
  }

  export function lookupSymbol(
    sr: Semantic.Context,
    name: string,
    args: { startLookupInScope: Collect.ScopeId; sourceloc: SourceLoc },
  ) {
    const found = tryLookupSymbol(sr, name, args);
    if (found) return found;
    throw new CompilerError(`Symbol '${name}' was not declared in this scope`, args.sourceloc);
  }

  export function findBuiltinSymbolByName(
    sr: Semantic.Context,
    symbolPath: string,
    sourceloc: SourceLoc,
  ): Collect.SymbolId {
    const names = symbolPath.split(".");

    let scope = sr.cc.moduleScopeId;
    let symbolId: Collect.SymbolId | undefined;

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const isLast = i === names.length - 1;

      const symbolResult = tryLookupSymbol(sr, name, {
        startLookupInScope: scope,
        sourceloc,
      });

      if (!symbolResult) {
        throw new InternalError(
          `Symbol '${symbolPath}' was expected to be defined but '${name}' could not be found`,
        );
      }

      if (symbolResult.type === "semantic") {
        throw new InternalError(`Symbol '${name}' resolved to a semantic expression, not a symbol`);
      }
      symbolId = symbolResult.id;

      const symbol = sr.cc.symbolNodes.get(symbolId);
      if (!isLast) {
        // Intermediate symbol must introduce a scope
        if (symbol.variant !== Collect.ENode.TypeDefSymbol) {
          throw new InternalError(
            `Symbol '${name}' of '${symbolPath}' was expected to be a namespace or struct, but it is not`,
          );
        }

        const symbolDef = sr.cc.typeDefNodes.get(symbol.typeDef);
        if (symbolDef.variant === Collect.ENode.StructTypeDef) {
          scope = symbolDef.lexicalScope;
        } else if (symbolDef.variant === Collect.ENode.NamespaceTypeDef) {
          scope = symbolDef.namespaceScope;
        } else {
          throw new InternalError(
            `Symbol '${name}' of '${symbolPath}' was expected to be a namespace or struct, but it is not`,
          );
        }
      }
    }

    assert(symbolId);
    return symbolId;
  }

  export function getInstanceDepsGraph(deps: InstanceDeps, instanceIds: Set<Semantic.InstanceId>) {
    const instances = new Set<Semantic.InstanceId>();

    const processInstance = (inst: Semantic.InstanceId) => {
      if (instances.has(inst)) {
        return;
      }

      instances.add(inst);
      getInstanceDeps(deps, inst).forEach((d) => {
        processInstance(d);
      });
      getAllStructMemberInstanceDeps(deps, inst).forEach((d) => {
        processInstance(d);
      });
    };

    instanceIds.forEach((d) => {
      processInstance(d);
    });
    return instances;
  }

  export function getSymbolDeps(deps: InstanceDeps, symbolId: Semantic.SymbolId) {
    let map = deps.symbolDependsOn.get(symbolId);
    if (!map) {
      return [];
    }

    return [...map];
  }

  export function addSymbolDeps(
    context: ElaborationContext,
    symbolId: Semantic.SymbolId,
    dependency: Semantic.InstanceId | Semantic.InstanceId[],
  ) {
    let map = context.instanceDeps.symbolDependsOn.get(symbolId);

    if (!map) {
      const set = new Set<Semantic.InstanceId>();
      context.instanceDeps.symbolDependsOn.set(symbolId, set);
      map = set;
    }

    if (Array.isArray(dependency)) {
      for (const d of dependency) {
        map.add(d);
      }
    } else {
      map.add(dependency);
    }
  }

  export function getInstanceDeps(deps: InstanceDeps, instanceId: Semantic.InstanceId) {
    let map = deps.instanceDependsOn.get(instanceId);
    if (!map) {
      return [];
    }

    return [...map];
  }

  export function addInstanceDeps(
    deps: InstanceDeps,
    instanceId: Semantic.InstanceId,
    dependency: Semantic.InstanceId | Semantic.InstanceId[],
  ) {
    let map = deps.instanceDependsOn.get(instanceId);

    if (!map) {
      const set = new Set<Semantic.InstanceId>();
      deps.instanceDependsOn.set(instanceId, set);
      map = set;
    }

    if (Array.isArray(dependency)) {
      for (const d of dependency) {
        map.add(d);
      }
    } else {
      map.add(dependency);
    }
  }

  export function getAllStructMemberInstanceDeps(
    deps: InstanceDeps,
    instanceId: Semantic.InstanceId,
  ) {
    let innerMap = deps.structMembersDependOn.get(instanceId);
    if (!innerMap) {
      return new Set<Semantic.InstanceId>();
    }

    const all = new Set<Semantic.InstanceId>();
    innerMap.forEach((e, k) => {
      e.forEach((i) => {
        all.add(i);
      });
    });
    return all;
  }

  export function getStructMemberInstanceDeps(
    deps: InstanceDeps,
    instanceId: Semantic.InstanceId,
    member: Semantic.SymbolId,
  ) {
    let innerMap = deps.structMembersDependOn.get(instanceId);
    if (!innerMap) {
      return new Set<Semantic.InstanceId>();
    }

    let set = innerMap.get(member);
    if (!set) {
      set = new Set<Semantic.InstanceId>();
      innerMap.set(member, set);
    }

    return [...set];
  }

  export function addStructMemberInstanceDeps(
    deps: InstanceDeps,
    instanceId: Semantic.InstanceId,
    member: Semantic.SymbolId,
    dependency: Semantic.InstanceId | Semantic.InstanceId[],
  ) {
    let innerMap = deps.structMembersDependOn.get(instanceId);
    if (!innerMap) {
      innerMap = new Map<Semantic.SymbolId, Set<Semantic.InstanceId>>();
      deps.structMembersDependOn.set(instanceId, innerMap);
    }

    let set = innerMap.get(member);
    if (!set) {
      set = new Set<Semantic.InstanceId>();
      innerMap.set(member, set);
    }

    if (Array.isArray(dependency)) {
      for (const d of dependency) {
        set.add(d);
      }
    } else {
      set.add(dependency);
    }
  }

  export type InstanceDeps = {
    instanceDependsOn: Map<Semantic.InstanceId, Set<Semantic.InstanceId>>;
    structMembersDependOn: Map<
      Semantic.InstanceId,
      Map<Semantic.SymbolId, Set<Semantic.InstanceId>>
    >;
    symbolDependsOn: Map<Semantic.SymbolId, Set<Semantic.InstanceId>>;
  };

  export type ElaborationContext = {
    substitute: Map<Collect.SymbolId, Semantic.ExprId>;
    currentScope: Collect.ScopeId; // This is the scope in which we are elaborating and it changes (e.g. A<i32> when elaborating A<i32>.B)
    genericsScope: Collect.ScopeId; // This is the scope for generics which does not change (e.g. A<i32>.B<u8> => i32 and u8 are elaborated in the same scope)
    constraints: ConstraintSet;
    instanceDeps: InstanceDeps;

    elaborationTypeOverride: Map<Collect.SymbolId, Semantic.TypeUseId>;
    elaboratedVariables: Map<Collect.SymbolId, Semantic.SymbolId>;
    elaboratedLambdaExprs: Map<Collect.ScopeId, Semantic.ExprId>;
    elaborationRecursiveStructStack: Semantic.TypeDefId[];
  };

  export function makeElaborationContext(args: {
    currentScope: Collect.ScopeId;
    genericsScope: Collect.ScopeId;
    constraints: ConstraintSet;
  }): ElaborationContext {
    return {
      substitute: new Map(),
      constraints: args.constraints,
      currentScope: args.currentScope,
      genericsScope: args.genericsScope,
      instanceDeps: {
        instanceDependsOn: new Map(),
        structMembersDependOn: new Map(),
        symbolDependsOn: new Map(),
      },
      elaboratedVariables: new Map(),
      elaboratedLambdaExprs: new Map(),
      elaborationTypeOverride: new Map(),
      elaborationRecursiveStructStack: [],
    };
  }

  export function isolateElaborationContext(
    parent: ElaborationContext,
    args: {
      currentScope: Collect.ScopeId;
      genericsScope: Collect.ScopeId;
      constraints: ConstraintSet;
      instanceDeps: InstanceDeps;
    },
  ): ElaborationContext {
    return {
      substitute: new Map(parent.substitute),
      constraints: args.constraints.clone(),
      currentScope: args.currentScope,
      genericsScope: args.genericsScope,
      instanceDeps: args.instanceDeps,

      elaboratedVariables: new Map(parent.elaboratedVariables),
      elaboratedLambdaExprs: new Map(parent.elaboratedLambdaExprs),
      elaborationTypeOverride: new Map(parent.elaborationTypeOverride),
      elaborationRecursiveStructStack: [...parent.elaborationRecursiveStructStack],
    };
  }

  export function mergeSubstitutionContext(
    a: ElaborationContext,
    b: ElaborationContext,
    args: {
      currentScope: Collect.ScopeId;
      genericsScope: Collect.ScopeId;
      instanceDeps: InstanceDeps;
    },
  ): ElaborationContext {
    // THE ORDER OF [a, b] IS VERY IMPORTANT, DO NOT MIX UP!!!
    const constraints = ConstraintSet.empty();
    constraints.addAll(a.constraints);
    constraints.addAll(b.constraints);
    return {
      substitute: new Map([...a.substitute, ...b.substitute]),
      constraints: constraints,
      currentScope: args.currentScope,
      genericsScope: args.genericsScope,
      instanceDeps: args.instanceDeps,
      elaboratedVariables: new Map([...a.elaboratedVariables, ...b.elaboratedVariables]),
      elaboratedLambdaExprs: new Map([...a.elaboratedLambdaExprs, ...b.elaboratedLambdaExprs]),
      elaborationTypeOverride: new Map([
        ...a.elaborationTypeOverride,
        ...b.elaborationTypeOverride,
      ]),
      elaborationRecursiveStructStack: [
        ...a.elaborationRecursiveStructStack,
        ...b.elaborationRecursiveStructStack,
      ],
    };
  }

  export function makeInstanceId(sr: Semantic.Context) {
    return sr.nextInstanceId++ as Semantic.InstanceId;
  }

  export function SemanticallyAnalyze(
    moduleCompiler: ModuleCompiler,
    cc: CollectionContext,
    isLibrary: boolean,
    moduleName: string,
    _moduleVersion: string,
  ) {
    const sr: Semantic.Context = {
      overloadedOperators: [],

      moduleCompiler: moduleCompiler,
      cc: cc,

      e: undefined as any,
      b: undefined as any,

      nextInstanceId: 1 as Semantic.InstanceId,

      elaboratedFunctionSignatures: new Map(),
      elaboratedFunctionSignaturesByName: new Map(),

      elaboratedStructDatatypes: new Map(),
      elaboratedFuncdefSymbols: new Map(),
      elaboratedUntaggedUnions: new Map(),
      elaboratedTaggedUnions: new Map(),
      elaboratedEnumSymbols: new Map(),
      elaboratedPrimitiveTypes: [],
      elaboratedNamespaceSymbols: [],
      elaboratedGlobalVariableDefinitionSymbols: new Set(),
      functionTypeCache: [],
      deferredFunctionTypeCache: [],
      fixedArrayTypeCache: [],
      dynamicArrayTypeCache: [],
      typeInstanceCache: [],

      syntheticFunctions: new Map(),

      blockScopeNodes: new BrandedArray<Semantic.BlockScopeId, Semantic.BlockScope>([]),
      symbolNodes: new BrandedArray<Semantic.SymbolId, Semantic.Symbol>([]),
      typeDefNodes: new BrandedArray<Semantic.TypeDefId, Semantic.TypeDef>([]),
      statementNodes: new BrandedArray<Semantic.StatementId, Semantic.Statement>([]),
      typeUseNodes: new BrandedArray<Semantic.TypeUseId, Semantic.TypeUse>([]),
      exprNodes: new BrandedArray<Semantic.ExprId, Semantic.Expression>([]),

      syntheticScopeToVariableMap: new Map(),

      exportedCollectedSymbols: new Set(),
      elaboratedGlobalVariableSymbols: new Map(),
      exportedTypeAliases: new Set(),

      elaboratedRegexInternMap: new Map(),
      elaboratedRegexTable: new Map(),
      nextRegexId: 0n,

      cInjections: [],
      globalMainFunction: null,

      exportedSymbols: new Set(),
    };

    const context = makeElaborationContext({
      currentScope: cc.moduleScopeId,
      genericsScope: cc.moduleScopeId,
      constraints: ConstraintSet.empty(),
    });

    sr.e = new SemanticElaborator(sr, context);
    sr.b = new SemanticBuilder(sr);

    sr.e.topLevelScope(cc.moduleScopeId);

    if (moduleName !== HAZE_STDLIB_NAME) {
      if (!isLibrary) {
        if (!sr.globalMainFunction) {
          throw new CompilerError("No main function is defined in global scope", null);
        }

        const mainFunctionSymbol = sr.symbolNodes.get(sr.globalMainFunction);
        assert(mainFunctionSymbol.variant === Semantic.ENode.FunctionSymbol);
        const mainFunctionType = sr.typeDefNodes.get(mainFunctionSymbol.type);
        assert(mainFunctionType.variant === Semantic.ENode.FunctionDatatype);
        const returnType = sr.typeDefNodes.get(
          sr.typeUseNodes.get(mainFunctionType.returnType).type,
        );
        if (
          returnType.variant !== Semantic.ENode.PrimitiveDatatype ||
          returnType.primitive !== EPrimitive.int
        ) {
          throw new CompilerError("Main function must return int", mainFunctionSymbol.sourceloc);
        }
      } else {
        if (sr.globalMainFunction) {
          throw new CompilerError(
            "main function is defined, but not allowed because module is built as library",
            null,
          );
        }
      }
    }

    return sr;
  }

  export function serializeMutability(typeUse: TypeUse) {
    let s = "";
    if (typeUse.inline) {
      s += "inline ";
    }

    if (typeUse.mutability === EDatatypeMutability.Const) {
      s += "const ";
    } else if (typeUse.mutability === EDatatypeMutability.Mut) {
      s += "mut ";
    }

    return s;
  }

  export function serializeTypeUse(sr: Semantic.Context, datatypeId: Semantic.TypeUseId): string {
    const datatype = sr.typeUseNodes.get(datatypeId);
    const names = getNamespaceChainFromDatatype(sr, datatype.type);
    return serializeMutability(datatype) + names.map((n) => n.pretty).join(".");
  }

  export function serializeLiteralType(sr: Semantic.Context, value: LiteralValue) {
    if (value.type === "enum") {
      const enumType = sr.typeDefNodes.get(value.enumType);
      assert(enumType.variant === Semantic.ENode.EnumDatatype && enumType.parentStructOrNS);
      const parent = Semantic.getNamespaceChainFromDatatype(sr, enumType.parentStructOrNS);
      return `${parent.map((p) => p.pretty).join(".")}.${value.valueName}`;
    } else {
      return primitiveToString(value.type);
    }
  }

  export function serializeLiteralValue(sr: Semantic.Context, value: LiteralValue) {
    if (value.type === EPrimitive.str) {
      return `${JSON.stringify(value.value)}`;
    } else if (value.type === EPrimitive.cstr || value.type === EPrimitive.ccstr) {
      return `${JSON.stringify(value.value)}`;
    } else if (value.type === EPrimitive.bool) {
      return `${value.value ? "true" : "false"}`;
    } else {
      if (value.type === EPrimitive.int || value.type === EPrimitive.real) {
        return `${value.value}`;
      } else if (value.type === EPrimitive.null) {
        return `null`;
      } else if (value.type === EPrimitive.Regex) {
        return `r"${value.pattern}"${[...value.flags].join("")}`;
      } else if (value.type === EPrimitive.none) {
        return `none`;
      } else if (value.type === "enum") {
        const parent = Semantic.getNamespaceChainFromDatatype(sr, value.enumType);
        const result = `${parent.map((p) => p.pretty).join(".")}.${value.valueName}`;
        return result;
      } else {
        return `(${value.value} as ${primitiveToString(value.type)})`;
      }
    }
  }

  export function getTypeDefChainFromDatatype(
    sr: Semantic.Context,
    typeId: Semantic.TypeDefId,
  ): Semantic.TypeDefId[] {
    const type = sr.typeDefNodes.get(typeId);

    if (
      type.variant !== Semantic.ENode.StructDatatype &&
      type.variant !== Semantic.ENode.EnumDatatype &&
      type.variant !== Semantic.ENode.NamespaceDatatype
    ) {
      return [typeId];
    }

    if (type.parentStructOrNS) {
      return [...getTypeDefChainFromDatatype(sr, type.parentStructOrNS), typeId];
    } else {
      return [typeId];
    }
  }

  export function getNamespaceChainFromDatatype(sr: Semantic.Context, typeId: Semantic.TypeDefId) {
    const type = sr.typeDefNodes.get(typeId);

    if (
      type.variant !== Semantic.ENode.StructDatatype &&
      type.variant !== Semantic.ENode.EnumDatatype &&
      type.variant !== Semantic.ENode.NamespaceDatatype
    ) {
      const mangle = mangleTypeDef(sr, typeId);
      return [
        {
          pretty: serializeTypeDef(sr, typeId),
          mangled: mangle.name,
          wasMangled: mangle.wasMangled,
          isMonomorphized: false,
          isExported: false,
        },
      ];
    }

    let current = {
      pretty: type.name,
      mangled: type.name.length + type.name,
      wasMangled: true,
      isMonomorphized: false,
      isExported: type.export,
    };
    if (type.variant === Semantic.ENode.StructDatatype && type.generics.length > 0) {
      current.isMonomorphized = true;
      current.pretty += `<${type.generics.map((g) => serializeExpr(sr, g)).join(", ")}>`;
      current.mangled += `I${type.generics
        .map((g) => {
          const expr = sr.exprNodes.get(g);
          if (expr.variant === Semantic.ENode.DatatypeAsValueExpr) {
            return mangleTypeUse(sr, expr.type).name;
          } else if (expr.variant === Semantic.ENode.LiteralExpr) {
            return mangleLiteralValue(sr, g).name;
          } else {
            assert(false);
          }
        })
        .join("")}E`;
    }

    let fragments = [current];
    if (type.parentStructOrNS) {
      fragments = [...getNamespaceChainFromDatatype(sr, type.parentStructOrNS), current];
    }
    return fragments;
  }

  export function getNamespaceChainFromSymbol(sr: Semantic.Context, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.VariableSymbol ||
        symbol.variant === Semantic.ENode.FunctionSignature ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol,
    );

    let current = {
      pretty: symbol.name,
      mangled: symbol.name.length + symbol.name,
      isMonomorphized: false,
      isExported: symbol.variant !== Semantic.ENode.FunctionSignature && symbol.export,
    };
    if (symbol.variant === Semantic.ENode.FunctionSymbol && symbol.generics.length > 0) {
      current.isMonomorphized = true;
      current.pretty += `<${symbol.generics.map((g) => serializeExpr(sr, g)).join(", ")}>`;
      current.mangled += `I${symbol.generics
        .map((g) => {
          const expr = sr.exprNodes.get(g);
          if (expr.variant === Semantic.ENode.DatatypeAsValueExpr) {
            return mangleTypeUse(sr, expr.type).name;
          } else if (expr.variant === Semantic.ENode.LiteralExpr) {
            return mangleLiteralValue(sr, g).name;
          } else {
            assert(false);
          }
        })
        .join("")}E`;
    }

    let fragments = [current];
    if (symbol.parentStructOrNS) {
      fragments = [...getNamespaceChainFromDatatype(sr, symbol.parentStructOrNS), current];
    }
    return fragments;
  }

  export function serializeTypeDef(
    sr: Semantic.Context,
    datatypeId: Semantic.TypeDefId,
    args?: { functionTypeAsCallable?: boolean },
  ): string {
    const datatype = sr.typeDefNodes.get(datatypeId);

    switch (datatype.variant) {
      case Semantic.ENode.PrimitiveDatatype:
        return primitiveToString(datatype.primitive);

      case Semantic.ENode.GenericParameterDatatype:
        return datatype.name;

      case Semantic.ENode.EnumDatatype:
      case Semantic.ENode.StructDatatype:
        if (datatype.extern === EExternLanguage.Extern_C) {
          return datatype.name;
        }
        return getNamespaceChainFromDatatype(sr, datatypeId)
          .map((n) => n.pretty)
          .join(".");

      case Semantic.ENode.FunctionDatatype: {
        let blocks = [] as string[];
        if (datatype.requires.final) {
          blocks.push("final");
        }
        if (datatype.requires.noreturn) {
          blocks.push("noreturn");
        }
        if (datatype.requires.pure) {
          blocks.push("pure");
        }
        if (datatype.requires.noreturnIf) {
          blocks.push(
            `noreturn_if(${printCollectedExpr(sr.cc, datatype.requires.noreturnIf.expr)})`,
          );
        }
        return `(${datatype.parameters
          .map((p, i) => `arg_${i}${p.optional ? "?" : ""}: ${serializeTypeUse(sr, p.type)}`)
          .join(
            ", ",
          )}${datatype.vararg ? ", ..." : ""}) ${args?.functionTypeAsCallable ? "=>" : "->"} (${serializeTypeUse(
          sr,
          datatype.returnType,
        )}) ${blocks.length > 0 ? ":: " + blocks.join(", ") : ""}`;
      }

      case Semantic.ENode.DeferredFunctionDatatype:
        return `(${datatype.parameters.map((p) => serializeTypeUse(sr, p.type)).join(", ")}${
          datatype.vararg ? ", ..." : ""
        }) :: deferred`;

      case Semantic.ENode.CallableDatatype:
        return `${serializeTypeDef(sr, datatype.functionType, { functionTypeAsCallable: true })}`;

      case Semantic.ENode.NamespaceDatatype:
        return getNamespaceChainFromDatatype(sr, datatypeId)
          .map((n) => n.pretty)
          .join(".");

      case Semantic.ENode.FixedArrayDatatype:
        return `[${datatype.length}]${serializeTypeUse(sr, datatype.datatype)}`;

      case Semantic.ENode.DynamicArrayDatatype:
        return `${serializeMutability(sr.typeUseNodes.get(datatype.datatype))}[]${serializeTypeUse(
          sr,
          datatype.datatype,
        )}`;

      case Semantic.ENode.UntaggedUnionDatatype: {
        return datatype.members.map((m) => serializeTypeUse(sr, m)).join(" | ");
      }

      case Semantic.ENode.TaggedUnionDatatype: {
        return (
          `${datatype.nodiscard ? "nodiscard " : ""}union { ` +
          datatype.members.map((m) => `${m.tag}: ${serializeTypeUse(sr, m.type)}`).join(", ") +
          " }"
        );
      }

      case Semantic.ENode.UnionTagRefDatatype: {
        return "<union-tag>";
      }

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

  export function isSymbolExported(sr: Semantic.Context, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.FunctionSignature ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol,
    );

    if (symbol.extern === EExternLanguage.Extern_C) {
      return false;
    }

    const names = getNamespaceChainFromSymbol(sr, symbolId);
    return names.some((n) => n.isExported) || ("export" in symbol && symbol.export);
  }

  export function isSymbolMonomorphized(sr: Semantic.Context, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.FunctionSignature ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol,
    );

    if (symbol.extern === EExternLanguage.Extern_C) {
      return false;
    }

    const names = getNamespaceChainFromSymbol(sr, symbolId);
    return names.some((n) => n.isMonomorphized);
  }

  export function serializeFullSymbolName(sr: Semantic.Context, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.FunctionSignature ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol,
    );

    if (symbol.extern === EExternLanguage.Extern_C) {
      return symbol.name;
    }

    const names = getNamespaceChainFromSymbol(sr, symbolId);
    return names.map((n) => n.pretty).join(".");
  }

  export function mangleFullTypeUse(sr: Semantic.Context, typeUseId: Semantic.TypeUseId) {
    const type = sr.typeUseNodes.get(typeUseId);

    const names = getNamespaceChainFromDatatype(sr, type.type);

    const use = mangleTypeUse(sr, typeUseId);
    return {
      name:
        use.name +
        names
          .slice(1)
          .map((n) => n.mangled)
          .join(""),
      wasMangled: use.wasMangled || names.slice(1).some((n) => n.wasMangled),
    };
  }

  export function mangleSymbol(sr: Semantic.Context, symbolId: Semantic.SymbolId) {
    const symbol = sr.symbolNodes.get(symbolId);
    assert(
      symbol.variant === Semantic.ENode.FunctionSymbol ||
        symbol.variant === Semantic.ENode.VariableSymbol ||
        symbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol,
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
      functionParameterPart += ftype.parameters.map((p) => mangleTypeUse(sr, p.type).name).join("");
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

  export function makeNameSetSymbol(sr: Semantic.Context, symbolId: Semantic.SymbolId): NameSet {
    const mangled = mangleSymbol(sr, symbolId);
    const pretty = serializeFullSymbolName(sr, symbolId);
    return {
      mangledName: mangled.name,
      prettyName: pretty,
      wasMangled: mangled.wasMangled,
    };
  }

  export function makeNameSetTypeDef(sr: Semantic.Context, typeDefId: Semantic.TypeDefId): NameSet {
    const mangled = mangleTypeDef(sr, typeDefId);
    const pretty = serializeTypeDef(sr, typeDefId);
    return {
      mangledName: mangled.name,
      prettyName: pretty,
      wasMangled: mangled.wasMangled,
    };
  }

  export function makeNameSetTypeUse(sr: Semantic.Context, typeUseId: Semantic.TypeUseId): NameSet {
    const mangled = mangleTypeUse(sr, typeUseId);
    const pretty = serializeTypeUse(sr, typeUseId);
    return {
      mangledName: mangled.name,
      prettyName: pretty,
      wasMangled: mangled.wasMangled,
    };
  }

  export function mangleTypeUse(sr: Semantic.Context, typeInstanceId: Semantic.TypeUseId) {
    const typeInstance = sr.typeUseNodes.get(typeInstanceId);

    const def = mangleTypeDef(sr, typeInstance.type);

    if (
      sr.typeDefNodes.get(typeInstance.type).variant === Semantic.ENode.StructDatatype ||
      sr.typeDefNodes.get(typeInstance.type).variant === Semantic.ENode.DynamicArrayDatatype
    ) {
      if (typeInstance.inline) {
        def.name = "i" + def.name;
      } else {
        def.name = "p" + def.name;
      }
      def.wasMangled = true;
    }

    if (sr.typeDefNodes.get(typeInstance.type).variant !== Semantic.ENode.ParameterPackDatatype) {
      if (typeInstance.mutability === EDatatypeMutability.Const) {
        def.name = "c" + def.name;
        def.wasMangled = true;
      } else if (typeInstance.mutability === EDatatypeMutability.Mut) {
        def.name = "m" + def.name;
        def.wasMangled = true;
      }
    }

    return def;
  }

  export function mangleTypeDef(
    sr: Semantic.Context,
    typeId: Semantic.TypeDefId,
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

      case Semantic.ENode.NamespaceDatatype: {
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
        if (type.primitive === EPrimitive.Regex) {
          return {
            name: "hzstd_regex_t",
            wasMangled: false,
          };
        } else {
          return {
            name: "hzstd_" + primitiveToString(type.primitive) + "_t",
            wasMangled: false,
          };
        }
      }

      case Semantic.ENode.FunctionDatatype: {
        let params = "";
        for (const p of type.parameters) {
          const ppt = sr.typeUseNodes.get(p.type);
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
            params += mangleTypeUse(sr, p.type).name;
          }
        }
        return {
          name: "F" + params + "E" + mangleTypeUse(sr, type.returnType).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.FixedArrayDatatype: {
        return {
          name: "A" + type.length + "_" + mangleTypeUse(sr, type.datatype).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.DynamicArrayDatatype: {
        return {
          name: "D" + mangleTypeUse(sr, type.datatype).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.SliceDatatype: {
        return {
          name: "S" + mangleTypeUse(sr, type.datatype).name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.UntaggedUnionDatatype: {
        return {
          name:
            "U" +
            type.members.length.toString() +
            "_" +
            type.members.map((m) => mangleTypeUse(sr, m).name).join("_"),
          wasMangled: true,
        };
      }

      case Semantic.ENode.TaggedUnionDatatype: {
        return {
          name:
            "T" +
            type.members.length.toString() +
            "_" +
            type.members.map((m) => `${m.tag}${mangleTypeUse(sr, m.type).name}`).join("_"),
          wasMangled: true,
        };
      }

      case Semantic.ENode.EnumDatatype: {
        if (type.extern === EExternLanguage.Extern_C) {
          return {
            name: type.name,
            wasMangled: false,
          };
        }
        return {
          name:
            (type.parentStructOrNS ? mangleTypeDef(sr, type.parentStructOrNS).name : "") +
            type.name.length +
            type.name,
          wasMangled: true,
        };
      }

      case Semantic.ENode.ParameterPackDatatype: {
        return {
          name:
            type.parameters
              ?.map((p) => {
                const sym = sr.symbolNodes.get(p);
                assert(sym.variant === Semantic.ENode.VariableSymbol && sym.type);
                return mangleTypeUse(sr, sym.type).name;
              })
              .join("") ?? "_",
          wasMangled: true,
        };
      }

      case Semantic.ENode.GenericParameterDatatype: {
        return {
          name: type.name.length + type.name,
          wasMangled: true,
        };
      }

      default:
        throw new InternalError("Unhandled variant: " + type.variant);
    }
  }

  export function mangleLiteralValue(sr: Semantic.Context, exprId: ExprId) {
    const expr = sr.exprNodes.get(exprId);
    assert(expr.variant === Semantic.ENode.LiteralExpr);
    const literal = expr.literal;
    const literalType = literal.type;
    if (literalType === EPrimitive.bool) {
      return {
        name: `Lb${literal.value ? "1" : "0"}E`,
        wasMangled: true,
      };
    } else if (
      literalType === EPrimitive.str ||
      literalType === EPrimitive.cstr ||
      literalType === EPrimitive.ccstr
    ) {
      const utf8 = new TextEncoder().encode(literal.value);
      let base64 = btoa(String.fromCharCode(...utf8));
      // make it C-identifier-safe: base64 → base64url (replace +/ with _)
      base64 = base64.replace(/\+/g, "_").replace(/\//g, "_").replace(/=+$/, "");
      return {
        name: `Ls${base64}E`,
        wasMangled: true,
      };
    } else if (literalType === EPrimitive.null) {
      return {
        name: "4null",
        wasMangled: true,
      };
    } else if (literalType === EPrimitive.none) {
      return {
        name: "4none",
        wasMangled: true,
      };
    } else if (literalType === EPrimitive.Regex) {
      return {
        name: "5Regex",
        wasMangled: true,
      };
    } else if (literalType === "enum") {
      const enumType = sr.typeDefNodes.get(literal.enumType);
      assert(enumType.variant === Semantic.ENode.EnumDatatype && enumType.parentStructOrNS);
      const parent = mangleTypeDef(sr, enumType.parentStructOrNS);
      if (parent.wasMangled) {
        return {
          name: parent.name + literal.valueName.length + literal.valueName,
          wasMangled: true,
        };
      } else {
        return {
          name: literal.valueName,
          wasMangled: false,
        };
      }
    } else {
      if (Number.isInteger(literalType)) {
        assert(typeof literal.value === "bigint");
        return {
          name: literal.value < 0 ? `Lin${-literal.value}E` : `Li${literal.value}E`,
          wasMangled: true,
        };
      } else {
        const repr = literal.value.toString().replace("-", "n").replace(".", "_");
        return {
          name: `Lf${repr}E`,
          wasMangled: true,
        };
      }
    }
  }

  export function serializeExpr(sr: Semantic.Context, exprId: Semantic.ExprId): string {
    const expr = sr.exprNodes.get(exprId);

    switch (expr.variant) {
      case Semantic.ENode.BinaryExpr:
        return `(${serializeExpr(sr, expr.left)} ${BinaryOperationToString(
          expr.operation,
        )} ${serializeExpr(sr, expr.right)})`;

      case Semantic.ENode.ValueToUnionCastExpr: {
        return `(${serializeExpr(sr, expr.expr)} as (${serializeTypeUse(sr, expr.type)}))`;
      }

      case Semantic.ENode.UnionToValueCastExpr: {
        return `(${serializeExpr(sr, expr.expr)} as tag ${expr.tag})`;
      }

      case Semantic.ENode.UnionTagCheckExpr: {
        return `(${serializeExpr(sr, expr.expr)} tag check TBD...)`;
      }

      case Semantic.ENode.UnionToUnionCastExpr: {
        return `(${serializeExpr(sr, expr.expr)} as (${serializeTypeUse(sr, expr.type)}))`;
      }

      case Semantic.ENode.UnaryExpr:
        return `(${UnaryOperationToString(expr.operation)} ${serializeExpr(sr, expr.expr)})`;

      case Semantic.ENode.SizeofExpr:
        return `sizeof(${serializeExpr(sr, expr.valueExpr)})`;

      case Semantic.ENode.AlignofExpr:
        return `alignof(${serializeExpr(sr, expr.valueExpr)})`;

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
              ? "<" + symbol.generics.map((g) => serializeExpr(sr, g)).join(", ") + ">"
              : "";
          return serializeFullSymbolName(sr, expr.symbol) + generic;
        }
        throw new InternalError("Symbol not supported: " + symbol.variant);
      }

      case Semantic.ENode.StructLiteralExpr: {
        const typeUse = sr.typeUseNodes.get(expr.type);
        const baseName = getNamespaceChainFromDatatype(sr, typeUse.type)
          .map((n) => n.pretty)
          .join(".");
        const literal = `${baseName} { ${expr.assign
          .map((a) => `${a.name}: ${serializeExpr(sr, a.value)}`)
          .join(", ")} }`;
        if (typeUse.inline || typeUse.mutability !== EDatatypeMutability.Default) {
          return `(${literal}) as ${serializeTypeUse(sr, expr.type)}`;
        }
        return literal;
      }

      case Semantic.ENode.LiteralExpr: {
        return serializeLiteralValue(sr, expr.literal);
      }

      case Semantic.ENode.MemberAccessExpr:
        return `(${serializeExpr(sr, expr.expr)}.${expr.memberName})`;

      case Semantic.ENode.CallableExpr: {
        const parts = [] as string[];
        parts.push(serializeFullSymbolName(sr, expr.functionSymbol));
        return `Callable(${parts.join(", ")})`;
      }

      case Semantic.ENode.BlockScopeExpr: {
        return `do { ... }`;
      }

      case Semantic.ENode.AddressOfExpr:
        return `&${serializeExpr(sr, expr.expr)}`;

      case Semantic.ENode.DereferenceExpr:
        return `*${serializeExpr(sr, expr.expr)}`;

      case Semantic.ENode.ExprAssignmentExpr:
        return `${serializeExpr(sr, expr.target)} = ${serializeExpr(sr, expr.value)}`;

      case Semantic.ENode.DatatypeAsValueExpr:
        return `${serializeTypeUse(sr, expr.type)}`;

      case Semantic.ENode.ArrayLiteralExpr: {
        return `([${expr.elements
          .map((v) => serializeExpr(sr, v))
          .join(", ")}]) as ${Semantic.serializeTypeUse(sr, expr.type)}`;
      }

      case Semantic.ENode.ArraySubscriptExpr: {
        const indices: string[] = [];
        for (const index of expr.indices) {
          indices.push(serializeExpr(sr, index));
        }
        return `${serializeExpr(sr, expr.expr)}[${indices.join(", ")}]`;
      }

      case Semantic.ENode.StringSubscriptExpr: {
        const indices: string[] = [];
        indices.push(serializeExpr(sr, expr.index));
        return `${serializeExpr(sr, expr.expr)}[${indices.join(", ")}]`;
      }

      case Semantic.ENode.StringConstructExpr: {
        if (expr.value.variant === "data-length") {
          return `str(${serializeExpr(sr, expr.value.data)}, ${serializeExpr(
            sr,
            expr.value.length,
          )})`;
        } else {
          assert(false);
        }
      }

      case Semantic.ENode.AttemptExpr: {
        return `attempt {...} else {...}`;
      }

      case Semantic.ENode.UnionTagReferenceExpr: {
        return `${Semantic.serializeTypeDef(sr, expr.unionType)}.${expr.tag}`;
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
        assert(false, Semantic.ENode[expr.variant]);
    }
  }

  export enum FlowType {
    NoReturn, // Control never comes back: Program terminates or infinite loop
    Return, // Control exits the current context and returns from the containing function
    Raise, // Control exits the current context and jumps to the nearest attempt/else construct
    Fallthrough, // Control continues normally
  }

  export class FlowResult {
    private set = new Set<FlowType>();

    private constructor() {}

    static empty() {
      return new FlowResult();
    }

    static fallthrough() {
      const result = new FlowResult();
      result.add(FlowType.Fallthrough);
      return result;
    }

    static return() {
      const result = new FlowResult();
      result.add(FlowType.Return);
      return result;
    }

    clone() {
      const result = new FlowResult();
      result.addAll(this);
      return result;
    }

    get() {
      return this.set;
    }

    has(type: FlowType) {
      return this.set.has(type);
    }

    add(type: FlowType) {
      this.set.add(type);
    }

    remove(type: FlowType) {
      this.set.delete(type);
    }

    addAll(result: FlowResult) {
      for (const a of result.set) {
        this.set.add(a);
      }
    }

    with(type: FlowType) {
      const result = this.clone();
      result.add(type);
      return result;
    }

    withAll(r: FlowResult) {
      const result = this.clone();
      result.addAll(r);
      return result;
    }

    addExitFlows(src: FlowResult) {
      for (const f of src.get()) {
        if (f !== FlowType.Fallthrough) {
          this.add(f);
        }
      }
    }
  }

  export class WriteResult {
    private set = new Set<Semantic.SymbolId>();

    private constructor() {}

    static empty() {
      return new WriteResult();
    }

    clone() {
      const result = new WriteResult();
      result.addAll(this);
      return result;
    }

    get() {
      return this.set;
    }

    add(type: Semantic.SymbolId) {
      this.set.add(type);
    }

    has(id: Semantic.SymbolId) {
      return this.set.has(id);
    }

    addAll(result: WriteResult) {
      for (const a of result.set) {
        this.set.add(a);
      }
    }

    with(type: Semantic.SymbolId) {
      const result = this.clone();
      result.add(type);
      return result;
    }

    withAll(r: WriteResult) {
      const result = this.clone();
      result.addAll(r);
      return result;
    }
  }
}
