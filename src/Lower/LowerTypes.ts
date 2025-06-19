import type { SemanticResult } from "../Semantic/SemanticSymbols";
import type { EBinaryOperation } from "../shared/AST";
import type { EPrimitive } from "../shared/common";
import type { ID } from "../shared/store";
import type { CollectResult } from "../SymbolCollection/CollectSymbols";

export namespace Lowered {
  export type Module = {
    cr: CollectResult;
    sr: SemanticResult;

    cDeclarations: string[];

    datatypes: Map<ID, Datatype>;
    functions: (FunctionDeclaration | FunctionDefinition)[];
  };

  export type BinaryExpr = {
    variant: "BinaryExpr";
    left: Expression;
    operation: EBinaryOperation;
    right: Expression;
    type: ID;
  };

  export type ExprCallExpr = {
    variant: "ExprCallExpr";
    expr: Expression;
    arguments: Expression[];
    type: ID;
  };

  export type ConstantExpr = {
    variant: "ConstantExpr";
    value: string | number | boolean;
    type: ID;
  };

  export type SymbolValueExpr = {
    variant: "SymbolValue";
    name: string;
    type: ID;
  };

  export type StructInstantiationExpr = {
    variant: "StructInstantiation";
    type: ID;
    memberAssigns: {
      name: string;
      value: Expression;
    }[];
  };

  export type Expression =
    | ExprCallExpr
    | BinaryExpr
    | StructInstantiationExpr
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
  };

  export type VariableStatement = {
    variant: "VariableStatement";
    name: string;
    type: ID;
    value?: Expression;
  };

  export type ReturnStatement = {
    variant: "ReturnStatement";
    expr?: Expression;
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
  };

  export type WhileStatement = {
    variant: "WhileStatement";
    condition: Expression;
    then: Scope;
  };

  export type ExprStatement = {
    variant: "ExprStatement";
    expr: Expression;
  };

  export type FunctionDeclaration = {
    id?: ID;
    variant: "FunctionDeclaration";
    name: string;
    parent: ID;
    semanticId: ID;
  };

  export type FunctionDefinition = {
    id?: ID;
    variant: "FunctionDefinition";
    name: string;
    parent?: ID;
    semanticId: ID;
    scope: Scope;
  };

  export type Datatype = StructDatatype | NamespaceDatatype | PrimitiveDatatype | FunctionDatatype;

  export type NamespaceDatatype = {
    id?: ID;
    variant: "Namespace";
    name: string;
    parent: ID;
    semanticId: ID;
  };

  export type PrimitiveDatatype = {
    id?: ID;
    variant: "Primitive";
    primitive: EPrimitive;
  };

  export type StructDatatype = {
    id?: ID;
    variant: "Struct";
    name: string;
    generics: ID[];
    parent: ID;
    semanticId: ID;
  };

  export type FunctionDatatype = {
    id?: ID;
    variant: "Function";
    parameters: {
      name: string;
      type: ID;
    }[];
    vararg: boolean;
    semanticId: ID;
  };
}
