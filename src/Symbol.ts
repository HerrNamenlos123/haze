import type { ParserRuleContext } from "antlr4ng";
import type { DatatypeRef } from "./Datatype";
import type { Scope } from "./Scope";

export enum VariableType {
  MutableVariable,
  ConstantVariable,
  Parameter,
  MutableStructField,
  ConstantStructField,
}

export enum FunctionType {
  Internal,
  External_C,
  External_CXX,
}

// export type SymbolTypes =
//   | "Variable"
//   | "GenericPlaceholder"
//   | "Datatype"
//   | "Constant";

export type VariableSymbol = {
  variant: "Variable";
  name: string;
  type: DatatypeRef;
  variableType: VariableType;
};

export type FunctionSymbol = {
  variant: "Function";
  name: string;
  type: DatatypeRef;
  functionType: FunctionType;
  scope: Scope;
};

export type MemberSymbol = {
  variant: "Member";
  name: string;
  type: DatatypeRef;
  functionType: FunctionType;
  scope: Scope;
  thisPointer?: DatatypeRef;
  isConstructor: boolean;
};

export type MethodSymbol = {
  variant: "Method";
  name: string;
  type: DatatypeRef;
};

export type GenericPlaceholderSymbol = {
  variant: "GenericPlaceholder";
  name: string;
  type?: DatatypeRef;
};

export type DatatypeSymbol = {
  variant: "Datatype";
  parentSymbol?: Symbol;
  name: string;
  type?: DatatypeRef;
};

// export type ConstantSymbol = {
//   variant: "Constant";
//   type: DatatypeRef;
//   value: string | number | boolean;
// };

export type Symbol =
  | VariableSymbol
  | GenericPlaceholderSymbol
  | DatatypeSymbol
  | MemberSymbol
  | MethodSymbol;
//   | ConstantSymbol;
