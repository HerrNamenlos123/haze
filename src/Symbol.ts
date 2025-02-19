import type { BaseDatatype, ConcreteDatatype, Datatype } from "./Datatype";
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

export type VariableSymbol = {
  variant: "Variable";
  name: string;
  type: Datatype;
  variableType: VariableType;
  parentSymbol?: Symbol;
};

export type FunctionSymbol = {
  variant: "Function";
  name: string;
  type: Datatype;
  functionType: FunctionType;
  parentSymbol?: Symbol;
  scope: Scope;
  thisPointer?: Datatype;
  isConstructor?: boolean;
};

export type DatatypeSymbol = {
  variant: "Datatype";
  parentSymbol?: Symbol;
  name: string;
  type?: Datatype;
  scope: Scope;
};

// export type ConstantSymbol = {
//   variant: "Constant";
//   type: DatatypeRef;
//   value: string | number | boolean;
// };

export type Symbol = VariableSymbol | DatatypeSymbol | FunctionSymbol;
//   | ConstantSymbol;
