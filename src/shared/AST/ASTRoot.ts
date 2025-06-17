import type { SourceLoc } from "../../Errors";

export enum EExternLanguage {
  None,
  Extern,
  Extern_C,
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
  LessEqal,
  Greater,
  GreaterEqual,
  Equal,
  Unequal,
  BoolAnd,
  BoolOr,
}

export enum EAssignmentOperation {
  Assign,
  Add,
  Subtract,
  Multiply,
  Divide,
  Modulo,
}

export type ASTFunctionDeclaration = {
  variant: "FunctionDeclaration";
  export: boolean;
  externLanguage: EExternLanguage;
  name: string;
  namespacePath: string[];
  params: ASTParam[];
  ellipsis: boolean;
  returnType: ASTDatatype;
  sourceloc: SourceLoc;
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
  nestedParent?: ASTNamedDatatype;
  sourceloc: SourceLoc;
};

export type ASTFunctionDatatype = {
  variant: "FunctionDatatype";
  params: ASTParam[];
  ellipsis: boolean;
  returnType: ASTDatatype;
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

export type ASTConstant =
  | ASTBooleanConstant
  | ASTNumberConstant
  | ASTStringConstant;

export type ASTDatatype = ASTNamedDatatype | ASTFunctionDatatype;

export type ASTFunctionDefinition = {
  variant: "FunctionDefinition";
  export: boolean;
  name: string;
  params: ASTParam[];
  ellipsis: boolean;
  returnType: ASTDatatype;
  funcbody: ASTFuncBody;
  sourceloc: SourceLoc;
};

export type ASTGlobalVariableDefinition = {
  variant: "GlobalVariableDefinition";
  export: boolean;
  externLanguage: EExternLanguage;
  mutable: boolean;
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

export type ASTConstantExpr = {
  variant: "ConstantExpr";
  constant: ASTConstant;
  sourceloc: SourceLoc;
};

export type ASTPostIncrExpr = {
  variant: "PostIncrExpr";
  expr: ASTExpr;
  operation: "++" | "--";
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
  generics: (ASTDatatype | ASTConstant)[];
  sourceloc: SourceLoc;
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

export type ASTFuncBody = ASTScope | ASTExpr;

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
  ellipsis: boolean;
  returnType?: ASTDatatype;
  funcbody: ASTFuncBody;
  sourceloc: SourceLoc;
};

export type ASTStructDefinition = {
  variant: "StructDefinition";
  export: boolean;
  externLanguage: EExternLanguage;
  name: string;
  genericPlaceholders: string[];
  members: ASTStructMemberDefinition[];
  methods: ASTStructMethodDefinition[];
  sourceloc: SourceLoc;
};

export type ASTTypeDefinition = ASTStructDefinition;

export type ASTNamespaceDefinition = {
  variant: "NamespaceDefinition";
  export: boolean;
  names: string[];
  declarations: ASTGlobalDeclaration;
  sourceloc: SourceLoc;
};

export type ASTGlobalDeclaration =
  | ASTFunctionDefinition
  | ASTFunctionDeclaration
  | ASTTypeDefinition
  | ASTNamespaceDefinition
  | ASTGlobalVariableDefinition;

export type ASTTopLevelDeclaration = ASTCInjectDirective | ASTGlobalDeclaration;

export type ASTRoot = ASTTopLevelDeclaration[];
