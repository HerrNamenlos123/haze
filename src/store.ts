import { InternalError, Location } from "./Errors";
import { ResolvedScope } from "./Scope";
import type { Module } from "./Module";
import type { ParsedDatatype, ParsedSymbol } from "./ParsedTypes";
import { EPrimitive } from "./common";

export type SymbolId = bigint & {
  __nonZeroBrand?: never;
  __brand: "ParsedSymbolId";
};
export type ScopeId = bigint & { __nonZeroBrand?: never; __brand: "ScopeId" };
export type TypeId = bigint & {
  __nonZeroBrand?: never;
  __brand: "ParsedTypeId";
};

export type Hash = string & { __brand: "Hash" };

export type Id = SymbolId | ScopeId | TypeId;

const ID_BASE = 10n ** 18n;

type ExactMatch<T, Shape> = T extends Shape
  ? Exclude<keyof T, keyof Shape> extends never
    ? Shape extends T
      ? T
      : never
    : never
  : never;

export abstract class BaseStore {
  private static nextIdCounter = 0n;

  constructor(public module: Module) {}

  private assertId() {
    if (BaseStore.nextIdCounter >= ID_BASE) {
      throw new Error(
        "Ran out of parsed Symbol IDs - What did you do to make the program so huge???",
      );
    }
  }

  makeSymbolId() {
    this.assertId();
    return (BaseStore.nextIdCounter++ + ID_BASE * 1n) as SymbolId;
  }

  makeScopeId() {
    this.assertId();
    return (BaseStore.nextIdCounter++ + ID_BASE * 2n) as ScopeId;
  }

  makeTypeId() {
    this.assertId();
    return (BaseStore.nextIdCounter++ + ID_BASE * 3n) as TypeId;
  }
}

export class ParsedStore extends BaseStore {
  globalScope: ResolvedScope;

  private scopes: Map<ScopeId, ResolvedScope> = new Map();
  private symbols: Map<SymbolId, ParsedSymbol.Symbol> = new Map();
  private datatypes: Map<TypeId, ParsedDatatype.Datatype> = new Map();

  constructor(module: Module) {
    super(module);

    this.globalScope = this.createScope(new Location("global", 0, 0));
    this.createPrimitiveTypeAndSymbol(EPrimitive.none);
    this.createPrimitiveTypeAndSymbol(EPrimitive.unknown);
    this.createPrimitiveTypeAndSymbol(EPrimitive.stringview);
    this.createPrimitiveTypeAndSymbol(EPrimitive.boolean);
    this.createPrimitiveTypeAndSymbol(EPrimitive.booleanptr);
    this.createPrimitiveTypeAndSymbol(EPrimitive.u8);
    this.createPrimitiveTypeAndSymbol(EPrimitive.u16);
    this.createPrimitiveTypeAndSymbol(EPrimitive.u32);
    this.createPrimitiveTypeAndSymbol(EPrimitive.u64);
    this.createPrimitiveTypeAndSymbol(EPrimitive.i8);
    this.createPrimitiveTypeAndSymbol(EPrimitive.i16);
    this.createPrimitiveTypeAndSymbol(EPrimitive.i32);
    this.createPrimitiveTypeAndSymbol(EPrimitive.i64);
    this.createPrimitiveTypeAndSymbol(EPrimitive.f32);
    this.createPrimitiveTypeAndSymbol(EPrimitive.f64);
  }

  getSymbol(id: SymbolId) {
    const dt = this.symbols.get(id);
    if (!dt) {
      throw new InternalError(
        `Symbol with id ${id} is not known to the compiler`,
      );
    }
    return dt;
  }

  getScope(id: ScopeId) {
    const dt = this.scopes.get(id);
    if (!dt) {
      throw new InternalError(
        `Scope with id ${id} is not known to the compiler`,
      );
    }
    return dt;
  }

  getType(id: TypeId) {
    const dt = this.datatypes.get(id);
    if (!dt) {
      throw new InternalError(
        `Datatype with id ${id} is not known to the compiler`,
      );
    }
    return dt;
  }

  createScope(location: Location, parentScope?: ScopeId) {
    const id = this.makeScopeId();
    return new ResolvedScope(id, location, parentScope);
  }

  createSymbol<T extends ParsedSymbol.Symbol>(fn: (id: SymbolId) => T) {
    const id = this.makeSymbolId();
    const symbol = fn(id);
    this.symbols.set(id, symbol);
    return symbol;
  }

  createDatatype<T extends ParsedDatatype.Datatype>(fn: (id: TypeId) => T) {
    const id = this.makeTypeId();
    const type = fn(id);
    this.datatypes.set(id, type);
    return type;
  }

  private createPrimitiveTypeAndSymbol(primitive: EPrimitive) {
    const dt = this.createDatatype((id) => ({
      id,
      variant: "Primitive",
      primitive: primitive,
    }));
    this.createSymbol((id) => ({
      id,
      variant: "Datatype",
      name: primitiveToString(dt),
      type: dt.id,
      definedInScope: this.globalScope.id,
      isExported: false,
      location: this.globalScope.location,
    }));
  }
}

function primitiveToString(primitive: ParsedDatatype.PrimitiveDatatype) {
  switch (primitive.primitive) {
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
