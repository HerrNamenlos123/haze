import { ImpossibleSituation, type SourceLoc } from "./Errors";
import type { Collect } from "../SymbolCollection/CollectSymbols";
import type { EMethodType, EVariableContext } from "./common";

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

export type ASTFunctionDeclaration = {
  variant: "FunctionDeclaration";
  export: boolean;
  externLanguage: EExternLanguage;
  name: string;
  noemit: boolean;
  namespacePath: string[];
  params: ASTParam[];
  ellipsis: boolean;
  returnType?: ASTDatatype;
  methodType?: EMethodType;
  sourceloc: SourceLoc;
  _collect: {
    definedInNamespaceOrStruct?: ASTNamespaceDefinition | ASTStructDefinition;
    definedInScope?: Collect.Scope;
    namespacePath?: string[];
  };
  _semantic: {};
};

export type ASTFunctionDefinition = {
  variant: "FunctionDefinition";
  export: boolean;
  externLanguage: EExternLanguage;
  operatorOverloading?: {
    operator: EOperator;
    asTarget: ASTDatatype;
  };
  generics: Collect.GenericParameter[];
  name: string;
  params: ASTParam[];
  ellipsis: boolean;
  returnType?: ASTDatatype;
  methodType?: EMethodType;
  declarationScope?: Collect.Scope;
  funcbody?: ASTFuncBody;
  sourceloc: SourceLoc;
  _collect: {
    definedInNamespaceOrStruct?: ASTNamespaceDefinition | ASTStructDefinition;
    definedInScope?: Collect.Scope;
  };
  _semantic: {};
};

export type ASTParam = {
  name: string;
  datatype: ASTDatatype;
  sourceloc: SourceLoc;
};

export type ASTNamedDatatype = {
  variant: "NamedDatatype";
  name: string;
  generics: (ASTDatatype | ASTConstant)[];
  nested?: ASTNamedDatatype;
  sourceloc: SourceLoc;
  _collect: {
    usedInScope?: Collect.Scope;
  };
};

export type ASTFunctionDatatype = {
  variant: "FunctionDatatype";
  params: ASTParam[];
  ellipsis: boolean;
  returnType: ASTDatatype;
  sourceloc: SourceLoc;
};

export type ASTRawPointerDatatype = {
  variant: "RawPointerDatatype";
  pointee: ASTDatatype;
  sourceloc: SourceLoc;
};

export type ASTReferenceDatatype = {
  variant: "ReferenceDatatype";
  referee: ASTDatatype;
  sourceloc: SourceLoc;
};

export type ASTBooleanConstant = {
  variant: "BooleanConstant";
  value: boolean;
  sourceloc: SourceLoc;
};

export type ASTNumberConstant = {
  variant: "NumberConstant";
  value: number;
  unit?: ELiteralUnit;
  sourceloc: SourceLoc;
};

export type ASTStringConstant = {
  variant: "StringConstant";
  value: string;
  sourceloc: SourceLoc;
};

export type ASTConstant = ASTBooleanConstant | ASTNumberConstant | ASTStringConstant;

export type ASTDatatype =
  | ASTNamedDatatype
  | ASTFunctionDatatype
  | ASTDeferredType
  | ASTRawPointerDatatype
  | ASTReferenceDatatype;

export type ASTGlobalVariableDefinition = {
  variant: "GlobalVariableDefinition";
  export: boolean;
  externLanguage: EExternLanguage;
  mutable: boolean;
  name: string;
  datatype?: ASTDatatype;
  expr?: ASTExpr;
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTInlineCStatement = {
  variant: "InlineCStatement";
  code: string;
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
  mutable: boolean;
  name: string;
  datatype?: ASTDatatype;
  expr?: ASTExpr;
  kind: EVariableContext;
  sourceloc: SourceLoc;
  _semantic: {};
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

export type ASTStatement =
  | ASTInlineCStatement
  | ASTExprStatement
  | ASTReturnStatement
  | ASTVariableDefinitionStatement
  | ASTIfStatement
  | ASTWhileStatement;

export type ASTScope = {
  variant: "Scope";
  statements: ASTStatement[];
  sourceloc: SourceLoc;
  _collect: {
    scope?: Collect.Scope;
  };
};

export type ASTParenthesisExpr = {
  variant: "ParenthesisExpr";
  expr: ASTExpr;
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTLambdaExpr = {
  variant: "LambdaExpr";
  lambda: ASTLambda;
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTConstantExpr = {
  variant: "ConstantExpr";
  constant: ASTConstant;
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTPostIncrExpr = {
  variant: "PostIncrExpr";
  expr: ASTExpr;
  operation: EIncrOperation;
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTExprCallExpr = {
  variant: "ExprCallExpr";
  calledExpr: ASTExpr;
  arguments: ASTExpr[];
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTExprMemberAccess = {
  variant: "ExprMemberAccess";
  expr: ASTExpr;
  member: string;
  generics: (ASTDatatype | ASTConstant)[];
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTStructInstantiationExpr = {
  variant: "StructInstantiationExpr";
  datatype: ASTDatatype;
  members: { name: string; value: ASTExpr }[];
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTPreIncrExpr = {
  variant: "PreIncrExpr";
  expr: ASTExpr;
  operation: EIncrOperation;
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTUnaryExpr = {
  variant: "UnaryExpr";
  expr: ASTExpr;
  operation: EUnaryOperation;
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTExplicitCastExpr = {
  variant: "ExplicitCastExpr";
  expr: ASTExpr;
  castedTo: ASTDatatype;
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTRawPointerAddressOfExpr = {
  variant: "RawPointerAddressOf";
  expr: ASTExpr;
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTRawPointerDereferenceExpr = {
  variant: "RawPointerDereference";
  expr: ASTExpr;
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTBinaryExpr = {
  variant: "BinaryExpr";
  a: ASTExpr;
  b: ASTExpr;
  operation: EBinaryOperation;
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTExprAssignmentExpr = {
  variant: "ExprAssignmentExpr";
  target: ASTExpr;
  value: ASTExpr;
  operation: EAssignmentOperation;
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTSymbolValueExpr = {
  variant: "SymbolValueExpr";
  name: string;
  generics: (ASTDatatype | ASTConstant)[];
  sourceloc: SourceLoc;
  _semantic: {};
};

export type ASTExpr =
  | ASTParenthesisExpr
  | ASTLambdaExpr
  | ASTConstantExpr
  | ASTPostIncrExpr
  | ASTExprCallExpr
  | ASTExprMemberAccess
  | ASTStructInstantiationExpr
  | ASTPreIncrExpr
  | ASTRawPointerAddressOfExpr
  | ASTRawPointerDereferenceExpr
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
  _collect: {
    scope?: Collect.Scope;
  };
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

export type ASTStructMethodDefinition = {
  variant: "StructMethod";
  params: ASTParam[];
  name: string;
  generics: Collect.GenericParameter[];
  static: boolean;
  ellipsis: boolean;
  operatorOverloading?: {
    operator: EOperator;
    asTarget: ASTDatatype;
  };
  returnType?: ASTDatatype;
  declarationScope?: Collect.Scope;
  funcbody?: ASTFuncBody;
  sourceloc: SourceLoc;
  _collect: {
    fullNamespacePath?: string[];
    definedInScope?: Collect.Scope;
  };
  _semantic: {
    // memberOfSymbol?: Semantic.Struc;
  };
};

export type ASTStructDefinition = {
  variant: "StructDefinition";
  export: boolean;
  externLanguage: EExternLanguage;
  name: string;
  generics: Collect.GenericParameter[];
  members: ASTStructMemberDefinition[];
  methods: ASTStructMethodDefinition[];
  declarations: ASTStructDefinition[];
  sourceloc: SourceLoc;
  _collect: {
    definedInNamespaceOrStruct?: ASTNamespaceDefinition | ASTStructDefinition;
    definedInScope?: Collect.Scope;
    fullNamespacedName?: string[];
    namespaces?: string[];
    scope?: Collect.Scope;
  };
  _semantic: {};
};

export type ASTTypeDefinition = ASTStructDefinition;

export type ASTNamespaceDefinition = {
  variant: "NamespaceDefinition";
  export: boolean;
  name: string;
  declarations: ASTGlobalDeclaration[];
  sourceloc: SourceLoc;
  _collect: {
    definedInNamespaceOrStruct?: ASTNamespaceDefinition | ASTStructDefinition;
    scope?: Collect.Scope;
  };
};

export type ASTGlobalDeclaration =
  | ASTFunctionDefinition
  | ASTFunctionDeclaration
  | ASTTypeDefinition
  | ASTNamespaceDefinition
  | ASTGlobalVariableDefinition;

export type ASTTopLevelDeclaration = ASTCInjectDirective | ASTGlobalDeclaration;

export type ASTRoot = ASTTopLevelDeclaration[];
