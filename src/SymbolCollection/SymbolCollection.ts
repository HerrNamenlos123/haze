import {
  assert,
  CompilerError,
  formatSourceLoc,
  InternalError,
  type SourceLoc,
} from "../shared/Errors";
import { readFileSync } from "fs";
import {
  EExternLanguage,
  type ASTBinaryExpr,
  type ASTTypeUse,
  type ASTExplicitCastExpr,
  type ASTExprAsFuncbody,
  type ASTExprAssignmentExpr,
  type ASTExprCallExpr,
  type ASTExprMemberAccess,
  type ASTFunctionDefinition,
  type ASTGlobalVariableDefinition,
  type ASTLambdaExpr,
  type ASTNamespaceDefinition,
  type ASTParenthesisExpr,
  type ASTPostIncrExpr,
  type ASTPreIncrExpr,
  type ASTRoot,
  type ASTScope,
  type ASTStructDefinition,
  type ASTStructInstantiationExpr,
  type ASTSymbolValueExpr,
  type ASTUnaryExpr,
  BinaryOperationToString,
  UnaryOperationToString,
  type ASTLiteralExpr,
  type ASTStructMemberDefinition,
  type ASTModuleImport,
  type ASTSymbolImport,
  type ASTSymbolDefinition,
  AssignmentOperationToString,
  IncrOperationToString,
  EVariableMutability,
  type ASTBlockScopeExpr,
  type ASTTypeDef,
  type ASTTypeAlias,
  EOverloadedOperator,
  type ASTExprIsTypeExpr,
} from "../shared/AST";
import {
  BrandedArray,
  EMethodType,
  EPrimitive,
  EVariableContext,
  primitiveToString,
  type Brand,
  type LiteralValue,
} from "../shared/common";

import {
  EDatatypeMutability,
  EUnaryOperation,
  type ASTCInjectDirective,
  type ASTExpr,
  type ASTStatement,
  type EAssignmentOperation,
  type EBinaryOperation,
  type EIncrOperation,
} from "../shared/AST";
import { getModuleGlobalNamespaceName, type ExportData, type ModuleConfig } from "../shared/Config";
import { join } from "path";
import { Semantic } from "../Semantic/Elaborate";

export type CollectionContext = {
  config: ModuleConfig;
  moduleScopeId: Collect.ScopeId;

  exprNodes: BrandedArray<Collect.ExprId, Collect.Expressions>;
  symbolNodes: BrandedArray<Collect.SymbolId, Collect.Symbols>;
  typeUseNodes: BrandedArray<Collect.TypeUseId, Collect.TypeUse>;
  typeDefNodes: BrandedArray<Collect.TypeDefId, Collect.TypeDef>;
  nsSharedInstances: BrandedArray<Collect.NSSharedInstanceId, Collect.NamespaceSharedInstance>;
  statementNodes: BrandedArray<Collect.StatementId, Collect.Statements>;
  scopeNodes: BrandedArray<Collect.ScopeId, Collect.Scope>;

  // Helper utilities
  overloadGroups: Set<Collect.SymbolId>;
  blockScopes: Set<Collect.ScopeId>;
  elaboratedNamespacesAndStructs: Set<Collect.TypeDefId>;

  exportedSymbols: ExportData;
};

export function funcSymHasParameterPack(cc: CollectionContext, id: Collect.SymbolId) {
  const funcsym = cc.symbolNodes.get(id);
  assert(funcsym.variant === Collect.ENode.FunctionSymbol);
  return funcsym.parameters.some((p) => {
    const pp = cc.typeUseNodes.get(p.type);
    return pp.variant === Collect.ENode.ParameterPack;
  });
}

export function makeCollectionContext(config: ModuleConfig): CollectionContext {
  const cc: CollectionContext = {
    config: config,
    moduleScopeId: -1 as Collect.ScopeId,

    exprNodes: new BrandedArray([]),
    typeUseNodes: new BrandedArray([]),
    typeDefNodes: new BrandedArray([]),
    nsSharedInstances: new BrandedArray([]),
    scopeNodes: new BrandedArray([]),
    symbolNodes: new BrandedArray([]),
    statementNodes: new BrandedArray([]),

    blockScopes: new Set(),
    overloadGroups: new Set(),
    exportedSymbols: {
      exported: new Set(),
    },
    elaboratedNamespacesAndStructs: new Set(),
  };
  const [scope, moduleScopeId] = Collect.makeScope(cc, {
    variant: Collect.ENode.ModuleScope,
    scopes: new Set(),
    symbols: new Set(),
  });
  cc.moduleScopeId = moduleScopeId;
  return cc;
}

export namespace Collect {
  export type ExprId = Brand<number, "CollectExpr">;
  export type SymbolId = Brand<number, "CollectSymbol">;
  export type TypeDefId = Brand<number, "CollectTypeDef">;
  export type TypeUseId = Brand<number, "CollectTypeUse">;
  export type NSSharedInstanceId = Brand<number, "CollectNSSharedInstance">;
  export type StatementId = Brand<number, "CollectStatement">;
  export type ScopeId = Brand<number, "CollectScope">;

  export enum ENode {
    ModuleScope,
    UnitScope,
    FileScope,
    ExportScope,
    FunctionScope,
    StructScope,
    TypeAliasScope,
    NamespaceScope,
    BlockScope,
    FunctionOverloadGroupSymbol,
    FunctionSymbol,
    VariableSymbol,
    TypeDefSymbol,
    TypeDefAlias,
    NamedDatatype,
    StackArrayDatatype,
    DynamicArrayDatatype,
    UntaggedUnionDatatype,
    TaggedUnionDatatype,
    ParameterPack,
    StructTypeDef,
    NamespaceSharedInstance,
    NamespaceTypeDef,
    GenericTypeParameterSymbol,
    CInjectDirective,
    ExprStatement,
    IfStatement,
    ForEachStatement,
    WhileStatement,
    ReturnStatement,
    InlineCStatement,
    BlockScopeExpr,
    VariableDefinitionStatement,
    FunctionDatatype,
    ParenthesisExpr,
    TryExpr,
    UnsafeExpr,
    BinaryExpr,
    LiteralExpr,
    FStringExpr,
    UnaryExpr,
    ExprCallExpr,
    SymbolValueExpr,
    ExplicitCastExpr,
    ExprIsTypeExpr,
    MemberAccessExpr,
    ExprAssignmentExpr,
    StructInstantiationExpr,
    PreIncrExpr,
    PostIncrExpr,
    ArraySubscriptExpr,
    ArraySliceExpr,
    ArrayLiteralExpr,
    TypeLiteralExpr,
    // Specials
    ModuleImport,
    SymbolImport,
  }

  /// ===============================================================
  /// ===                         Scopes                          ===
  /// ===============================================================

  export type ModuleScope = {
    variant: ENode.ModuleScope;
    symbols: Set<Collect.SymbolId>;
    scopes: Set<Collect.ScopeId>;
  };

  export type UnitScope = {
    variant: ENode.UnitScope;
    parentScope: Collect.ScopeId;
    symbols: Set<Collect.SymbolId>;
    scopes: Set<Collect.ScopeId>;
  };

  export type FileScope = {
    variant: ENode.FileScope;
    filepath: string;
    parentScope: Collect.ScopeId;
    symbols: Set<Collect.SymbolId>;
  };

  export type FunctionScope = {
    variant: ENode.FunctionScope;
    parentScope: Collect.ScopeId;
    owningSymbol: Collect.SymbolId;
    sourceloc: SourceLoc;
    blockScope: Collect.ScopeId;
    symbols: Set<Collect.SymbolId>;
  };

  export type StructScope = {
    variant: ENode.StructScope;
    parentScope: Collect.ScopeId;
    owningSymbol: Collect.SymbolId;
    sourceloc: SourceLoc;
    symbols: Set<Collect.SymbolId>;
  };

  export type TypeAliasScope = {
    variant: ENode.TypeAliasScope;
    parentScope: Collect.ScopeId;
    owningSymbol: Collect.SymbolId;
    sourceloc: SourceLoc;
    symbols: Set<Collect.SymbolId>;
  };

  export type NamespaceScope = {
    variant: ENode.NamespaceScope;
    parentScope: Collect.ScopeId;
    owningSymbol: Collect.SymbolId;
    sourceloc: SourceLoc;
    symbols: Set<Collect.SymbolId>;
  };

  export type BlockScope = {
    variant: ENode.BlockScope;
    parentScope: Collect.ScopeId;
    owningSymbol: Collect.SymbolId;
    sourceloc: SourceLoc;
    statements: Set<Collect.StatementId>;
    unsafe: boolean;
    emittedExpr: Collect.ExprId | null;
    symbols: Set<Collect.SymbolId>;
  };

  export type Scope =
    | ModuleScope
    | UnitScope
    | FileScope
    | FunctionScope
    | StructScope
    | NamespaceScope
    | TypeAliasScope
    | BlockScope;

  /// ===============================================================
  /// ===                          Symbols                        ===
  /// ===============================================================

  export type ParameterValue = {
    name: string;
    type: Collect.TypeUseId;
    optional: boolean;
    sourceloc: SourceLoc;
  };

  export type FunctionSymbol = {
    variant: ENode.FunctionSymbol;
    parentScope: Collect.ScopeId;
    staticMethod: boolean;
    overloadGroup: Collect.SymbolId;
    overloadedOperator?: EOverloadedOperator;
    generics: Collect.SymbolId[];
    name: string;
    requires: FunctionRequiresBlock;
    returnType: Collect.TypeUseId | null;
    parameters: ParameterValue[];
    vararg: boolean;
    export: boolean;
    pub: boolean;
    noemit: boolean;
    methodType: EMethodType;
    extern: EExternLanguage;
    sourceloc: SourceLoc;
    functionScope: Collect.ScopeId | null;
    originalSourcecode: string;
  };

  export type VariableSymbol = {
    variant: ENode.VariableSymbol;
    name: string;
    comptime: boolean;
    globalValueInitializer: Collect.ExprId | null;
    inScope: Collect.ScopeId;
    type: Collect.TypeUseId | null;
    mutability: EVariableMutability;
    variableContext: EVariableContext;
    sourceloc: SourceLoc;
  };

  export type TypeDefSymbol = {
    variant: ENode.TypeDefSymbol;
    name: string;
    inScope: Collect.ScopeId;
    typeDef: Collect.TypeDefId;
  };

  export type FunctionOverloadGroupSymbol = {
    variant: ENode.FunctionOverloadGroupSymbol;
    parentScope: Collect.ScopeId;
    name: string;
    overloadedOperator?: EOverloadedOperator;
    overloads: Set<Collect.SymbolId>;
  };

  export type CInjectDirective = {
    variant: ENode.CInjectDirective;
    value: string;
    export: boolean;
    sourceloc: SourceLoc;
  };

  export type GenericTypeParameterSymbol = {
    variant: ENode.GenericTypeParameterSymbol;
    name: string;
    owningSymbol: Collect.SymbolId;
    sourceloc: SourceLoc;
  };

  export type Symbols =
    | FunctionSymbol
    | VariableSymbol
    | TypeDefSymbol
    | FunctionOverloadGroupSymbol
    | GenericTypeParameterSymbol
    | CInjectDirective;

  export type TypeDefAlias = {
    variant: ENode.TypeDefAlias;
    name: string;
    inScope: Collect.ScopeId;
    generics: Collect.SymbolId[];
    genericScope: Collect.ScopeId;
    target: Collect.TypeUseId;
    sourceloc: SourceLoc;
  };

  export type StructTypeDef = {
    variant: ENode.StructTypeDef;
    fullyQualifiedName: string;
    parentScope: Collect.ScopeId;
    generics: Collect.SymbolId[];
    defaultMemberValues: {
      name: string;
      value: Collect.ExprId;
    }[];
    name: string;
    export: boolean;
    pub: boolean;
    extern: EExternLanguage;
    noemit: boolean;
    sourceloc: SourceLoc;
    structScope: Collect.ScopeId;
    originalSourcecode: string;
  };

  export type NamespaceTypeDef = {
    variant: ENode.NamespaceTypeDef;
    parentScope: Collect.ScopeId;
    fullyQualifiedName: string;
    name: string;
    extern: EExternLanguage;
    pub: boolean;
    export: boolean;
    sharedInstance: Collect.NSSharedInstanceId;
    sourceloc: SourceLoc;
    namespaceScope: Collect.ScopeId;
  };

  export type TypeDef = TypeDefAlias | StructTypeDef | NamespaceTypeDef;

  export type NamespaceSharedInstance = {
    variant: ENode.NamespaceSharedInstance;
    fullyQualifiedName: string;
    namespaceScopes: Set<Collect.ScopeId>;
  };

  /// ===============================================================
  /// ===                       Type Symbols                      ===
  /// ===============================================================

  export type NamedDatatype = {
    variant: ENode.NamedDatatype;
    name: string;
    inline: boolean;
    innerNested: Collect.TypeUseId | null;
    genericArgs: Collect.ExprId[];
    mutability: EDatatypeMutability;
    sourceloc: SourceLoc;
  };

  export type FunctionRequiresBlock = {
    autodest: boolean;
    final: boolean;
    noreturn: boolean;
  };

  export type FunctionDatatype = {
    variant: ENode.FunctionDatatype;
    parameters: Collect.TypeUseId[];
    returnType: Collect.TypeUseId;
    vararg: boolean;
    requires: FunctionRequiresBlock;
    mutability: EDatatypeMutability;
    sourceloc: SourceLoc;
  };

  export type StackArrayDatatype = {
    variant: ENode.StackArrayDatatype;
    datatype: Collect.TypeUseId;
    length: number;
    inline: boolean;
    mutability: EDatatypeMutability;
    sourceloc: SourceLoc;
  };

  export type DynamicArrayDatatype = {
    variant: ENode.DynamicArrayDatatype;
    datatype: Collect.TypeUseId;
    mutability: EDatatypeMutability;
    sourceloc: SourceLoc;
  };

  export type UntaggedUnionDatatype = {
    variant: ENode.UntaggedUnionDatatype;
    members: Collect.TypeUseId[];
    sourceloc: SourceLoc;
  };

  export type TaggedUnionDatatype = {
    variant: ENode.TaggedUnionDatatype;
    members: {
      tag: string;
      type: Collect.TypeUseId;
    }[];
    sourceloc: SourceLoc;
  };

  export type ParameterPack = {
    variant: ENode.ParameterPack;
    sourceloc: SourceLoc;
  };

  export type TypeUse =
    | NamedDatatype
    | FunctionDatatype
    | StackArrayDatatype
    | DynamicArrayDatatype
    | UntaggedUnionDatatype
    | TaggedUnionDatatype
    | ParameterPack;

  /// ===============================================================
  /// ===                       Statements                        ===
  /// ===============================================================

  type BaseStatement = {
    owningScope: Collect.ScopeId;
    sourceloc: SourceLoc;
  };

  export type ExprStatement = BaseStatement & {
    variant: ENode.ExprStatement;
    expr: Collect.ExprId;
  };

  export type InlineCStatement = BaseStatement & {
    variant: ENode.InlineCStatement;
    value: string;
  };

  export type ReturnStatement = BaseStatement & {
    variant: ENode.ReturnStatement;
    expr: Collect.ExprId | null;
  };

  export type ForEachStatement = BaseStatement & {
    variant: ENode.ForEachStatement;
    loopVariable: string;
    indexVariable: string | null;
    value: Collect.ExprId;
    comptime: boolean;
    body: Collect.ScopeId;
  };

  export type IfStatement = BaseStatement & {
    variant: ENode.IfStatement;
    condition: Collect.ExprId;
    comptime: boolean;
    thenBlock: Collect.ScopeId;
    elseif: {
      condition: Collect.ExprId;
      thenBlock: Collect.ScopeId;
    }[];
    elseBlock: Collect.ScopeId | null;
  };

  export type WhileStatement = BaseStatement & {
    variant: ENode.WhileStatement;
    condition: Collect.ExprId;
    block: Collect.ScopeId;
  };

  export type VariableDefinitionStatement = BaseStatement & {
    variant: ENode.VariableDefinitionStatement;
    variableSymbol: Collect.SymbolId;
    comptime: boolean;
    value: Collect.ExprId | null;
  };

  export type Statements =
    | ExprStatement
    | InlineCStatement
    | ReturnStatement
    | IfStatement
    | ForEachStatement
    | WhileStatement
    | VariableDefinitionStatement;

  export type StatementsWithoutOwningScope =
    | Omit<ExprStatement, "owningScope">
    | Omit<InlineCStatement, "owningScope">
    | Omit<ReturnStatement, "owningScope">
    | Omit<IfStatement, "owningScope">
    | Omit<ForEachStatement, "owningScope">
    | Omit<WhileStatement, "owningScope">
    | Omit<VariableDefinitionStatement, "owningScope">;

  /// ===============================================================
  /// ===                      Expressions                        ===
  /// ===============================================================

  type BaseExpr = {
    sourceloc: SourceLoc;
  };

  export type ParenthesisExpr = BaseExpr & {
    variant: ENode.ParenthesisExpr;
    expr: Collect.ExprId;
  };

  export type TryExpr = BaseExpr & {
    variant: ENode.TryExpr;
    expr: Collect.ExprId;
  };

  export type BlockScopeExpr = BaseExpr & {
    variant: ENode.BlockScopeExpr;
    scope: Collect.ScopeId;
  };

  export type BinaryExpr = BaseExpr & {
    variant: ENode.BinaryExpr;
    left: Collect.ExprId;
    right: Collect.ExprId;
    operation: EBinaryOperation;
  };

  export type UnaryExpr = BaseExpr & {
    variant: ENode.UnaryExpr;
    expr: Collect.ExprId;
    operation: EUnaryOperation;
  };

  export type ExprCallExpr = BaseExpr & {
    variant: ENode.ExprCallExpr;
    calledExpr: Collect.ExprId;
    inArena: Collect.ExprId | null;
    arguments: Collect.ExprId[];
  };

  export type SymbolValueExpr = BaseExpr & {
    variant: ENode.SymbolValueExpr;
    name: string;
    genericArgs: Collect.ExprId[];
  };

  export type ExplicitCastExpr = BaseExpr & {
    variant: ENode.ExplicitCastExpr;
    expr: Collect.ExprId;
    targetType: Collect.TypeUseId;
  };

  export type ExprIsTypeExpr = BaseExpr & {
    variant: ENode.ExprIsTypeExpr;
    expr: Collect.ExprId;
    comparisonType: Collect.TypeUseId;
  };

  export type StructInstantiationExpr = BaseExpr & {
    variant: ENode.StructInstantiationExpr;
    structType: Collect.TypeUseId | null;
    members: {
      name: string;
      value: Collect.ExprId;
    }[];
    inArena: Collect.ExprId | null;
  };

  export type ExprAssignmentExpr = BaseExpr & {
    variant: ENode.ExprAssignmentExpr;
    expr: Collect.ExprId;
    value: Collect.ExprId;
    operation: EAssignmentOperation;
  };

  export type MemberAccessExpr = BaseExpr & {
    variant: ENode.MemberAccessExpr;
    expr: Collect.ExprId;
    memberName: string;
    genericArgs: Collect.ExprId[];
  };

  export type LiteralExpr = BaseExpr & {
    variant: ENode.LiteralExpr;
    literal: LiteralValue;
  };

  export type FStringExpr = BaseExpr & {
    variant: ENode.FStringExpr;
    fragments: ({ type: "expr"; value: Collect.ExprId } | { type: "text"; value: string })[];
    literal: LiteralValue;
  };

  export type PreIncrExpr = BaseExpr & {
    variant: ENode.PreIncrExpr;
    expr: Collect.ExprId;
    operation: EIncrOperation;
  };

  export type PostIncrExpr = BaseExpr & {
    variant: ENode.PostIncrExpr;
    expr: Collect.ExprId;
    operation: EIncrOperation;
  };

  export type ArrayLiteralExpr = BaseExpr & {
    variant: ENode.ArrayLiteralExpr;
    values: Collect.ExprId[];
  };

  export type ArraySubscriptExpr = BaseExpr & {
    variant: ENode.ArraySubscriptExpr;
    expr: Collect.ExprId;
    indices: Collect.ExprId[];
  };

  export type ArraySliceExpr = BaseExpr & {
    variant: ENode.ArraySliceExpr;
    expr: Collect.ExprId;
    indices: {
      start: Collect.ExprId | null;
      end: Collect.ExprId | null;
    }[];
  };

  export type TypeLiteralExpr = BaseExpr & {
    variant: ENode.TypeLiteralExpr;
    datatype: Collect.TypeUseId;
  };

  export type Expressions =
    | ParenthesisExpr
    | TryExpr
    | BlockScopeExpr
    | BinaryExpr
    | UnaryExpr
    | SymbolValueExpr
    | ExprCallExpr
    | ExplicitCastExpr
    | ExprIsTypeExpr
    | StructInstantiationExpr
    | ExprAssignmentExpr
    | LiteralExpr
    | ArrayLiteralExpr
    | ArraySubscriptExpr
    | ArraySliceExpr
    | TypeLiteralExpr
    | PreIncrExpr
    | PostIncrExpr
    | MemberAccessExpr;

  export type ModuleImport = {
    variant: ENode.ModuleImport;
    mode: "path" | "module";
    name: string;
    alias: string | null;
    sourceloc: SourceLoc;
  };

  export type SymbolImport = {
    variant: ENode.SymbolImport;
    mode: "path" | "module";
    name: string;
    symbols: {
      symbol: string;
      alias: string | null;
    }[];
    sourceloc: SourceLoc;
  };

  export function makeNSSharedInstance<T extends Collect.NamespaceSharedInstance>(
    cc: CollectionContext,
    symbol: T
  ): [T, Collect.NSSharedInstanceId] {
    if (cc.nsSharedInstances.length === 0) {
      cc.nsSharedInstances.push({} as any);
    }
    const id = cc.nsSharedInstances.length as Collect.NSSharedInstanceId;
    cc.nsSharedInstances.push(symbol);
    return [symbol, id];
  }

  export function makeTypeDef<T extends Collect.TypeDef>(
    cc: CollectionContext,
    symbol: T
  ): [T, Collect.TypeDefId] {
    if (cc.typeDefNodes.length === 0) {
      cc.typeDefNodes.push({} as any);
    }
    const id = cc.typeDefNodes.length as Collect.TypeDefId;
    cc.typeDefNodes.push(symbol);
    return [symbol, id];
  }

  export function makeTypeUse<T extends Collect.TypeUse>(
    cc: CollectionContext,
    symbol: T
  ): [T, Collect.TypeUseId] {
    if (cc.typeUseNodes.length === 0) {
      cc.typeUseNodes.push({} as any);
    }
    const id = cc.typeUseNodes.length as Collect.TypeUseId;
    cc.typeUseNodes.push(symbol);
    return [symbol, id];
  }

  export function makeExpr<T extends Collect.Expressions>(
    cc: CollectionContext,
    symbol: T
  ): [T, Collect.ExprId] {
    if (cc.exprNodes.length === 0) {
      cc.exprNodes.push({} as any);
    }
    const id = cc.exprNodes.length as Collect.ExprId;
    cc.exprNodes.push(symbol);
    return [symbol, id];
  }

  export function makeStatement<T extends Collect.Statements>(
    cc: CollectionContext,
    symbol: T
  ): [T, Collect.StatementId] {
    if (cc.statementNodes.length === 0) {
      cc.statementNodes.push({} as any);
    }
    const id = cc.statementNodes.length as Collect.StatementId;
    cc.statementNodes.push(symbol);
    return [symbol, id];
  }

  export function makeScope<T extends Collect.Scope>(
    cc: CollectionContext,
    symbol: T
  ): [T, Collect.ScopeId] {
    if (cc.scopeNodes.length === 0) {
      cc.scopeNodes.push({} as any);
    }
    const id = cc.scopeNodes.length as Collect.ScopeId;
    cc.scopeNodes.push(symbol);
    return [symbol, id];
  }

  export function makeSymbol<T extends Collect.Symbols>(
    cc: CollectionContext,
    symbol: T
  ): [T, Collect.SymbolId] {
    if (cc.symbolNodes.length === 0) {
      cc.symbolNodes.push({} as any);
    }
    const id = cc.symbolNodes.length as Collect.SymbolId;
    cc.symbolNodes.push(symbol);
    return [symbol, id];
  }
}

function makeOverloadGroupAvailable(
  cc: CollectionContext,
  parentScope: Collect.ScopeId,
  name: string,
  overloadedOperator: EOverloadedOperator | undefined
) {
  for (const group of cc.overloadGroups) {
    const og = cc.symbolNodes.get(group);
    assert(og.variant === Collect.ENode.FunctionOverloadGroupSymbol);
    if (
      og.parentScope === parentScope &&
      og.name === name &&
      og.overloadedOperator === overloadedOperator
    ) {
      return [og, group] as const;
    }
  }
  const [g, gId] = Collect.makeSymbol(cc, {
    variant: Collect.ENode.FunctionOverloadGroupSymbol,
    name: name,
    overloads: new Set(),
    overloadedOperator: overloadedOperator,
    parentScope: parentScope,
  });
  cc.overloadGroups.add(gId);
  return [g, gId] as const;
}

function makeBlockScope(
  cc: CollectionContext,
  parentScope: Collect.ScopeId,
  unsafe: boolean,
  sourceloc: SourceLoc
): Collect.ScopeId {
  const parent = cc.scopeNodes.get(parentScope);
  assert(
    parent.variant === Collect.ENode.BlockScope || parent.variant === Collect.ENode.FunctionScope
  );
  const [scope, scopeId] = Collect.makeScope(cc, {
    variant: Collect.ENode.BlockScope,
    owningSymbol: parent.owningSymbol,
    parentScope: parentScope,
    statements: new Set(),
    sourceloc: sourceloc,
    unsafe: unsafe,
    emittedExpr: null,
    symbols: new Set(),
  });
  cc.blockScopes.add(scopeId);
  return scopeId;
}

function addStatement(
  cc: CollectionContext,
  parentScope: Collect.ScopeId,
  statement: Collect.StatementsWithoutOwningScope
) {
  const parent = cc.scopeNodes.get(parentScope);
  assert(parent.variant === Collect.ENode.BlockScope);
  const [st, stId] = Collect.makeStatement(cc, {
    ...statement,
    owningScope: parentScope,
  });
  parent.statements.add(stId);
  return st;
}

function defineGenericTypeParameter(
  cc: CollectionContext,
  name: string,
  functionScopeId: Collect.ScopeId,
  sourceloc: SourceLoc
) {
  const functionScope = cc.scopeNodes.get(functionScopeId);
  assert(
    functionScope.variant === Collect.ENode.FunctionScope ||
      functionScope.variant === Collect.ENode.StructScope ||
      functionScope.variant === Collect.ENode.TypeAliasScope
  );
  const owner = cc.symbolNodes.get(functionScope.owningSymbol);
  assert(
    owner.variant === Collect.ENode.FunctionSymbol || owner.variant === Collect.ENode.TypeDefSymbol
  );
  const [gg, id] = Collect.makeSymbol(cc, {
    variant: Collect.ENode.GenericTypeParameterSymbol,
    name: name,
    owningSymbol: functionScope.owningSymbol,
    sourceloc: sourceloc,
  });
  functionScope.symbols.add(id);
  return id;
}

export function defineVariableSymbol(
  cc: CollectionContext,
  variable: Omit<Collect.VariableSymbol, "inScope">,
  scope: Collect.ScopeId
) {
  const sc = cc.scopeNodes.get(scope);
  for (const id of sc.symbols) {
    const s = cc.symbolNodes.get(id);
    if (s.variant === Collect.ENode.VariableSymbol && s.name === variable.name) {
      throw new CompilerError(
        `Symbol '${variable.name}' was already declared in this scope. Previous definition: ${
          (s.sourceloc && formatSourceLoc(s.sourceloc)) || ""
        }`,
        variable.sourceloc
      );
    }
  }

  const [varsym, varSymId] = Collect.makeSymbol<Collect.VariableSymbol>(cc, {
    ...variable,
    inScope: scope,
  });
  sc.symbols.add(varSymId);
  return [varsym, varSymId] as const;
}

function collectTypeDef(
  cc: CollectionContext,
  item: ASTTypeDef,
  args: {
    currentParentScope: Collect.ScopeId;
  }
): Collect.SymbolId {
  if (item === null) {
    assert(false);
  }
  switch (item.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamespaceDefinition": {
      const parent = cc.scopeNodes.get(args.currentParentScope);
      assert(
        parent.variant === Collect.ENode.FileScope ||
          parent.variant === Collect.ENode.NamespaceScope ||
          parent.variant === Collect.ENode.ModuleScope
      );

      let fullyQualifiedName = "";
      if (parent.variant === Collect.ENode.NamespaceScope) {
        const ns = cc.symbolNodes.get(parent.owningSymbol);
        assert(ns.variant === Collect.ENode.TypeDefSymbol);
        const nsTd = cc.typeDefNodes.get(ns.typeDef);
        assert(nsTd.variant === Collect.ENode.NamespaceTypeDef);
        fullyQualifiedName += nsTd.fullyQualifiedName + ".";
      }
      fullyQualifiedName += item.name;

      let [existingNamespace, existingNamespaceId] = [
        undefined as undefined | Collect.NamespaceTypeDef,
        -1 as Collect.TypeDefId,
      ];
      let [namespaceSymbol, namespaceSymbolId] = [
        undefined as undefined | Collect.TypeDefSymbol,
        -1 as Collect.SymbolId,
      ];
      for (const id of parent.symbols) {
        const sym = cc.symbolNodes.get(id);
        if (sym.variant === Collect.ENode.TypeDefSymbol) {
          const typedef = cc.typeDefNodes.get(sym.typeDef);
          if (typedef.variant === Collect.ENode.NamespaceTypeDef && typedef.name === item.name) {
            [existingNamespace, existingNamespaceId] = [typedef, sym.typeDef];
            [namespaceSymbol, namespaceSymbolId] = [sym, id];
            break;
          } else if (
            typedef.variant === Collect.ENode.StructTypeDef &&
            typedef.name === item.name
          ) {
            throw new CompilerError(
              `Symbol '${
                item.name
              }' has already been declared as a Struct, which cannot be extended by a namespace. Original definition: ${
                (typedef.sourceloc && formatSourceLoc(typedef.sourceloc)) || ""
              }`,
              item.sourceloc
            );
          }
        }
      }

      if (existingNamespaceId === -1) {
        let [sharedInstance, sharedInstanceId] = [
          undefined as undefined | Collect.NamespaceSharedInstance,
          -1 as Collect.NSSharedInstanceId,
        ];
        cc.nsSharedInstances.getAll().forEach((instance, id) => {
          if (instance.fullyQualifiedName === fullyQualifiedName) {
            sharedInstance = instance;
            sharedInstanceId = id as Collect.NSSharedInstanceId;
          }
        });

        if (sharedInstanceId === -1) {
          [sharedInstance, sharedInstanceId] = Collect.makeNSSharedInstance(cc, {
            variant: Collect.ENode.NamespaceSharedInstance,
            fullyQualifiedName: fullyQualifiedName,
            namespaceScopes: new Set(),
          });
        }

        [existingNamespace, existingNamespaceId] = Collect.makeTypeDef(cc, {
          variant: Collect.ENode.NamespaceTypeDef,
          fullyQualifiedName: fullyQualifiedName,
          sharedInstance: sharedInstanceId,
          name: item.name,
          export: item.export,
          extern: EExternLanguage.None,
          pub: false,
          namespaceScope: -1 as Collect.ScopeId,
          parentScope: args.currentParentScope,
          sourceloc: item.sourceloc,
        });
        [namespaceSymbol, namespaceSymbolId] = Collect.makeSymbol(cc, {
          variant: Collect.ENode.TypeDefSymbol,
          inScope: args.currentParentScope,
          typeDef: existingNamespaceId,
          name: item.name,
        });
        const [namespaceScope, namespaceScopeId] = Collect.makeScope(cc, {
          variant: Collect.ENode.NamespaceScope,
          owningSymbol: namespaceSymbolId,
          parentScope: args.currentParentScope,
          sourceloc: item.sourceloc,
          symbols: new Set(),
        });
        assert(sharedInstance);
        existingNamespace.namespaceScope = namespaceScopeId;
        sharedInstance.namespaceScopes.add(namespaceScopeId);
        cc.elaboratedNamespacesAndStructs.add(existingNamespaceId);
      }

      assert(existingNamespace);
      for (const s of item.declarations) {
        const namespaceScope = cc.scopeNodes.get(existingNamespace.namespaceScope);
        assert(namespaceScope.variant === Collect.ENode.NamespaceScope);
        if (s.variant === "GlobalVariableDefinition") {
          collectGlobalDirective(cc, s, {
            currentParentScope: existingNamespace.namespaceScope,
          });
        } else {
          const decl = collectSymbol(cc, s, {
            currentParentScope: existingNamespace.namespaceScope,
          });
          namespaceScope.symbols.add(decl);
        }
      }
      return namespaceSymbolId;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructDefinition": {
      const parent = cc.scopeNodes.get(args.currentParentScope);
      assert(
        parent.variant === Collect.ENode.FileScope ||
          parent.variant === Collect.ENode.NamespaceScope ||
          parent.variant === Collect.ENode.ModuleScope ||
          parent.variant === Collect.ENode.StructScope
      );

      let fullyQualifiedName = "";
      if (parent.variant === Collect.ENode.NamespaceScope) {
        const ns = cc.symbolNodes.get(parent.owningSymbol);
        assert(ns.variant === Collect.ENode.TypeDefSymbol);
        const nsTd = cc.typeDefNodes.get(ns.typeDef);
        assert(nsTd.variant === Collect.ENode.NamespaceTypeDef);
        fullyQualifiedName += nsTd.fullyQualifiedName + ".";
      } else if (parent.variant === Collect.ENode.StructScope) {
        const ns = cc.symbolNodes.get(parent.owningSymbol);
        assert(ns.variant === Collect.ENode.TypeDefSymbol);
        const nsTd = cc.typeDefNodes.get(ns.typeDef);
        assert(nsTd.variant === Collect.ENode.StructTypeDef);
        fullyQualifiedName += nsTd.fullyQualifiedName + ".";
      }
      fullyQualifiedName += item.name;

      for (const id of cc.elaboratedNamespacesAndStructs) {
        const sym = cc.typeDefNodes.get(id);
        if (
          sym.variant === Collect.ENode.NamespaceTypeDef &&
          sym.fullyQualifiedName === fullyQualifiedName
        ) {
          throw new CompilerError(
            `Symbol '${fullyQualifiedName}' has already been declared as a Namespace, which cannot be extended by a struct. Original definition: ${
              (sym.sourceloc && formatSourceLoc(sym.sourceloc)) || ""
            }`,
            item.sourceloc
          );
        } else if (
          sym.variant === Collect.ENode.StructTypeDef &&
          sym.fullyQualifiedName === fullyQualifiedName
        ) {
          throw new CompilerError(
            `Struct '${item.name}' is already declared in this scope. Original definition: ${
              (sym.sourceloc && formatSourceLoc(sym.sourceloc)) || ""
            }`,
            item.sourceloc
          );
        }
      }

      const [struct, structId] = Collect.makeTypeDef<Collect.StructTypeDef>(cc, {
        variant: Collect.ENode.StructTypeDef,
        name: item.name,
        fullyQualifiedName: fullyQualifiedName,
        generics: [],
        defaultMemberValues: [],
        export: item.export,
        extern: item.extern,
        pub: false,
        noemit: item.noemit,
        structScope: -1 as Collect.ScopeId,
        parentScope: args.currentParentScope,
        sourceloc: item.sourceloc,
        originalSourcecode: item.originalSourcecode,
      });
      const [structSymbol, structSymbolId] = Collect.makeSymbol<Collect.TypeDefSymbol>(cc, {
        variant: Collect.ENode.TypeDefSymbol,
        inScope: args.currentParentScope,
        name: item.name,
        typeDef: structId,
      });
      const [structScope, structScopeId] = Collect.makeScope<Collect.StructScope>(cc, {
        variant: Collect.ENode.StructScope,
        owningSymbol: structSymbolId,
        parentScope: args.currentParentScope,
        sourceloc: item.sourceloc,
        symbols: new Set(),
      });
      struct.structScope = structScopeId;
      cc.elaboratedNamespacesAndStructs.add(structId);

      for (const g of item.generics) {
        const generic = defineGenericTypeParameter(cc, g.name, structScopeId, g.sourceloc);
        struct.generics.push(generic);
      }

      for (const s of item.nestedStructs) {
        const decl = collectTypeDef(cc, s, {
          currentParentScope: structScopeId,
        });
        structScope.symbols.add(decl);
      }

      for (const m of item.members) {
        if (m.defaultValue) {
          struct.defaultMemberValues.push({
            name: m.name,
            value: collectExpr(cc, m.defaultValue, { currentParentScope: structScopeId }),
          });
        }
        collectSymbol(cc, m, {
          currentParentScope: structScopeId,
        });
      }

      for (const m of item.methods) {
        const funcsym = collectSymbol(cc, m, {
          currentParentScope: structScopeId,
        });
        structScope.symbols.add(funcsym);
      }

      if (item.export) {
        cc.exportedSymbols.exported.add(structSymbolId);
      }

      return structSymbolId;
    }

    default:
      assert(false, "All cases handled " + item.variant);
  }
}

function collectTypeUse(
  cc: CollectionContext,
  item: ASTTypeUse,
  args: {
    currentParentScope: Collect.ScopeId;
  }
): Collect.TypeUseId {
  if (item === null) {
    assert(false);
  }
  switch (item.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamedDatatype": {
      return Collect.makeTypeUse(cc, {
        variant: Collect.ENode.NamedDatatype,
        name: item.name,
        inline: item.inline,
        innerNested: (item.nested && collectTypeUse(cc, item.nested, args)) || null,
        genericArgs: item.generics.map((g) => {
          if (g.variant === "LiteralExpr") {
            return collectExpr(cc, g, args);
          } else {
            return Collect.makeExpr(cc, {
              variant: Collect.ENode.TypeLiteralExpr,
              sourceloc: item.sourceloc,
              datatype: collectTypeUse(cc, g, args),
            })[1];
          }
        }),
        mutability: item.mutability,
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDatatype":
      return Collect.makeTypeUse(cc, {
        variant: Collect.ENode.FunctionDatatype,
        returnType: collectTypeUse(cc, item.returnType, args),
        parameters: item.params.map((p) => collectTypeUse(cc, p.datatype, args)),
        vararg: item.ellipsis,
        requires: {
          final: item.requires.final,
          autodest: item.requires.autodest,
          noreturn: item.requires.noreturn,
        },
        sourceloc: item.sourceloc,
        mutability: item.mutability,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StackArrayDatatype":
      return Collect.makeTypeUse(cc, {
        variant: Collect.ENode.StackArrayDatatype,
        datatype: collectTypeUse(cc, item.datatype, args),
        length: item.length,
        inline: item.inline,
        mutability: item.mutability,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "DynamicArrayDatatype":
      return Collect.makeTypeUse(cc, {
        variant: Collect.ENode.DynamicArrayDatatype,
        datatype: collectTypeUse(cc, item.datatype, args),
        mutability: item.mutability,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ParameterPack":
      return Collect.makeTypeUse(cc, {
        variant: Collect.ENode.ParameterPack,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "UntaggedUnionDatatype":
      return Collect.makeTypeUse(cc, {
        variant: Collect.ENode.UntaggedUnionDatatype,
        members: item.members.map((m) => collectTypeUse(cc, m, args)),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "TaggedUnionDatatype":
      return Collect.makeTypeUse(cc, {
        variant: Collect.ENode.TaggedUnionDatatype,
        members: item.members.map((m) => ({
          tag: m.tag,
          type: collectTypeUse(cc, m.type, args),
        })),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    default:
      assert(false, "All cases handled " + item.variant);
  }
}

function collectTypeUnion(
  cc: CollectionContext,
  item: ASTTypeUse,
  args: {
    currentParentScope: Collect.ScopeId;
  }
) {
  return Collect.makeTypeDef;
}

function collectSymbol(
  cc: CollectionContext,
  item: ASTFunctionDefinition | ASTStructMemberDefinition | ASTSymbolDefinition,
  args: {
    currentParentScope: Collect.ScopeId;
  }
): Collect.SymbolId {
  if (item === null) {
    assert(false);
  }
  switch (item.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDefinition": {
      const [overloadGroup, overloadGroupId] = makeOverloadGroupAvailable(
        cc,
        args.currentParentScope,
        item.name,
        item.operatorOverloading?.operator
      );

      if (item.static && item.methodType !== EMethodType.Method) {
        throw new CompilerError(
          `A function that is not a method cannot be marked as 'static'`,
          item.sourceloc
        );
      }

      const parameters = item.params.map((p) => ({
        name: p.name,
        type: collectTypeUse(cc, p.datatype, args),
        optional: p.optional,
        sourceloc: p.sourceloc,
      }));
      const [functionSymbol, functionSymbolId] = Collect.makeSymbol<Collect.FunctionSymbol>(cc, {
        variant: Collect.ENode.FunctionSymbol,
        export: item.export,
        extern: item.externLanguage,
        generics: [],
        name: item.name,
        staticMethod: item.static,
        overloadGroup: overloadGroupId,
        parameters: parameters,
        parentScope: args.currentParentScope,
        methodType: item.methodType,
        overloadedOperator: item.operatorOverloading?.operator,
        pub: item.pub,
        requires: {
          final: item.requires.final,
          autodest: item.requires.autodest,
          noreturn: item.requires.noreturn,
        },
        noemit: item.noemit,
        vararg: item.ellipsis,
        returnType: (item.returnType && collectTypeUse(cc, item.returnType, args)) || null,
        sourceloc: item.sourceloc,
        functionScope: null,
        originalSourcecode: item.originalSourcecode,
      });
      overloadGroup.overloads.add(functionSymbolId);

      if (item.funcbody) {
        const [functionScope, functionScopeId] = Collect.makeScope(cc, {
          variant: Collect.ENode.FunctionScope,
          owningSymbol: functionSymbolId,
          parentScope: args.currentParentScope,
          sourceloc: item.sourceloc,
          blockScope: -1 as Collect.ScopeId,
          symbols: new Set(),
        });
        functionSymbol.functionScope = functionScopeId;

        if (item.funcbody.variant === "ExprAsFuncBody") {
          item.funcbody = {
            variant: "Scope",
            statements: [
              {
                variant: "ReturnStatement",
                sourceloc: item.sourceloc,
                expr: item.funcbody.expr,
              },
            ],
            unsafe: false,
            sourceloc: item.sourceloc,
          };
        }

        const blockScopeId = collectScope(cc, item.funcbody, {
          currentParentScope: functionScopeId,
        });
        functionScope.blockScope = blockScopeId;

        for (const g of item.generics) {
          const generic = defineGenericTypeParameter(cc, g.name, functionScopeId, g.sourceloc);
          functionSymbol.generics.push(generic);
        }

        if (item.methodType === EMethodType.Method) {
          defineVariableSymbol(
            cc,
            {
              variant: Collect.ENode.VariableSymbol,
              comptime: false,
              mutability: EVariableMutability.Default,
              name: "this",
              sourceloc: functionSymbol.sourceloc,
              type: null,
              globalValueInitializer: null,
              variableContext: EVariableContext.ThisReference,
            },
            functionScopeId
          );
        }

        for (const p of parameters) {
          defineVariableSymbol(
            cc,
            {
              variant: Collect.ENode.VariableSymbol,
              comptime: false,
              mutability: EVariableMutability.Let,
              name: p.name,
              sourceloc: p.sourceloc,
              type: p.type,
              globalValueInitializer: null,
              variableContext: EVariableContext.FunctionParameter,
            },
            functionScopeId
          );
        }
      }

      if (item.export) {
        cc.exportedSymbols.exported.add(functionSymbolId);
      }

      return overloadGroupId;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "TypeAlias":
    case "NamespaceDefinition":
    case "StructDefinition": {
      return collectTypeDef(cc, item, args);
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructMember": {
      const [member, memberId] = defineVariableSymbol(
        cc,
        {
          variant: Collect.ENode.VariableSymbol,
          name: item.name,
          comptime: false,
          mutability: item.mutability,
          sourceloc: item.sourceloc,
          type: collectTypeUse(cc, item.type, {
            currentParentScope: args.currentParentScope,
          }),
          globalValueInitializer: null,
          variableContext: EVariableContext.MemberOfStruct,
        },
        args.currentParentScope
      );
      return memberId;
    }

    default:
      assert(false, "All cases handled " + item.variant);
  }
}

function collectGlobalDirective(
  cc: CollectionContext,
  item:
    | ASTTypeAlias
    | ASTCInjectDirective
    | ASTGlobalVariableDefinition
    | ASTModuleImport
    | ASTSymbolImport,
  args: {
    currentParentScope: Collect.ScopeId;
  }
) {
  if (item === null) {
    assert(false);
  }
  switch (item.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "CInjectDirective": {
      const symbolId = Collect.makeSymbol(cc, {
        variant: Collect.ENode.CInjectDirective,
        value: item.code,
        export: item.export,
        sourceloc: item.sourceloc,
      })[1];
      cc.scopeNodes.get(args.currentParentScope).symbols.add(symbolId);
      if (item.export) {
        cc.exportedSymbols.exported.add(symbolId);
      }
      return;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "GlobalVariableDefinition": {
      const [variableSymbol, variableSymbolId] = defineVariableSymbol(
        cc,
        {
          variant: Collect.ENode.VariableSymbol,
          name: item.name,
          comptime: item.comptime,
          type:
            (item.datatype &&
              collectTypeUse(cc, item.datatype, { currentParentScope: args.currentParentScope })) ||
            null,
          globalValueInitializer: item.expr
            ? collectExpr(cc, item.expr, { currentParentScope: args.currentParentScope })
            : null,
          mutability: item.mutability,
          variableContext: EVariableContext.Global,
          sourceloc: item.sourceloc,
        },
        args.currentParentScope
      );
      return;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "TypeAlias": {
      const [genericsScope, genericsScopeId] = Collect.makeScope<Collect.TypeAliasScope>(cc, {
        variant: Collect.ENode.TypeAliasScope,
        owningSymbol: -1 as Collect.SymbolId,
        parentScope: args.currentParentScope,
        sourceloc: item.sourceloc,
        symbols: new Set(),
      });

      const [alias, aliasId] = Collect.makeTypeDef<Collect.TypeDefAlias>(cc, {
        variant: Collect.ENode.TypeDefAlias,
        inScope: args.currentParentScope,
        name: item.name,
        generics: [],
        genericScope: genericsScopeId,
        target: collectTypeUse(cc, item.datatype, { currentParentScope: genericsScopeId }),
        sourceloc: item.sourceloc,
      });
      const [symbol, symbolId] = Collect.makeSymbol(cc, {
        variant: Collect.ENode.TypeDefSymbol,
        inScope: args.currentParentScope,
        name: item.name,
        typeDef: aliasId,
      });
      genericsScope.owningSymbol = symbolId;
      cc.scopeNodes.get(args.currentParentScope).symbols.add(symbolId);
      if (item.export) {
        cc.exportedSymbols.exported.add(symbolId);
      }

      for (const g of item.generics) {
        const generic = defineGenericTypeParameter(cc, g.name, genericsScopeId, g.sourceloc);
        alias.generics.push(generic);
      }

      return;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ModuleImport": {
      // return makeSymbol(cc, {
      //   variant: Collect.ENode.ModuleImport,
      //   alias: item.alias,
      //   mode: item.mode,
      //   name: item.name,
      //   sourceloc: item.sourceloc,
      // })[1];
      const dependency = cc.config.dependencies.find((d) => d.name === item.name);
      if (!dependency) {
        throw new CompilerError(
          `Cannot find import '${item.name}': No such module`,
          item.sourceloc
        );
      }
      const globalBuildDir = join(process.cwd(), "__haze__");
      const metadataPath = join(
        globalBuildDir,
        cc.config.name,
        "__deps",
        dependency.name,
        "metadata.json"
      );
      const metadata: ModuleConfig = JSON.parse(readFileSync(metadataPath, "utf8"));
      const importedNamespace = getModuleGlobalNamespaceName(metadata.name, metadata.version);
      const [alias, aliasId] = Collect.makeTypeDef<Collect.TypeDefAlias>(cc, {
        variant: Collect.ENode.TypeDefAlias,
        inScope: args.currentParentScope,
        target: Collect.makeTypeUse(cc, {
          variant: Collect.ENode.NamedDatatype,
          genericArgs: [],
          inline: false,
          innerNested: null,
          name: importedNamespace,
          mutability: EDatatypeMutability.Default,
          sourceloc: null,
        })[1],
        // mode: item.mode,
        generics: [],
        genericScope: -1 as Collect.ScopeId,
        name: item.name,
        sourceloc: item.sourceloc,
      });
      const [symbol, symbolId] = Collect.makeSymbol(cc, {
        variant: Collect.ENode.TypeDefSymbol,
        inScope: args.currentParentScope,
        typeDef: aliasId,
        name: item.name,
      });
      const scope = cc.scopeNodes.get(args.currentParentScope);
      scope.symbols.add(symbolId);

      const [structScope, structScopeId] = Collect.makeScope<Collect.TypeAliasScope>(cc, {
        variant: Collect.ENode.TypeAliasScope,
        owningSymbol: symbolId,
        parentScope: args.currentParentScope,
        sourceloc: item.sourceloc,
        symbols: new Set(),
      });
      alias.genericScope = structScopeId;

      return;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    // case "SymbolImport": {
    //   return Collect.makeSymbol(cc, {
    //     variant: Collect.ENode.SymbolImport,
    //     symbols: item.symbols,
    //     mode: item.mode,
    //     name: item.name,
    //     sourceloc: item.sourceloc,
    //   })[1];
    // }

    default:
      assert(false, "" + (item as any).variant);
  }
}

function collectScope(
  cc: CollectionContext,
  item: ASTScope,
  args: {
    currentParentScope: Collect.ScopeId;
  }
): Collect.ScopeId {
  if (item === null) {
    assert(false);
  }
  const blockScopeId = makeBlockScope(cc, args.currentParentScope, item.unsafe, item.sourceloc);
  for (const astStatement of item.statements) {
    switch (astStatement.variant) {
      case "ExprStatement": {
        addStatement(cc, blockScopeId, {
          variant: Collect.ENode.ExprStatement,
          expr: collectExpr(cc, astStatement.expr, { currentParentScope: blockScopeId }),
          sourceloc: astStatement.sourceloc,
        });
        break;
      }

      case "IfStatement": {
        addStatement(cc, blockScopeId, {
          variant: Collect.ENode.IfStatement,
          comptime: astStatement.comptime,
          condition: collectExpr(cc, astStatement.condition, {
            currentParentScope: blockScopeId,
          }),
          elseBlock:
            (astStatement.else &&
              collectScope(cc, astStatement.else, { currentParentScope: blockScopeId })) ||
            null,
          thenBlock: collectScope(cc, astStatement.then, { currentParentScope: blockScopeId }),
          elseif: astStatement.elseIfs.map((e) => ({
            condition: collectExpr(cc, e.condition, { currentParentScope: blockScopeId }),
            thenBlock: collectScope(cc, e.then, { currentParentScope: blockScopeId }),
          })),
          sourceloc: astStatement.sourceloc,
        });
        break;
      }

      case "InlineCStatement": {
        addStatement(cc, blockScopeId, {
          variant: Collect.ENode.InlineCStatement,
          value: astStatement.code,
          sourceloc: astStatement.sourceloc,
        });
        break;
      }

      case "ReturnStatement":
        addStatement(cc, blockScopeId, {
          variant: Collect.ENode.ReturnStatement,
          expr:
            (astStatement.expr &&
              collectExpr(cc, astStatement.expr, { currentParentScope: blockScopeId })) ||
            null,
          sourceloc: astStatement.sourceloc,
        });
        break;

      case "WhileStatement":
        addStatement(cc, blockScopeId, {
          variant: Collect.ENode.WhileStatement,
          condition: collectExpr(cc, astStatement.condition, {
            currentParentScope: blockScopeId,
          }),
          block: collectScope(cc, astStatement.body, { currentParentScope: blockScopeId }),
          sourceloc: astStatement.sourceloc,
        });
        break;

      case "TypeAlias":
        const [typeDef, typeDefId] = Collect.makeTypeDef(cc, {
          variant: Collect.ENode.TypeDefAlias,
          inScope: blockScopeId,
          name: astStatement.name,
          generics: [],
          genericScope: -1 as Collect.ScopeId,
          target: collectTypeUse(cc, astStatement.datatype, { currentParentScope: blockScopeId }),
          sourceloc: astStatement.sourceloc,
        });
        const [symbol, symbolId] = Collect.makeSymbol(cc, {
          variant: Collect.ENode.TypeDefSymbol,
          inScope: blockScopeId,
          typeDef: typeDefId,
          name: astStatement.name,
        });
        (cc.scopeNodes.get(blockScopeId) as Collect.BlockScope).symbols.add(symbolId);

        const [structScope, structScopeId] = Collect.makeScope<Collect.TypeAliasScope>(cc, {
          variant: Collect.ENode.TypeAliasScope,
          owningSymbol: symbolId,
          parentScope: args.currentParentScope,
          sourceloc: item.sourceloc,
          symbols: new Set(),
        });
        typeDef.genericScope = structScopeId;

        break;

      case "VariableDefinitionStatement":
        const [variableSymbol, variableSymbolId] = defineVariableSymbol(
          cc,
          {
            variant: Collect.ENode.VariableSymbol,
            name: astStatement.name,
            comptime: astStatement.comptime,
            type:
              (astStatement.datatype &&
                collectTypeUse(cc, astStatement.datatype, { currentParentScope: blockScopeId })) ||
              null,
            mutability: astStatement.mutability,
            globalValueInitializer: null,
            variableContext: astStatement.variableContext,
            sourceloc: astStatement.sourceloc,
          },
          blockScopeId
        );
        addStatement(cc, blockScopeId, {
          variant: Collect.ENode.VariableDefinitionStatement,
          sourceloc: astStatement.sourceloc,
          value:
            (astStatement.expr &&
              collectExpr(cc, astStatement.expr, { currentParentScope: blockScopeId })) ||
            null,
          comptime: astStatement.comptime,
          variableSymbol: variableSymbolId,
        });
        break;

      case "ForEachStatement": {
        addStatement(cc, blockScopeId, {
          variant: Collect.ENode.ForEachStatement,
          value: collectExpr(cc, astStatement.value, { currentParentScope: blockScopeId }),
          body: collectScope(cc, astStatement.body, { currentParentScope: blockScopeId }),
          comptime: astStatement.comptime,
          loopVariable: astStatement.loopVariable,
          indexVariable: astStatement.indexVariable,
          sourceloc: astStatement.sourceloc,
        });
        break;
      }

      default:
        assert(false, "" + (astStatement as any).variant);
    }
  }

  return blockScopeId;
}

function collectExpr(
  cc: CollectionContext,
  item:
    | ASTBlockScopeExpr
    | ASTLiteralExpr
    | ASTExpr
    | ASTStatement
    | ASTParenthesisExpr
    | ASTExprAssignmentExpr
    | ASTExprCallExpr
    | ASTUnaryExpr
    | ASTExprMemberAccess
    | ASTLambdaExpr
    | ASTPreIncrExpr
    | ASTPostIncrExpr
    | ASTStructInstantiationExpr
    | ASTExplicitCastExpr
    | ASTExprIsTypeExpr
    | ASTBinaryExpr
    | ASTSymbolValueExpr,
  args: {
    currentParentScope: Collect.ScopeId;
  }
): Collect.ExprId {
  if (item === null) {
    assert(false);
  }
  switch (item.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "BlockScopeExpr": {
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.BlockScopeExpr,
        scope: collectScope(cc, item.scope, { currentParentScope: args.currentParentScope }),
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ParenthesisExpr": {
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.ParenthesisExpr,
        expr: collectExpr(cc, item.expr, args),
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "TryExpr": {
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.TryExpr,
        expr: collectExpr(cc, item.expr, args),
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "BinaryExpr": {
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.BinaryExpr,
        left: collectExpr(cc, item.a, args),
        right: collectExpr(cc, item.b, args),
        operation: item.operation,
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "LiteralExpr":
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.LiteralExpr,
        literal: item.literal,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "SymbolValueExpr":
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.SymbolValueExpr,
        name: item.name,
        genericArgs: item.generics.map((g) => {
          if (g.variant === "LiteralExpr") {
            return collectExpr(cc, g, args);
          } else {
            return Collect.makeExpr(cc, {
              variant: Collect.ENode.TypeLiteralExpr,
              sourceloc: item.sourceloc,
              datatype: collectTypeUse(cc, g, args),
            })[1];
          }
        }),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "LambdaExpr":
      assert(false, "Not implemented yet");

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructInstantiationExpr":
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.StructInstantiationExpr,
        structType: item.datatype ? collectTypeUse(cc, item.datatype, args) : null,
        members: item.members.map((m) => ({
          name: m.name,
          value: collectExpr(cc, m.value, args),
        })),
        inArena: item.inArena ? collectExpr(cc, item.inArena, args) : null,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "UnaryExpr":
      // Here, we do a small canonicalization: If we encounter Unary-Negative + Positive Integer Literal, we turn it
      // into just an Integer Literal and make the value negative. This allows for much cleaner elaboration and compile-
      // time evaluation, and it also solves the well known C-quirk with -(2^63-1) underflowing to 0 instead of LONG_MIN

      if (
        item.operation === EUnaryOperation.Minus &&
        item.expr.variant === "LiteralExpr" &&
        item.expr.literal.type === EPrimitive.int
      ) {
        item.expr.literal.value = -item.expr.literal.value; // This is the raw pure-tree AST, so we can safely mutate it
        return collectExpr(cc, item.expr, args);
      }

      return Collect.makeExpr(cc, {
        variant: Collect.ENode.UnaryExpr,
        expr: collectExpr(cc, item.expr, args),
        operation: item.operation,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PreIncrExpr":
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.PreIncrExpr,
        expr: collectExpr(cc, item.expr, args),
        operation: item.operation,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PostIncrExpr":
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.PostIncrExpr,
        expr: collectExpr(cc, item.expr, args),
        operation: item.operation,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprMemberAccess":
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.MemberAccessExpr,
        expr: collectExpr(cc, item.expr, args),
        memberName: item.member,
        genericArgs: item.generics.map((g) => {
          if (g.variant === "LiteralExpr") {
            return collectExpr(cc, g, args);
          } else {
            return Collect.makeExpr(cc, {
              variant: Collect.ENode.TypeLiteralExpr,
              sourceloc: item.sourceloc,
              datatype: collectTypeUse(cc, g, args),
            })[1];
          }
        }),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprIsTypeExpr":
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.ExprIsTypeExpr,
        expr: collectExpr(cc, item.expr, args),
        comparisonType: collectTypeUse(cc, item.comparisonType, args),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExplicitCastExpr":
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.ExplicitCastExpr,
        expr: collectExpr(cc, item.expr, args),
        targetType: collectTypeUse(cc, item.castedTo, args),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprAssignmentExpr":
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.ExprAssignmentExpr,
        expr: collectExpr(cc, item.target, args),
        value: collectExpr(cc, item.value, args),
        operation: item.operation,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprCallExpr":
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.ExprCallExpr,
        calledExpr: collectExpr(cc, item.calledExpr, args),
        arguments: item.arguments.map((a) => collectExpr(cc, a, args)),
        inArena: item.inArena ? collectExpr(cc, item.inArena, args) : null,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ArrayLiteralExpr":
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.ArrayLiteralExpr,
        values: item.values.map((v) => collectExpr(cc, v, args)),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ArraySubscriptExpr":
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.ArraySubscriptExpr,
        expr: collectExpr(cc, item.expr, args),
        indices: item.indices.map((i) => collectExpr(cc, i, args)),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ArraySliceExpr":
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.ArraySliceExpr,
        expr: collectExpr(cc, item.expr, args),
        indices: item.indices.map((i) => ({
          start: i.start ? collectExpr(cc, i.start, args) : null,
          end: i.end ? collectExpr(cc, i.end, args) : null,
        })),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "TypeLiteralExpr": {
      return Collect.makeExpr(cc, {
        variant: Collect.ENode.TypeLiteralExpr,
        datatype: collectTypeUse(cc, item.datatype, {
          currentParentScope: args.currentParentScope,
        }),
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    // case "": {
    //   return Collect.makeExpr(cc, {
    //     variant: Collect.ENode.TypeLiteralExpr,
    //     datatype: collectTypeUse(cc, item.datatype, {
    //       currentParentScope: args.currentParentScope,
    //     }),
    //     sourceloc: item.sourceloc,
    //   })[1];
    // }

    default:
      assert(false, "All cases handled " + item.variant);
  }
}

export enum ECollectionMode {
  WrapIntoModuleNamespace,
  ImportUnderRootDirectly,
}

export function CollectFile(
  cc: CollectionContext,
  ast: ASTRoot,
  parentScope: Collect.ScopeId,
  filepath: string,
  moduleName: string,
  moduleVersion: string,
  collectionMode: ECollectionMode
) {
  const parent = cc.scopeNodes.get(parentScope);
  assert(
    parent.variant === Collect.ENode.UnitScope || parent.variant === Collect.ENode.ModuleScope
  );

  if (collectionMode === ECollectionMode.WrapIntoModuleNamespace) {
    const [fileScope, fileScopeId] = Collect.makeScope<Collect.FileScope>(cc, {
      variant: Collect.ENode.FileScope,
      filepath: filepath,
      parentScope: parentScope,
      symbols: new Set(),
    });
    parent.scopes.add(fileScopeId);

    const namespacedDeclarations: ASTSymbolDefinition[] = [];
    for (const decl of ast) {
      if (
        decl.variant === "CInjectDirective" ||
        decl.variant === "ModuleImport" ||
        decl.variant === "SymbolImport"
      ) {
        collectGlobalDirective(cc, decl, {
          currentParentScope: fileScopeId,
        });
      } else {
        namespacedDeclarations.push(decl);
      }
    }

    if (namespacedDeclarations.length > 0) {
      const globalNamespaceId = collectTypeDef(
        cc,
        {
          variant: "NamespaceDefinition",
          declarations: namespacedDeclarations,
          export: true,
          name: getModuleGlobalNamespaceName(moduleName, moduleVersion),
          sourceloc: null,
        },
        {
          currentParentScope: fileScopeId,
        }
      );
      fileScope.symbols.add(globalNamespaceId);
    }
  } else if (collectionMode === ECollectionMode.ImportUnderRootDirectly) {
    for (const decl of ast) {
      if (
        decl.variant === "CInjectDirective" ||
        decl.variant === "ModuleImport" ||
        decl.variant === "GlobalVariableDefinition" ||
        decl.variant === "TypeAlias" ||
        decl.variant === "SymbolImport"
      ) {
        collectGlobalDirective(cc, decl, {
          currentParentScope: parentScope,
        });
      } else {
        const symbolId = collectSymbol(cc, decl, {
          currentParentScope: parentScope,
        });
        parent.symbols.add(symbolId);
      }
    }
  }
}

export function printCollectedDatatype(
  cc: CollectionContext,
  typeId: Collect.TypeUseId | null
): string {
  if (typeId === null) {
    return "?";
  }
  const type = cc.typeUseNodes.get(typeId);
  switch (type.variant) {
    case Collect.ENode.NamedDatatype: {
      let str = "";
      let n: Collect.NamedDatatype | null = type;
      while (n) {
        if (str !== "") {
          str += ".";
        }
        str += n.name;
        if (n.genericArgs.length > 0) {
          str += "<" + n.genericArgs.map((g) => printCollectedExpr(cc, g)).join(", ") + ">";
        }
        n =
          (n.innerNested && (cc.typeUseNodes.get(n.innerNested) as Collect.NamedDatatype)) || null;
        assert(n === null || n.variant === Collect.ENode.NamedDatatype);
      }
      return str;
    }

    case Collect.ENode.StackArrayDatatype: {
      return `[${type.length}]${printCollectedDatatype(cc, type.datatype)}`;
    }

    case Collect.ENode.ParameterPack: {
      return `...`;
    }

    case Collect.ENode.DynamicArrayDatatype: {
      return `[]${printCollectedDatatype(cc, type.datatype)}`;
    }

    case Collect.ENode.UntaggedUnionDatatype: {
      return "(" + type.members.map((m) => printCollectedDatatype(cc, m)).join(" | ") + ")";
    }

    case Collect.ENode.FunctionDatatype: {
      return `(${type.parameters
        .map((p, i) => `param${i}: ${printCollectedDatatype(cc, p)}`)
        .join(", ")}${type.vararg ? ", ..." : ""}) => ${printCollectedDatatype(
        cc,
        type.returnType
      )}`;
    }

    default:
      assert(false, (type as any).variant.toString());
  }
}

export const printCollectedExpr = (cc: CollectionContext, exprId: Collect.ExprId): string => {
  const expr = cc.exprNodes.get(exprId);
  switch (expr.variant) {
    case Collect.ENode.ParenthesisExpr: {
      return `(${printCollectedExpr(cc, expr.expr)})`;
    }

    case Collect.ENode.BlockScopeExpr: {
      printCollectedScope(cc, expr.scope, 0);
      return `Scope: [${expr.scope}]`;
    }

    case Collect.ENode.LiteralExpr: {
      return Semantic.serializeLiteralValue(expr.literal);
    }

    case Collect.ENode.BinaryExpr: {
      return `(${printCollectedExpr(cc, expr.left)} ${BinaryOperationToString(
        expr.operation
      )} ${printCollectedExpr(cc, expr.right)})`;
    }

    case Collect.ENode.UnaryExpr: {
      return `(${UnaryOperationToString(expr.operation)} ${printCollectedExpr(cc, expr.expr)})`;
    }

    case Collect.ENode.ExprCallExpr: {
      return `${printCollectedExpr(cc, expr.calledExpr)}(${expr.arguments
        .map((a) => printCollectedExpr(cc, a))
        .join(", ")})`;
    }

    case Collect.ENode.SymbolValueExpr: {
      let str = expr.name;
      if (expr.genericArgs.length > 0) {
        str += "<" + expr.genericArgs.map((g) => printCollectedExpr(cc, g)).join(", ") + ">";
      }
      return str;
    }

    case Collect.ENode.StructInstantiationExpr: {
      return (
        `${printCollectedDatatype(cc, expr.structType)} {` +
        expr.members.map((a) => `${a.name}: ${printCollectedExpr(cc, a.value)}`).join(", ") +
        "}"
      );
    }

    case Collect.ENode.ExplicitCastExpr: {
      return `${printCollectedExpr(cc, expr.expr)} as ${printCollectedDatatype(
        cc,
        expr.targetType
      )}`;
    }

    case Collect.ENode.MemberAccessExpr: {
      let str = `${printCollectedExpr(cc, expr.expr)}.${expr.memberName}`;
      if (expr.genericArgs.length > 0) {
        str += "<" + expr.genericArgs.map((g) => printCollectedExpr(cc, g)).join(", ") + ">";
      }
      return str;
    }

    case Collect.ENode.ExprAssignmentExpr: {
      return `${printCollectedExpr(cc, expr.expr)} ${AssignmentOperationToString(
        expr.operation
      )} ${printCollectedExpr(cc, expr.value)}`;
    }

    case Collect.ENode.PreIncrExpr: {
      return `${printCollectedExpr(cc, expr.expr)}${IncrOperationToString(expr.operation)}`;
    }

    case Collect.ENode.PostIncrExpr: {
      return `${printCollectedExpr(cc, expr.expr)}${IncrOperationToString(expr.operation)}`;
    }

    case Collect.ENode.ArraySubscriptExpr: {
      const indices: string[] = [];
      for (const index of expr.indices) {
        indices.push(printCollectedExpr(cc, index));
      }
      return `${printCollectedExpr(cc, expr.expr)}[${indices.join(", ")}]`;
    }

    case Collect.ENode.ArraySliceExpr: {
      const indices: string[] = [];
      for (const index of expr.indices) {
        if (index.start && index.end) {
          indices.push(
            printCollectedExpr(cc, index.start) + ":" + printCollectedExpr(cc, index.end)
          );
        } else if (index.start) {
          indices.push(printCollectedExpr(cc, index.start));
        } else if (index.end) {
          indices.push(printCollectedExpr(cc, index.end));
        } else {
          assert(false);
        }
      }
      return `${printCollectedExpr(cc, expr.expr)}[${indices.join(", ")}]`;
    }

    case Collect.ENode.ArrayLiteralExpr: {
      return `[${expr.values.map((v) => printCollectedExpr(cc, v)).join(", ")}]`;
    }

    case Collect.ENode.TypeLiteralExpr: {
      return `type<${printCollectedDatatype(cc, expr.datatype)}>`;
    }

    default:
      assert(false, (expr as any).variant.toString());
  }
};

export const printCollectedScope = (
  cc: CollectionContext,
  scopeId: Collect.ScopeId,
  indent: number
) => {
  const scope = cc.scopeNodes.get(scopeId);
  const print = (str: string, _indent = 0) => {
    console.info(`Scope[${scopeId}]` + " ".repeat(indent + _indent) + str);
  };

  switch (scope.variant) {
    case Collect.ENode.ModuleScope:
      print(`ModuleScope id=${scopeId}`);
      for (const id of scope.symbols) {
        printCollectedSymbol(cc, id, indent + 2);
      }
      break;

    case Collect.ENode.UnitScope:
      print(`- UnitScope id=${scopeId}`);
      for (const id of scope.symbols) {
        printCollectedSymbol(cc, id, indent + 2);
      }
      break;

    case Collect.ENode.FileScope:
      print(`- FileScope id=${scopeId} ${scope.filepath}`);
      for (const id of scope.symbols) {
        printCollectedSymbol(cc, id, indent + 4);
      }
      break;

    case Collect.ENode.StructScope: {
      print(`{`);
      for (const id of scope.symbols) {
        printCollectedSymbol(cc, id, indent + 2);
      }
      print(`}`);
      break;
    }

    case Collect.ENode.FunctionScope: {
      print(`{`);
      for (const id of scope.symbols) {
        printCollectedSymbol(cc, id, indent + 2);
      }
      printCollectedScope(cc, scope.blockScope, indent + 2);
      print(`}`);
      break;
    }

    case Collect.ENode.NamespaceScope: {
      print(`{`);
      for (const id of scope.symbols) {
        printCollectedSymbol(cc, id, indent + 2);
      }
      print(`}`);
      break;
    }

    case Collect.ENode.BlockScope: {
      print(`Block {`);
      for (const id of scope.symbols) {
        printCollectedSymbol(cc, id, indent + 2);
      }
      for (const id of scope.statements) {
        printCollectedStatement(cc, id, indent + 2);
      }
      print(`}`);
      break;
    }

    default:
      assert(false, (scope as any).variant.toString());
  }
};

export const printCollectedStatement = (
  cc: CollectionContext,
  statementId: Collect.StatementId,
  indent: number
) => {
  const statement = cc.statementNodes.get(statementId);
  const print = (str: string, _indent = 0) => {
    console.info(`Statement[${statementId}]` + " ".repeat(indent + _indent) + str);
  };

  switch (statement.variant) {
    case Collect.ENode.ExprStatement: {
      print(`${printCollectedExpr(cc, statement.expr)};`);
      break;
    }

    case Collect.ENode.ReturnStatement: {
      if (statement.expr) {
        print(`return ${printCollectedExpr(cc, statement.expr)};`);
      } else {
        print("return;");
      }
      break;
    }

    case Collect.ENode.IfStatement: {
      print(`If (${printCollectedExpr(cc, statement.condition)})`);
      printCollectedScope(cc, statement.thenBlock, indent + 2);
      for (const elif of statement.elseif) {
        print(`ElseIf (${printCollectedExpr(cc, elif.condition)})`);
        printCollectedScope(cc, elif.thenBlock, indent + 2);
      }
      if (statement.elseBlock) {
        print(`Else`);
        printCollectedScope(cc, statement.elseBlock, indent + 2);
      }
      break;
    }

    case Collect.ENode.WhileStatement: {
      print(`while (${printCollectedExpr(cc, statement.condition)})`);
      printCollectedScope(cc, statement.block, indent + 2);
      break;
    }

    case Collect.ENode.VariableDefinitionStatement: {
      if (statement.value) {
        print(`var ${statement.variableSymbol} = ${printCollectedExpr(cc, statement.value)};`);
      } else {
        print(`var ${statement.variableSymbol};`);
      }
      break;
    }

    case Collect.ENode.InlineCStatement: {
      print(`__c__(${JSON.stringify(statement.value)})`);
      break;
    }

    case Collect.ENode.ForEachStatement: {
      print(
        `for ${statement.comptime ? "comptime " : ""}${
          statement.loopVariable
        } in ${printCollectedExpr(cc, statement.value)}`
      );
      printCollectedScope(cc, statement.body, indent + 2);
      break;
    }

    default:
      assert(false, (statement as any).variant.toString());
  }
};

export const printCollectedSymbol = (
  cc: CollectionContext,
  symbolId: Collect.SymbolId,
  indent: number,
  newline: boolean = true
) => {
  const symbol = cc.symbolNodes.get(symbolId);
  const print = (str: string, _indent = 0) => {
    const msg = `Symbol[${symbolId}]` + " ".repeat(indent + _indent) + str;
    if (newline) {
      console.info(msg);
    } else {
      process.stdout.write(msg);
    }
  };

  switch (symbol.variant) {
    case Collect.ENode.VariableSymbol:
      print(
        `- VariableSymbol id=${symbolId} name=${symbol.name} type=${printCollectedDatatype(
          cc,
          symbol.type
        )}`
      );
      break;

    case Collect.ENode.GenericTypeParameterSymbol:
      print(`- Generic ${symbol.name}`);
      break;

    case Collect.ENode.FunctionOverloadGroupSymbol:
      print(`- ${symbol.name}()`);
      for (const id of symbol.overloads) {
        printCollectedSymbol(cc, id, indent + 4);
      }
      break;

    case Collect.ENode.FunctionSymbol: {
      let ftype =
        "(" +
        symbol.parameters
          .map((p) => `${p.name}: ${printCollectedDatatype(cc, p.type)}`)
          .join(", ") +
        ") => " +
        printCollectedDatatype(cc, symbol.returnType);
      print(`- ${ftype}`);
      if (symbol.functionScope) {
        printCollectedScope(cc, symbol.functionScope, indent + 4);
      }
      break;
    }

    case Collect.ENode.TypeDefSymbol: {
      const typedef = cc.typeDefNodes.get(symbol.typeDef);
      switch (typedef.variant) {
        case Collect.ENode.StructTypeDef: {
          print(`- struct ${typedef.name}`);
          printCollectedScope(cc, typedef.structScope, indent + 4);
          break;
        }

        case Collect.ENode.NamespaceTypeDef: {
          print(`- namespace ${typedef.name}`);
          printCollectedScope(cc, typedef.namespaceScope, indent + 4);
          break;
        }

        case Collect.ENode.TypeDefAlias: {
          print(`type ${typedef.name} = ${printCollectedDatatype(cc, typedef.target)};`);
          break;
        }

        default:
          assert(false, (typedef as any).variant.toString());
      }
      break;
    }

    case Collect.ENode.CInjectDirective: {
      print(`- __c__(${symbol.value})`);
      break;
    }

    // case Collect.ENode.ModuleImport: {
    //   if (symbol.mode === "module") {
    //     print(`import ${symbol.name}${symbol.alias ? " as " + symbol.alias : ""}`);
    //   } else {
    //     print(`import "${symbol.name}"${symbol.alias ? " as " + symbol.alias : ""}`);
    //   }
    //   break;
    // }

    // case Collect.ENode.SymbolImport: {
    //   let symbols: string[] = [];
    //   for (const s of symbol.symbols) {
    //     if (s.alias) {
    //       symbols.push(`${s.symbol} as ${s.alias}`);
    //     } else {
    //       symbols.push(`${s.symbol}`);
    //     }
    //   }
    //   if (symbol.mode === "module") {
    //     print(`from ${symbol.name} import ${symbols.join(", ")}`);
    //   } else {
    //     print(`from "${symbol.name}" import ${symbols.join(", ")}`);
    //   }
    //   break;
    // }

    default:
      assert(false, (symbol as any).variant.toString());
  }
};

export function PrettyPrintCollected(cc: CollectionContext) {
  printCollectedScope(cc, cc.moduleScopeId, 2);
}
