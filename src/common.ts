import type { ParserRuleContext } from "antlr4ng";
import type { Location } from "./Errors";
import type {
  VariableDeclarationContext,
  VariableDefinitionContext,
} from "./grammar/autogen/HazeParser";
import type { ScopeId, SymbolId, TypeId } from "./store";
import type { Expression } from "./Expression";

export enum EPrimitive {
  none = 1,
  unknown = 2,
  boolean = 3,
  booleanptr = 4,
  i8 = 5,
  i16 = 6,
  i32 = 7,
  i64 = 8,
  u8 = 9,
  u16 = 10,
  u32 = 11,
  u64 = 12,
  f32 = 13,
  f64 = 14,
  stringview = 15,
}

export enum EVariableMutability {
  MutableVariable,
  ConstantVariable,
  Parameter,
  MutableStructField,
  ConstantStructField,
}

export enum EVariableContext {
  FunctionParameter,
  FunctionLocal,
  MemberOfStruct,
  Global,
}

export enum ELinkage {
  Internal,
  External,
  External_C,
}

export enum EKindOfFunction {
  Normal,
  Method,
  Constructor,
}

export type LiteralUnits = "s" | "ms" | "us" | "ns" | "m" | "h" | "d";

export namespace BaseDatatype {
  export type BaseDatatype = {
    id: TypeId;
  };

  export type FunctionDatatype = {
    variant: "Function";
    functionParameters: SymbolId[];
    functionReturnValue: SymbolId;
    vararg: boolean;
  } & BaseDatatype;

  export type StructDatatype = {
    variant: "Struct";
    name: string;
    linkage: ELinkage;
    members: SymbolId[];
    methods: SymbolId[];
    parentSymbol?: SymbolId;
  } & BaseDatatype;

  export type RawPointerDatatype = {
    variant: "RawPointer";
    pointee: SymbolId;
  } & BaseDatatype;

  export type PrimitiveDatatype = {
    variant: "Primitive";
    primitive: EPrimitive;
  } & BaseDatatype;

  export type NamespaceDatatype = {
    variant: "Namespace";
    name: string;
    symbolsScope: ScopeId;
  } & BaseDatatype;

  export type Datatype =
    | FunctionDatatype
    | StructDatatype
    | RawPointerDatatype
    | PrimitiveDatatype
    | NamespaceDatatype;

  export type Variants =
    | FunctionDatatype["variant"]
    | StructDatatype["variant"]
    | RawPointerDatatype["variant"]
    | PrimitiveDatatype["variant"]
    | NamespaceDatatype["variant"];
}

export namespace BaseSymbol {
  export type BaseSymbol = {
    id: SymbolId;
  };

  export type VariableSymbol = {
    variant: "Variable";
    name: string;
    type: TypeId;
    variableType: EVariableMutability;
    variableContext: EVariableContext;
    isExported: boolean;
    linkage: ELinkage;
    location: Location;
    parentSymbol?: SymbolId;
    ctx?: VariableDefinitionContext | VariableDeclarationContext;
  } & BaseSymbol;

  // export type StructUnion = {
  //   variant: "StructUnion";
  //   location: Location;
  //   members: SymbolId[];
  //   parentSymbol?: SymbolId;
  //   ctx?: VariableDefinitionContext | VariableDeclarationContext;
  // } & BaseSymbol;

  export type GenericParameterSymbol = {
    variant: "GenericParameter";
    name: string;
    visibleName: string;
    location: Location;
    parentSymbol?: SymbolId;
  } & BaseSymbol;

  export type FunctionSymbol = {
    variant: "Function";
    name: string;
    type: TypeId;
    linkage: ELinkage;
    bodyScope: ScopeId;
    definedInScope: ScopeId;
    isExported: boolean;
    location: Location;
    kindOfFunction: EKindOfFunction;
    parentSymbol?: SymbolId;
    thisPointerExpr?: Expression;
    ctx?: ParserRuleContext;
  } & BaseSymbol;

  export type DatatypeSymbol = {
    variant: "Datatype";
    name: string;
    type: TypeId;
    definedInScope: ScopeId;
    isExported: boolean;
    location: Location;
    parentSymbol?: SymbolId;
  } & BaseSymbol;

  export type ConstantSymbol = {
    variant: "Constant";
    constant:
      | {
          variant: "String";
          type: TypeId;
          value: string;
          location: Location;
        }
      | {
          variant: "Boolean";
          type: TypeId;
          value: boolean;
          location: Location;
        }
      | {
          variant: "Literal";
          type: TypeId;
          value: number;
          unit?: LiteralUnits;
          location: Location;
        };
    location: Location;
  } & BaseSymbol;

  export type Symbol =
    | VariableSymbol
    // | StructUnion
    | GenericParameterSymbol
    | FunctionSymbol
    | DatatypeSymbol
    | ConstantSymbol;

  export type Variants =
    | VariableSymbol["variant"]
    // | StructUnion["variant"]
    | GenericParameterSymbol["variant"]
    | FunctionSymbol["variant"]
    | DatatypeSymbol["variant"]
    | ConstantSymbol["variant"];
}
