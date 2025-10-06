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

export enum EOperator {
  Add,
  Sub,
  As,
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
  Unequal,
  BoolAnd,
  BoolOr,
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
    case EAssignmentOperation.Assign:
      return "=";
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
    case EBinaryOperation.Unequal:
      return "!=";
    case EBinaryOperation.BoolAnd:
      return "&&";
    case EBinaryOperation.BoolOr:
      return "||";
    default:
      throw new ImpossibleSituation();
  }
}

export enum EAssignmentOperation {
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

export type ASTFunctionDefinition = {
  variant: "FunctionDefinition";
  export: boolean;
  pub: boolean;
  externLanguage: EExternLanguage;
  operatorOverloading?: {
    operator: EOperator;
    asTarget: ASTTypeUse;
  };
  generics: {
    name: string;
    sourceloc: SourceLoc;
  }[];
  name: string;
  noemit: boolean;
  static: boolean;
  params: ASTParam[];
  ellipsis: boolean;
  returnType?: ASTTypeUse;
  methodType: EMethodType;
  funcbody?: ASTFuncBody;
  sourceloc: SourceLoc;
  originalSourcecode: string;
};

export type ASTParam = {
  name: string;
  datatype: ASTTypeUse;
  sourceloc: SourceLoc;
};

export type ASTNamedDatatype = {
  variant: "NamedDatatype";
  name: string;
  generics: (ASTTypeUse | ASTLiteralExpr)[];
  nested?: ASTNamedDatatype;
  mutability: EDatatypeMutability;
  sourceloc: SourceLoc;
};

export type ASTFunctionDatatype = {
  variant: "FunctionDatatype";
  params: ASTParam[];
  ellipsis: boolean;
  returnType: ASTTypeUse;
  mutability: EDatatypeMutability;
  sourceloc: SourceLoc;
};

export type ASTNullableReferenceDatatype = {
  variant: "NullableReferenceDatatype";
  referee: ASTTypeUse;
  mutability: EDatatypeMutability;
  sourceloc: SourceLoc;
};

export type ASTArrayDatatype = {
  variant: "ArrayDatatype";
  datatype: ASTTypeUse;
  length: number;
  mutability: EDatatypeMutability;
  sourceloc: SourceLoc;
};

export type ASTSliceDatatype = {
  variant: "SliceDatatype";
  datatype: ASTTypeUse;
  mutability: EDatatypeMutability;
  sourceloc: SourceLoc;
};

export type ASTReferenceDatatype = {
  variant: "ReferenceDatatype";
  referee: ASTTypeUse;
  mutability: EDatatypeMutability;
  sourceloc: SourceLoc;
};

export type ASTParameterPackDatatype = {
  variant: "ParameterPack";
  sourceloc: SourceLoc;
};

export type ASTTypeUse =
  | ASTNamedDatatype
  | ASTFunctionDatatype
  | ASTDeferredType
  | ASTNullableReferenceDatatype
  | ASTArrayDatatype
  | ASTSliceDatatype
  | ASTParameterPackDatatype
  | ASTReferenceDatatype;

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
  code: string;
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
  condition: ASTExpr;
  then: ASTScope;
  comptime: boolean;
  elseIfs: {
    condition: ASTExpr;
    then: ASTScope;
  }[];
  else?: ASTScope;
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
  condition: ASTExpr;
  body: ASTScope;
  sourceloc: SourceLoc;
};

export type ASTTypeAlias = {
  variant: "TypeAlias";
  name: string;
  datatype: ASTTypeUse;
  export: boolean;
  pub: boolean;
  extern: EExternLanguage;
  sourceloc: SourceLoc;
};

export type ASTStatement =
  | ASTInlineCStatement
  | ASTExprStatement
  | ASTForEachStatement
  | ASTReturnStatement
  | ASTVariableDefinitionStatement
  | ASTIfStatement
  | ASTTypeAlias
  | ASTWhileStatement;

export type ASTScope = {
  variant: "Scope";
  statements: ASTStatement[];
  emittedExpr: ASTExpr | null;
  unsafe: boolean;
  sourceloc: SourceLoc;
};

export type ASTParenthesisExpr = {
  variant: "ParenthesisExpr";
  expr: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTLambdaExpr = {
  variant: "LambdaExpr";
  lambda: ASTLambda;
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
  sourceloc: SourceLoc;
};

export type ASTArrayLiteralExpr = {
  variant: "ArrayLiteralExpr";
  values: ASTExpr[];
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
  sourceloc: SourceLoc;
};

export type ASTExprMemberAccess = {
  variant: "ExprMemberAccess";
  expr: ASTExpr;
  member: string;
  generics: (ASTTypeUse | ASTLiteralExpr)[];
  sourceloc: SourceLoc;
};

export type ASTStructInstantiationExpr = {
  variant: "StructInstantiationExpr";
  datatype: ASTTypeUse | null;
  members: { name: string; value: ASTExpr }[];
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

export type ASTAddressOfExpr = {
  variant: "AddressOfExpr";
  expr: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTDereferenceExpr = {
  variant: "DereferenceExpr";
  expr: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTArraySubscriptExpr = {
  variant: "ArraySubscriptExpr";
  expr: ASTExpr;
  indices: ASTExpr[];
  sourceloc: SourceLoc;
};

export type ASTArraySliceExpr = {
  variant: "ArraySliceExpr";
  expr: ASTExpr;
  indices: { start: ASTExpr | null; end: ASTExpr | null }[];
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
  | ASTBlockScopeExpr
  | ASTLambdaExpr
  | ASTArrayLiteralExpr
  | ASTLiteralExpr
  | ASTPostIncrExpr
  | ASTExprCallExpr
  | ASTExprMemberAccess
  | ASTStructInstantiationExpr
  | ASTPreIncrExpr
  | ASTAddressOfExpr
  | ASTDereferenceExpr
  | ASTUnaryExpr
  | ASTExplicitCastExpr
  | ASTArraySubscriptExpr
  | ASTArraySliceExpr
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
  code: string;
  export: boolean;
  sourceloc: SourceLoc;
};

export type ASTStructMemberDefinition = {
  variant: "StructMember";
  name: string;
  type: ASTTypeUse;
  defaultValue: ASTExpr | null;
  mutability: EVariableMutability;
  sourceloc: SourceLoc;
};

export type ASTStructDefinition = {
  variant: "StructDefinition";
  export: boolean;
  extern: EExternLanguage;
  name: string;
  noemit: boolean;
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

export type ASTTypeDef = ASTStructDefinition | ASTNamespaceDefinition | ASTTypeAlias;

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
