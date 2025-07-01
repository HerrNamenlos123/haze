import type { Semantic, SemanticResult } from "../Semantic/SemanticSymbols";
import type { EBinaryOperation, EExternLanguage, EIncrOperation } from "../shared/AST";
import type { EPrimitive, EVariableContext } from "../shared/common";
import type { SourceLoc } from "../shared/Errors";
import type { LoweredTypeId, SemanticSymbolId } from "../shared/store";
import type { CollectResult } from "../SymbolCollection/CollectSymbols";

export namespace Lowered {
  export type Module = {
    cr: CollectResult;
    sr: SemanticResult;

    cDeclarations: string[];

    loweredTypes: Map<Semantic.Symbol, Lowered.Datatype>
    loweredFunctions: Map<Semantic.Symbol, Lowered.FunctionDeclaration | Lowered.FunctionDefinition>;
  };

  export type BinaryExpr = {
    variant: "BinaryExpr";
    left: Expression;
    operation: EBinaryOperation;
    right: Expression;
    type: Datatype;
  };

  export type ExprCallExpr = {
    variant: "ExprCallExpr";
    expr: Expression;
    arguments: Expression[];
    type: Datatype;
  };

  export type CallableExpr = {
    variant: "Callable";
    thisExpr: Expression;
    functionSymbol: FunctionDefinition | FunctionDeclaration;
    type: Datatype;
  };

  export type ExplicitCastExpr = {
    variant: "ExplicitCast";
    expr: Expression;
    type: Datatype;
  };

  export type ExprMemberAccessExpr = {
    variant: "ExprMemberAccess";
    expr: Expression;
    memberName: string;
    isReference: boolean;
    type: Datatype;
  };

  export type ConstantExpr = {
    variant: "ConstantExpr";
    value: string | number | boolean;
    type: Datatype;
  };

  export type SymbolValueExpr = {
    variant: "SymbolValue";
    name: string;
    functionSymbol?: FunctionDeclaration | FunctionDefinition;
    type: Datatype;
  };

  export type PostIncrExpr = {
    variant: "PostIncrExpr";
    expr: Expression;
    operation: EIncrOperation;
    type: Datatype;
  };

  export type PreIncrExpr = {
    variant: "PreIncrExpr";
    expr: Expression;
    operation: EIncrOperation;
    type: Datatype;
  };

  export type StructInstantiationExpr = {
    variant: "StructInstantiation";
    type: Datatype;
    memberAssigns: {
      name: string;
      value: Expression;
    }[];
  };

  export type Expression =
    | ExprCallExpr
    | BinaryExpr
    | CallableExpr
    | StructInstantiationExpr
    | ExplicitCastExpr
    | ExprMemberAccessExpr
    | ConstantExpr
    | PreIncrExpr | PostIncrExpr
    | SymbolValueExpr;

  export type Scope = {
    statements: Statement[];
  };

  export type Statement =
    | InlineCStatement
    | ReturnStatement
    | VariableStatement
    | IfStatement
    | WhileStatement
    | ExprStatement;

  export type InlineCStatement = {
    variant: "InlineCStatement";
    value: string;
    sourceloc: SourceLoc;
  };

  export type VariableStatement = {
    variant: "VariableStatement";
    name: string;
    type: Datatype;
    variableContext: EVariableContext;
    value?: Expression;
    sourceloc: SourceLoc;
  };

  export type ReturnStatement = {
    variant: "ReturnStatement";
    expr?: Expression;
    sourceloc: SourceLoc;
  };

  export type IfStatement = {
    variant: "IfStatement";
    condition: Expression;
    then: Scope;
    elseIfs: {
      condition: Expression;
      then: Scope;
    }[];
    else?: Scope;
    sourceloc: SourceLoc;
  };

  export type WhileStatement = {
    variant: "WhileStatement";
    condition: Expression;
    then: Scope;
    sourceloc: SourceLoc;
  };

  export type ExprStatement = {
    variant: "ExprStatement";
    expr: Expression;
    sourceloc: SourceLoc;
  };

  export type FunctionDeclaration = {
    variant: "FunctionDeclaration";
    name: string;
    parent?: NamespaceDatatype | StructDatatype;
    type: FunctionDatatype;
    externLanguage: EExternLanguage;
    sourceloc: SourceLoc;
  };

  export type FunctionDefinition = {
    variant: "FunctionDefinition";
    name: string;
    parent?: NamespaceDatatype | StructDatatype;
    type: FunctionDatatype;
    externLanguage: EExternLanguage;
    scope: Scope;
    sourceloc: SourceLoc;
  };

  export type Datatype =
    | StructDatatype
    | NamespaceDatatype
    | CallableDatatype
    | PrimitiveDatatype
    | FunctionDatatype
    | ReferenceDatatype
    | RawPointerDatatype;

  export type DatatypeWithoutId =
    | (Omit<StructDatatype, "id"> & { variant: "Struct" })
    | (Omit<NamespaceDatatype, "id"> & { variant: "Namespace" })
    | (Omit<CallableDatatype, "id"> & { variant: "Callable" })
    | (Omit<PrimitiveDatatype, "id"> & { variant: "Primitive" })
    | (Omit<FunctionDatatype, "id"> & { variant: "Function" })
    | (Omit<ReferenceDatatype, "id"> & { variant: "Reference" })
    | (Omit<RawPointerDatatype, "id"> & { variant: "RawPointer" });

  export type NamespaceDatatype = {
    variant: "Namespace";
    name: string;
    parent: NamespaceDatatype | StructDatatype;
  };

  export type RawPointerDatatype = {
    variant: "RawPointer";
    pointee: Datatype;
  };

  export type ReferenceDatatype = {
    variant: "Reference";
    referee: Datatype;
  };

  export type CallableDatatype = {
    variant: "Callable";
    thisExprType?: Datatype;
    functionType: FunctionDatatype;
  };

  export type PrimitiveDatatype = {
    variant: "Primitive";
    primitive: EPrimitive;
  };

  export type StructDatatype = {
    variant: "Struct";
    name: string;
    generics: Datatype[];
    parent?: NamespaceDatatype | StructDatatype;
    members: {
      name: string;
      type: Datatype;
    }[];
  };

  export type FunctionDatatype = {
    variant: "Function";
    parameters: Datatype[];
    returnType: Datatype;
    vararg: boolean;
  };
}
