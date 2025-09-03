import type { ELiteralUnit } from "./AST";
import { InternalError } from "./Errors";

export type Brand<T, B> = T & { __brand: B };

export class BrandedArray<I extends number, T> {
  private data: T[];

  constructor(data: T[]) {
    this.data = data;
  }

  // Access by branded index I
  get(index: I): T {
    return this.data[index as unknown as number]; // cast to number for indexing
  }

  set(index: I, value: T): void {
    this.data[index as unknown as number] = value;
  }

  get length(): number {
    return this.data.length;
  }

  push(value: T): I {
    const index = this.data.length;
    this.data.push(value);
    return index as unknown as I;
  }

  forEach(callback: (value: T, index: I) => void): void {
    for (let i = 0; i < this.data.length; i++) {
      callback(this.data[i], i as unknown as I);
    }
  }
}

export enum EPrimitive {
  void = 1,
  null,
  bool,
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
  int,
  real,
  usize,
  str,
}

export enum EVariableContext {
  FunctionParameter,
  FunctionLocal,
  MemberOfStruct,
  ThisReference,
  Global,
}

export type LiteralValue =
  | {
      type: EPrimitive.bool;
      value: boolean;
    }
  | {
      type: EPrimitive.null;
    }
  | {
      type: EPrimitive.str;
      value: string;
    }
  | {
      type:
        | EPrimitive.i8
        | EPrimitive.i16
        | EPrimitive.i32
        | EPrimitive.i64
        | EPrimitive.u8
        | EPrimitive.u16
        | EPrimitive.u32
        | EPrimitive.u64
        | EPrimitive.usize
        | EPrimitive.int;
      value: bigint;
      unit: ELiteralUnit | null;
    }
  | {
      type: EPrimitive.f32 | EPrimitive.f64 | EPrimitive.real;
      value: number;
      unit: ELiteralUnit | null;
    };

export enum EMethodType {
  None,
  Method,
  Constructor,
}

export function primitiveToString(primitive: EPrimitive) {
  switch (primitive) {
    case EPrimitive.void:
      return "void";
    case EPrimitive.null:
      return "null";
    case EPrimitive.bool:
      return "bool";
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
    case EPrimitive.int:
      return "int";
    case EPrimitive.real:
      return "real";
    case EPrimitive.usize:
      return "usize";
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
    case "void":
      return EPrimitive.void;
    case "null":
      return EPrimitive.null;
    case "bool":
      return EPrimitive.bool;
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
    case "int":
      return EPrimitive.int;
    case "real":
      return EPrimitive.real;
    case "usize":
      return EPrimitive.usize;
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
