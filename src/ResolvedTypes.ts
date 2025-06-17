import type { SymbolId } from "./shared/store";
import type { BaseDatatype, BaseSymbol } from "./shared/common";

export namespace ResolvedDatatype {
  export type FunctionDatatype = {} & BaseDatatype.FunctionDatatype;

  export type StructDatatype = {} & BaseDatatype.StructDatatype;

  export type PrimitiveDatatype = {} & BaseDatatype.PrimitiveDatatype;

  export type NamespaceDatatype = {} & BaseDatatype.NamespaceDatatype;

  export type Datatype =
    | FunctionDatatype
    | StructDatatype
    | PrimitiveDatatype
    | NamespaceDatatype;
}

export namespace ResolvedSymbol {
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
