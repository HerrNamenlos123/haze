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
  type ASTDatatype,
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
  type ASTPointerAddressOfExpr,
  type ASTPointerDereferenceExpr,
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
  type ModuleImport,
  type SymbolImport,
  type ASTGlobalDeclaration,
  AssignmentOperationToString,
  IncrOperationToString,
  EClonability,
  EVariableMutability,
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
  type ASTCInjectDirective,
  type ASTExpr,
  type ASTStatement,
  type EAssignmentOperation,
  type EBinaryOperation,
  type EIncrOperation,
  type EUnaryOperation,
} from "../shared/AST";
import { getModuleGlobalNamespaceName, type ExportData, type ModuleConfig } from "../shared/Config";
import { join } from "path";
import { Semantic } from "../Semantic/Elaborate";

export type CollectionContext = {
  config: ModuleConfig;
  nodes: BrandedArray<Collect.Id, Collect.Node>;

  // Helper utilities
  overloadGroups: Set<Collect.Id>;
  blockScopes: Set<Collect.Id>;
  sharedNamespaceInstances: Set<Collect.Id>;
  elaboratedNamespacesAndStructs: Set<Collect.Id>;

  exportedSymbols: ExportData;
  // exportCache: Map<Collect.Id, ImpExp.Id>;
};

export function funcSymHasParameterPack(cc: CollectionContext, id: Collect.Id) {
  const funcsym = cc.nodes.get(id);
  assert(funcsym.variant === Collect.ENode.FunctionSymbol);
  return funcsym.parameters.some((p) => {
    const pp = cc.nodes.get(p.type);
    return pp.variant === Collect.ENode.ParameterPack;
  });
}

export function makeCollectionContext(config: ModuleConfig): CollectionContext {
  const cc: CollectionContext = {
    config: config,
    nodes: new BrandedArray([
      {
        variant: Collect.ENode.ModuleScope,
        symbols: new Set(),
      },
    ]),
    blockScopes: new Set(),
    overloadGroups: new Set(),
    sharedNamespaceInstances: new Set(),
    exportedSymbols: {
      exported: new Set(),
    },
    elaboratedNamespacesAndStructs: new Set(),
    // exportCache: new Map(),
  };
  return cc;
}

export namespace Collect {
  export type Id = Brand<number, "Collect">;
  export const enum ENode {
    ModuleScope,
    UnitScope,
    FileScope,
    ExportScope,
    FunctionScope,
    StructScope,
    NamespaceScope,
    BlockScope,
    FunctionOverloadGroup,
    FunctionSymbol,
    VariableSymbol,
    AliasTypeSymbol,
    GlobalVariableDefinition,
    NamedDatatype,
    ReferenceDatatype,
    PointerDatatype,
    ArrayDatatype,
    SliceDatatype,
    ParameterPack,
    StructDefinitionSymbol,
    NamespaceSharedInstance,
    NamespaceDefinitionSymbol,
    GenericTypeParameter,
    CInjectDirective,
    ExprStatement,
    IfStatement,
    ForEachStatement,
    WhileStatement,
    TypeAliasStatement,
    ReturnStatement,
    InlineCStatement,
    BlockScopeStatement,
    VariableDefinitionStatement,
    FunctionDatatype,
    ParenthesisExpr,
    BinaryExpr,
    LiteralExpr,
    FStringExpr,
    UnaryExpr,
    ExprCallExpr,
    SymbolValueExpr,
    ExplicitCastExpr,
    MemberAccessExpr,
    PointerAddressOfExpr,
    PointerDereferenceExpr,
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
    symbols: Set<Collect.Id>;
  };

  export type UnitScope = {
    variant: ENode.UnitScope;
    parentScope: Collect.Id;
    symbols: Set<Collect.Id>;
  };

  // export type ExportScope = {
  //   variant: ENode.ExportScope;
  //   symbols: Collect.Id[];
  // };

  export type FileScope = {
    variant: ENode.FileScope;
    filepath: string;
    parentScope: Collect.Id;
    symbols: Set<Collect.Id>;
  };

  export type FunctionScope = {
    variant: ENode.FunctionScope;
    parentScope: Collect.Id;
    owningSymbol: Collect.Id;
    sourceloc: SourceLoc;
    blockScope: Collect.Id;
    symbols: Set<Collect.Id>;
  };

  export type StructScope = {
    variant: ENode.StructScope;
    parentScope: Collect.Id;
    owningSymbol: Collect.Id;
    sourceloc: SourceLoc;
    symbols: Set<Collect.Id>;
  };

  export type NamespaceScope = {
    variant: ENode.NamespaceScope;
    parentScope: Collect.Id;
    owningSymbol: Collect.Id;
    sourceloc: SourceLoc;
    symbols: Set<Collect.Id>;
  };

  export type BlockScope = {
    variant: ENode.BlockScope;
    parentScope: Collect.Id;
    owningSymbol: Collect.Id;
    sourceloc: SourceLoc;
    statements: Set<Collect.Id>;
    symbols: Set<Collect.Id>;
  };

  export type Scope =
    | ModuleScope
    | UnitScope
    | FileScope
    | FunctionScope
    | StructScope
    | NamespaceScope
    | BlockScope;

  /// ===============================================================
  /// ===                       Overloads                         ===
  /// ===============================================================

  export type FunctionOverloadGroup = {
    variant: ENode.FunctionOverloadGroup;
    parentScope: Collect.Id;
    name: string;
    overloads: Set<Collect.Id>;
  };

  export type Overloads = FunctionOverloadGroup;

  /// ===============================================================
  /// ===                          Symbols                        ===
  /// ===============================================================

  export type ParameterValue = {
    name: string;
    type: Collect.Id;
    sourceloc: SourceLoc;
  };

  export type FunctionSymbol = {
    variant: ENode.FunctionSymbol;
    parentScope: Collect.Id;
    staticMethod: boolean;
    overloadGroup: Collect.Id;
    generics: Collect.Id[];
    name: string;
    returnType: Collect.Id;
    parameters: ParameterValue[];
    vararg: boolean;
    export: boolean;
    pub: boolean;
    noemit: boolean;
    methodType: EMethodType;
    extern: EExternLanguage;
    sourceloc: SourceLoc;
    functionScope: Collect.Id | null;
    originalSourcecode: string;
  };

  export type VariableSymbol = {
    variant: ENode.VariableSymbol;
    name: string;
    comptime: boolean;
    inScope: Collect.Id;
    type: Collect.Id | null;
    mutability: EVariableMutability;
    variableContext: EVariableContext;
    sourceloc: SourceLoc;
  };

  export type AliasTypeSymbol = {
    variant: ENode.AliasTypeSymbol;
    name: string;
    inScope: Collect.Id;
    target: Collect.Id;
    sourceloc: SourceLoc;
  };

  export type GlobalVariableDefinition = {
    variant: ENode.GlobalVariableDefinition;
    variableSymbol: Collect.Id;
    comptime: boolean;
    value: Collect.Id | null;
    sourceloc: SourceLoc;
  };

  export type CInjectDirective = {
    variant: ENode.CInjectDirective;
    value: string;
    export: boolean;
    sourceloc: SourceLoc;
  };

  // export const VariableSymbolComponent = defineComponent({
  //   parentScope: Types.eid,
  //   name: Types.eid,
  //   type: Types.eid,
  //   sourceloc: Types.eid,
  //   bindingMutability: Types.ui8,
  // });

  export type Symbols =
    | FunctionSymbol
    | VariableSymbol
    | AliasTypeSymbol
    | GlobalVariableDefinition
    | CInjectDirective;

  /// ===============================================================
  /// ===                       Type Symbols                      ===
  /// ===============================================================

  export type NamedDatatype = {
    variant: ENode.NamedDatatype;
    name: string;
    innerNested: Collect.Id | null;
    genericArgs: Collect.Id[];
    mutability: EDatatypeMutability;
    sourceloc: SourceLoc;
  };

  export type FunctionDatatype = {
    variant: ENode.FunctionDatatype;
    parameters: Collect.Id[];
    returnType: Collect.Id;
    vararg: boolean;
    mutability: EDatatypeMutability;
    sourceloc: SourceLoc;
  };

  export type PointerDatatype = {
    variant: ENode.PointerDatatype;
    pointee: Collect.Id;
    mutability: EDatatypeMutability;
    sourceloc: SourceLoc;
  };

  export type ReferenceDatatype = {
    variant: ENode.ReferenceDatatype;
    referee: Collect.Id;
    mutability: EDatatypeMutability;
    sourceloc: SourceLoc;
  };

  export type ArrayDatatype = {
    variant: ENode.ArrayDatatype;
    datatype: Collect.Id;
    length: number;
    mutability: EDatatypeMutability;
    sourceloc: SourceLoc;
  };

  export type SliceDatatype = {
    variant: ENode.SliceDatatype;
    datatype: Collect.Id;
    mutability: EDatatypeMutability;
    sourceloc: SourceLoc;
  };

  export type ParameterPack = {
    variant: ENode.ParameterPack;
    sourceloc: SourceLoc;
  };

  export type StructDefinitionSymbol = {
    variant: ENode.StructDefinitionSymbol;
    fullyQualifiedName: string;
    parentScope: Collect.Id;
    generics: Collect.Id[];
    defaultMemberValues: {
      name: string;
      value: Collect.Id;
    }[];
    name: string;
    export: boolean;
    clonability: EClonability;
    pub: boolean;
    extern: EExternLanguage;
    noemit: boolean;
    sourceloc: SourceLoc;
    structScope: Collect.Id;
    originalSourcecode: string;
  };

  export type NamespaceSharedInstance = {
    variant: ENode.NamespaceSharedInstance;
    fullyQualifiedName: string;
    namespaceScopes: Set<Collect.Id>;
  };

  export type NamespaceDefinitionSymbol = {
    variant: ENode.NamespaceDefinitionSymbol;
    parentScope: Collect.Id;
    fullyQualifiedName: string;
    name: string;
    extern: EExternLanguage;
    pub: boolean;
    export: boolean;
    sharedInstance: Collect.Id;
    sourceloc: SourceLoc;
    namespaceScope: Collect.Id;
  };

  export type GenericTypeParameter = {
    variant: ENode.GenericTypeParameter;
    name: string;
    owningSymbol: Collect.Id;
    sourceloc: SourceLoc;
  };

  export type Datatypes =
    | NamedDatatype
    | FunctionDatatype
    | PointerDatatype
    | ReferenceDatatype
    | ArrayDatatype
    | SliceDatatype
    | ParameterPack
    | StructDefinitionSymbol
    | NamespaceDefinitionSymbol
    | NamespaceSharedInstance
    | GenericTypeParameter;

  /// ===============================================================
  /// ===                       Statements                        ===
  /// ===============================================================

  type BaseStatement = {
    owningScope: Collect.Id;
    sourceloc: SourceLoc;
  };

  export type ExprStatement = BaseStatement & {
    variant: ENode.ExprStatement;
    expr: Collect.Id;
  };

  export type InlineCStatement = BaseStatement & {
    variant: ENode.InlineCStatement;
    value: string;
  };

  export type ReturnStatement = BaseStatement & {
    variant: ENode.ReturnStatement;
    expr: Collect.Id | null;
  };

  export type BlockScopeStatement = BaseStatement & {
    variant: ENode.BlockScopeStatement;
    blockscope: Collect.Id;
  };

  export type ForEachStatement = BaseStatement & {
    variant: ENode.ForEachStatement;
    loopVariable: string;
    indexVariable: string | null;
    value: Collect.Id;
    comptime: boolean;
    body: Collect.Id;
  };

  export type IfStatement = BaseStatement & {
    variant: ENode.IfStatement;
    condition: Collect.Id;
    comptime: boolean;
    thenBlock: Collect.Id;
    elseif: {
      condition: Collect.Id;
      thenBlock: Collect.Id;
    }[];
    elseBlock: Collect.Id | null;
  };

  export type WhileStatement = BaseStatement & {
    variant: ENode.WhileStatement;
    condition: Collect.Id;
    block: Collect.Id;
  };

  export type VariableDefinitionStatement = BaseStatement & {
    variant: ENode.VariableDefinitionStatement;
    variableSymbol: Collect.Id;
    comptime: boolean;
    value: Collect.Id | null;
  };

  export type TypedefStatement = BaseStatement & {
    variant: ENode.TypeAliasStatement;
    name: string;
    datatype: Collect.Id;
  };

  export type Statements =
    | ExprStatement
    | InlineCStatement
    | ReturnStatement
    | BlockScopeStatement
    | IfStatement
    | ForEachStatement
    | WhileStatement
    | TypedefStatement
    | VariableDefinitionStatement;

  export type StatementsWithoutOwningScope =
    | Omit<ExprStatement, "owningScope">
    | Omit<InlineCStatement, "owningScope">
    | Omit<ReturnStatement, "owningScope">
    | Omit<BlockScopeStatement, "owningScope">
    | Omit<IfStatement, "owningScope">
    | Omit<ForEachStatement, "owningScope">
    | Omit<WhileStatement, "owningScope">
    | Omit<TypedefStatement, "owningScope">
    | Omit<VariableDefinitionStatement, "owningScope">;

  /// ===============================================================
  /// ===                      Expressions                        ===
  /// ===============================================================

  type BaseExpr = {
    sourceloc: SourceLoc;
  };

  export type ParenthesisExpr = BaseExpr & {
    variant: ENode.ParenthesisExpr;
    expr: Collect.Id;
  };

  export type BinaryExpr = BaseExpr & {
    variant: ENode.BinaryExpr;
    left: Collect.Id;
    right: Collect.Id;
    operation: EBinaryOperation;
  };

  export type UnaryExpr = BaseExpr & {
    variant: ENode.UnaryExpr;
    expr: Collect.Id;
    operation: EUnaryOperation;
  };

  export type ExprCallExpr = BaseExpr & {
    variant: ENode.ExprCallExpr;
    calledExpr: Collect.Id;
    arguments: Collect.Id[];
  };

  export type SymbolValueExpr = BaseExpr & {
    variant: ENode.SymbolValueExpr;
    name: string;
    genericArgs: Collect.Id[];
  };

  export type ExplicitCastExpr = BaseExpr & {
    variant: ENode.ExplicitCastExpr;
    expr: Collect.Id;
    targetType: Collect.Id;
  };

  export type StructInstantiationExpr = BaseExpr & {
    variant: ENode.StructInstantiationExpr;
    structType: Collect.Id | null;
    members: {
      name: string;
      value: Collect.Id;
    }[];
  };

  export type ExprAssignmentExpr = BaseExpr & {
    variant: ENode.ExprAssignmentExpr;
    expr: Collect.Id;
    value: Collect.Id;
    operation: EAssignmentOperation;
  };

  export type PointerAddressOfExpr = BaseExpr & {
    variant: ENode.PointerAddressOfExpr;
    expr: Collect.Id;
  };

  export type PointerDereferenceExpr = BaseExpr & {
    variant: ENode.PointerDereferenceExpr;
    expr: Collect.Id;
  };

  export type MemberAccessExpr = BaseExpr & {
    variant: ENode.MemberAccessExpr;
    expr: Collect.Id;
    memberName: string;
    genericArgs: Collect.Id[];
  };

  export type LiteralExpr = BaseExpr & {
    variant: ENode.LiteralExpr;
    literal: LiteralValue;
  };

  export type FStringExpr = BaseExpr & {
    variant: ENode.FStringExpr;
    fragments: ({ type: "expr"; value: Collect.Id } | { type: "text"; value: string })[];
    literal: LiteralValue;
  };

  export type PreIncrExpr = BaseExpr & {
    variant: ENode.PreIncrExpr;
    expr: Collect.Id;
    operation: EIncrOperation;
  };

  export type PostIncrExpr = BaseExpr & {
    variant: ENode.PostIncrExpr;
    expr: Collect.Id;
    operation: EIncrOperation;
  };

  export type ArrayLiteralExpr = BaseExpr & {
    variant: ENode.ArrayLiteralExpr;
    values: Collect.Id[];
  };

  export type ArraySubscriptExpr = BaseExpr & {
    variant: ENode.ArraySubscriptExpr;
    expr: Collect.Id;
    indices: Collect.Id[];
  };

  export type ArraySliceExpr = BaseExpr & {
    variant: ENode.ArraySliceExpr;
    expr: Collect.Id;
    indices: {
      start: Collect.Id | null;
      end: Collect.Id | null;
    }[];
  };

  export type TypeLiteralExpr = BaseExpr & {
    variant: ENode.TypeLiteralExpr;
    datatype: Collect.Id;
  };

  export type Expressions =
    | ParenthesisExpr
    | BinaryExpr
    | UnaryExpr
    | SymbolValueExpr
    | ExprCallExpr
    | ExplicitCastExpr
    | StructInstantiationExpr
    | ExprAssignmentExpr
    | PointerAddressOfExpr
    | PointerDereferenceExpr
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

  export type Node =
    | Scope
    | Overloads
    | Symbols
    | Datatypes
    | Statements
    | Expressions
    | ModuleImport
    | SymbolImport;
}

export function makeSymbol<T extends Collect.Node>(
  cc: CollectionContext,
  symbol: T
): [T, Collect.Id] {
  const id = cc.nodes.length as Collect.Id;
  cc.nodes.push(symbol);
  return [symbol, id];
}

function makeOverloadGroupAvailable(cc: CollectionContext, parentScope: Collect.Id, name: string) {
  for (const group of cc.overloadGroups) {
    const og = cc.nodes.get(group);
    assert(og.variant === Collect.ENode.FunctionOverloadGroup);
    if (og.parentScope === parentScope && og.name === name) {
      return [og, group] as const;
    }
  }
  const [g, gId] = makeSymbol(cc, {
    variant: Collect.ENode.FunctionOverloadGroup,
    name: name,
    overloads: new Set(),
    parentScope: parentScope,
  });
  cc.overloadGroups.add(gId);
  return [g, gId] as const;
}

function makeBlockScope(
  cc: CollectionContext,
  parentScope: Collect.Id,
  sourceloc: SourceLoc
): Collect.Id {
  const parent = cc.nodes.get(parentScope);
  assert(
    parent.variant === Collect.ENode.BlockScope || parent.variant === Collect.ENode.FunctionScope
  );
  const [scope, scopeId] = makeSymbol(cc, {
    variant: Collect.ENode.BlockScope,
    owningSymbol: parent.owningSymbol,
    parentScope: parentScope,
    statements: new Set(),
    sourceloc: sourceloc,
    symbols: new Set(),
  });
  cc.blockScopes.add(scopeId);
  return scopeId;
}

function addStatement(
  cc: CollectionContext,
  parentScope: Collect.Id,
  statement: Collect.StatementsWithoutOwningScope
) {
  const parent = cc.nodes.get(parentScope);
  assert(parent.variant === Collect.ENode.BlockScope);
  const [st, stId] = makeSymbol(cc, {
    ...statement,
    owningScope: parentScope,
  });
  parent.statements.add(stId);
  return st;
}

function defineGenericTypeParameter(
  cc: CollectionContext,
  name: string,
  functionOrStructScopeId: Collect.Id,
  sourceloc: SourceLoc
) {
  const functionOrStructScope = cc.nodes.get(functionOrStructScopeId);
  assert(
    functionOrStructScope.variant === Collect.ENode.FunctionScope ||
      functionOrStructScope.variant === Collect.ENode.StructScope
  );
  const owner = cc.nodes.get(functionOrStructScope.owningSymbol);
  assert(
    owner.variant === Collect.ENode.FunctionSymbol ||
      owner.variant === Collect.ENode.StructDefinitionSymbol
  );
  const [gg, id] = makeSymbol(cc, {
    variant: Collect.ENode.GenericTypeParameter,
    name: name,
    owningSymbol: functionOrStructScope.owningSymbol,
    sourceloc: sourceloc,
  });
  functionOrStructScope.symbols.add(id);
  return id;
}

export function defineVariableSymbol(
  cc: CollectionContext,
  variable: Omit<Collect.VariableSymbol, "inScope">,
  scope: Collect.Id
) {
  const sc = cc.nodes.get(scope);
  assert(
    sc.variant === Collect.ENode.FileScope ||
      sc.variant === Collect.ENode.BlockScope ||
      sc.variant === Collect.ENode.FunctionScope ||
      sc.variant === Collect.ENode.NamespaceScope ||
      sc.variant === Collect.ENode.ModuleScope ||
      sc.variant === Collect.ENode.StructScope
  );

  for (const id of sc.symbols) {
    const s = cc.nodes.get(id);
    if (s.variant === Collect.ENode.VariableSymbol && s.name === variable.name) {
      throw new CompilerError(
        `Symbol '${variable.name}' was already declared in this scope. Previous definition: ${
          (s.sourceloc && formatSourceLoc(s.sourceloc)) || ""
        }`,
        variable.sourceloc
      );
    }
  }

  const [varsym, varSymId] = makeSymbol<Collect.VariableSymbol>(cc, {
    ...variable,
    inScope: scope,
  });
  sc.symbols.add(varSymId);
  return [varsym, varSymId] as const;
}

function collect(
  cc: CollectionContext,
  item:
    | ASTCInjectDirective
    | ASTStructMemberDefinition
    | ASTDatatype
    | ASTLiteralExpr
    | ASTStructDefinition
    | ASTExpr
    | ASTScope
    | ASTStatement
    | ASTCInjectDirective
    | ASTNamespaceDefinition
    | ASTFunctionDefinition
    | ASTGlobalVariableDefinition
    | ASTNamespaceDefinition
    | ASTScope
    | ASTParenthesisExpr
    | ASTExprAssignmentExpr
    | ASTExprCallExpr
    | ASTUnaryExpr
    | ASTExprMemberAccess
    | ASTLambdaExpr
    | ASTPreIncrExpr
    | ASTPointerAddressOfExpr
    | ASTPointerDereferenceExpr
    | ASTPostIncrExpr
    | ASTStructInstantiationExpr
    | ASTExplicitCastExpr
    | ASTBinaryExpr
    | ASTExprAsFuncbody
    | ASTSymbolValueExpr
    | ASTStructDefinition
    | ModuleImport
    | SymbolImport
    | ASTDatatype,
  args: {
    currentParentScope: Collect.Id;
  }
): Collect.Id {
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
        item.name
      );

      if (item.static && item.methodType !== EMethodType.Method) {
        throw new CompilerError(
          `A function that is not a method cannot be marked as 'static'`,
          item.sourceloc
        );
      }

      const parameters = item.params.map((p) => ({
        name: p.name,
        type: collect(cc, p.datatype, args),
        sourceloc: p.sourceloc,
      }));
      const [functionSymbol, functionSymbolId] = makeSymbol<Collect.FunctionSymbol>(cc, {
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
        pub: item.pub,
        noemit: item.noemit,
        vararg: item.ellipsis,
        returnType:
          (item.returnType && collect(cc, item.returnType, args)) ||
          makeSymbol(cc, {
            variant: Collect.ENode.NamedDatatype,
            genericArgs: [],
            innerNested: null,
            name: "void",
            mutability: EDatatypeMutability.Default,
            sourceloc: null,
          })[1],
        sourceloc: item.sourceloc,
        functionScope: null,
        originalSourcecode: item.originalSourcecode,
      });
      overloadGroup.overloads.add(functionSymbolId);

      console.warn("TODO: Check if function is redefined with conflicting parameters");

      if (item.funcbody) {
        const [functionScope, functionScopeId] = makeSymbol(cc, {
          variant: Collect.ENode.FunctionScope,
          owningSymbol: functionSymbolId,
          parentScope: args.currentParentScope,
          sourceloc: item.sourceloc,
          blockScope: -1 as Collect.Id,
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
            sourceloc: item.sourceloc,
          };
        }

        const blockScopeId = collect(cc, item.funcbody, {
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
              mutability: EVariableMutability.Default,
              name: p.name,
              sourceloc: p.sourceloc,
              type: p.type,
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

    case "StructMember": {
      const [member, memberId] = defineVariableSymbol(
        cc,
        {
          variant: Collect.ENode.VariableSymbol,
          name: item.name,
          comptime: false,
          mutability: item.mutability,
          sourceloc: item.sourceloc,
          type: collect(cc, item.type, {
            currentParentScope: args.currentParentScope,
          }),
          variableContext: EVariableContext.MemberOfStruct,
        },
        args.currentParentScope
      );
      return memberId;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprAsFuncBody":
      throw new InternalError("This is handled elsewhere");

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
              collect(cc, item.datatype, { currentParentScope: args.currentParentScope })) ||
            null,
          mutability: item.mutability,
          variableContext: EVariableContext.Global,
          sourceloc: item.sourceloc,
        },
        args.currentParentScope
      );
      const [globvar, globvarId] = makeSymbol(cc, {
        variant: Collect.ENode.GlobalVariableDefinition,
        value:
          (item.expr && collect(cc, item.expr, { currentParentScope: args.currentParentScope })) ||
          null,
        variableSymbol: variableSymbolId,
        comptime: item.comptime,
        sourceloc: item.sourceloc,
      });
      return globvarId;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamespaceDefinition": {
      const parent = cc.nodes.get(args.currentParentScope);
      assert(
        parent.variant === Collect.ENode.FileScope ||
          parent.variant === Collect.ENode.NamespaceScope ||
          parent.variant === Collect.ENode.ModuleScope
      );

      let fullyQualifiedName = "";
      if (parent.variant === Collect.ENode.NamespaceScope) {
        const ns = cc.nodes.get(parent.owningSymbol);
        assert(ns.variant === Collect.ENode.NamespaceDefinitionSymbol);
        fullyQualifiedName += ns.fullyQualifiedName + ".";
      }
      fullyQualifiedName += item.name;

      let [existingNamespace, existingNamespaceId] = [
        undefined as undefined | Collect.NamespaceDefinitionSymbol,
        -1 as Collect.Id,
      ];
      for (const id of parent.symbols) {
        const sym = cc.nodes.get(id);
        if (sym.variant === Collect.ENode.NamespaceDefinitionSymbol && sym.name === item.name) {
          [existingNamespace, existingNamespaceId] = [sym, id];
          break;
        } else if (sym.variant === Collect.ENode.StructDefinitionSymbol && sym.name === item.name) {
          throw new CompilerError(
            `Symbol '${
              item.name
            }' has already been declared as a Struct, which cannot be extended by a namespace. Original definition: ${
              (sym.sourceloc && formatSourceLoc(sym.sourceloc)) || ""
            }`,
            item.sourceloc
          );
        }
      }

      if (existingNamespaceId === -1) {
        let [sharedInstance, sharedInstanceId] = [
          undefined as undefined | Collect.NamespaceSharedInstance,
          -1 as Collect.Id,
        ];
        for (const id of cc.sharedNamespaceInstances) {
          const ni = cc.nodes.get(id);
          assert(ni.variant === Collect.ENode.NamespaceSharedInstance);
          if (ni.fullyQualifiedName === fullyQualifiedName) {
            sharedInstance = ni;
            sharedInstanceId = id;
            break;
          }
        }

        if (sharedInstanceId === -1) {
          [sharedInstance, sharedInstanceId] = makeSymbol(cc, {
            variant: Collect.ENode.NamespaceSharedInstance,
            fullyQualifiedName: fullyQualifiedName,
            namespaceScopes: new Set(),
          });
        }

        [existingNamespace, existingNamespaceId] = makeSymbol(cc, {
          variant: Collect.ENode.NamespaceDefinitionSymbol,
          fullyQualifiedName: fullyQualifiedName,
          sharedInstance: sharedInstanceId,
          name: item.name,
          export: item.export,
          extern: EExternLanguage.None,
          pub: false,
          namespaceScope: -1 as Collect.Id,
          parentScope: args.currentParentScope,
          sourceloc: item.sourceloc,
        });
        const [namespaceScope, namespaceScopeId] = makeSymbol(cc, {
          variant: Collect.ENode.NamespaceScope,
          owningSymbol: existingNamespaceId,
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
        const namespaceScope = cc.nodes.get(existingNamespace.namespaceScope);
        assert(namespaceScope.variant === Collect.ENode.NamespaceScope);
        const decl = collect(cc, s, {
          currentParentScope: existingNamespace.namespaceScope,
        });
        namespaceScope.symbols.add(decl);
      }
      return existingNamespaceId;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructDefinition": {
      const parent = cc.nodes.get(args.currentParentScope);
      assert(
        parent.variant === Collect.ENode.FileScope ||
          parent.variant === Collect.ENode.NamespaceScope ||
          parent.variant === Collect.ENode.ModuleScope ||
          parent.variant === Collect.ENode.StructScope
      );

      let fullyQualifiedName = "";
      if (parent.variant === Collect.ENode.NamespaceScope) {
        const ns = cc.nodes.get(parent.owningSymbol);
        assert(ns.variant === Collect.ENode.NamespaceDefinitionSymbol);
        fullyQualifiedName += ns.fullyQualifiedName + ".";
      } else if (parent.variant === Collect.ENode.StructScope) {
        const ns = cc.nodes.get(parent.owningSymbol);
        assert(ns.variant === Collect.ENode.StructDefinitionSymbol);
        fullyQualifiedName += ns.fullyQualifiedName + ".";
      }
      fullyQualifiedName += item.name;

      for (const id of cc.elaboratedNamespacesAndStructs) {
        const sym = cc.nodes.get(id);
        if (
          sym.variant === Collect.ENode.NamespaceDefinitionSymbol &&
          sym.fullyQualifiedName === fullyQualifiedName
        ) {
          throw new CompilerError(
            `Symbol '${fullyQualifiedName}' has already been declared as a Namespace, which cannot be extended by a struct. Original definition: ${
              (sym.sourceloc && formatSourceLoc(sym.sourceloc)) || ""
            }`,
            item.sourceloc
          );
        } else if (
          sym.variant === Collect.ENode.StructDefinitionSymbol &&
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

      const [struct, structId] = makeSymbol<Collect.StructDefinitionSymbol>(cc, {
        variant: Collect.ENode.StructDefinitionSymbol,
        name: item.name,
        fullyQualifiedName: fullyQualifiedName,
        generics: [],
        defaultMemberValues: [],
        export: item.export,
        extern: item.extern,
        pub: false,
        clonability: item.clonability,
        noemit: item.noemit,
        structScope: -1 as Collect.Id,
        parentScope: args.currentParentScope,
        sourceloc: item.sourceloc,
        originalSourcecode: item.originalSourcecode,
      });
      const [structScope, structScopeId] = makeSymbol<Collect.StructScope>(cc, {
        variant: Collect.ENode.StructScope,
        owningSymbol: structId,
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
        const decl = collect(cc, s, {
          currentParentScope: structScopeId,
        });
        structScope.symbols.add(decl);
      }

      for (const m of item.members) {
        if (m.defaultValue) {
          struct.defaultMemberValues.push({
            name: m.name,
            value: collect(cc, m.defaultValue, { currentParentScope: structScopeId }),
          });
        }
        collect(cc, m, {
          currentParentScope: structScopeId,
        });
      }

      for (const m of item.methods) {
        const funcsym = collect(cc, m, {
          currentParentScope: structScopeId,
        });
        structScope.symbols.add(funcsym);
      }

      if (item.export) {
        cc.exportedSymbols.exported.add(structId);
      }

      return structId;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamedDatatype": {
      return makeSymbol(cc, {
        variant: Collect.ENode.NamedDatatype,
        name: item.name,
        innerNested: (item.nested && collect(cc, item.nested, args)) || null,
        genericArgs: item.generics.map((g) => collect(cc, g, args)),
        mutability: item.mutability,
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PointerDatatype": {
      return makeSymbol(cc, {
        variant: Collect.ENode.PointerDatatype,
        pointee: collect(cc, item.pointee, args),
        mutability: item.mutability,
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ReferenceDatatype": {
      return makeSymbol(cc, {
        variant: Collect.ENode.ReferenceDatatype,
        referee: collect(cc, item.referee, args),
        mutability: item.mutability,
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "CInjectDirective": {
      const symbol = makeSymbol(cc, {
        variant: Collect.ENode.CInjectDirective,
        value: item.code,
        export: item.export,
        sourceloc: item.sourceloc,
      })[1];
      if (item.export) {
        cc.exportedSymbols.exported.add(symbol);
      }
      return symbol;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Scope": {
      const blockScope = makeBlockScope(cc, args.currentParentScope, item.sourceloc);
      for (const astStatement of item.statements) {
        switch (astStatement.variant) {
          case "ExprStatement": {
            addStatement(cc, blockScope, {
              variant: Collect.ENode.ExprStatement,
              expr: collect(cc, astStatement.expr, { currentParentScope: blockScope }),
              sourceloc: astStatement.sourceloc,
            });
            break;
          }

          case "IfStatement": {
            addStatement(cc, blockScope, {
              variant: Collect.ENode.IfStatement,
              comptime: astStatement.comptime,
              condition: collect(cc, astStatement.condition, { currentParentScope: blockScope }),
              elseBlock:
                (astStatement.else &&
                  collect(cc, astStatement.else, { currentParentScope: blockScope })) ||
                null,
              thenBlock: collect(cc, astStatement.then, { currentParentScope: blockScope }),
              elseif: astStatement.elseIfs.map((e) => ({
                condition: collect(cc, e.condition, { currentParentScope: blockScope }),
                thenBlock: collect(cc, e.then, { currentParentScope: blockScope }),
              })),
              sourceloc: astStatement.sourceloc,
            });
            break;
          }

          case "InlineCStatement": {
            addStatement(cc, blockScope, {
              variant: Collect.ENode.InlineCStatement,
              value: astStatement.code,
              sourceloc: astStatement.sourceloc,
            });
            break;
          }

          case "ReturnStatement":
            addStatement(cc, blockScope, {
              variant: Collect.ENode.ReturnStatement,
              expr:
                (astStatement.expr &&
                  collect(cc, astStatement.expr, { currentParentScope: blockScope })) ||
                null,
              sourceloc: astStatement.sourceloc,
            });
            break;

          case "WhileStatement":
            addStatement(cc, blockScope, {
              variant: Collect.ENode.WhileStatement,
              condition: collect(cc, astStatement.condition, { currentParentScope: blockScope }),
              block: collect(cc, astStatement.body, { currentParentScope: blockScope }),
              sourceloc: astStatement.sourceloc,
            });
            break;

          case "TypeAliasStatement":
            addStatement(cc, blockScope, {
              variant: Collect.ENode.TypeAliasStatement,
              datatype: collect(cc, astStatement.datatype, { currentParentScope: blockScope }),
              name: astStatement.name,
              sourceloc: astStatement.sourceloc,
            });
            const [symbol, symbolId] = makeSymbol(cc, {
              variant: Collect.ENode.AliasTypeSymbol,
              inScope: blockScope,
              name: astStatement.name,
              target: collect(cc, astStatement.datatype, { currentParentScope: blockScope }),
              sourceloc: astStatement.sourceloc,
            });
            (cc.nodes.get(blockScope) as Collect.BlockScope).symbols.add(symbolId);
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
                    collect(cc, astStatement.datatype, { currentParentScope: blockScope })) ||
                  null,
                mutability: astStatement.mutability,
                variableContext: astStatement.variableContext,
                sourceloc: astStatement.sourceloc,
              },
              blockScope
            );
            addStatement(cc, blockScope, {
              variant: Collect.ENode.VariableDefinitionStatement,
              sourceloc: astStatement.sourceloc,
              value:
                (astStatement.expr &&
                  collect(cc, astStatement.expr, { currentParentScope: blockScope })) ||
                null,
              comptime: astStatement.comptime,
              variableSymbol: variableSymbolId,
            });
            break;

          case "ForEachStatement": {
            addStatement(cc, blockScope, {
              variant: Collect.ENode.ForEachStatement,
              value: collect(cc, astStatement.value, { currentParentScope: blockScope }),
              body: collect(cc, astStatement.body, { currentParentScope: blockScope }),
              comptime: astStatement.comptime,
              loopVariable: astStatement.loopVariable,
              indexVariable: astStatement.indexVariable,
              sourceloc: astStatement.sourceloc,
            });
            break;
          }

          case "ScopeStatement": {
            addStatement(cc, blockScope, {
              variant: Collect.ENode.BlockScopeStatement,
              blockscope: collect(cc, astStatement.scope, { currentParentScope: blockScope }),
              sourceloc: astStatement.sourceloc,
            });
            break;
          }

          default:
            assert(false, "" + (astStatement as any).variant);
        }
      }
      return blockScope;
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Deferred":
      return -1 as Collect.Id;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDatatype":
      return makeSymbol(cc, {
        variant: Collect.ENode.FunctionDatatype,
        returnType: collect(cc, item.returnType, args),
        parameters: item.params.map((p) => collect(cc, p.datatype, args)),
        vararg: item.ellipsis,
        sourceloc: item.sourceloc,
        mutability: item.mutability,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ArrayDatatype":
      return makeSymbol(cc, {
        variant: Collect.ENode.ArrayDatatype,
        datatype: collect(cc, item.datatype, args),
        length: item.length,
        mutability: item.mutability,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "SliceDatatype":
      return makeSymbol(cc, {
        variant: Collect.ENode.SliceDatatype,
        datatype: collect(cc, item.datatype, args),
        mutability: item.mutability,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ParameterPack":
      return makeSymbol(cc, {
        variant: Collect.ENode.ParameterPack,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ParenthesisExpr": {
      return makeSymbol(cc, {
        variant: Collect.ENode.ParenthesisExpr,
        expr: collect(cc, item.expr, args),
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "BinaryExpr": {
      return makeSymbol(cc, {
        variant: Collect.ENode.BinaryExpr,
        left: collect(cc, item.a, args),
        right: collect(cc, item.b, args),
        operation: item.operation,
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "LiteralExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.LiteralExpr,
        literal: item.literal,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "SymbolValueExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.SymbolValueExpr,
        name: item.name,
        genericArgs: item.generics.map((g) => collect(cc, g, args)),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "LambdaExpr":
      assert(false, "Not implemented yet");
    // item.lambda.funcbody._collect.scope = makeScope(cc, item.sourceloc, functionScope.id);
    // for (const param of item.lambda.params) {
    //   const s: ASTVariableDefinitionStatement = {
    //     variant: "VariableDefinitionStatement",
    //     id: makeModulePrefix(cc.config) + ".vardef." + (cc.config.symbolIdCounter++).toString(),
    //     mutability: false,
    //     name: param.name,
    //     datatype: param.datatype,
    //     sourceloc: param.sourceloc,
    //     variableContext: EVariableContext.FunctionParameter,
    //     _semantic: {},
    //   };
    //   getScope(cc, item.lambda.funcbody._collect.scope).defineSymbol(cc, s);
    //   cc.symbols.set(s.id, s);
    // }

    // for (const param of item.lambda.params) {
    //   collect(cc, functionScope, param.datatype, meta);
    // }
    // if (item.lambda.returnType) {
    //   collect(cc, functionScope, item.lambda.returnType, meta);
    // }

    // collect(cc, getScope(cc, item.lambda.funcbody._collect.scope), item.lambda.funcbody, meta);
    // break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "StructInstantiationExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.StructInstantiationExpr,
        structType: item.datatype ? collect(cc, item.datatype, args) : null,
        members: item.members.map((m) => ({
          name: m.name,
          value: collect(cc, m.value, args),
        })),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "UnaryExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.UnaryExpr,
        expr: collect(cc, item.expr, args),
        operation: item.operation,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PreIncrExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.PreIncrExpr,
        expr: collect(cc, item.expr, args),
        operation: item.operation,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PostIncrExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.PostIncrExpr,
        expr: collect(cc, item.expr, args),
        operation: item.operation,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprMemberAccess":
      return makeSymbol(cc, {
        variant: Collect.ENode.MemberAccessExpr,
        expr: collect(cc, item.expr, args),
        memberName: item.member,
        genericArgs: item.generics.map((g) => collect(cc, g, args)),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExplicitCastExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.ExplicitCastExpr,
        expr: collect(cc, item.expr, args),
        targetType: collect(cc, item.castedTo, args),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PointerAddressOf":
      return makeSymbol(cc, {
        variant: Collect.ENode.PointerAddressOfExpr,
        expr: collect(cc, item.expr, args),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PointerDereference":
      return makeSymbol(cc, {
        variant: Collect.ENode.PointerDereferenceExpr,
        expr: collect(cc, item.expr, args),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprAssignmentExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.ExprAssignmentExpr,
        expr: collect(cc, item.target, args),
        value: collect(cc, item.value, args),
        operation: item.operation,
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprCallExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.ExprCallExpr,
        calledExpr: collect(cc, item.calledExpr, args),
        arguments: item.arguments.map((a) => collect(cc, a, args)),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ArrayLiteralExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.ArrayLiteralExpr,
        values: item.values.map((v) => collect(cc, v, args)),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ArraySubscriptExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.ArraySubscriptExpr,
        expr: collect(cc, item.expr, args),
        indices: item.indices.map((i) => collect(cc, i, args)),
        sourceloc: item.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ArraySliceExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.ArraySliceExpr,
        expr: collect(cc, item.expr, args),
        indices: item.indices.map((i) => ({
          start: i.start ? collect(cc, i.start, args) : null,
          end: i.end ? collect(cc, i.end, args) : null,
        })),
        sourceloc: item.sourceloc,
      })[1];

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
      return makeSymbol(cc, {
        variant: Collect.ENode.AliasTypeSymbol,
        inScope: args.currentParentScope,
        target: makeSymbol(cc, {
          variant: Collect.ENode.NamedDatatype,
          genericArgs: [],
          innerNested: null,
          name: importedNamespace,
          mutability: EDatatypeMutability.Default,
          sourceloc: null,
        })[1],
        mode: item.mode,
        name: item.name,
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "SymbolImport": {
      return makeSymbol(cc, {
        variant: Collect.ENode.SymbolImport,
        symbols: item.symbols,
        mode: item.mode,
        name: item.name,
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "TypeLiteralExpr": {
      return makeSymbol(cc, {
        variant: Collect.ENode.TypeLiteralExpr,
        datatype: collect(cc, item.datatype, { currentParentScope: args.currentParentScope }),
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "TypeAliasStatement": {
      const [symbol, symbolId] = makeSymbol(cc, {
        variant: Collect.ENode.TypeAliasStatement,
        datatype: collect(cc, item.datatype, { currentParentScope: args.currentParentScope }),
        owningScope: args.currentParentScope,
        name: item.name,
        sourceloc: item.sourceloc,
      });
      const [alias, aliasId] = makeSymbol(cc, {
        variant: Collect.ENode.AliasTypeSymbol,
        inScope: args.currentParentScope,
        name: item.name,
        target: collect(cc, item.datatype, { currentParentScope: args.currentParentScope }),
        sourceloc: item.sourceloc,
      });
      (cc.nodes.get(args.currentParentScope) as Collect.BlockScope).symbols.add(aliasId);
      if (item.export) {
        cc.exportedSymbols.exported.add(aliasId);
      }
      return symbolId;
    }

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
  parentScope: Collect.Id,
  filepath: string,
  moduleName: string,
  moduleVersion: string,
  collectionMode: ECollectionMode
) {
  const parent = cc.nodes.get(parentScope);
  assert(
    parent.variant === Collect.ENode.UnitScope || parent.variant === Collect.ENode.ModuleScope
  );

  if (collectionMode === ECollectionMode.WrapIntoModuleNamespace) {
    const [fileScope, fileScopeId] = makeSymbol<Collect.FileScope>(cc, {
      variant: Collect.ENode.FileScope,
      filepath: filepath,
      parentScope: parentScope,
      symbols: new Set(),
    });
    parent.symbols.add(fileScopeId);

    const namespacedDeclarations: ASTGlobalDeclaration[] = [];
    for (const decl of ast) {
      if (
        decl.variant === "CInjectDirective" ||
        decl.variant === "ModuleImport" ||
        decl.variant === "SymbolImport"
      ) {
        const sym = collect(cc, decl, {
          currentParentScope: fileScopeId,
        });
        fileScope.symbols.add(sym);
      } else {
        namespacedDeclarations.push(decl);
      }
    }

    if (namespacedDeclarations.length > 0) {
      const globalNamespaceId = collect(
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
      const sym = collect(cc, decl, {
        currentParentScope: parentScope,
      });
      parent.symbols.add(sym);
    }
  }
}

export function printCollectedDatatype(cc: CollectionContext, typeId: Collect.Id | null): string {
  if (typeId === null) {
    return "?";
  }
  const type = cc.nodes.get(typeId);
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
          str += "<" + n.genericArgs.map((g) => printCollectedDatatype(cc, g)).join(", ") + ">";
        }
        n = (n.innerNested && (cc.nodes.get(n.innerNested) as Collect.NamedDatatype)) || null;
        assert(n === null || n.variant === Collect.ENode.NamedDatatype);
      }
      return str;
    }

    case Collect.ENode.PointerDatatype: {
      return `${printCollectedDatatype(cc, type.pointee)}*`;
    }

    case Collect.ENode.ReferenceDatatype: {
      return `${printCollectedDatatype(cc, type.referee)}&`;
    }

    case Collect.ENode.GenericTypeParameter: {
      return `${type.name} [${typeId}]`;
    }

    case Collect.ENode.LiteralExpr: {
      return Semantic.serializeLiteralValue(type.literal);
    }

    case Collect.ENode.ArrayDatatype: {
      return `[${type.length}]${printCollectedDatatype(cc, type.datatype)}`;
    }

    case Collect.ENode.ParameterPack: {
      return `...`;
    }

    case Collect.ENode.SliceDatatype: {
      return `[]${printCollectedDatatype(cc, type.datatype)}`;
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
      assert(false, type.variant.toString());
  }
}

export function PrettyPrintCollected(cc: CollectionContext) {
  const printExpr = (exprId: Collect.Id): string => {
    const expr = cc.nodes.get(exprId);
    switch (expr.variant) {
      case Collect.ENode.ParenthesisExpr: {
        return `(${printExpr(expr.expr)})`;
      }

      case Collect.ENode.BinaryExpr: {
        return `(${printExpr(expr.left)} ${BinaryOperationToString(expr.operation)} ${printExpr(
          expr.right
        )})`;
      }

      case Collect.ENode.UnaryExpr: {
        return `(${UnaryOperationToString(expr.operation)} ${printExpr(expr.expr)})`;
      }

      case Collect.ENode.ExprCallExpr: {
        return `${printExpr(expr.calledExpr)}(${expr.arguments
          .map((a) => printExpr(a))
          .join(", ")})`;
      }

      case Collect.ENode.SymbolValueExpr: {
        let str = expr.name;
        if (expr.genericArgs.length > 0) {
          str += "<" + expr.genericArgs.map((g) => printCollectedDatatype(cc, g)).join(", ") + ">";
        }
        return str;
      }

      case Collect.ENode.StructInstantiationExpr: {
        return (
          `${printCollectedDatatype(cc, expr.structType)} {` +
          expr.members.map((a) => `${a.name}: ${printExpr(a.value)}`).join(", ") +
          "}"
        );
      }

      case Collect.ENode.LiteralExpr: {
        if (expr.literal.type === EPrimitive.null) {
          return "null";
        } else if (expr.literal.type !== EPrimitive.str && expr.literal.type !== EPrimitive.c_str) {
          return `${primitiveToString(expr.literal.type)}(${expr.literal.value})`;
        } else {
          return `${JSON.stringify(expr.literal.value)}`;
        }
      }

      case Collect.ENode.ExplicitCastExpr: {
        return `${printExpr(expr.expr)} as ${printCollectedDatatype(cc, expr.targetType)}`;
      }

      case Collect.ENode.MemberAccessExpr: {
        let str = `${printExpr(expr.expr)}.${expr.memberName}`;
        if (expr.genericArgs.length > 0) {
          str += "<" + expr.genericArgs.map((g) => printCollectedDatatype(cc, g)).join(", ") + ">";
        }
        return str;
      }

      case Collect.ENode.ExprAssignmentExpr: {
        return `${printExpr(expr.expr)} ${AssignmentOperationToString(expr.operation)} ${printExpr(
          expr.value
        )}`;
      }

      case Collect.ENode.PreIncrExpr: {
        return `${printExpr(expr.expr)}${IncrOperationToString(expr.operation)}`;
      }

      case Collect.ENode.PostIncrExpr: {
        return `${printExpr(expr.expr)}${IncrOperationToString(expr.operation)}`;
      }

      case Collect.ENode.ArraySubscriptExpr: {
        const indices: string[] = [];
        for (const index of expr.indices) {
          indices.push(printExpr(index));
        }
        return `${printExpr(expr.expr)}[${indices.join(", ")}]`;
      }

      case Collect.ENode.ArraySliceExpr: {
        const indices: string[] = [];
        for (const index of expr.indices) {
          if (index.start && index.end) {
            indices.push(printExpr(index.start) + ":" + printExpr(index.end));
          } else if (index.start) {
            indices.push(printExpr(index.start));
          } else if (index.end) {
            indices.push(printExpr(index.end));
          } else {
            assert(false);
          }
        }
        return `${printExpr(expr.expr)}[${indices.join(", ")}]`;
      }

      case Collect.ENode.ArrayLiteralExpr: {
        return `[${expr.values.map((v) => printExpr(v)).join(", ")}]`;
      }

      case Collect.ENode.PointerAddressOfExpr: {
        return `&${printExpr(expr.expr)}`;
      }

      case Collect.ENode.PointerDereferenceExpr: {
        return `*${printExpr(expr.expr)}`;
      }

      case Collect.ENode.TypeLiteralExpr: {
        return `type<${printCollectedDatatype(cc, expr.datatype)}>`;
      }

      default:
        assert(false, expr.variant.toString());
    }
  };

  const printSymbol = (symbolId: Collect.Id, indent: number) => {
    const symbol = cc.nodes.get(symbolId);
    const print = (str: string, _indent = 0) => {
      console.info(`[${symbolId}]` + " ".repeat(indent + _indent) + str);
    };

    switch (symbol.variant) {
      case Collect.ENode.ModuleScope:
        print(`ModuleScope id=${symbolId}`);
        for (const id of symbol.symbols) {
          printSymbol(id, indent + 2);
        }
        break;

      case Collect.ENode.UnitScope:
        print(`- UnitScope id=${symbolId}`);
        for (const id of symbol.symbols) {
          printSymbol(id, indent + 2);
        }
        break;

      case Collect.ENode.FileScope:
        print(`- FileScope id=${symbolId} ${symbol.filepath}`);
        for (const id of symbol.symbols) {
          printSymbol(id, indent + 4);
        }
        break;

      case Collect.ENode.VariableSymbol:
        print(
          `- VariableSymbol id=${symbolId} name=${symbol.name} type=${printCollectedDatatype(
            cc,
            symbol.type
          )}`
        );
        break;

      case Collect.ENode.GenericTypeParameter:
        print(`- Generic ${symbol.name}`);
        break;

      case Collect.ENode.GlobalVariableDefinition:
        print(
          `- Glob Var Def Statement id=${symbolId} variable=${symbol.variableSymbol} value=${symbol.value}`
        );
        break;

      case Collect.ENode.FunctionOverloadGroup:
        print(`- Overload ${symbol.name}`);
        for (const id of symbol.overloads) {
          printSymbol(id, indent + 4);
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
        print(`- Function ${ftype}`);
        if (symbol.functionScope) {
          printSymbol(symbol.functionScope, indent + 4);
        }
        break;
      }

      case Collect.ENode.StructDefinitionSymbol: {
        print(`- Struct ${symbol.name}`);
        printSymbol(symbol.structScope, indent + 4);
        break;
      }

      case Collect.ENode.ExprStatement: {
        print(`${printExpr(symbol.expr)};`);
        break;
      }

      case Collect.ENode.ReturnStatement: {
        if (symbol.expr) {
          print(`return ${printExpr(symbol.expr)};`);
        } else {
          print("return;");
        }
        break;
      }

      case Collect.ENode.NamespaceDefinitionSymbol: {
        print(`- Namespace ${symbol.name}`);
        printSymbol(symbol.namespaceScope, indent + 4);
        break;
      }

      case Collect.ENode.StructScope: {
        print(`{`);
        for (const id of symbol.symbols) {
          printSymbol(id, indent + 2);
        }
        print(`}`);
        break;
      }

      case Collect.ENode.FunctionScope: {
        print(`{`);
        for (const id of symbol.symbols) {
          printSymbol(id, indent + 2);
        }
        printSymbol(symbol.blockScope, indent + 2);
        print(`}`);
        break;
      }

      case Collect.ENode.NamespaceScope: {
        print(`{`);
        for (const id of symbol.symbols) {
          printSymbol(id, indent + 2);
        }
        print(`}`);
        break;
      }

      case Collect.ENode.BlockScope: {
        print(`Block {`);
        for (const id of symbol.symbols) {
          printSymbol(id, indent + 2);
        }
        for (const id of symbol.statements) {
          printSymbol(id, indent + 2);
        }
        print(`}`);
        break;
      }

      case Collect.ENode.IfStatement: {
        print(`If (${printExpr(symbol.condition)})`);
        printSymbol(symbol.thenBlock, indent + 2);
        for (const elif of symbol.elseif) {
          print(`ElseIf (${printExpr(elif.condition)})`);
          printSymbol(elif.thenBlock, indent + 2);
        }
        if (symbol.elseBlock) {
          print(`Else`);
          printSymbol(symbol.elseBlock, indent + 2);
        }
        break;
      }

      case Collect.ENode.WhileStatement: {
        print(`While (${printExpr(symbol.condition)})`);
        printSymbol(symbol.block, indent + 2);
        break;
      }

      case Collect.ENode.VariableDefinitionStatement: {
        if (symbol.value) {
          print(`var ${symbol.variableSymbol} = ${printExpr(symbol.value)};`);
        } else {
          print(`var ${symbol.variableSymbol};`);
        }
        break;
      }

      case Collect.ENode.CInjectDirective: {
        print(`- __c__(${symbol.value})`);
        break;
      }

      case Collect.ENode.ModuleImport: {
        if (symbol.mode === "module") {
          print(`import ${symbol.name}${symbol.alias ? " as " + symbol.alias : ""}`);
        } else {
          print(`import "${symbol.name}"${symbol.alias ? " as " + symbol.alias : ""}`);
        }
        break;
      }

      case Collect.ENode.SymbolImport: {
        let symbols: string[] = [];
        for (const s of symbol.symbols) {
          if (s.alias) {
            symbols.push(`${s.symbol} as ${s.alias}`);
          } else {
            symbols.push(`${s.symbol}`);
          }
        }
        if (symbol.mode === "module") {
          print(`from ${symbol.name} import ${symbols.join(", ")}`);
        } else {
          print(`from "${symbol.name}" import ${symbols.join(", ")}`);
        }
        break;
      }

      case Collect.ENode.TypeAliasStatement: {
        print(`type ${symbol.name} = ${printCollectedDatatype(cc, symbol.datatype)};`);
        break;
      }

      case Collect.ENode.AliasTypeSymbol: {
        print(`alias ${symbol.name} = ${printCollectedDatatype(cc, symbol.target)};`);
        break;
      }

      case Collect.ENode.InlineCStatement: {
        print(`__c__(${JSON.stringify(symbol.value)})`);
        break;
      }

      case Collect.ENode.BlockScopeStatement: {
        printSymbol(symbol.blockscope, indent + 2);
        break;
      }

      case Collect.ENode.ForEachStatement: {
        print(
          `for ${symbol.comptime ? "comptime " : ""}${symbol.loopVariable} in ${printExpr(
            symbol.value
          )}`
        );
        printSymbol(symbol.body, indent + 2);
        break;
      }

      default:
        assert(false, symbol.variant.toString());
    }
  };

  printSymbol(0 as Collect.Id, 2);
}
