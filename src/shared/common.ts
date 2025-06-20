import { InternalError } from "./Errors";
import type { Collect } from "../SymbolCollection/CollectSymbols";
import type { SemanticSymbolId, SemanticTypeId } from "./store";

export enum EPrimitive {
  none = 1,
  boolean,
  i8,
  i16,
  i32,
  i64,
  u8,
  u16,
  u32,
  u64,
  f32,
  f64,
  str,
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
  Drop,
  // Constructor
  // Destructor
}

export function primitiveToString(primitive: EPrimitive) {
  switch (primitive) {
    case EPrimitive.none:
      return "none";
    case EPrimitive.boolean:
      return "boolean";
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
    case EPrimitive.str:
      return "str";
    default:
      throw new InternalError("Unexpected datatype");
  }
}

export function stringToPrimitive(str: string) {
  switch (str) {
    case "none":
      return EPrimitive.none;
    case "boolean":
      return EPrimitive.boolean;
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
    case "str":
      return EPrimitive.str;
    default:
      return undefined;
  }
}

export function assertScope(id: Collect.Scope | undefined) {
  if (!id) {
    throw new InternalError("Scope is undefined!");
  }
  return id;
}

export function assertID<T>(id: T | undefined) {
  if (!id) {
    throw new InternalError("ID is undefined!");
  }
  return id;
}
