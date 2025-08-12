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
  type ASTLiteralExpr,
  type ASTDatatype,
  type ASTExplicitCastExpr,
  type ASTExprAsFuncbody,
  type ASTExprAssignmentExpr,
  type ASTExprCallExpr,
  type ASTExprMemberAccess,
  type ASTFunctionDefinition,
  type ASTGlobalVariableDefinition,
  type ASTLambdaExpr,
  type ASTNamedDatatype,
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
  type ASTVariableDefinitionStatement,
  BinaryOperationToString,
  UnaryOperationToString,
} from "../shared/AST";
import {
  BrandedArray,
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
import type { ModuleConfig } from "../shared/Config";

export type CollectionContext = {
  config: ModuleConfig;
  nodes: BrandedArray<Collect.Id, Collect.Node>;

  // Helper utilities
  overloadGroups: Set<Collect.Id>;
  blockScopes: Set<Collect.Id>;
  sharedNamespaceInstances: Set<Collect.Id>;
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
  };
  return cc;
}

export namespace Collect {
  export type Id = Brand<number, "Collect">;
  export const enum ENode {
    ModuleScope,
    UnitScope,
    FileScope,
    FunctionScope,
    StructScope,
    NamespaceScope,
    BlockScope,
    FunctionOverloadGroup,
    FunctionSymbol,
    VariableSymbol,
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
    extern: EExternLanguage;
    sourceloc: SourceLoc;
    functionScope: Collect.Id | null;
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

  export type Statements =
    | ExprStatement
    | InlineCStatement
    | ReturnStatement
    | BlockScopeStatement
    | IfStatement
    | WhileStatement
    | VariableDefinitionStatement;

  export type StatementsWithoutOwningScope =
    | Omit<ExprStatement, "owningScope">
    | Omit<InlineCStatement, "owningScope">
    | Omit<ReturnStatement, "owningScope">
    | Omit<BlockScopeStatement, "owningScope">
    | Omit<IfStatement, "owningScope">
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

  export type Node = Scope | Overloads | Symbols | Datatypes | Statements | Expressions;
}

export function makeSymbol(cc: CollectionContext, symbol: Collect.Node): Collect.Id {
  cc.nodes.push(symbol);
  return (cc.nodes.length - 1) as Collect.Id;
}

function makeOverloadGroupAvailable(cc: CollectionContext, parentScope: Collect.Id, name: string) {
  for (const group of cc.overloadGroups) {
    const og = cc.nodes.get(group);
    assert(og.variant === Collect.ENode.FunctionOverloadGroup);
    if (og.parentScope === parentScope && og.name === name) {
      return group;
    }
  }
  const g = makeSymbol(cc, {
    variant: Collect.ENode.FunctionOverloadGroup,
    name: name,
    overloads: [],
    parentScope: parentScope,
  });
  cc.overloadGroups.add(g);
  return g;
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
  const scope = makeSymbol(cc, {
    variant: Collect.ENode.BlockScope,
    owningSymbol: parent.owningSymbol,
    parentScope: parentScope,
    statements: [],
    sourceloc: sourceloc,
    symbols: [],
  });
  cc.blockScopes.add(scope);
  return scope;
}

function addStatement(
  cc: CollectionContext,
  parentScope: Collect.Id,
  statement: Collect.StatementsWithoutOwningScope
) {
  const parent = cc.nodes.get(parentScope);
  assert(parent.variant === Collect.ENode.BlockScope);
  const st = makeSymbol(cc, {
    ...statement,
    owningScope: parentScope,
  });
  parent.statements.push(st);
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
  const gg = makeSymbol(cc, {
    variant: Collect.ENode.GenericTypeParameter,
    name: name,
    owningSymbol: functionOrStructScope.owningSymbol,
    sourceloc: sourceloc,
  });
  functionOrStructScope.symbols.push(gg);
  return gg;
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

  const varsym = makeSymbol(cc, {
    ...variable,
    inScope: scope,
  });
  sc.symbols.push(varsym);
  return varsym;
}

function collect(
  cc: CollectionContext,
  item:
    | ASTCInjectDirective
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
      const overloadGroup = makeOverloadGroupAvailable(cc, args.currentParentScope, item.name);

      const parameters = item.params.map((p) => ({
        name: p.name,
        type: collect(cc, p.datatype, args),
        sourceloc: p.sourceloc,
      }));
      const functionSymbol = makeSymbol(cc, {
        variant: Collect.ENode.FunctionSymbol,
        export: item.export,
        extern: item.externLanguage,
        generics: [],
        overloadGroup: overloadGroup,
        parameters: parameters,
        parentScope: args.currentParentScope,
        pub: item.pub,
        vararg: item.ellipsis,
        returnType:
          (item.returnType && collect(cc, item.returnType, args)) ||
          makeSymbol(cc, {
            variant: Collect.ENode.NamedDatatype,
            genericArgs: [],
            innerNested: null,
            name: "none",
            sourceloc: null,
          }),
        sourceloc: item.sourceloc,
        functionScope: null,
      });
      (cc.nodes.get(overloadGroup) as Collect.FunctionOverloadGroup).overloads.push(functionSymbol);

      console.warn("TODO: Check if function is redefined with conflicting parameters");

      if (item.funcbody) {
        const funcSym = cc.nodes.get(functionSymbol);
        assert(funcSym.variant === Collect.ENode.FunctionSymbol);

        const functionScope = makeSymbol(cc, {
          variant: Collect.ENode.FunctionScope,
          owningSymbol: functionSymbol,
          parentScope: args.currentParentScope,
          sourceloc: item.sourceloc,
          blockScope: -1 as Collect.Id,
          symbols: [],
        });
        (cc.nodes.get(functionSymbol) as Collect.FunctionSymbol).functionScope = functionScope;

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

        const blockScope = collect(cc, item.funcbody, {
          currentParentScope: functionScope,
        });
        (cc.nodes.get(functionScope) as Collect.FunctionScope).blockScope = blockScope;

        for (const g of item.generics) {
          const generic = defineGenericTypeParameter(cc, g.name, functionScope, g.sourceloc);
          (cc.nodes.get(functionSymbol) as Collect.FunctionSymbol).generics.push(generic);
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
            functionScope
          );
        }
      }

      return overloadGroup;
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
      const variableSymbol = defineVariableSymbol(
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
      const globvar = makeSymbol(cc, {
        variant: Collect.ENode.GlobalVariableDefinition,
        value:
          (item.expr && collect(cc, item.expr, { currentParentScope: args.currentParentScope })) ||
          null,
        variableSymbol: variableSymbol,
        sourceloc: item.sourceloc,
      });
      return globvar;
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

      let existingNamespace = -1 as Collect.Id;
      for (const id of parent.symbols) {
        const sym = cc.nodes.get(id);
        if (sym.variant === Collect.ENode.NamespaceDefinitionSymbol && sym.name === item.name) {
          if (sym.name === item.name) {
            existingNamespace = id;
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

      if (existingNamespace === -1) {
        let sharedInstance = -1 as Collect.Id;
        for (const id of cc.sharedNamespaceInstances) {
          const ni = cc.nodes.get(id);
          assert(ni.variant === Collect.ENode.NamespaceSharedInstance);
          if (ni.fullyQualifiedName === fullyQualifiedName) {
            sharedInstance = id;
            break;
          }
        }

        if (sharedInstance === -1) {
          sharedInstance = makeSymbol(cc, {
            variant: Collect.ENode.NamespaceSharedInstance,
            fullyQualifiedName: fullyQualifiedName,
            namespaceScopes: [],
          });
        }

        existingNamespace = makeSymbol(cc, {
          variant: Collect.ENode.NamespaceDefinitionSymbol,
          fullyQualifiedName: fullyQualifiedName,
          sharedInstance: sharedInstance,
          name: item.name,
          export: item.export,
          extern: EExternLanguage.None,
          pub: false,
          namespaceScope: -1 as Collect.Id,
          parentScope: args.currentParentScope,
          sourceloc: item.sourceloc,
        });
        const namespaceScope = makeSymbol(cc, {
          variant: Collect.ENode.NamespaceScope,
          owningSymbol: existingNamespace,
          parentScope: args.currentParentScope,
          sourceloc: item.sourceloc,
          symbols: [],
        });
        (cc.nodes.get(existingNamespace) as Collect.NamespaceDefinitionSymbol).namespaceScope =
          namespaceScope;
        (cc.nodes.get(sharedInstance) as Collect.NamespaceSharedInstance).namespaceScopes.push(
          namespaceScope
        );
      }

      for (const s of item.declarations) {
        const namespaceScope = (
          cc.nodes.get(existingNamespace) as Collect.NamespaceDefinitionSymbol
        ).namespaceScope;
        const decl = collect(cc, s, {
          currentParentScope: namespaceScope,
        });
        const symbols = (cc.nodes.get(namespaceScope) as Collect.NamespaceScope).symbols;
        symbols.push(decl);
      }
      return existingNamespace;
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

      const struct = makeSymbol(cc, {
        variant: Collect.ENode.StructDefinitionSymbol,
        name: item.name,
        generics: [],
        export: item.export,
        extern: EExternLanguage.None,
        pub: false,
        noemit: item.noemit,
        structScope: -1 as Collect.Id,
        parentScope: args.currentParentScope,
        sourceloc: item.sourceloc,
      });
      const structScope = makeSymbol(cc, {
        variant: Collect.ENode.StructScope,
        owningSymbol: struct,
        parentScope: args.currentParentScope,
        sourceloc: item.sourceloc,
        symbols: [],
      });
      (cc.nodes.get(struct) as Collect.StructDefinitionSymbol).structScope = structScope;

      for (const g of item.generics) {
        const generic = defineGenericTypeParameter(cc, g.name, structScope, g.sourceloc);
        (cc.nodes.get(struct) as Collect.StructDefinitionSymbol).generics.push(generic);
      }

      // for (const s of item.nestedStructs) {
      //   const namespaceScope = (cc.nodes[existingNamespace] as Collect.NamespaceDefinitionSymbol)
      //     .namespaceScope;
      //   const decl = collect(cc, s, {
      //     currentParentScope: namespaceScope,
      //   });
      //   const symbols = (cc.nodes[namespaceScope] as Collect.NamespaceScope).symbols;
      //   symbols.push(decl);
      // }
      return struct;

      // for (const decl of item.declarations) {
      //   collect(cc, getScope(cc, item._collect.scope), decl, newMeta);
      // }

      // for (const m of item.members) {
      //   collect(cc, getScope(cc, item._collect.scope), m.type, newMeta);
      // }

      // for (const method of item.methods) {
      //   method.declarationScope = makeScope(cc, item.sourceloc, item._collect.scope);
      //   if (method.funcbody) {
      //     method.funcbody._collect.scope = makeScope(cc, item.sourceloc, method.declarationScope);
      //   }

      //   if (!method.returnType) {
      //     method.returnType = {
      //       variant: "NamedDatatype",
      //       name: "none",
      //       cstruct: false,
      //       generics: [],
      //       sourceloc: item.sourceloc,
      //       _collect: {},
      //     };
      //   }

      //   method._collect.fullNamespacePath = [
      //     ...meta.namespaceStack.map((n) => n.name),
      //     method.name,
      //   ];
      //   method._collect.definedInScope = item._collect.scope;

      //   for (const g of method.generics) {
      //     getScope(cc, method.declarationScope).defineSymbol(cc, g);
      //   }

      //   if (method.funcbody?._collect.scope) {
      //     if (!method.static && method.name !== "constructor") {
      //       const s: ASTVariableDefinitionStatement = {
      //         variant: "VariableDefinitionStatement",
      //         id:
      //           makeModulePrefix(cc.config) + ".vardef." + (cc.config.symbolIdCounter++).toString(),
      //         mutability: false,
      //         name: "this",
      //         sourceloc: method.sourceloc,
      //         datatype: undefined,
      //         variableContext: EVariableContext.ThisReference,
      //         _semantic: {},
      //       };
      //       getScope(cc, method.funcbody._collect.scope).defineSymbol(cc, s);
      //       cc.symbols.set(s.id, s);
      //     }

      //     for (const param of method.params) {
      //       const s: ASTVariableDefinitionStatement = {
      //         variant: "VariableDefinitionStatement",
      //         id:
      //           makeModulePrefix(cc.config) + ".vardef." + (cc.config.symbolIdCounter++).toString(),
      //         mutability: false,
      //         name: param.name,
      //         datatype: param.datatype,
      //         sourceloc: param.sourceloc,
      //         variableContext: EVariableContext.FunctionParameter,
      //         _semantic: {},
      //       };
      //       getScope(cc, method.funcbody._collect.scope).defineSymbol(cc, s);
      //       cc.symbols.set(s.id, s);
      //       collect(cc, getScope(cc, method.declarationScope), param.datatype, newMeta);
      //     }
      //     if (method.returnType) {
      //       collect(cc, getScope(cc, method.declarationScope), method.returnType, newMeta);
      //     }
      //     collect(cc, getScope(cc, method.funcbody._collect.scope), method.funcbody, newMeta);
      //   }
      // }
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
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PointerDatatype": {
      return makeSymbol(cc, {
        variant: Collect.ENode.PointerDatatype,
        pointee: collect(cc, item.pointee, args),
        sourceloc: item.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ReferenceDatatype": {
      return makeSymbol(cc, {
        variant: Collect.ENode.ReferenceDatatype,
        referee: collect(cc, item.referee, args),
        sourceloc: item.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "CInjectDirective": {
      return makeSymbol(cc, {
        variant: Collect.ENode.CInjectDirective,
        value: item.code,
        sourceloc: item.sourceloc,
      });
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

          case "VariableDefinitionStatement":
            const variableSymbol = defineVariableSymbol(
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
              variableSymbol: variableSymbol,
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
      });

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ParenthesisExpr": {
      return makeSymbol(cc, {
        variant: Collect.ENode.ParenthesisExpr,
        expr: collect(cc, item.expr, args),
        sourceloc: item.sourceloc,
      });
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
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "LiteralExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.LiteralExpr,
        literal: item.literal,
        sourceloc: item.sourceloc,
      });

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "SymbolValueExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.SymbolValueExpr,
        name: item.name,
        genericArgs: item.generics.map((g) => collect(cc, g, args)),
        sourceloc: item.sourceloc,
      });

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
      });

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "UnaryExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.UnaryExpr,
        expr: collect(cc, item.expr, args),
        operation: item.operation,
        sourceloc: item.sourceloc,
      });
      break;

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PreIncrExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.PreIncrExpr,
        expr: collect(cc, item.expr, args),
        operation: item.operation,
        sourceloc: item.sourceloc,
      });

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PostIncrExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.PostIncrExpr,
        expr: collect(cc, item.expr, args),
        operation: item.operation,
        sourceloc: item.sourceloc,
      });

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
      });

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExplicitCastExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.ExplicitCastExpr,
        expr: collect(cc, item.expr, args),
        targetType: collect(cc, item.castedTo, args),
        sourceloc: item.sourceloc,
      });

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PointerAddressOf":
      return makeSymbol(cc, {
        variant: Collect.ENode.PointerAddressOfExpr,
        expr: collect(cc, item.expr, args),
        sourceloc: item.sourceloc,
      });

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "PointerDereference":
      return makeSymbol(cc, {
        variant: Collect.ENode.PointerDereferenceExpr,
        expr: collect(cc, item.expr, args),
        sourceloc: item.sourceloc,
      });

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
      });

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ExprCallExpr":
      return makeSymbol(cc, {
        variant: Collect.ENode.ExprCallExpr,
        calledExpr: collect(cc, item.calledExpr, args),
        arguments: item.arguments.map((a) => collect(cc, a, args)),
        sourceloc: item.sourceloc,
      });

    default:
      assert(false, "All cases handled" + item.variant);
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

  const fileScope = makeSymbol(cc, {
    variant: Collect.ENode.FileScope,
    filepath: filepath,
    parentScope: unitScope,
    symbols: [],
  });
  unit.files.push(fileScope);

  for (const decl of ast) {
    const sym = collect(cc, decl, {
      currentParentScope: fileScope,
    });
    // console.log(decl, sym);
    (cc.nodes.get(fileScope) as Collect.FileScope).symbols.push(sym);
  }

  // const globalScope = getEntityByComponent(cc, Collect.ModuleScopeComponent);
  // assert(globalScope);
  // const mermaid = exportMermaidScopeTree(cc);
  // console.log(mermaid);
  // Bun.write("log.md", mermaid);

  // RenderCollectedSymbolTree(cc);
}

export function PrettyPrintCollected(cc: CollectionContext) {
  console.log("C Injections:");
  // for (const i of cc.cInjections) {
  //   console.log(" - " + i.code);
  // }
  console.log("\n");

  const printType = (typeId: Collect.Id | null): string => {
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
            str += "<" + n.genericArgs.map((g) => printType(g)).join(", ") + ">";
          }
          n = (n.innerNested && (cc.nodes.get(n.innerNested) as Collect.NamedDatatype)) || null;
          assert(n === null || n.variant === Collect.ENode.NamedDatatype);
        }
        return str;
      }

      case Collect.ENode.PointerDatatype: {
        return `${printType(type.pointee)}*`;
      }

      case Collect.ENode.ReferenceDatatype: {
        return `${printType(type.referee)}&`;
      }

      default:
        assert(false, type.variant.toString());
    }
  };

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
          str += "<" + expr.genericArgs.map((g) => printType(g)).join(", ") + ">";
        }
        return str;
      }

      case Collect.ENode.StructInstantiationExpr: {
        return (
          `${printType(expr.structType)} {` +
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
        return `${printExpr(expr.expr)} as ${printType(expr.targetType)}`;
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
        print(`- VariableSymbol id=${symbolId} name=${symbol.name} type=${printType(symbol.type)}`);
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
          symbol.parameters.map((p) => `${p.name}: ${printType(p.type)}`).join(", ") +
          ") => " +
          printType(symbol.returnType);
        print(`- Function ${ftype}`);
        if (symbol.functionScope) {
          printSymbol(symbol.functionScope, indent + 4);
        }
        break;
      }

      case Collect.ENode.StructDefinitionSymbol: {
        print(`- Struct ${symbol.name}`);
        // for (const members of symbol.members)
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
          print(`var ${symbol.variableSymbol} = ${printExpr(symbol.value)});`);
        } else {
          print(`var ${symbol.variableSymbol};`);
        }
        break;
      }

      case Collect.ENode.CInjectDirective: {
        print(`- __c__(${symbol.value})`);
        break;
      }

      default:
        assert(false, symbol.variant.toString());
    }
  };

  printSymbol(0 as Collect.Id, 2);
}
