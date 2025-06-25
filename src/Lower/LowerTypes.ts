import type { SemanticResult } from "../Semantic/SemanticSymbols";
import type { EBinaryOperation } from "../shared/AST";
import type { EPrimitive, EVariableContext } from "../shared/common";
import type { SourceLoc } from "../shared/Errors";
import type { LoweredTypeId, SemanticSymbolId } from "../shared/store";
import type { CollectResult } from "../SymbolCollection/CollectSymbols";

export namespace Lowered {
  export type Module = {
    cr: CollectResult;
    sr: SemanticResult;

    cDeclarations: string[];

    datatypes: Map<LoweredTypeId, Datatype>;
    functions: Map<LoweredTypeId, FunctionDeclaration | FunctionDefinition>;
  };

  export type BinaryExpr = {
    variant: "BinaryExpr";
    left: Expression;
    operation: EBinaryOperation;
    right: Expression;
    type: LoweredTypeId;
  };

  export type ExprCallExpr = {
    variant: "ExprCallExpr";
    expr: Expression;
    arguments: Expression[];
    type: LoweredTypeId;
  };

  export type CallableExpr = {
    variant: "Callable";
    thisExpr: Expression;
    functionSymbol: LoweredTypeId;
    type: LoweredTypeId;
  };

  export type ExplicitCastExpr = {
    variant: "ExplicitCast";
    expr: Expression;
    type: LoweredTypeId;
  };

  export type ExprMemberAccessExpr = {
    variant: "ExprMemberAccess";
    expr: Expression;
    memberName: string;
    isReference: boolean;
    type: LoweredTypeId;
  };

  export type ConstantExpr = {
    variant: "ConstantExpr";
    value: string | number | boolean;
    type: LoweredTypeId;
  };

  export type SymbolValueExpr = {
    variant: "SymbolValue";
    name: string;
    type: LoweredTypeId;
  };

  export type StructInstantiationExpr = {
    variant: "StructInstantiation";
    type: LoweredTypeId;
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
    type: LoweredTypeId;
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
    id: LoweredTypeId;
    variant: "FunctionDeclaration";
    name: string;
    parent?: LoweredTypeId;
    type: LoweredTypeId;
    semanticId: SemanticSymbolId;
    sourceloc: SourceLoc;
  };

  export type FunctionDefinition = {
    id: LoweredTypeId;
    variant: "FunctionDefinition";
    name: string;
    parent?: LoweredTypeId;
    type: LoweredTypeId;
    semanticId: SemanticSymbolId;
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
    id: LoweredTypeId;
    variant: "Namespace";
    name: string;
    parent: LoweredTypeId;
    semanticId: SemanticSymbolId;
  };

  export type RawPointerDatatype = {
    id: LoweredTypeId;
    variant: "RawPointer";
    pointee: LoweredTypeId;
  };

  export type ReferenceDatatype = {
    id: LoweredTypeId;
    variant: "Reference";
    referee: LoweredTypeId;
  };

  export type CallableDatatype = {
    id: LoweredTypeId;
    variant: "Callable";
    thisExprType?: LoweredTypeId;
    functionType: LoweredTypeId;
  };

  export type PrimitiveDatatype = {
    id: LoweredTypeId;
    variant: "Primitive";
    primitive: EPrimitive;
  };

  export type StructDatatype = {
    id: LoweredTypeId;
    variant: "Struct";
    name: string;
    generics: LoweredTypeId[];
    parent?: LoweredTypeId;
    members: {
      name: string;
      type: LoweredTypeId;
    }[];
    semanticId: SemanticSymbolId;
  };

  export type FunctionDatatype = {
    id: LoweredTypeId;
    variant: "Function";
    parameters: {
      name: string;
      type: LoweredTypeId;
    }[];
    returnType: LoweredTypeId;
    vararg: boolean;
    semanticId: SemanticSymbolId;
  };
}
