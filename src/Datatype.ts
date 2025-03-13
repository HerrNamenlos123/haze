import {
  CompilerError,
  ErrorType,
  getCallerLocation,
  ImpossibleSituation,
  InternalError,
  printWarningMessage,
  UnreachableCode,
  type Location,
} from "./Errors";
import { OutputWriter } from "./OutputWriter";
import type { Module } from "./Module";
import { Scope } from "./Scope";
import {
  Language,
  mangleDatatype,
  mangleSymbol,
  serializeSymbol,
  type DatatypeSymbol,
  type FunctionSymbol,
  type Symbol,
  type VariableSymbol,
} from "./Symbol";
import { defineGenericsInScope, resolveGenerics } from "./utils";

export enum Primitive {
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

/**
 * Explanation what is a datatype:
 *
 *  - Base Datatypes are the most basic form or generic form of datatypes.
 *    Those are generic types (such as "Array<T>"). They cannot be used directly.
 *
 *  - Concrete types are instantiated for usage (e.g. Primitives or instantiated generic types).
 *    For generic types, it will be a mix of other concrete types, that all were built out of the base types.
 *    e.g. "Array<T=Box<T=i32>>" <-- All of those are also concrete
 *    Only concrete types can be used for anything. Even primitives need to be instantiated from "Base" to "Concrete".
 *
 *  - Primitives are directly instantiated as concrete
 */

export type Generics = Map<string, Datatype | undefined>;

export type FunctionDatatype = {
  variant: "Function";
  functionParameters: [string, Datatype][];
  functionReturnType: Datatype;
  vararg: boolean;
};

export type DeferredDatatype = {
  variant: "Deferred";
};

export type GenericPlaceholderDatatype = {
  variant: "Generic";
  name: string;
};

export type StructMemberUnion = {
  variant: "StructMemberUnion";
  symbols: VariableSymbol[];
};

export type StructDatatype = {
  variant: "Struct";
  name: string;
  generics: Generics;
  language: Language;
  members: (VariableSymbol | StructMemberUnion)[];
  methods: FunctionSymbol[];
  parentSymbol?: DatatypeSymbol;
};

export type RawPointerDatatype = {
  variant: "RawPointer";
  generics: Generics;
};

export type PrimitiveDatatype = {
  variant: "Primitive";
  primitive: Primitive;
};

export type NamespaceDatatype = {
  variant: "Namespace";
  name: string;
  symbolsScope: Scope;
  parentSymbol?: DatatypeSymbol;
};

export type Datatype =
  | DeferredDatatype
  | FunctionDatatype
  | StructDatatype
  | NamespaceDatatype
  | RawPointerDatatype
  | GenericPlaceholderDatatype
  | PrimitiveDatatype
  | FunctionDatatype;

export function primitiveVariantToString(dt: PrimitiveDatatype): string {
  switch (dt.primitive) {
    case Primitive.none:
      return "none";
    case Primitive.unknown:
      return "unknown";
    case Primitive.boolean:
      return "boolean";
    case Primitive.booleanptr:
      return "booleanptr";
    case Primitive.i8:
      return "i8";
    case Primitive.i16:
      return "i16";
    case Primitive.i32:
      return "i32";
    case Primitive.i64:
      return "i64";
    case Primitive.u8:
      return "u8";
    case Primitive.u16:
      return "u16";
    case Primitive.u32:
      return "u32";
    case Primitive.u64:
      return "u64";
    case Primitive.f32:
      return "f32";
    case Primitive.f64:
      return "f64";
    case Primitive.stringview:
      return "stringview";
  }
  throw new Error("Datatype has no string representation");
}

export function isBoolean(dt: Datatype): boolean {
  switch (dt.variant) {
    case "Primitive":
      switch (dt.primitive) {
        case Primitive.boolean:
          return true;
      }
      return false;
  }
  return false;
}

function getWiderInteger(
  a: PrimitiveDatatype,
  b: PrimitiveDatatype,
): PrimitiveDatatype {
  const aBits = getIntegerBits(a);
  const bBits = getIntegerBits(b);
  return aBits > bBits ? a : b;
}

function widenInteger(
  a: PrimitiveDatatype,
  b: PrimitiveDatatype,
): PrimitiveDatatype {
  if (a.primitive == b.primitive) {
    return a;
  }

  let sizeA = getIntegerBits(a);
  let sizeB = getIntegerBits(b);

  // If one of the types is unsigned and larger in size, widen accordingly
  if (isIntegerUnsigned(a) && !isIntegerUnsigned(b)) {
    if (sizeA > sizeB) {
      return a; // Promote the unsigned type
    } else {
      return b; // Promote the signed type to the larger unsigned type
    }
  }

  if (isIntegerUnsigned(b) && !isIntegerUnsigned(a)) {
    if (sizeB > sizeA) {
      return b; // Promote the unsigned type
    } else {
      return a; // Promote the signed type to the larger unsigned type
    }
  }

  // Otherwise, promote to the larger type based on size
  if (sizeA > sizeB) {
    return a;
  } else {
    return b;
  }
}

function promoteType(
  a: PrimitiveDatatype,
  b: PrimitiveDatatype,
): PrimitiveDatatype {
  if (a.primitive == b.primitive) return a;
  if (isIntegerUnsigned(a) && !isIntegerUnsigned(b)) return widenInteger(a, b);
  if (!isIntegerUnsigned(a) && isIntegerUnsigned(b)) return widenInteger(a, b);
  return getWiderInteger(a, b);
}

export function getIntegerBinaryResult(
  a: PrimitiveDatatype,
  b: PrimitiveDatatype,
): Datatype {
  if (a.variant !== "Primitive" || b.variant !== "Primitive") {
    throw new InternalError("Datatype is not an integer");
  }
  return promoteType(a, b);
}

export function isIntegerUnsigned(dt: Datatype): boolean {
  switch (dt.variant) {
    case "Primitive":
      switch (dt.primitive) {
        case Primitive.i8:
        case Primitive.i16:
        case Primitive.i32:
        case Primitive.i64:
          return false;
        case Primitive.u8:
        case Primitive.u16:
        case Primitive.u32:
        case Primitive.u64:
          return true;
      }
      return false;
  }
  return false;
}

export function getIntegerBits(dt: Datatype): number {
  switch (dt.variant) {
    case "Primitive":
      switch (dt.primitive) {
        case Primitive.i8:
        case Primitive.u8:
          return 8;
        case Primitive.i16:
        case Primitive.u16:
          return 16;
        case Primitive.i32:
        case Primitive.u32:
          return 32;
        case Primitive.i64:
        case Primitive.u64:
          return 64;
      }
      return 0;
  }
  return 0;
}

export function isNone(dt: Datatype): boolean {
  switch (dt.variant) {
    case "Primitive":
      switch (dt.primitive) {
        case Primitive.none:
          return true;
      }
      return false;
  }
  return false;
}

export function isInteger(dt: Datatype): boolean {
  switch (dt.variant) {
    case "Primitive":
      switch (dt.primitive) {
        case Primitive.i8:
        case Primitive.i16:
        case Primitive.i32:
        case Primitive.i64:
        case Primitive.u8:
        case Primitive.u16:
        case Primitive.u32:
        case Primitive.u64:
          return true;
      }
      return false;
  }
  return false;
}

export function isF32(dt: Datatype): boolean {
  switch (dt.variant) {
    case "Primitive":
      switch (dt.primitive) {
        case Primitive.f32:
          return true;
      }
      return false;
  }
  return false;
}

export function isF64(dt: Datatype): boolean {
  switch (dt.variant) {
    case "Primitive":
      switch (dt.primitive) {
        case Primitive.f64:
          return true;
      }
      return false;
  }
  return false;
}

export function isFloat(dt: Datatype): boolean {
  switch (dt.variant) {
    case "Primitive":
      switch (dt.primitive) {
        case Primitive.f32:
        case Primitive.f64:
          return true;
      }
      return false;
  }
  return false;
}

export function getStructMembers(struct: StructDatatype) {
  const members = [] as VariableSymbol[];
  for (const member of struct.members) {
    if (member.variant === "Variable") {
      members.push(member);
    } else {
      for (const inner of member.symbols) {
        members.push(inner);
      }
    }
  }
  return members;
}

export function findMemberInStruct(struct: StructDatatype, name: string) {
  for (const member of struct.members) {
    if (member.variant === "Variable") {
      if (member.name === name) {
        return member;
      }
    } else {
      for (const inner of member.symbols) {
        if (inner.name === name) {
          return inner;
        }
      }
    }
  }
}

export function findMethodInStruct(struct: StructDatatype, name: string) {
  for (const member of struct.methods) {
    if (member.name === name) {
      return member;
    }
  }
}

export function serializeDatatype(datatype: Datatype): string {
  switch (datatype.variant) {
    case "Primitive":
      return primitiveVariantToString(datatype);

    case "Namespace":
      return datatype.name;

    case "RawPointer":
      const g2 = [] as string[];
      for (const [name, tp] of datatype.generics) {
        if (tp) {
          g2.push(`${serializeDatatype(tp)}`);
        } else {
          g2.push(name);
        }
      }
      let pp = "RawPtr";
      if (g2.length > 0) {
        pp += `<${g2.join(", ")}>`;
      }
      return pp;

    case "Struct":
      let s = datatype.name;

      let p = datatype.parentSymbol?.type;
      while (p) {
        if (p.variant === "Struct" || p.variant === "Namespace") {
          s = `${p.name}.${s}`;
          p = p.parentSymbol?.type;
        } else {
          throw new ImpossibleSituation();
        }
      }

      const g = [] as string[];
      for (const [name, tp] of datatype.generics) {
        if (tp) {
          g.push(`${name}=${serializeDatatype(tp)}`);
        } else {
          g.push(name);
        }
      }
      if (g.length > 0) {
        s += `<${g.join(", ")}>`;
      }
      return s;

    case "Function":
      let ss = "(";
      ss += datatype.functionParameters
        .map((p) => `${p[0]}: ${serializeDatatype(p[1])}`)
        .join(", ");
      ss += ") -> " + serializeDatatype(datatype.functionReturnType);
      return ss;

    case "Deferred":
      return "__Deferred";

    case "Generic":
      return datatype.name;
  }
}

export function generateDeclarationCCode(
  _datatype: DatatypeSymbol,
  program: Module,
): OutputWriter {
  const writer = new OutputWriter();
  const scope = new Scope(_datatype.scope.location, _datatype.scope);
  if (_datatype.type.variant === "Struct") {
    defineGenericsInScope(_datatype.type.generics, scope);
  }
  const datatype: DatatypeSymbol = {
    name: _datatype.name,
    scope: _datatype.scope,
    variant: _datatype.variant,
    parentSymbol: _datatype.parentSymbol,
    type: resolveGenerics(_datatype.type, scope, _datatype.scope.location),
    export: _datatype.export,
    location: _datatype.location,
  };
  switch (datatype.type.variant) {
    case "Primitive":
      return writer;

    case "Struct":
      if (!datatype.type.language) {
        const struct = generateUsageCode(datatype.type, program);
        writer.writeLine(`struct ${struct}_;`);
        writer.writeLine(`typedef struct ${struct}_ ${struct};`);
      }
      return writer;

    case "RawPointer":
      const generic = datatype.type.generics.get("__Pointee");
      if (!generic) {
        throw new ImpossibleSituation();
      }
      writer.writeLine(
        `typedef ${generateUsageCode(generic, program)}* ${mangleSymbol(datatype)};`,
      );
      return writer;

    case "Function":
      const params = datatype.type.functionParameters.map(([name, tp]) =>
        generateUsageCode(tp, program),
      );
      if (datatype.type.vararg) {
        params.push("...");
      }
      writer.write(
        `typedef ${generateUsageCode(datatype.type.functionReturnType, program)} (*${generateUsageCode(datatype.type, program)})(${generateUsageCode(program.getBuiltinType("Context"), program)}* ctx${params.length > 0 ? ", " : ""}${params.join(", ")});`,
      );
      return writer;

    case "Namespace":
      return writer;
  }
  throw new InternalError(`Invalid variant ${datatype.type.variant}`);
}

export function generateDefinitionCCode(
  _datatype: DatatypeSymbol,
  program: Module,
): OutputWriter {
  const writer = new OutputWriter();
  const scope = new Scope(_datatype.scope.location, _datatype.scope);
  if (_datatype.type.variant === "Struct") {
    defineGenericsInScope(_datatype.type.generics, scope);
  }
  const datatype: DatatypeSymbol = {
    name: _datatype.name,
    scope: _datatype.scope,
    variant: _datatype.variant,
    parentSymbol: _datatype.parentSymbol,
    type: resolveGenerics(_datatype.type, scope, _datatype.scope.location),
    export: _datatype.export,
    location: _datatype.location,
  };
  switch (datatype.type.variant) {
    case "Primitive":
      return writer;

    case "Struct":
      if (!datatype.type.language) {
        writer
          .writeLine(`struct ${generateUsageCode(datatype.type, program)}_ {`)
          .pushIndent();
        for (const memberSymbol of datatype.type.members) {
          if (memberSymbol.variant === "Variable") {
            writer.writeLine(
              `${generateUsageCode(memberSymbol.type, program)} ${memberSymbol.name};`,
            );
          } else {
            writer.writeLine("union {").pushIndent();
            for (const innerMember of memberSymbol.symbols) {
              writer.writeLine(
                `${generateUsageCode(innerMember.type, program)} ${innerMember.name};`,
              );
            }
            writer.popIndent().writeLine("};");
          }
        }
        writer.popIndent().writeLine(`};`);
      }
      return writer;

    case "RawPointer":
      return writer;

    case "Function":
      return writer;

    case "Namespace":
      return writer;
  }
  throw new InternalError(`Invalid variant ${datatype.type.variant}`);
}

export function generateUsageCode(dt: Datatype, program: Module): string {
  switch (dt.variant) {
    case "Primitive":
      switch (dt.primitive) {
        case Primitive.none:
          return "void";
        case Primitive.unknown:
          throw new InternalError(
            "Type 'unknown' is compiler internal and must not appear in generated C-code",
          );
        case Primitive.boolean:
          return "char";
        case Primitive.booleanptr:
          return "char*";
        case Primitive.i8:
          return "int8_t";
        case Primitive.i16:
          return "int16_t";
        case Primitive.i32:
          return "int32_t";
        case Primitive.i64:
          return "int64_t";
        case Primitive.u8:
          return "uint8_t";
        case Primitive.u16:
          return "uint16_t";
        case Primitive.u32:
          return "uint32_t";
        case Primitive.u64:
          return "uint64_t";
        case Primitive.f32:
          return "float";
        case Primitive.f64:
          return "double";
        case Primitive.stringview:
          return "char*";
      }
      throw new UnreachableCode();

    case "RawPointer":
      const ptrGeneric = dt.generics.get("__Pointee");
      if (!ptrGeneric) {
        throw new ImpossibleSituation();
      }
      return `${generateUsageCode(ptrGeneric, program)}*`;

    case "Deferred":
      throw new InternalError("Cannot generate usage code for deferred");

    case "Struct":
      if (dt.language === Language.Internal) {
        return `_H${mangleDatatype(dt)}`;
      } else {
        return `${mangleDatatype(dt)}`;
      }

    case "Function":
      return `_H${mangleDatatype(dt)}`;

    case "Generic":
      throw new InternalError("Cannot generate usage code for generic");

    case "Namespace":
      throw new InternalError(
        "Cannot generate usage code for a namespace",
        getCallerLocation(3),
      );
  }
  // throw new InternalError(`Invalid variant ${dt.variant}`);
}

export function generateDatatypeDeclarationHazeCode(
  datatype: Datatype,
): OutputWriter {
  const writer = new OutputWriter();
  switch (datatype.variant) {
    case "Primitive":
      return writer;

    case "Deferred":
      throw new ImpossibleSituation();

    case "Struct": {
      let generics: string[] = [];
      for (const [name, tp] of datatype.generics) {
        if (tp !== undefined) {
          throw new ImpossibleSituation();
        }
        generics.push(name);
      }
      writer.write(
        `struct ${datatype.name}${generics.length > 0 ? "<" + generics.join(",") + ">" : ""} {`,
      );
      for (const member of datatype.members) {
        if (member.variant === "Variable") {
          writer.write(
            `${member.name}: ${generateDatatypeUsageHazeCode(member.type).get()};`,
          );
        } else {
          writer.write(`unsafe_union {`);
          for (const inner of member.symbols) {
            writer.write(
              `${inner.name}: ${generateDatatypeUsageHazeCode(inner.type).get()};`,
            );
          }
          writer.write(`}`);
        }
      }
      writer.write("}");
      return writer;
    }

    case "RawPointer": {
      return writer;
    }
  }
  throw new UnreachableCode();
}

export function generateDatatypeUsageHazeCode(
  datatype: Datatype,
): OutputWriter {
  const writer = new OutputWriter();
  switch (datatype.variant) {
    case "Primitive":
      writer.write(primitiveVariantToString(datatype));
      return writer;

    case "Deferred":
      throw new ImpossibleSituation();

    case "Struct": {
      let generics: string[] = [];
      for (const [name, tp] of datatype.generics) {
        if (tp === undefined) {
          generics.push(name);
        } else {
          generics.push(generateDatatypeUsageHazeCode(tp).get());
        }
      }
      writer.write(
        `${datatype.name}${generics.length > 0 ? "<" + generics.join(",") + ">" : ""}`,
      );
      return writer;
    }

    case "RawPointer": {
      let generics: string[] = [];
      for (const [name, tp] of datatype.generics) {
        if (tp === undefined) {
          throw new ImpossibleSituation();
        }
        generics.push(generateDatatypeUsageHazeCode(tp).get());
      }
      writer.write(`RawPtr<${generics.join(",")}>`);
      return writer;
    }

    case "Generic": {
      writer.write(`${datatype.name}`);
      return writer;
    }
  }
  throw new UnreachableCode();
}

export function generateSymbolUsageHazeCode(symbol: Symbol) {
  const writer = new OutputWriter();
  switch (symbol.variant) {
    case "Datatype": {
      const namespaces = [] as string[];
      let p = symbol.parentSymbol;
      while (p) {
        if (p.variant !== "Datatype" || p.type.variant !== "Namespace") {
          throw new InternalError("Unexpected parent");
        }
        namespaces.unshift(p.type.name);
        p = p.parentSymbol;
      }
      let tp = generateDatatypeDeclarationHazeCode(symbol.type).get();
      if (namespaces.length > 0) {
        writer.write(`namespace ${namespaces.join(".")} {${tp}}`);
      } else {
        writer.write(tp);
      }
      return writer;
    }

    case "Function": {
      const namespaces = [] as string[];
      let p = symbol.parentSymbol;
      while (p) {
        if (p.variant === "Function") {
          // noop
        } else if (p.variant === "Datatype") {
          if (p.type.variant === "Struct") {
            // noop
          } else if (p.type.variant !== "Namespace") {
            throw new InternalError("Unexpected parent: " + p.type.variant);
          }
          namespaces.unshift(p.type.name);
        } else {
          throw new InternalError("Unexpected symbol type: " + p.variant);
        }
        p = p.parentSymbol;
      }
      let tp = "declare " + symbol.name + "(";
      const params = [] as string[];
      for (const [name, tp] of symbol.type.functionParameters) {
        params.push(`${name}:${generateDatatypeUsageHazeCode(tp).get()}`);
      }
      if (symbol.type.vararg) {
        params.push("...");
      }
      tp += params.join(",");
      tp += `):${generateDatatypeUsageHazeCode(symbol.type.functionReturnType).get()};`;
      if (namespaces.length > 0) {
        writer.write(`namespace ${namespaces.join(".")} {${tp}}`);
      } else {
        writer.write(tp);
      }
      return writer;
    }
  }
  throw new UnreachableCode();
}

export function isSame(a: Datatype, b: Datatype): boolean {
  if (a.variant === "Primitive" && b.variant === "Primitive") {
    return a.primitive === b.primitive;
  }

  if (a.variant === "RawPointer" && b.variant === "RawPointer") {
    return isSame(a.generics.get("__Pointee")!, b.generics.get("__Pointee")!);
  }

  if (a.variant === "Function" && b.variant === "Function") {
    if (!a.functionReturnType || !b.functionReturnType) {
      return false;
    }
    if (!isSame(a.functionReturnType, b.functionReturnType)) {
      return false;
    }
    if (a.functionParameters.length !== b.functionParameters.length) {
      return false;
    }
    for (let i = 0; i < a.functionParameters.length; i++) {
      if (!isSame(a.functionParameters[i][1], b.functionParameters[i][1])) {
        return false;
      }
    }
    return true;
  }

  if (a.variant === "Struct" && b.variant === "Struct") {
    if (a.members.length !== b.members.length) {
      return false;
    }
    for (let i = 0; i < a.members.length; i++) {
      const aa = a.members[i];
      const bb = b.members[i];
      if (aa.variant !== bb.variant) {
        return false;
      }
      if (aa.variant === "Variable" && bb.variant === "Variable") {
        if (aa.name !== bb.name || !isSame(aa.type, bb.type)) {
          return false;
        }
      } else if (
        aa.variant === "StructMemberUnion" &&
        bb.variant === "StructMemberUnion"
      ) {
        for (let j = 0; j < aa.symbols.length; j++) {
          if (
            aa.symbols[i].name !== bb.symbols[i].name ||
            !isSame(aa.symbols[i].type, bb.symbols[i].type)
          ) {
            return false;
          }
        }
      }
    }
    return true;
  }
  return false;
}

const exactMatchInTheOther = (
  a: VariableSymbol | StructMemberUnion,
  bList: (VariableSymbol | StructMemberUnion)[],
) => {
  if (a.variant === "Variable") {
    for (const b of bList) {
      if (b.variant === "Variable") {
        if (a.name === b.name && isSame(a.type, b.type)) {
          return true;
        }
      }
    }
  } else {
    for (const b of bList) {
      if (b.variant === "StructMemberUnion") {
        for (const inner of a.symbols) {
          if (!exactMatchInTheOther(inner, b.symbols)) {
            return false;
          }
        }
        for (const inner of b.symbols) {
          if (!exactMatchInTheOther(inner, a.symbols)) {
            return false;
          }
        }
        return true;
      }
    }
  }
  return false;
};

export function implicitConversion(
  _from: Datatype,
  _to: Datatype,
  expr: string,
  scope: Scope,
  loc: Location,
  program: Module,
): string {
  const from = resolveGenerics(_from, scope, loc);
  const to = resolveGenerics(_to, scope, loc);

  if (isSame(from, to)) {
    return expr;
  }

  if (from.variant === "Primitive" && to.variant === "Primitive") {
    if (isInteger(from) && isBoolean(to)) {
      return `(${expr} != 0)`;
    }
    if (isBoolean(from) && isInteger(to)) {
      return `(${expr} ? 1 : 0)`;
    }
    if (isInteger(from) && isInteger(to)) {
      return `(${generateUsageCode(to, program)})(${expr})`;
    }
    if (isFloat(from) && isFloat(to)) {
      return `(${generateUsageCode(to, program)})(${expr})`;
    }
    if (isInteger(from) && isFloat(to)) {
      return `(${generateUsageCode(to, program)})(${expr})`;
    }
    if (isFloat(from) && isInteger(to)) {
      printWarningMessage(
        `Implicit conversion from ${serializeDatatype(from)} to ${serializeDatatype(to)} may lose precision`,
        loc,
      );
      return `(${generateUsageCode(to, program)})(${expr})`;
    }
    throw new CompilerError(
      `No implicit conversion from ${serializeDatatype(from)} to ${serializeDatatype(to)}`,
      loc,
    );
  }

  if (
    from.variant === "RawPointer" &&
    to.variant === "Primitive" &&
    to.primitive === Primitive.boolean
  ) {
    return `(${expr} != 0)`;
  }

  if (from.variant === "RawPointer" && to.variant === "RawPointer") {
    if (
      isSame(from.generics.get("__Pointee")!, to.generics.get("__Pointee")!)
    ) {
      return expr;
    }
    const topointee = to.generics.get("__Pointee")!;
    if (
      topointee.variant === "Primitive" &&
      topointee.primitive === Primitive.none
    ) {
      return `(void*)(${expr})`;
    }
    throw new CompilerError(
      `No implicit conversion from ${serializeDatatype(from)} to ${serializeDatatype(to)}`,
      loc,
    );
  }

  if (from.variant === "Function" && to.variant === "Function") {
    if (isSame(from.functionReturnType, to.functionReturnType)) {
      if (from.functionParameters.length === to.functionParameters.length) {
        let equal = true;
        for (let i = 0; i < from.functionParameters.length; i++) {
          if (
            !isSame(from.functionParameters[i][1], to.functionParameters[i][1])
          ) {
            equal = false;
          }
        }
        if (equal) {
          return expr;
        }
      }
    }
    throw new CompilerError(
      `No implicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}'`,
      loc,
    );
  }

  if (from.variant === "Struct" && to.variant === "Struct") {
    if (from.members.length !== to.members.length) {
      throw new CompilerError(
        `No implicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}': different number of fields`,
        loc,
      );
    }

    let equal = true;
    for (const a of from.members) {
      if (!exactMatchInTheOther(a, to.members)) {
        equal = false;
      }
    }
    for (const b of to.members) {
      if (!exactMatchInTheOther(b, from.members)) {
        equal = false;
      }
    }

    if (equal) {
      return expr;
    }

    throw new CompilerError(
      `No implicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}'`,
      loc,
    );
  }

  throw new CompilerError(
    `No implicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}'`,
    loc,
  );
}

export function explicitConversion(
  _from: Datatype,
  _to: Datatype,
  expr: string,
  scope: Scope,
  loc: Location,
  program: Module,
): string {
  const from = resolveGenerics(_from, scope, loc);
  const to = resolveGenerics(_to, scope, loc);

  if (isSame(from, to)) {
    return expr;
  }

  if (from.variant === "Primitive" && to.variant === "Primitive") {
    if (isInteger(from) && isBoolean(to)) {
      return `(${expr} != 0)`;
    }
    if (isBoolean(from) && isInteger(to)) {
      return `(${expr} ? 1 : 0)`;
    }
    if (isInteger(from) && isInteger(to)) {
      return `(${generateUsageCode(to, program)})(${expr})`;
    }
    if (isFloat(from) && isFloat(to)) {
      return `(${generateUsageCode(to, program)})(${expr})`;
    }
    if (isInteger(from) && isFloat(to)) {
      return `(${generateUsageCode(to, program)})(${expr})`;
    }
    if (isFloat(from) && isInteger(to)) {
      return `(${generateUsageCode(to, program)})(${expr})`;
    }
    throw new CompilerError(
      `No explicit conversion from ${serializeDatatype(from)} to ${serializeDatatype(to)}`,
      loc,
    );
  }

  if (
    from.variant === "RawPointer" &&
    to.variant === "Primitive" &&
    to.primitive === Primitive.boolean
  ) {
    return `(${expr} != 0)`;
  }

  if (from.variant === "RawPointer" && isInteger(to)) {
    return `(${generateUsageCode(to, program)})(${expr})`;
  }
  if (to.variant === "RawPointer" && isInteger(from)) {
    return `(${generateUsageCode(to, program)})(${expr})`;
  }

  if (from.variant === "RawPointer" && to.variant === "RawPointer") {
    return `(${generateUsageCode(to.generics.get("__Pointee")!, program)}*)(${expr})`;
  }

  if (from.variant === "Function" && to.variant === "Function") {
    if (isSame(from.functionReturnType, to.functionReturnType)) {
      if (from.functionParameters.length === to.functionParameters.length) {
        let equal = true;
        for (let i = 0; i < from.functionParameters.length; i++) {
          if (
            !isSame(from.functionParameters[i][1], to.functionParameters[i][1])
          ) {
            equal = false;
          }
        }
        if (equal) {
          return expr;
        }
      }
    }
    throw new CompilerError(
      `No explicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}'`,
      loc,
    );
  }

  if (from.variant === "Struct" && to.variant === "Struct") {
    if (from.members.length !== to.members.length) {
      throw new CompilerError(
        `No explicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}': different number of fields`,
        loc,
      );
    }

    let equal = true;
    for (const a of from.members) {
      if (!exactMatchInTheOther(a, to.members)) {
        equal = false;
      }
    }
    for (const b of to.members) {
      if (!exactMatchInTheOther(b, from.members)) {
        equal = false;
      }
    }

    if (equal) {
      return expr;
    }

    throw new CompilerError(
      `No explicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}'`,
      loc,
    );
  }

  throw new CompilerError(
    `No explicit conversion from '${serializeDatatype(from)}' to '${serializeDatatype(to)}'`,
    loc,
  );
}
