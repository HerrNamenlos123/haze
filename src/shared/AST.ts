import type { EMethodType, EVariableContext, LiteralValue } from "./common";
import { assert, ImpossibleSituation, type SourceLoc } from "./Errors";

export enum EVariableMutability {
  Const = 1,
  Let = 2,
  Default = 3,
}

export enum EDatatypeMutability {
  Default = 1,
  Mut = 2,
  Const = 3,
}

export enum EExternLanguage {
  None = 0,
  Extern = 1,
  Extern_C = 2,
}

export enum EOverloadedOperator {
  Add = 1,
  Sub = 2,
  Mul = 3,
  Div = 4,
  Mod = 5,
  Rebind = 6,
  Assign = 7,
  Subscript = 8,
  Cast = 9,
  Equal = 10,
  NotEqual = 11,
  LessThan = 12,
  GreaterThan = 13,
  LessThanOrEqual = 14,
  GreaterThanOrEqual = 15,
}

export enum ELiteralUnit {
  s = 0,
  ms = 1,
  us = 2,
  ns = 3,
  m = 4,
  h = 5,
  d = 6,
}

export enum EIncrOperation {
  Incr = 0,
  Decr = 1,
}

export enum EUnaryOperation {
  Plus = 0,
  Minus = 1,
  Negate = 2,
}

export enum EBinaryOperation {
  Multiply = 0,
  Divide = 1,
  Modulo = 2,
  Add = 3,
  Subtract = 4,
  LessThan = 5,
  LessEqual = 6,
  GreaterThan = 7,
  GreaterEqual = 8,
  Equal = 9,
  NotEqual = 10,
  BoolAnd = 11,
  BoolOr = 12,
  BitwiseOr = 13,
}

export function IncrOperationToString(op: EIncrOperation): string {
  switch (op) {
    case EIncrOperation.Incr:
      return "++";
    case EIncrOperation.Decr:
      return "--";
    default:
      throw new ImpossibleSituation();
  }
}

export function UnaryOperationToString(op: EUnaryOperation): string {
  switch (op) {
    case EUnaryOperation.Plus:
      return "+";
    case EUnaryOperation.Minus:
      return "-";
    case EUnaryOperation.Negate:
      return "!";
    default:
      throw new ImpossibleSituation();
  }
}

export function AssignmentOperationToString(op: EAssignmentOperation): string {
  switch (op) {
    case EAssignmentOperation.Rebind:
      return "=";
    case EAssignmentOperation.Assign:
      return ":=";
    case EAssignmentOperation.Divide:
      return "/=";
    case EAssignmentOperation.Modulo:
      return "%=";
    case EAssignmentOperation.Add:
      return "+=";
    case EAssignmentOperation.Multiply:
      return "*=";
    case EAssignmentOperation.Subtract:
      return "-=";
    default:
      throw new ImpossibleSituation();
  }
}

export function BinaryOperationToString(op: EBinaryOperation): string {
  switch (op) {
    case EBinaryOperation.Multiply:
      return "*";
    case EBinaryOperation.Divide:
      return "/";
    case EBinaryOperation.Modulo:
      return "%";
    case EBinaryOperation.Add:
      return "+";
    case EBinaryOperation.Subtract:
      return "-";
    case EBinaryOperation.LessThan:
      return "<";
    case EBinaryOperation.LessEqual:
      return "<=";
    case EBinaryOperation.GreaterThan:
      return ">";
    case EBinaryOperation.GreaterEqual:
      return ">=";
    case EBinaryOperation.Equal:
      return "==";
    case EBinaryOperation.NotEqual:
      return "!=";
    case EBinaryOperation.BoolAnd:
      return "&&";
    case EBinaryOperation.BoolOr:
      return "||";
    case EBinaryOperation.BitwiseOr:
      return "|";
    default:
      throw new ImpossibleSituation();
  }
}

export enum EAssignmentOperation {
  Rebind = 0,
  Assign = 1,
  Add = 2,
  Subtract = 3,
  Multiply = 4,
  Divide = 5,
  Modulo = 6,
}

export type ASTDeferredType = {
  variant: "Deferred";
};

export type ASTFunctionRequiresBlock = {
  final: boolean;
  pure: boolean;
  noreturn: boolean;
  noreturnIf: {
    expr: ASTExpr;
  } | null;
};

export type ASTFunctionOverloading =
  | {
      operator:
        | EOverloadedOperator.Add
        | EOverloadedOperator.Sub
        | EOverloadedOperator.Mul
        | EOverloadedOperator.Div
        | EOverloadedOperator.Mod;
    }
  | {
      operator: EOverloadedOperator.Cast;
      // castTarget: ASTTypeUse;
    }
  | {
      operator: EOverloadedOperator.Subscript;
    }
  | {
      operator: EOverloadedOperator.Equal;
    }
  | {
      operator: EOverloadedOperator.NotEqual;
    }
  | {
      operator: EOverloadedOperator.LessThan;
    }
  | {
      operator: EOverloadedOperator.LessThanOrEqual;
    }
  | {
      operator: EOverloadedOperator.GreaterThan;
    }
  | {
      operator: EOverloadedOperator.GreaterThanOrEqual;
    }
  | {
      operator: EOverloadedOperator.Assign;
    }
  | {
      operator: EOverloadedOperator.Rebind;
    };

export type ASTFunctionDefinition = {
  variant: "FunctionDefinition";
  export: boolean;
  comptime?: boolean;
  pub: boolean;
  externLanguage: EExternLanguage;
  operatorOverloading?: ASTFunctionOverloading;
  generics: {
    name: string;
    sourceloc: SourceLoc;
  }[];
  requires: ASTFunctionRequiresBlock;
  name: string;
  noemit: boolean;
  static: boolean;
  params: ASTParam[];
  ellipsis: boolean;
  returnType?: ASTExpr;
  methodType: EMethodType;
  methodRequiredMutability:
    | EDatatypeMutability.Const
    | EDatatypeMutability.Mut
    | null;
  funcbody?: ASTFuncBody;
  sourceloc: SourceLoc;
  originalSourcecode: string;
};

export type ASTParam =
  | {
      kind: "normal";
      name: string;
      datatype: ASTExpr;
      optional: boolean;
      defaultValue: ASTExpr | null;
      sourceloc: SourceLoc;
    }
  | {
      kind: "param-pack";
      name: string;
      sourceloc: SourceLoc;
    };

export type ASTGlobalVariableDefinition = {
  variant: "GlobalVariableDefinition";
  export: boolean;
  comptime: boolean;
  pub: boolean;
  extern: EExternLanguage;
  mutability: EVariableMutability;
  name: string;
  datatype?: ASTExpr;
  expr?: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTInlineCStatement = {
  variant: "InlineCStatement";
  expr: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTBlockScopeExpr = {
  variant: "BlockScopeExpr";
  scope: ASTScope;
  sourceloc: SourceLoc;
};

export type ASTExprStatement = {
  variant: "ExprStatement";
  expr: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTReturnStatement = {
  variant: "ReturnStatement";
  expr?: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTVariableDefinitionStatement = {
  variant: "VariableDefinitionStatement";
  mutability: EVariableMutability;
  comptime: boolean;
  name: string;
  datatype?: ASTExpr;
  expr?: ASTExpr;
  variableContext: EVariableContext;
  sourceloc: SourceLoc;
};

export type ASTIfStatement = {
  variant: "IfStatement";
  condition: ASTExpr | null;
  letCondition: {
    name: string;
    type: ASTExpr | null;
    expr: ASTExpr;
  } | null;
  thenScope: ASTScope;
  comptime: boolean;
  elseIfs: {
    condition: ASTExpr | null;
    letCondition: {
      name: string;
      type: ASTExpr | null;
      expr: ASTExpr;
    } | null;
    thenScope: ASTScope;
  }[];
  else?: ASTScope;
  sourceloc: SourceLoc;
};

export type ASTForStatement = {
  variant: "ForStatement";
  initStatement: ASTStatement | null;
  loopCondition: ASTExpr | null;
  loopIncrement: ASTExpr | null;
  comptime: boolean;
  body: ASTScope;
  sourceloc: SourceLoc;
};

export type ASTRaiseStatement = {
  variant: "RaiseStatement";
  expr: ASTExpr | null;
  sourceloc: SourceLoc;
};

export type ASTForEachStatement = {
  variant: "ForEachStatement";
  loopVariable: string;
  indexVariable: string | null;
  value: ASTExpr;
  comptime: boolean;
  body: ASTScope;
  sourceloc: SourceLoc;
};

export type ASTWhileStatement = {
  variant: "WhileStatement";
  letCondition: {
    name: string;
    type: ASTExpr | null;
    expr: ASTExpr;
  } | null;
  condition: ASTExpr | null;
  body: ASTScope;
  sourceloc: SourceLoc;
};

export type ASTTypeAlias = {
  variant: "TypeAlias";
  name: string;
  datatype: ASTExpr;
  generics: {
    name: string;
    sourceloc: SourceLoc;
  }[];
  export: boolean;
  pub: boolean;
  extern: EExternLanguage;
  sourceloc: SourceLoc;
};

export type ASTStatement =
  | ASTInlineCStatement
  | ASTExprStatement
  | ASTRaiseStatement
  | ASTForStatement
  | ASTForEachStatement
  | ASTReturnStatement
  | ASTVariableDefinitionStatement
  | ASTIfStatement
  | ASTTypeAlias
  | ASTWhileStatement;

export type ASTScope = {
  variant: "Scope";
  statements: ASTStatement[];
  unsafe: boolean;
  sourceloc: SourceLoc;
};

export type ASTParenthesisExpr = {
  variant: "ParenthesisExpr";
  expr: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTErrorPropagationExpr = {
  variant: "ErrorPropagationExpr";
  expr: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTLambdaExpr = {
  variant: "LambdaExpr";
  lambda: ASTLambda;
  sourceloc: SourceLoc;
};

export type ASTAttemptExpr = {
  variant: "AttemptExpr";
  attemptScope: ASTScope;
  elseScope: ASTScope;
  elseVar: string | null;
  sourceloc: SourceLoc;
};

export type ASTLiteralExpr = {
  variant: "LiteralExpr";
  literal: LiteralValue;
  sourceloc: SourceLoc;
};

export type ASTFStringExpr = {
  variant: "FStringExpr";
  fragments: (
    | { type: "expr"; value: ASTExpr }
    | { type: "text"; value: string }
  )[];
  allocator: ASTExpr | null;
  sourceloc: SourceLoc;
};

export type ASTPostIncrExpr = {
  variant: "PostIncrExpr";
  expr: ASTExpr;
  operation: EIncrOperation;
  sourceloc: SourceLoc;
};

export type ASTExprCallExpr = {
  variant: "ExprCallExpr";
  calledExpr: ASTExpr;
  arguments: ASTExpr[];
  allocator: ASTExpr | null;
  sourceloc: SourceLoc;
};

export type ASTExprMemberAccess = {
  variant: "ExprMemberAccess";
  expr: ASTExpr;
  member: string;
  generics: ASTExpr[];
  sourceloc: SourceLoc;
};

export type ASTExprComptimeMemberAccess = {
  variant: "ExprComptimeMemberAccess";
  expr: ASTExpr;
  memberExpr: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTAggregateLiteralElement = {
  key: string | null;
  value: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTAggregateLiteralExpr = {
  variant: "AggregateLiteralExpr";
  datatype: ASTExpr | null;
  elements: ASTAggregateLiteralElement[];
  allocator: ASTExpr | null;
  sourceloc: SourceLoc;
};

export type ASTTernaryExpr = {
  variant: "TernaryExpr";
  condition: ASTExpr;
  thenExpr: ASTExpr;
  else: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTPreIncrExpr = {
  variant: "PreIncrExpr";
  expr: ASTExpr;
  operation: EIncrOperation;
  sourceloc: SourceLoc;
};

export type ASTUnaryExpr = {
  variant: "UnaryExpr";
  expr: ASTExpr;
  operation: EUnaryOperation;
  sourceloc: SourceLoc;
};

export type ASTExplicitCastExpr = {
  variant: "ExplicitCastExpr";
  expr: ASTExpr;
  castedTo: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTExprIsTypeExpr = {
  variant: "ExprIsTypeExpr";
  expr: ASTExpr;
  comparisonType: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTSubscriptIndexExpr =
  | {
      type: "slice";
      start: ASTExpr | null;
      end: ASTExpr | null;
    }
  | {
      type: "index";
      value: ASTExpr;
    };

export type ASTArraySubscriptExpr = {
  variant: "ArraySubscriptExpr";
  expr: ASTExpr;
  indices: ASTSubscriptIndexExpr[];
  sourceloc: SourceLoc;
};

export type ASTBinaryExpr = {
  variant: "BinaryExpr";
  a: ASTExpr;
  b: ASTExpr;
  operation: EBinaryOperation;
  sourceloc: SourceLoc;
};

export type ASTExprAssignmentExpr = {
  variant: "ExprAssignmentExpr";
  target: ASTExpr;
  value: ASTExpr;
  operation: EAssignmentOperation;
  sourceloc: SourceLoc;
};

export type ASTSymbolValueExpr = {
  variant: "SymbolValueExpr";
  name: string;
  generics: ASTExpr[];
  sourceloc: SourceLoc;
};

export type ASTConstTypeExpr = {
  variant: "ConstTypeExpr";
  type: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTMutTypeExpr = {
  variant: "MutTypeExpr";
  type: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTInlineTypeExpr = {
  variant: "InlineTypeExpr";
  type: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTDynamicArrayTypeExpr = {
  variant: "DynamicArrayTypeExpr";
  type: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTStaticArrayTypeExpr = {
  variant: "StaticArrayTypeExpr";
  type: ASTExpr;
  arraySize: bigint;
  sourceloc: SourceLoc;
};

export type ASTNodiscardTypeExpr = {
  variant: "NodiscardTypeExpr";
  type: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTCallableTypeExpr = {
  variant: "CallableTypeExpr";
  params: ASTParam[];
  ellipsis: boolean;
  returnType: ASTExpr;
  requires: ASTFunctionRequiresBlock;
  mutability: EDatatypeMutability;
  sourceloc: SourceLoc;
};

export type ASTFunctionTypeExpr = {
  variant: "FunctionTypeExpr";
  params: ASTParam[];
  ellipsis: boolean;
  returnType: ASTExpr;
  requires: ASTFunctionRequiresBlock;
  mutability: EDatatypeMutability;
  sourceloc: SourceLoc;
};

export type ASTBinaryUnionTypeExpr = {
  // int | real
  variant: "BinaryUnionTypeExpr";
  types: ASTExpr[];
  sourceloc: SourceLoc;
};

export type ASTTaggedUnionTypeExpr = {
  // union { Foo: int, Bar: real }
  variant: "TaggedUnionTypeExpr";
  members: {
    tag: string;
    type: ASTExpr;
  }[];
  sourceloc: SourceLoc;
};

export type ASTTypeValueExpr = {
  // This is the "type mut[]mut Foo" syntax, which switches from expression syntax to type syntax in the parser and
  // allows a type to appear in a place where a normal expression is expected.
  // The distinction is only relevant in the parser, so this is a direct pass-through node to preserve the parsed
  // syntax. In the collection step, it will simply be unwrapped and skipped.
  variant: "TypeValueExpr";
  datatype: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTTypeOfExpr = {
  // This is the "typeof(<expr>)" syntax, which bridges expression land and type land, to infer type from runtime values.
  variant: "TypeOfExpr";
  expr: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTExpr =
  | ASTParenthesisExpr
  | ASTErrorPropagationExpr
  | ASTBlockScopeExpr
  | ASTLambdaExpr
  | ASTAttemptExpr
  | ASTLiteralExpr
  | ASTFStringExpr
  | ASTPostIncrExpr
  | ASTExprCallExpr
  | ASTExprMemberAccess
  | ASTExprComptimeMemberAccess
  | ASTTernaryExpr
  | ASTAggregateLiteralExpr
  | ASTPreIncrExpr
  | ASTUnaryExpr
  | ASTExplicitCastExpr
  | ASTExprIsTypeExpr
  | ASTArraySubscriptExpr
  | ASTBinaryExpr
  | ASTExprAssignmentExpr
  | ASTSymbolValueExpr
  | ASTConstTypeExpr
  | ASTMutTypeExpr
  | ASTInlineTypeExpr
  | ASTDynamicArrayTypeExpr
  | ASTStaticArrayTypeExpr
  | ASTNodiscardTypeExpr
  | ASTCallableTypeExpr
  | ASTFunctionTypeExpr
  | ASTBinaryUnionTypeExpr
  | ASTTaggedUnionTypeExpr
  | ASTTypeValueExpr
  | ASTTypeOfExpr;

export type ASTLambda = {
  variant: "Lambda";
  kind: "closure" | "function";
  params: ASTParam[];
  ellipsis: boolean;
  returnType?: ASTExpr;
  scope: ASTFuncBody;
  requires: ASTFunctionRequiresBlock;
  sourceloc: SourceLoc;
};

export type ASTExprAsFuncbody = {
  variant: "ExprAsFuncBody";
  expr: ASTExpr;
};

export type ASTFuncBody = ASTScope | ASTExprAsFuncbody;

export type ASTCInjectDirective = {
  variant: "CInjectDirective";
  expr: ASTExpr;
  export: boolean;
  sourceloc: SourceLoc;
};

export type ASTStructMemberDefinition = {
  variant: "StructMember";
  name: string;
  type: ASTExpr;
  defaultValue: ASTExpr | null;
  optional: boolean;
  mutability: EVariableMutability;
  sourceloc: SourceLoc;
};

export type ASTEnumValueDefinition = {
  variant: "EnumValue";
  name: string;
  value: ASTExpr | null;
  sourceloc: SourceLoc;
};

export type ASTEnumDefinition = {
  variant: "EnumDefinition";
  export: boolean;
  extern: EExternLanguage;
  name: string;
  noemit: boolean;
  pub: boolean;
  bitflag: boolean;
  unscoped: boolean;
  values: ASTEnumValueDefinition[];
  sourceloc: SourceLoc;
  originalSourcecode: string;
};

export type ASTStructDefinition = {
  variant: "StructDefinition";
  export: boolean;
  extern: EExternLanguage;
  name: string;
  noemit: boolean;
  opaque: boolean;
  plain: boolean;
  inlineByDefault: boolean;
  pub: boolean;
  generics: {
    name: string;
    sourceloc: SourceLoc;
  }[];
  members: ASTStructMemberDefinition[];
  methods: ASTFunctionDefinition[];
  nestedStructs: ASTStructDefinition[];
  sourceloc: SourceLoc;
  originalSourcecode: string;
};

export type ASTTypeDef =
  | ASTStructDefinition
  | ASTNamespaceDefinition
  | ASTTypeAlias
  | ASTEnumDefinition;

export type ASTNamespaceDefinition = {
  variant: "NamespaceDefinition";
  export: boolean;
  name: string;
  declarations: ASTSymbolDefinition[];
  sourceloc: SourceLoc;
};

export type ASTModuleImport = {
  variant: "ModuleImport";
  mode: "path" | "module";
  name: string;
  alias: string | null;
  sourceloc: SourceLoc;
};

export type ASTSymbolImport = {
  variant: "SymbolImport";
  mode: "path" | "module";
  name: string;
  symbols: {
    symbol: string;
    alias: string | null;
  }[];
  sourceloc: SourceLoc;
};

export type ASTSymbolDefinition =
  | ASTFunctionDefinition
  | ASTTypeDef
  | ASTNamespaceDefinition
  | ASTTypeAlias
  | ASTGlobalVariableDefinition;

export type ASTTopLevelDeclaration =
  | ASTCInjectDirective
  | ASTModuleImport
  | ASTSymbolImport
  | ASTSymbolDefinition;

export type ASTRoot = ASTTopLevelDeclaration[];

export function buildASTDatatype(
  nestedName: (string | [string, string[]])[],
  sourceloc: SourceLoc
) {
  const buildType = (
    parentType: ASTExpr | null,
    nestedName: string | [string, string[]]
  ): ASTExpr => {
    let name = "";
    let generics = [] as string[];
    if (Array.isArray(nestedName)) {
      assert(nestedName.length === 2);
      name = nestedName[0];
      generics = nestedName[1];
    } else {
      name = nestedName;
    }

    if (parentType) {
      return {
        variant: "ExprMemberAccess",
        generics: generics.map((g) => buildASTDatatype([g], sourceloc)),
        expr: parentType,
        member: name,
        sourceloc: sourceloc,
      };
    }
    return {
      variant: "SymbolValueExpr",
      generics: generics.map((g) => buildASTDatatype([g], sourceloc)),
      name: name,
      sourceloc: sourceloc,
    };
  };
  let t: ASTExpr | null = null;
  for (const name of nestedName) {
    t = buildType(t, name);
  }
  assert(t);
  return t;
}
