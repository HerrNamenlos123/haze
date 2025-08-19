import { assert, type SourceLoc } from "../shared/Errors";
import type {
  EBinaryOperation,
  EExternLanguage,
  EIncrOperation,
  EOperator,
  EUnaryOperation,
  EVariableMutability,
} from "../shared/AST";
import {
  BrandedArray,
  EVariableContext,
  type Brand,
  type EMethodType,
  type EPrimitive,
  type LiteralValue,
} from "../shared/common";
import {
  Collect,
  printCollectedDatatype,
  type CollectionContext,
} from "../SymbolCollection/SymbolCollection";
import type { SubstitutionContext } from "./Elaborate";
import { serializeDatatype } from "./Serialize";

export function printSubstitutionContext(sr: SemanticResult, context: SubstitutionContext) {
  console.log(`Substitutions: (${[...context.substitute.values()].length})`);
  for (const [fromId, toId] of context.substitute) {
    console.log(`${printCollectedDatatype(sr.cc, fromId)} -> ${serializeDatatype(sr, toId)}`);
  }
}

export type SemanticResult = {
  cc: CollectionContext;

  nodes: BrandedArray<Semantic.Id, Semantic.Node>;

  overloadedOperators: Semantic.FunctionSymbol[];

  elaboratedStructDatatypes: {
    originalSymbol: Collect.Id;
    generics: Semantic.Id[];
    substitutionContext: SubstitutionContext;
    resultSymbol: Semantic.Id;
  }[];
  elaboratedFuncdefSymbols: {
    originalSymbol: Collect.Id;
    generics: Semantic.Id[];
    substitutionContext: SubstitutionContext;
    resultSymbol: Semantic.Id;
  }[];
  elaboratedNamespaceSymbols: {
    originalSharedInstance: Collect.Id;
    resultSymbol: Semantic.Id;
  }[];
  elaboratedGlobalVariableStatements: {
    originalSymbol: Collect.Id;
    resultSymbol: Semantic.Id;
  }[];
  elaboratedGlobalVariableSymbols: Map<Collect.Id, Semantic.Id>;
  // Function-local variable symbols are cached per function call because they are separate for each generic instance.

  elaboratedPrimitiveTypes: Semantic.Id[];
  functionTypeCache: Semantic.Id[];
  rawPointerTypeCache: Semantic.Id[];
  referenceTypeCache: Semantic.Id[];

  exportedCollectedSymbols: Set<number>;

  cInjections: Semantic.Id[];
};

export function makePrimitiveAvailable(sr: SemanticResult, primitive: EPrimitive): Semantic.Id {
  for (const id of sr.elaboratedPrimitiveTypes) {
    const s = sr.nodes.get(id);
    assert(s.variant === Semantic.ENode.PrimitiveDatatype);
    if (s.primitive === primitive) {
      return id;
    }
  }
  const [s, sId] = Semantic.addNode(sr, {
    variant: Semantic.ENode.PrimitiveDatatype,
    primitive: primitive,
    concrete: true,
  });
  sr.elaboratedPrimitiveTypes.push(sId);
  return sId;
}

export function isExpression(node: Semantic.Node): node is Semantic.Expression {
  return ([...Semantic.ExpressionEnums] as number[]).includes(node.variant);
}

export function asExpression(node: Semantic.Node): Semantic.Expression {
  assert(isExpression(node));
  return node;
}

export function isType(node: Semantic.Node): node is Semantic.Datatype {
  return ([...Semantic.TypeEnums] as number[]).includes(node.variant);
}

export function asType(node: Semantic.Node): Semantic.Datatype {
  assert(isType(node));
  return node;
}

export function getExprType(sr: SemanticResult, exprId: Semantic.Id): Semantic.Id {
  const expr = sr.nodes.get(exprId);
  assert(isExpression(expr));
  return expr.type;
}

export function isTypeConcrete(sr: SemanticResult, id: Semantic.Id) {
  const symbol = sr.nodes.get(id);
  assert("concrete" in symbol);
  return symbol.concrete;
}

export namespace Semantic {
  export type Id = Brand<number, "Semantic">;
  export const enum ENode {
    CInjectDirective,
    // Symbols
    VariableSymbol,
    GlobalVariableDefinitionSymbol,
    FunctionSymbol,
    // Datatypes
    FunctionDatatype,
    BlockScope,
    StructDatatype,
    PointerDatatype,
    ReferenceDatatype,
    CallableDatatype,
    PrimitiveDatatype,
    GenericParameterDatatype,
    NamespaceDatatype,
    LiteralValueDatatype,
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
    NamespaceOrStructValueExpr,
    SizeofExpr,
    ExplicitCastExpr,
    MemberAccessExpr,
    CallableExpr,
    PointerAddressOfExpr,
    PointerDereferenceExpr,
    ExprAssignmentExpr,
    StructInstantiationExpr,
    PreIncrExpr,
    PostIncrExpr,
    // Dummy
    Dummy,
  }

  export const TypeEnums = [
    ENode.FunctionDatatype,
    ENode.BlockScope,
    ENode.StructDatatype,
    ENode.PointerDatatype,
    ENode.ReferenceDatatype,
    ENode.CallableDatatype,
    ENode.PrimitiveDatatype,
    ENode.GenericParameterDatatype,
    ENode.NamespaceDatatype,
    ENode.LiteralValueDatatype,
  ] as const;

  export const ExpressionEnums = [
    ENode.ParenthesisExpr,
    ENode.BinaryExpr,
    ENode.LiteralExpr,
    ENode.UnaryExpr,
    ENode.ExprCallExpr,
    ENode.SymbolValueExpr,
    ENode.CallableExpr,
    ENode.SizeofExpr,
    ENode.ExplicitCastExpr,
    ENode.NamespaceOrStructValueExpr,
    ENode.MemberAccessExpr,
    ENode.PointerAddressOfExpr,
    ENode.PointerDereferenceExpr,
    ENode.ExprAssignmentExpr,
    ENode.StructInstantiationExpr,
    ENode.PreIncrExpr,
    ENode.PostIncrExpr,
  ] as const;

  export function addNode<T extends Semantic.Node>(sr: SemanticResult, n: T): [T, Semantic.Id] {
    if (sr.nodes.length === 0) {
      // Push a dummy because it causes issues when the id is zero, so zero is not a valid id.
      sr.nodes.push({ variant: Semantic.ENode.Dummy });
    }
    const id = sr.nodes.length as Semantic.Id;
    sr.nodes.push(n);
    return [n, id];
  }

  export type CInjectDirective = {
    variant: ENode.CInjectDirective;
    value: string;
    sourceloc: SourceLoc;
  };

  export type VariableSymbol = {
    variant: ENode.VariableSymbol;
    name: string;
    memberOfStruct: Id | null;
    type: Id | null;
    mutability: EVariableMutability;
    export: boolean;
    extern: EExternLanguage;
    variableContext: EVariableContext;
    parentStructOrNS: Semantic.Id | null;
    sourceloc: SourceLoc;
    comptime: boolean;
    comptimeValue: Semantic.Id | null;
    concrete: boolean;
  };

  export type GlobalVariableDefinitionSymbol = {
    variant: ENode.GlobalVariableDefinitionSymbol;
    variableSymbol: Id;
    name: string;
    value: Id | null;
    export: boolean;
    extern: EExternLanguage;
    parentStructOrNS: Semantic.Id | null;
    sourceloc: SourceLoc;
    comptime: boolean;
    concrete: boolean;
  };

  export type FunctionSymbol = {
    variant: ENode.FunctionSymbol;
    staticMethod: boolean;
    name: string;
    type: Id;
    noemit: boolean;
    generics: Semantic.Id[];
    operatorOverloading?: {
      operator: EOperator;
      asTarget: Id;
    };
    parameterNames: string[];
    extern: EExternLanguage;
    // collectedScope?: number;
    scope: Semantic.Id | null;
    export: boolean;
    methodType: EMethodType;
    methodOf: Semantic.Id | null;
    sourceloc: SourceLoc;
    parentStructOrNS: Semantic.Id | null;
    concrete: boolean;
  };

  export type BlockScope = {
    variant: ENode.BlockScope;
    statements: Id[];
  };

  export type FunctionDatatypeSymbol = {
    variant: ENode.FunctionDatatype;
    parameters: Id[];
    returnType: Id;
    vararg: boolean;
    concrete: boolean;
  };

  export type StructDatatypeSymbol = {
    variant: ENode.StructDatatype;
    name: string;
    noemit: boolean;
    generics: Semantic.Id[];
    extern: EExternLanguage;
    members: Semantic.Id[];
    methods: Semantic.Id[];
    nestedStructs: Semantic.Id[];
    parentStructOrNS: Id | null;
    sourceloc: SourceLoc;
    concrete: boolean;
    originalCollectedSymbol: Collect.Id;
  };

  export type PointerDatatypeSymbol = {
    variant: ENode.PointerDatatype;
    pointee: Id;
    concrete: boolean;
  };

  export type ReferenceDatatypeSymbol = {
    variant: ENode.ReferenceDatatype;
    referee: Id;
    concrete: boolean;
  };

  export type CallableDatatypeSymbol = {
    variant: ENode.CallableDatatype;
    thisExprType?: Id;
    functionType: Id;
    concrete: boolean;
  };

  export type PrimitiveDatatypeSymbol = {
    variant: ENode.PrimitiveDatatype;
    primitive: EPrimitive;
    concrete: boolean;
  };

  export type GenericParameterDatatypeSymbol = {
    variant: ENode.GenericParameterDatatype;
    name: string;
    concrete: boolean;
  };

  export type NamespaceDatatypeSymbol = {
    variant: ENode.NamespaceDatatype;
    name: string;
    parentStructOrNS: Semantic.Id | null;
    symbols: Semantic.Id[];
    concrete: boolean; // For consistency, always true
  };

  export type LiteralValueDatatypeSymbol = {
    variant: ENode.LiteralValueDatatype;
    literal: LiteralValue;
    sourceloc: SourceLoc;
    concrete: boolean;
  };

  export type Datatype =
    | GenericParameterDatatypeSymbol
    | NamespaceDatatypeSymbol
    | FunctionDatatypeSymbol
    | StructDatatypeSymbol
    | PointerDatatypeSymbol
    | ReferenceDatatypeSymbol
    | CallableDatatypeSymbol
    | LiteralValueDatatypeSymbol
    | PrimitiveDatatypeSymbol;

  export type Symbol =
    | CInjectDirective
    | VariableSymbol
    | GlobalVariableDefinitionSymbol
    | FunctionSymbol;

  export type ExprMemberAccessExpr = {
    variant: ENode.MemberAccessExpr;
    expr: Id;
    memberName: string;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type CallableExpr = {
    variant: ENode.CallableExpr;
    thisExpr: Id;
    functionSymbol: Id;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type SymbolValueExpr = {
    variant: ENode.SymbolValueExpr;
    symbol: Id;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type NamespaceOrStructValueExpr = {
    variant: ENode.NamespaceOrStructValueExpr;
    collectedNamespaceOrStruct: Collect.Id;
    elaboratedNamespaceOrStruct: Id;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type SizeofExpr = {
    variant: ENode.SizeofExpr;
    datatype: Id | null;
    value: Id | null;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type ExprAssignmentExpr = {
    variant: ENode.ExprAssignmentExpr;
    value: Id;
    target: Id;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type PointerDereferenceExpr = {
    variant: ENode.PointerDereferenceExpr;
    expr: Id;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type PointerAddressOfExpr = {
    variant: ENode.PointerAddressOfExpr;
    expr: Id;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type ExplicitCastExpr = {
    variant: ENode.ExplicitCastExpr;
    expr: Id;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type BinaryExpr = {
    variant: ENode.BinaryExpr;
    left: Id;
    right: Id;
    operation: EBinaryOperation;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type UnaryExpr = {
    variant: ENode.UnaryExpr;
    expr: Id;
    operation: EUnaryOperation;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type PostIncrExpr = {
    variant: ENode.PostIncrExpr;
    expr: Id;
    operation: EIncrOperation;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type PreIncrExpr = {
    variant: ENode.PreIncrExpr;
    expr: Id;
    operation: EIncrOperation;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type ExprCallExpr = {
    variant: ENode.ExprCallExpr;
    calledExpr: Id;
    arguments: Id[];
    type: Id;
    sourceloc: SourceLoc;
  };

  export type StructInstantiationExpr = {
    variant: ENode.StructInstantiationExpr;
    assign: {
      name: string;
      value: Id;
    }[];
    type: Id;
    sourceloc: SourceLoc;
  };

  export type LiteralExpr = {
    variant: ENode.LiteralExpr;
    literal: LiteralValue;
    type: Id;
    sourceloc: SourceLoc;
  };

  export type Expression =
    | ExprMemberAccessExpr
    | SymbolValueExpr
    | NamespaceOrStructValueExpr
    | SizeofExpr
    | ExprAssignmentExpr
    | UnaryExpr
    | BinaryExpr
    | CallableExpr
    | PreIncrExpr
    | PostIncrExpr
    | PointerAddressOfExpr
    | PointerDereferenceExpr
    | ExplicitCastExpr
    | ExprCallExpr
    | StructInstantiationExpr
    | LiteralExpr;

  // =============================================

  export type InlineCStatement = {
    variant: ENode.InlineCStatement;
    value: string;
    sourceloc: SourceLoc;
  };

  export type ReturnStatement = {
    variant: ENode.ReturnStatement;
    expr?: Id;
    sourceloc: SourceLoc;
  };

  export type IfStatement = {
    variant: ENode.IfStatement;
    condition: Id;
    then: Id;
    elseIfs: {
      condition: Id;
      then: Id;
    }[];
    else?: Id;
    sourceloc: SourceLoc;
  };

  export type WhileStatement = {
    variant: ENode.WhileStatement;
    condition: Id;
    then: Id;
    sourceloc: SourceLoc;
  };

  export type VariableStatement = {
    variant: ENode.VariableStatement;
    name: string;
    value: Id | null;
    mutability: EVariableMutability;
    comptime: boolean;
    variableSymbol: Id;
    sourceloc: SourceLoc;
  };

  export type ExprStatement = {
    variant: ENode.ExprStatement;
    expr: Id;
    sourceloc: SourceLoc;
  };

  export type BlockScopeStatement = {
    variant: ENode.BlockScopeStatement;
    block: Id;
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

  export type DummyNode = {
    variant: ENode.Dummy;
  };

  export type Node = DummyNode | Expression | Symbol | Statement | BlockScope | Datatype;
}
