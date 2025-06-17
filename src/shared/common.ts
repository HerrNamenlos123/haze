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

export enum EFunctionType {
  Normal,
  Method,
  Constructor,
}

// export type BaseDatatype = {
//   id: ID;
// };

// export type FunctionDatatype = {
//   variant: "Function";
//   generics: ID[];
//   functionParameters: ID[];
//   functionReturnValue: ID;
//   vararg: boolean;
// } & BaseDatatype;

// export type StructDatatype = {
//   variant: "Struct";
//   name: string;
//   generics: ID[];
//   linkage: ELinkage;
//   members: ID[];
//   methods: ID[];
//   parentSymbol?: ID;
// } & BaseDatatype;

// export type RawPointerDatatype = {
//   variant: "RawPointer";
//   pointee: ID;
// } & BaseDatatype;

// export type PrimitiveDatatype = {
//   variant: "Primitive";
//   primitive: EPrimitive;
// } & BaseDatatype;

// export type NamespaceDatatype = {
//   variant: "Namespace";
//   name: string;
//   symbolsScope: ID;
// } & BaseDatatype;

// export type Datatype =
//   | FunctionDatatype
//   | StructDatatype
//   | RawPointerDatatype
//   | PrimitiveDatatype
//   | NamespaceDatatype;

// export type DatatypeVariants =
//   | FunctionDatatype["variant"]
//   | StructDatatype["variant"]
//   | RawPointerDatatype["variant"]
//   | PrimitiveDatatype["variant"]
//   | NamespaceDatatype["variant"];
