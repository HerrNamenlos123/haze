import type { ParserRuleContext } from "antlr4";
import {
  CompilerError,
  getCallerLocation,
  ImpossibleSituation,
  InternalError,
  UnreachableCode,
  type Location,
} from "./Errors";
import { OutputWriter } from "./OutputWriter";
import type { Program } from "./Program";
import { Scope } from "./Scope";
import {
  getDatatypeId,
  Language,
  mangleSymbol,
  type DatatypeSymbol,
  type FunctionSymbol,
  type VariableSymbol,
} from "./Symbol";
import { defineGenericsInScope } from "./utils";

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

export type DatatypeId = string;

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

export type Generics = { [name: string]: DatatypeId | null };

export type FunctionDatatype = {
  variant: "Function";
  generics: Generics;
  functionParameters: [string, DatatypeId][];
  functionReturnType: DatatypeId;
  vararg: boolean;
};

export type DeferredReturnDatatype = {
  variant: "DeferredReturn";
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
  language: Language;
  generics: Generics;
  members: (VariableSymbol | StructMemberUnion)[];
  methods: FunctionSymbol[];
};

export type RawPointerDatatype = {
  variant: "RawPointer";
  generics: Generics;
};

export type PrimitiveDatatype = {
  variant: "Primitive";
  primitive: Primitive;
};

export type Datatype =
  | DeferredReturnDatatype
  | FunctionDatatype
  | StructDatatype
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

export function isDeferred(id: DatatypeId, program: Program): boolean {
  const dt = program.datatypeDatabase.tryLookup(id);
  if (!dt) {
    return false;
  }
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
): DatatypeId {
  if (a.variant !== "Primitive" || b.variant !== "Primitive") {
    throw new InternalError("Datatype is not an integer");
  }
  return getDatatypeId(promoteType(a, b));
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

export function serializeDatatype(id: DatatypeId, program: Program): string {
  const type = program.lookupDt(id);
  switch (type.variant) {
    case "Primitive":
      return primitiveVariantToString(type);

    case "RawPointer":
      const g2 = [] as string[];
      for (const [name, tp] of Object.entries(type.generics)) {
        if (tp) {
          g2.push(`${serializeDatatype(tp, program)}`);
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
      let s = type.name;
      const g = [] as string[];
      for (const [name, tp] of Object.entries(type.generics)) {
        if (tp) {
          g.push(`${name}=${serializeDatatype(tp, program)}`);
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
      ss += type.functionParameters
        .map((p) => `${p[0]}: ${serializeDatatype(p[1], program)}`)
        .join(", ");
      ss += ") -> " + serializeDatatype(type.functionReturnType, program);
      return ss;

    case "DeferredReturn":
      return "DeferredReturn";

    case "Generic":
      return type.name;
  }
}

export function generateDefinitionCCode(
  _datatype: DatatypeSymbol,
  program: Program,
): OutputWriter {
  const writer = new OutputWriter();
  const type = program.lookupDt(_datatype.type);
  const scope = new Scope(_datatype.scope.location, _datatype.scope);
  if (type.variant === "Struct") {
    defineGenericsInScope(type.generics, scope);
  }
  switch (type.variant) {
    case "Primitive":
      return writer;

    case "Struct":
      if (type.language === Language.Internal) {
        writer.writeLine(`typedef struct {`).pushIndent();
        for (const memberSymbol of type.members) {
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
        writer
          .popIndent()
          .writeLine(`} ${generateUsageCode(_datatype.type, program)};`);
      }
      return writer;

    case "RawPointer":
      const generic = type.generics["__Pointee"];
      if (!generic) {
        throw new ImpossibleSituation();
      }
      writer.writeLine(
        `typedef ${generateUsageCode(generic, program)}* ${mangleSymbol(_datatype, program)};`,
      );
      return writer;

    case "Function":
      const params = type.functionParameters.map(([name, tp]) =>
        generateUsageCode(_datatype.type, program),
      );
      writer.write(
        `typedef ${generateUsageCode(type.functionReturnType, program)} (*${generateUsageCode(_datatype.type, program)})(${params.join(", ")});`,
      );
      return writer;
  }
  throw new InternalError(`Invalid variant ${type.variant}`);
}

export function generateUsageCode(dt: DatatypeId, program: Program): string {
  const type = program.lookupDt(dt);
  switch (type.variant) {
    case "Primitive":
      switch (type.primitive) {
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
      const ptrGeneric = type.generics["__Pointee"];
      if (!ptrGeneric) {
        throw new ImpossibleSituation();
      }
      return `${generateUsageCode(ptrGeneric, program)}*`;

    case "DeferredReturn":
      throw new InternalError("Cannot generate usage code for deferred");
    case "Struct":
      if (type.language === Language.Internal) {
        return `_H${dt}`;
      } else {
        return `${dt}`;
      }
    case "Function":
      return `_H${dt}`;

    case "Generic":
      throw new InternalError("Cannot generate usage code for generic");
  }
  // throw new InternalError(`Invalid variant ${dt.variant}`);
}

export function isSame(
  _a: DatatypeId,
  _b: DatatypeId,
  program: Program,
): boolean {
  const a = program.lookupDt(_a);
  const b = program.lookupDt(_b);
  if (a.variant === "Primitive" && b.variant === "Primitive") {
    return a.primitive === b.primitive;
  }

  if (a.variant === "RawPointer" && b.variant === "RawPointer") {
    return isSame(a.generics["__Pointee"]!, b.generics["__Pointee"]!, program);
  }

  if (a.variant === "Function" && b.variant === "Function") {
    if (!a.functionReturnType || !b.functionReturnType) {
      return false;
    }
    if (!isSame(a.functionReturnType, b.functionReturnType, program)) {
      return false;
    }
    if (a.functionParameters.length !== b.functionParameters.length) {
      return false;
    }
    for (let i = 0; i < a.functionParameters.length; i++) {
      if (
        !isSame(a.functionParameters[i][1], b.functionParameters[i][1], program)
      ) {
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
        if (aa.name !== bb.name || !isSame(aa.type, bb.type, program)) {
          return false;
        }
      } else if (
        aa.variant === "StructMemberUnion" &&
        bb.variant === "StructMemberUnion"
      ) {
        for (let j = 0; j < aa.symbols.length; j++) {
          if (
            aa.symbols[i].name !== bb.symbols[i].name ||
            !isSame(aa.symbols[i].type, bb.symbols[i].type, program)
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
  program: Program,
) => {
  if (a.variant === "Variable") {
    for (const b of bList) {
      if (b.variant === "Variable") {
        if (a.name === b.name && isSame(a.type, b.type, program)) {
          return true;
        }
      }
    }
  } else {
    for (const b of bList) {
      if (b.variant === "StructMemberUnion") {
        for (const inner of a.symbols) {
          if (!exactMatchInTheOther(inner, b.symbols, program)) {
            return false;
          }
        }
        for (const inner of b.symbols) {
          if (!exactMatchInTheOther(inner, a.symbols, program)) {
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
  _from: DatatypeId,
  _to: DatatypeId,
  expr: string,
  ctx: ParserRuleContext,
  program: Program,
): string {
  const from = program.lookupDt(_from);
  const to = program.lookupDt(_to);

  if (isSame(_from, _to, program)) {
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
      return `(${generateUsageCode(_to, program)})(${expr})`;
    }
    throw new CompilerError(
      `No implicit conversion from ${serializeDatatype(_from, program)} to ${serializeDatatype(_to, program)}`,
      program.getLoc(ctx),
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
      isSame(from.generics["__Pointee"]!, to.generics["__Pointee"]!, program)
    ) {
      return expr;
    }
    const topointee = program.lookupDt(to.generics["__Pointee"]!);
    if (
      topointee.variant === "Primitive" &&
      topointee.primitive === Primitive.none
    ) {
      return `(void*)(${expr})`;
    }
    throw new CompilerError(
      `No implicit conversion from ${serializeDatatype(_from, program)} to ${serializeDatatype(_to, program)}`,
      program.getLoc(ctx),
    );
  }

  if (from.variant === "Function" && to.variant === "Function") {
    if (isSame(from.functionReturnType, to.functionReturnType, program)) {
      if (from.functionParameters.length === to.functionParameters.length) {
        let equal = true;
        for (let i = 0; i < from.functionParameters.length; i++) {
          if (
            !isSame(
              from.functionParameters[i][1],
              to.functionParameters[i][1],
              program,
            )
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
      `No implicit conversion from '${serializeDatatype(_from, program)}' to '${serializeDatatype(_to, program)}'`,
      program.getLoc(ctx),
    );
  }

  if (from.variant === "Struct" && to.variant === "Struct") {
    if (from.members.length !== to.members.length) {
      throw new CompilerError(
        `No implicit conversion from '${serializeDatatype(_from, program)}' to '${serializeDatatype(_to, program)}': different number of fields`,
        program.getLoc(ctx),
      );
    }

    let equal = true;
    for (const a of from.members) {
      if (!exactMatchInTheOther(a, to.members, program)) {
        equal = false;
      }
    }
    for (const b of to.members) {
      if (!exactMatchInTheOther(b, from.members, program)) {
        equal = false;
      }
    }

    if (equal) {
      return expr;
    }

    throw new CompilerError(
      `No implicit conversion from '${serializeDatatype(_from, program)}' to '${serializeDatatype(_to, program)}'`,
      program.getLoc(ctx),
    );
  }

  throw new CompilerError(
    `No implicit conversion from '${serializeDatatype(_from, program)}' to '${serializeDatatype(_to, program)}'`,
    program.getLoc(ctx),
  );
}

export function explicitConversion(
  _from: DatatypeId,
  _to: DatatypeId,
  expr: string,
  ctx: ParserRuleContext,
  program: Program,
): string {
  const from = program.lookupDt(_from);
  const to = program.lookupDt(_to);

  if (isSame(_from, _to, program)) {
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
      return `(${generateUsageCode(_to, program)})(${expr})`;
    }
    throw new CompilerError(
      `No explicit conversion from ${serializeDatatype(_from, program)} to ${serializeDatatype(_to, program)}`,
      program.getLoc(ctx),
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
    return `(${generateUsageCode(_to, program)})(${expr})`;
  }
  if (to.variant === "RawPointer" && isInteger(from)) {
    return `(${generateUsageCode(_to, program)})(${expr})`;
  }

  if (from.variant === "RawPointer" && to.variant === "RawPointer") {
    return `(${generateUsageCode(to.generics["__Pointee"]!, program)}*)(${expr})`;
  }

  if (from.variant === "Function" && to.variant === "Function") {
    if (isSame(from.functionReturnType, to.functionReturnType, program)) {
      if (from.functionParameters.length === to.functionParameters.length) {
        let equal = true;
        for (let i = 0; i < from.functionParameters.length; i++) {
          if (
            !isSame(
              from.functionParameters[i][1],
              to.functionParameters[i][1],
              program,
            )
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
      `No explicit conversion from '${serializeDatatype(_from, program)}' to '${serializeDatatype(_to, program)}'`,
      program.getLoc(ctx),
    );
  }

  if (from.variant === "Struct" && to.variant === "Struct") {
    if (from.members.length !== to.members.length) {
      throw new CompilerError(
        `No explicit conversion from '${serializeDatatype(_from, program)}' to '${serializeDatatype(_to, program)}': different number of fields`,
        program.getLoc(ctx),
      );
    }

    let equal = true;
    for (const a of from.members) {
      if (!exactMatchInTheOther(a, to.members, program)) {
        equal = false;
      }
    }
    for (const b of to.members) {
      if (!exactMatchInTheOther(b, from.members, program)) {
        equal = false;
      }
    }

    if (equal) {
      return expr;
    }

    throw new CompilerError(
      `No explicit conversion from '${serializeDatatype(_from, program)}' to '${serializeDatatype(_to, program)}'`,
      program.getLoc(ctx),
    );
  }

  throw new CompilerError(
    `No explicit conversion from '${serializeDatatype(_from, program)}' to '${serializeDatatype(_to, program)}'`,
    program.getLoc(ctx),
  );
}
