import { ImpossibleSituation, type SourceLoc } from "./Errors";
import type { EMethodType, EVariableContext, LiteralValue } from "./common";

export enum EVariableMutability {
  Const,
  Let,
  Default,
}

export enum EDatatypeMutability {
  Default,
  Mut,
  Const,
}

export enum EExternLanguage {
  None,
  Extern,
  Extern_C,
}

export enum EOverloadedOperator {
  Add,
  Sub,
  Mul,
  Div,
  Mod,
  Rebind,
  Assign,
  Subscript,
  Cast,
}

export enum ELiteralUnit {
  s,
  ms,
  us,
  ns,
  m,
  h,
  d,
}

export enum EIncrOperation {
  Incr,
  Decr,
}

export enum EUnaryOperation {
  Plus,
  Minus,
  Negate,
}

export enum EBinaryOperation {
  Multiply,
  Divide,
  Modulo,
  Add,
  Subtract,
  LessThan,
  LessEqual,
  GreaterThan,
  GreaterEqual,
  Equal,
  NotEqual,
  BoolAnd,
  BoolOr,
  BitwiseOr,
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
  Rebind,
  Assign,
  Add,
  Subtract,
  Multiply,
  Divide,
  Modulo,
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
      operator: EOverloadedOperator.Assign;
    }
  | {
      operator: EOverloadedOperator.Rebind;
    };

export type ASTFunctionDefinition = {
  variant: "FunctionDefinition";
  export: boolean;
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
  returnType?: ASTTypeUse;
  methodType: EMethodType;
  methodRequiredMutability: EDatatypeMutability.Const | EDatatypeMutability.Mut | null;
  funcbody?: ASTFuncBody;
  sourceloc: SourceLoc;
  originalSourcecode: string;
};

export type ASTParam = {
  name: string;
  datatype: ASTTypeUse;
  optional: boolean;
  sourceloc: SourceLoc;
};

export type ASTNamedDatatype = {
  variant: "NamedDatatype";
  name: string;
  generics: (ASTTypeUse | ASTLiteralExpr)[];
  nested?: ASTNamedDatatype;
  inline: boolean;
  mutability: EDatatypeMutability;
  sourceloc: SourceLoc;
};

export type ASTUntaggedUnionDatatype = {
  variant: "UntaggedUnionDatatype";
  members: ASTTypeUse[];
  sourceloc: SourceLoc;
};

export type ASTTaggedUnionDatatype = {
  variant: "TaggedUnionDatatype";
  members: {
    tag: string;
    type: ASTTypeUse;
  }[];
  nodiscard: boolean;
  sourceloc: SourceLoc;
};

export type ASTFunctionDatatype = {
  variant: "FunctionDatatype";
  params: ASTParam[];
  ellipsis: boolean;
  returnType: ASTTypeUse;
  requires: ASTFunctionRequiresBlock;
  mutability: EDatatypeMutability;
  sourceloc: SourceLoc;
};

export type ASTStackArrayDatatype = {
  variant: "StackArrayDatatype";
  datatype: ASTTypeUse;
  length: bigint;
  inline: boolean;
  mutability: EDatatypeMutability;
  sourceloc: SourceLoc;
};

export type ASTDynamicArrayDatatype = {
  variant: "DynamicArrayDatatype";
  datatype: ASTTypeUse;
  mutability: EDatatypeMutability;
  sourceloc: SourceLoc;
};

export type ASTParameterPackDatatype = {
  variant: "ParameterPack";
  sourceloc: SourceLoc;
};

export type ASTTypeUse =
  | ASTUntaggedUnionDatatype
  | ASTTaggedUnionDatatype
  | ASTNamedDatatype
  | ASTFunctionDatatype
  | ASTDeferredType
  | ASTStackArrayDatatype
  | ASTDynamicArrayDatatype
  | ASTParameterPackDatatype;

export type ASTGlobalVariableDefinition = {
  variant: "GlobalVariableDefinition";
  export: boolean;
  comptime: boolean;
  pub: boolean;
  extern: EExternLanguage;
  mutability: EVariableMutability;
  name: string;
  datatype?: ASTTypeUse;
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
  datatype?: ASTTypeUse;
  expr?: ASTExpr;
  variableContext: EVariableContext;
  sourceloc: SourceLoc;
};

export type ASTIfStatement = {
  variant: "IfStatement";
  condition: ASTExpr | null;
  letCondition: {
    name: string;
    type: ASTTypeUse | null;
    expr: ASTExpr;
  } | null;
  then: ASTScope;
  comptime: boolean;
  elseIfs: {
    condition: ASTExpr | null;
    letCondition: {
      name: string;
      type: ASTTypeUse | null;
      expr: ASTExpr;
    } | null;
    then: ASTScope;
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
    type: ASTTypeUse | null;
    expr: ASTExpr;
  } | null;
  condition: ASTExpr | null;
  body: ASTScope;
  sourceloc: SourceLoc;
};

export type ASTTypeAlias = {
  variant: "TypeAlias";
  name: string;
  datatype: ASTTypeUse;
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
  fragments: ({ type: "expr"; value: ASTExpr } | { type: "text"; value: string })[];
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
  generics: (ASTTypeUse | ASTLiteralExpr)[];
  sourceloc: SourceLoc;
};

export type ASTAggregateLiteralElement = {
  key: string | null;
  value: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTAggregateLiteralExpr = {
  variant: "AggregateLiteralExpr";
  datatype: ASTTypeUse | null;
  elements: ASTAggregateLiteralElement[];
  allocator: ASTExpr | null;
  sourceloc: SourceLoc;
};

export type ASTTernaryExpr = {
  variant: "TernaryExpr";
  condition: ASTExpr;
  then: ASTExpr;
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
  castedTo: ASTTypeUse;
  sourceloc: SourceLoc;
};

export type ASTExprIsTypeExpr = {
  variant: "ExprIsTypeExpr";
  expr: ASTExpr;
  comparisonType: ASTTypeUse;
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
  generics: (ASTTypeUse | ASTLiteralExpr)[];
  sourceloc: SourceLoc;
};

export type ASTTypeLiteralExpr = {
  variant: "TypeLiteralExpr";
  datatype: ASTTypeUse;
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
  | ASTTypeLiteralExpr;

export type ASTLambda = {
  variant: "Lambda";
  params: ASTParam[];
  ellipsis: boolean;
  returnType?: ASTTypeUse;
  funcbody: ASTFuncBody;
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
  type: ASTTypeUse;
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
