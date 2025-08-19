import {
  assert,
  CompilerError,
  formatSourceLoc,
  InternalError,
  type SourceLoc,
} from "../shared/Errors";
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
  EVariableMutability,
  type ASTCInjectDirective,
  type ASTExpr,
  type ASTStatement,
  type EAssignmentOperation,
  type EBinaryOperation,
  type EIncrOperation,
  type EUnaryOperation,
} from "../shared/AST";
import type { ExportData, ModuleConfig } from "../shared/Config";
import { serializeLiteralValue } from "../Semantic/Serialize";

export type CollectionContext = {
  config: ModuleConfig;
  nodes: BrandedArray<Collect.Id, Collect.Node>;

  // Helper utilities
  overloadGroups: Set<Collect.Id>;
  blockScopes: Set<Collect.Id>;
  sharedNamespaceInstances: Set<Collect.Id>;

  exportedSymbols: ExportData;
  // exportCache: Map<Collect.Id, ImpExp.Id>;
};

export function makeCollectionContext(config: ModuleConfig): CollectionContext {
  const cc: CollectionContext = {
    config: config,
    nodes: new BrandedArray([
      {
        variant: Collect.ENode.ModuleScope,
        units: [],
      },
    ]),
    blockScopes: new Set(),
    overloadGroups: new Set(),
    sharedNamespaceInstances: new Set(),
    exportedSymbols: {
      exported: new Set(),
    },
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
    StructDefinitionSymbol,
    NamespaceSharedInstance,
    NamespaceDefinitionSymbol,
    GenericTypeParameter,
    CInjectDirective,
    ExprStatement,
    IfStatement,
    WhileStatement,
    TypedefStatement,
    ReturnStatement,
    InlineCStatement,
    BlockScopeStatement,
    VariableDefinitionStatement,
    FunctionDatatype,
    ParenthesisExpr,
    BinaryExpr,
    LiteralExpr,
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
    // Specials
    ModuleImport,
    SymbolImport,
  }

  /// ===============================================================
  /// ===                         Scopes                          ===
  /// ===============================================================

  export type ModuleScope = {
    variant: ENode.ModuleScope;
    units: Collect.Id[];
  };

  export type UnitScope = {
    variant: ENode.UnitScope;
    parentScope: Collect.Id;
    files: Collect.Id[];
  };

  export type ExportScope = {
    variant: ENode.ExportScope;
    symbols: Collect.Id[];
  };

  export type FileScope = {
    variant: ENode.FileScope;
    filepath: string;
    parentScope: Collect.Id;
    symbols: Collect.Id[];
  };

  export type FunctionScope = {
    variant: ENode.FunctionScope;
    parentScope: Collect.Id;
    owningSymbol: Collect.Id;
    sourceloc: SourceLoc;
    blockScope: Collect.Id;
    symbols: Collect.Id[];
  };

  export type StructScope = {
    variant: ENode.StructScope;
    parentScope: Collect.Id;
    owningSymbol: Collect.Id;
    sourceloc: SourceLoc;
    symbols: Collect.Id[];
  };

  export type NamespaceScope = {
    variant: ENode.NamespaceScope;
    parentScope: Collect.Id;
    owningSymbol: Collect.Id;
    sourceloc: SourceLoc;
    symbols: Collect.Id[];
  };

  export type BlockScope = {
    variant: ENode.BlockScope;
    parentScope: Collect.Id;
    owningSymbol: Collect.Id;
    sourceloc: SourceLoc;
    statements: Collect.Id[];
    symbols: Collect.Id[];
  };

  export type Scope =
    | ModuleScope
    | UnitScope
    | ExportScope
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
    overloads: Collect.Id[];
  };

  export type Overloads = FunctionOverloadGroup;

  /// ===============================================================
  /// ===                          Symbols                        ===
  /// ===============================================================

  export type FunctionSymbol = {
    variant: ENode.FunctionSymbol;
    parentScope: Collect.Id;
    overloadGroup: Collect.Id;
    generics: Collect.Id[];
    returnType: Collect.Id;
    parameters: {
      name: string;
      type: Collect.Id;
      sourceloc: SourceLoc;
    }[];
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
    value: Collect.Id | null;
    sourceloc: SourceLoc;
  };

  export type CInjectDirective = {
    variant: ENode.CInjectDirective;
    value: string;
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
    sourceloc: SourceLoc;
  };

  export type FunctionDatatype = {
    variant: ENode.FunctionDatatype;
    parameters: Collect.Id[];
    returnType: Collect.Id;
    vararg: boolean;
    sourceloc: SourceLoc;
  };

  export type PointerDatatype = {
    variant: ENode.PointerDatatype;
    pointee: Collect.Id;
    sourceloc: SourceLoc;
  };

  export type ReferenceDatatype = {
    variant: ENode.ReferenceDatatype;
    referee: Collect.Id;
    sourceloc: SourceLoc;
  };

  export type StructDefinitionSymbol = {
    variant: ENode.StructDefinitionSymbol;
    parentScope: Collect.Id;
    generics: Collect.Id[];
    name: string;
    export: boolean;
    pub: boolean;
    extern: EExternLanguage;
    noemit: boolean;
    sourceloc: SourceLoc;
    structScope: Collect.Id;
  };

  export type NamespaceSharedInstance = {
    variant: ENode.NamespaceSharedInstance;
    fullyQualifiedName: string;
    namespaceScopes: Collect.Id[];
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

  export type IfStatement = BaseStatement & {
    variant: ENode.IfStatement;
    condition: Collect.Id;
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
    value: Collect.Id | null;
  };

  export type TypedefStatement = BaseStatement & {
    variant: ENode.TypedefStatement;
    name: string;
    datatype: Collect.Id;
  };

  export type Statements =
    | ExprStatement
    | InlineCStatement
    | ReturnStatement
    | BlockScopeStatement
    | IfStatement
    | WhileStatement
    | TypedefStatement
    | VariableDefinitionStatement;

  export type StatementsWithoutOwningScope =
    | Omit<ExprStatement, "owningScope">
    | Omit<InlineCStatement, "owningScope">
    | Omit<ReturnStatement, "owningScope">
    | Omit<BlockScopeStatement, "owningScope">
    | Omit<IfStatement, "owningScope">
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
    structType: Collect.Id;
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
    overloads: [],
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
    statements: [],
    sourceloc: sourceloc,
    symbols: [],
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
  parent.statements.push(stId);
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
  functionOrStructScope.symbols.push(id);
  return id;
}

function defineVariableSymbol(
  cc: CollectionContext,
  variable: Omit<Collect.VariableSymbol, "inScope">,
  scope: Collect.Id
) {
  const sc = cc.nodes.get(scope);
  assert(
    sc.variant === Collect.ENode.FileScope ||
      sc.variant === Collect.ENode.BlockScope ||
      sc.variant === Collect.ENode.FunctionScope ||
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
  sc.symbols.push(varSymId);
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
    | ASTLiteralExpr
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
            name: "none",
            sourceloc: null,
          })[1],
        sourceloc: item.sourceloc,
        functionScope: null,
        originalSourcecode: item.originalSourcecode,
      });
      overloadGroup.overloads.push(functionSymbolId);

      console.warn("TODO: Check if function is redefined with conflicting parameters");

      if (item.funcbody) {
        const [functionScope, functionScopeId] = makeSymbol(cc, {
          variant: Collect.ENode.FunctionScope,
          owningSymbol: functionSymbolId,
          parentScope: args.currentParentScope,
          sourceloc: item.sourceloc,
          blockScope: -1 as Collect.Id,
          symbols: [],
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
              mutability: EVariableMutability.Mutable,
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
              mutability: EVariableMutability.Immutable,
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
        // ExportCollectedSymbol(cc, functionSymbolId);
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
          mutability: EVariableMutability.Mutable,
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
          parent.variant === Collect.ENode.NamespaceScope
      );

      let [existingNamespace, existingNamespaceId] = [
        undefined as undefined | Collect.NamespaceDefinitionSymbol,
        -1 as Collect.Id,
      ];
      for (const id of parent.symbols) {
        const sym = cc.nodes.get(id);
        if (sym.variant === Collect.ENode.NamespaceDefinitionSymbol && sym.name === item.name) {
          if (sym.name === item.name) {
            [existingNamespace, existingNamespaceId] = [sym, id];
            break;
          }
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

      let fullyQualifiedName = "";
      if (parent.variant === Collect.ENode.NamespaceScope) {
        const ns = cc.nodes.get(parent.owningSymbol);
        assert(ns.variant === Collect.ENode.NamespaceDefinitionSymbol);
        fullyQualifiedName += ns.fullyQualifiedName + ".";
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
            namespaceScopes: [],
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
          symbols: [],
        });
        assert(sharedInstance);
        existingNamespace.namespaceScope = namespaceScopeId;
        sharedInstance.namespaceScopes.push(namespaceScopeId);
      }

      assert(existingNamespace);
      for (const s of item.declarations) {
        const namespaceScope = cc.nodes.get(existingNamespace.namespaceScope);
        assert(namespaceScope.variant === Collect.ENode.NamespaceScope);
        const decl = collect(cc, s, {
          currentParentScope: existingNamespace.namespaceScope,
        });
        namespaceScope.symbols.push(decl);
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
          parent.variant === Collect.ENode.StructScope
      );
      for (const id of parent.symbols) {
        const sym = cc.nodes.get(id);
        if (sym.variant === Collect.ENode.NamespaceDefinitionSymbol && sym.name === item.name) {
          throw new CompilerError(
            `Symbol '${
              item.name
            }' has already been declared as a Namespace, which cannot be extended by a struct. Original definition: ${
              (sym.sourceloc && formatSourceLoc(sym.sourceloc)) || ""
            }`,
            item.sourceloc
          );
        } else if (sym.variant === Collect.ENode.StructDefinitionSymbol && sym.name === item.name) {
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
        generics: [],
        export: item.export,
        extern: item.extern,
        pub: false,
        noemit: item.noemit,
        structScope: -1 as Collect.Id,
        parentScope: args.currentParentScope,
        sourceloc: item.sourceloc,
      });
      const [structScope, structScopeId] = makeSymbol<Collect.StructScope>(cc, {
        variant: Collect.ENode.StructScope,
        owningSymbol: structId,
        parentScope: args.currentParentScope,
        sourceloc: item.sourceloc,
        symbols: [],
      });
      struct.structScope = structScopeId;

      for (const g of item.generics) {
        const generic = defineGenericTypeParameter(cc, g.name, structScopeId, g.sourceloc);
        struct.generics.push(generic);
      }

      for (const s of item.nestedStructs) {
        const decl = collect(cc, s, {
          currentParentScope: structScopeId,
        });
        structScope.symbols.push(decl);
      }

      for (const m of item.members) {
        collect(cc, m, {
          currentParentScope: structScopeId,
        });
      }

      for (const m of item.methods) {
        const funcsym = collect(cc, m, {
          currentParentScope: structScopeId,
        });
        structScope.symbols.push(funcsym);
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
        // referee: collect(cc, item.n, args),
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
        sourceloc: item.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "CInjectDirective": {
      return makeSymbol(cc, {
        variant: Collect.ENode.CInjectDirective,
        value: item.code,
        sourceloc: item.sourceloc,
      })[1];
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

          case "TypedefStatement":
            addStatement(cc, blockScope, {
              variant: Collect.ENode.TypedefStatement,
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
            (cc.nodes.get(blockScope) as Collect.BlockScope).symbols.push(symbolId);
            break;

          case "VariableDefinitionStatement":
            const [variableSymbol, variableSymbolId] = defineVariableSymbol(
              cc,
              {
                variant: Collect.ENode.VariableSymbol,
                name: astStatement.name,
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
              variableSymbol: variableSymbolId,
            });
            break;
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
        structType: collect(cc, item.datatype, args),
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

    case "ModuleImport": {
      return makeSymbol(cc, {
        variant: Collect.ENode.ModuleImport,
        alias: item.alias,
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

    case "TypedefStatement": {
      const [symbol, symbolId] = makeSymbol(cc, {
        variant: Collect.ENode.TypedefStatement,
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
      (cc.nodes.get(args.currentParentScope) as Collect.BlockScope).symbols.push(aliasId);
      return symbolId;
    }

    default:
      assert(false, "All cases handled " + item.variant);
  }
}

export function CollectFileInUnit(
  cc: CollectionContext,
  ast: ASTRoot,
  unitScope: Collect.Id,
  filepath: string
) {
  const unit = cc.nodes.get(unitScope);
  assert(unit.variant === Collect.ENode.UnitScope);

  const [fileScope, fileScopeId] = makeSymbol<Collect.FileScope>(cc, {
    variant: Collect.ENode.FileScope,
    filepath: filepath,
    parentScope: unitScope,
    symbols: [],
  });
  unit.files.push(fileScopeId);

  for (const decl of ast) {
    const sym = collect(cc, decl, {
      currentParentScope: fileScopeId,
    });
    fileScope.symbols.push(sym);
  }

  // const globalScope = getEntityByComponent(cc, Collect.ModuleScopeComponent);
  // assert(globalScope);
  // const mermaid = exportMermaidScopeTree(cc);
  // console.log(mermaid);
  // Bun.write("log.md", mermaid);
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
      return serializeLiteralValue(type.literal);
    }

    default:
      assert(false, type.variant.toString());
  }
}

export function PrettyPrintCollected(cc: CollectionContext) {
  console.log("C Injections:");
  // for (const i of cc.cInjections) {
  //   console.log(" - " + i.code);
  // }
  console.log("\n");

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
        if (expr.literal.type !== EPrimitive.str) {
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

      default:
        assert(false, expr.variant.toString());
    }
  };

  const printSymbol = (symbolId: Collect.Id, indent: number) => {
    const symbol = cc.nodes.get(symbolId);
    const print = (str: string, _indent = 0) => {
      console.log(`[${symbolId}]` + " ".repeat(indent + _indent) + str);
    };

    switch (symbol.variant) {
      case Collect.ENode.ModuleScope:
        print(`ModuleScope id=${symbolId}`);
        cc.nodes.forEach((inner, i) => {
          if (inner.variant === Collect.ENode.UnitScope && inner.parentScope === symbolId) {
            printSymbol(i, indent + 2);
          }
        });
        break;

      case Collect.ENode.UnitScope:
        print(`- UnitScope id=${symbolId}`);
        cc.nodes.forEach((inner, i) => {
          if (inner.variant === Collect.ENode.FileScope && inner.parentScope === symbolId) {
            printSymbol(i, indent + 4);
          }
        });
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

      case Collect.ENode.TypedefStatement: {
        print(`type ${symbol.name} = ${printCollectedDatatype(cc, symbol.datatype)};`);
        break;
      }

      case Collect.ENode.AliasTypeSymbol: {
        print(`alias ${symbol.name} = ${printCollectedDatatype(cc, symbol.target)};`);
        break;
      }

      default:
        assert(false, symbol.variant.toString());
    }
  };

  printSymbol(0 as Collect.Id, 2);
}
