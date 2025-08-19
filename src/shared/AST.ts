import { ImpossibleSituation, type SourceLoc } from "./Errors";
import type { EMethodType, EVariableContext, LiteralValue } from "./common";

export enum EVariableMutability {
  Immutable, // Fully immutable
  BindingImmutable, // Binding is immutable, but value inside is not (e.g. struct fields)
  Mutable, // Fully mutable
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
    asTarget: ASTDatatype;
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
  returnType?: ASTDatatype;
  methodType: EMethodType;
  funcbody?: ASTFuncBody;
  sourceloc: SourceLoc;
  originalSourcecode: string;
};

export type ASTParam = {
  name: string;
  datatype: ASTDatatype;
  sourceloc: SourceLoc;
};

export type ASTNamedDatatype = {
  variant: "NamedDatatype";
  name: string;
  generics: (ASTDatatype | ASTLiteralExpr)[];
  nested?: ASTNamedDatatype;
  sourceloc: SourceLoc;
};

export type ASTFunctionDatatype = {
  variant: "FunctionDatatype";
  params: ASTParam[];
  ellipsis: boolean;
  returnType: ASTDatatype;
  sourceloc: SourceLoc;
};

export type ASTPointerDatatype = {
  variant: "PointerDatatype";
  pointee: ASTDatatype;
  sourceloc: SourceLoc;
};

export type ASTReferenceDatatype = {
  variant: "ReferenceDatatype";
  referee: ASTDatatype;
  sourceloc: SourceLoc;
};

export type ASTDatatype =
  | ASTNamedDatatype
  | ASTFunctionDatatype
  | ASTDeferredType
  | ASTPointerDatatype
  | ASTReferenceDatatype;

export type ASTGlobalVariableDefinition = {
  variant: "GlobalVariableDefinition";
  export: boolean;
  pub: boolean;
  extern: EExternLanguage;
  mutability: EVariableMutability;
  name: string;
  datatype?: ASTDatatype;
  expr?: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTInlineCStatement = {
  variant: "InlineCStatement";
  code: string;
  sourceloc: SourceLoc;
};

export type ASTScopeStatement = {
  variant: "ScopeStatement";
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
  name: string;
  datatype?: ASTDatatype;
  expr?: ASTExpr;
  variableContext: EVariableContext;
  sourceloc: SourceLoc;
};

export type ASTIfStatement = {
  variant: "IfStatement";
  condition: ASTExpr;
  then: ASTScope;
  elseIfs: {
    condition: ASTExpr;
    then: ASTScope;
  }[];
  else?: ASTScope;
  sourceloc: SourceLoc;
};

export type ASTWhileStatement = {
  variant: "WhileStatement";
  condition: ASTExpr;
  body: ASTScope;
  sourceloc: SourceLoc;
};

export type ASTTypedefStatement = {
  variant: "TypedefStatement";
  name: string;
  datatype: ASTDatatype;
  export: boolean;
  pub: boolean;
  extern: EExternLanguage;
  sourceloc: SourceLoc;
};

export type ASTStatement =
  | ASTInlineCStatement
  | ASTScopeStatement
  | ASTExprStatement
  | ASTReturnStatement
  | ASTVariableDefinitionStatement
  | ASTIfStatement
  | ASTTypedefStatement
  | ASTWhileStatement;

export type ASTScope = {
  variant: "Scope";
  statements: ASTStatement[];
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
  generics: (ASTDatatype | ASTLiteralExpr)[];
  sourceloc: SourceLoc;
};

export type ASTStructInstantiationExpr = {
  variant: "StructInstantiationExpr";
  datatype: ASTDatatype;
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
  castedTo: ASTDatatype;
  sourceloc: SourceLoc;
};

export type ASTPointerAddressOfExpr = {
  variant: "PointerAddressOf";
  expr: ASTExpr;
  sourceloc: SourceLoc;
};

export type ASTPointerDereferenceExpr = {
  variant: "PointerDereference";
  expr: ASTExpr;
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
  generics: (ASTDatatype | ASTLiteralExpr)[];
  sourceloc: SourceLoc;
};

export type ASTExpr =
  | ASTParenthesisExpr
  | ASTLambdaExpr
  | ASTLiteralExpr
  | ASTPostIncrExpr
  | ASTExprCallExpr
  | ASTExprMemberAccess
  | ASTStructInstantiationExpr
  | ASTPreIncrExpr
  | ASTPointerAddressOfExpr
  | ASTPointerDereferenceExpr
  | ASTUnaryExpr
  | ASTExplicitCastExpr
  | ASTBinaryExpr
  | ASTExprAssignmentExpr
  | ASTSymbolValueExpr;

export type ASTLambda = {
  variant: "Lambda";
  params: ASTParam[];
  ellipsis: boolean;
  returnType?: ASTDatatype;
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
  sourceloc: SourceLoc;
};

export type ASTStructMemberDefinition = {
  variant: "StructMember";
  name: string;
  type: ASTDatatype;
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

export type ASTTypeDefinition = ASTStructDefinition;

export type ASTNamespaceDefinition = {
  variant: "NamespaceDefinition";
  export: boolean;
  name: string;
  declarations: ASTGlobalDeclaration[];
  sourceloc: SourceLoc;
};

export type ModuleImport = {
  variant: "ModuleImport";
  mode: "path" | "module";
  name: string;
  alias: string | null;
  sourceloc: SourceLoc;
};

export type SymbolImport = {
  variant: "SymbolImport";
  mode: "path" | "module";
  name: string;
  symbols: {
    symbol: string;
    alias: string | null;
  }[];
  sourceloc: SourceLoc;
};

export type ASTGlobalDeclaration =
  | ASTFunctionDefinition
  | ASTTypeDefinition
  | ASTNamespaceDefinition
  | ASTTypedefStatement
  | ASTGlobalVariableDefinition;

export type ASTTopLevelDeclaration =
  | ASTCInjectDirective
  | ModuleImport
  | SymbolImport
  | ASTGlobalDeclaration;

export type ASTRoot = ASTTopLevelDeclaration[];
