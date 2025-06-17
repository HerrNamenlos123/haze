import type { SymbolId } from "./shared/store";
import type { BaseDatatype, BaseSymbol } from "./shared/common";

export namespace ParsedDatatype {
  export type FunctionDatatype = {
    generics: { symbol: SymbolId }[];
  } & BaseDatatype.FunctionDatatype;

  export type StructDatatype = {
    generics: { symbol: SymbolId }[];
  } & BaseDatatype.StructDatatype;

  export type DeferredDatatype = {} & BaseDatatype.BaseDatatype;

  // export type RawPointerDatatype = {
  //   variant: "RawPointer";
  //   pointee: SymbolId;
  // } & BaseDatatype.StructDatatype;

  export type PrimitiveDatatype = {} & BaseDatatype.PrimitiveDatatype;

  export type NamespaceDatatype = {} & BaseDatatype.NamespaceDatatype;

  export type Datatype =
    | FunctionDatatype
    | StructDatatype
    | DeferredDatatype
    | PrimitiveDatatype
    | NamespaceDatatype;
  // | RawPointerDatatype
}

export namespace ParsedSymbol {
  export type VariableSymbol = {} & BaseSymbol.VariableSymbol;

  export type StructUnion = {} & BaseSymbol.VariableSymbol;

  export type GenericParameterSymbol = {} & BaseSymbol.GenericParameterSymbol;

  export type FunctionSymbol = {} & BaseSymbol.FunctionSymbol;

  export type DatatypeSymbol = {} & BaseSymbol.DatatypeSymbol;

  export type ConstantSymbol = {} & BaseSymbol.ConstantSymbol;

  export type Symbol =
    | VariableSymbol
    | StructUnion
    | GenericParameterSymbol
    | FunctionSymbol
    | DatatypeSymbol
    | ConstantSymbol;
}
