import { InternalError } from "../Errors";

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

export enum EVariableContext {
  FunctionParameter,
  FunctionLocal,
  MemberOfStruct,
  Global,
}

export enum EMethodType {
  NotAMethod,
  Method,
  // Constructor
  // Destructor
}

export function primitiveToString(primitive: EPrimitive) {
  switch (primitive) {
    case EPrimitive.none:
      return "none";
    case EPrimitive.unknown:
      return "unknown";
    case EPrimitive.boolean:
      return "boolean";
    case EPrimitive.booleanptr:
      return "booleanptr";
    case EPrimitive.i8:
      return "i8";
    case EPrimitive.i16:
      return "i16";
    case EPrimitive.i32:
      return "i32";
    case EPrimitive.i64:
      return "i64";
    case EPrimitive.u8:
      return "u8";
    case EPrimitive.u16:
      return "u16";
    case EPrimitive.u32:
      return "u32";
    case EPrimitive.u64:
      return "u64";
    case EPrimitive.f32:
      return "f32";
    case EPrimitive.f64:
      return "f64";
    case EPrimitive.stringview:
      return "stringview";
    default:
      throw new InternalError("Unexpected datatype");
  }
}

export function stringToPrimitive(str: string) {
  switch (str) {
    case "none":
      return EPrimitive.none;
    case "unknown":
      return EPrimitive.unknown;
    case "boolean":
      return EPrimitive.boolean;
    case "booleanptr":
      return EPrimitive.booleanptr;
    case "i8":
      return EPrimitive.i8;
    case "i16":
      return EPrimitive.i16;
    case "i32":
      return EPrimitive.i32;
    case "i64":
      return EPrimitive.i64;
    case "u8":
      return EPrimitive.u8;
    case "u16":
      return EPrimitive.u16;
    case "u32":
      return EPrimitive.u32;
    case "u64":
      return EPrimitive.u64;
    case "f32":
      return EPrimitive.f32;
    case "f64":
      return EPrimitive.f64;
    case "stringview":
      return EPrimitive.stringview;
    default:
      return undefined;
  }
}
