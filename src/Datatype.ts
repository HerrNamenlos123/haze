import {
  CompilerError,
  InternalError,
  UnreachableCode,
  type Location,
} from "./Errors";
import type { Scope } from "./Scope";
import {
  mangleDatatype,
  type FunctionSymbol,
  type VariableSymbol,
} from "./Symbol";
import { resolveGenerics } from "./utils";

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
  stringview = 13,
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
};

export type DeferredDatatype = {
  variant: "Deferred";
};

export type GenericPlaceholderDatatype = {
  variant: "Generic";
  name: string;
};

export type StructDatatype = {
  variant: "Struct";
  name: string;
  generics: Generics;
  members: VariableSymbol[];
  methods: FunctionSymbol[];
};

export type PrimitiveDatatype = {
  variant: "Primitive";
  primitive: Primitive;
};

export type Datatype =
  | DeferredDatatype
  | FunctionDatatype
  | StructDatatype
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
    case Primitive.stringview:
      return "stringview";
  }
  throw new Error("Datatype has no string representation");
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

export function serializeDatatype(datatype: Datatype): string {
  switch (datatype.variant) {
    case "Primitive":
      return primitiveVariantToString(datatype);

    case "Struct":
      let s = datatype.name;
      const g = [] as string[];
      for (const [name, tp] of datatype.generics) {
        if (tp) {
          g.push(`${name}=${serializeDatatype(tp)}`);
        } else {
          g.push(name);
        }
      }
      s += `<${g.join(", ")}>`;
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

// function getDisplayName(type: Datatype): string {
//   switch (type.variant) {
//     case "Primitive":
//       return primitiveVariantToString(type);
//     case "Function":
//       const genericArr: string[] = [];
//       for (const [name, tp] of type.generics) {
//         let nm = name;
//         if (tp) {
//           nm += ` = ${getDisplayName(tp)}`;
//         }
//         genericArr.push(nm);
//       }
//       const params = type.functionParameters.map((f) => getDisplayName(f[1]));
//       const s = genericArr.length > 0 ? `<${genericArr.join(", ")}> ` : "";
//       return `${s}(${params.join(", ")}) -> ${this._functionReturnType.getDisplayName()}`;
//     case Datatype.Variants.Pointer:
//       return `Ptr<${this._pointee.getDisplayName()}>`;
//     case Datatype.Variants.ResolutionDeferred:
//       return "__Deferred";
//     case Datatype.Variants.Struct:
//       if (this._name.startsWith("__anonym_")) {
//         const val = "struct {";
//         for (const symbol of this._structMemberSymbols!.symbols) {
//           val += `${symbol.name}: ${symbol.type.getDisplayName()}, `;
//         }
//         if (this._structMemberSymbols!.symbols.length > 0) {
//           val = val.slice(0, -2);
//         }
//         val += "}";
//         return val;
//       } else {
//         let s = this._name;
//         if (this._generics.length > 0) {
//           const g = this._generics.map((gg) =>
//             gg[1] ? `${gg[0]} = ${gg[1].getDisplayName()}` : gg[0],
//           );
//           s += `<${g.join(", ")}> `;
//         }
//         if (this._structMemberSymbols) {
//           s += "{";
//           s += this._structMemberSymbols.symbols
//             .map((m) => `${m.name}: ${m.type}`)
//             .join(", ");
//           s += "}";
//         }
//         return s;
//       }
//     default:
//       throw new Error("Invalid variant");
//   }
// }

// function getMangledName(): string {
//   switch (this._variant) {
//     case Datatype.Variants.Primitive:
//       return Datatype.primitiveVariantToString(this._primitiveVariant);
//     case Datatype.Variants.Pointer:
//       throw new InternalError("Cannot mangle pointer");
//     case Datatype.Variants.ResolutionDeferred:
//       throw new InternalError("Cannot mangle deferred");
//     case Datatype.Variants.Struct:
//       let mangled = this._name.length.toString();
//       mangled += this._name;
//       if (this._generics.length > 0) {
//         mangled += "I";
//         for (const [name, tp] of this._generics) {
//           if (!tp) {
//             throw new InternalError(
//               `Generic placeholder '${name}' is missing value`,
//               getCallerLocation(),
//             );
//           }
//           mangled += tp.getMangledName();
//         }
//         mangled += "E";
//       }
//       return mangled;
//     case Datatype.Variants.Function:
//       let mangled = "F";
//       for (const [name, tp] of this._functionParameters) {
//         mangled += tp.getMangledName();
//       }
//       mangled += "E";
//       return mangled;
//   }
//   throw new InternalError(`Invalid variant ${this._variant}`);
// }

// function areAllGenericsResolved(): boolean {
//   if (!this.isGeneric()) {
//     return true;
//   }
//   switch (this._variant) {
//     case Datatype.Variants.Primitive:
//       return true;
//     case Datatype.Variants.GenericPlaceholder:
//       return false;
//     case Datatype.Variants.ResolutionDeferred:
//       throw new InternalError(
//         "Deferred type should no longer be in this stage",
//       );
//     case Datatype.Variants.Pointer:
//       return !!this._pointee && this._pointee.areAllGenericsResolved();
//     case Datatype.Variants.Function:
//       if (
//         this._functionReturnType &&
//         !this._functionReturnType.areAllGenericsResolved()
//       ) {
//         return false;
//       }
//       for (const [name, type] of this._functionParameters) {
//         if (!type.areAllGenericsResolved()) {
//           return false;
//         }
//       }
//       for (const [name, tp] of this._generics) {
//         if (!tp) {
//           return false;
//         }
//       }
//       return true;
//     case Datatype.Variants.Struct:
//       for (const vsym of this.structSymbolTable().getFiltered(VariableSymbol)) {
//         const vsymbol = vsym as VariableSymbol;
//         if (!vsymbol.type.areAllGenericsResolved()) {
//           return false;
//         }
//       }
//       for (const [name, tp] of this._generics) {
//         if (!tp) {
//           return false;
//         }
//       }
//       return true;
//   }
//   throw new InternalError(`Invalid variant ${this._variant}`);
// }

// function isGeneric(): boolean {
//   switch (this._variant) {
//     case Datatype.Variants.Primitive:
//       return false;

//     case Datatype.Variants.GenericPlaceholder:
//       return true;

//     case Datatype.Variants.ResolutionDeferred:
//       return false;

//     case Datatype.Variants.Pointer:
//       return !!this._pointee && this._pointee.isGeneric();

//     case Datatype.Variants.Function:
//       if (this._functionReturnType && this._functionReturnType.isGeneric()) {
//         return true;
//       }
//       for (const [name, type] of this._functionParameters) {
//         if (type.isGeneric()) {
//           return true;
//         }
//       }
//       return this._generics.length > 0;

//     case Datatype.Variants.Struct:
//       const vsyms = this.structSymbolTable().getFiltered(VariableSymbol);
//       for (const vsym of vsyms) {
//         const vsymbol = vsym as VariableSymbol;
//         if (vsymbol.type.isGeneric()) {
//           return true;
//         }
//       }
//       return this._generics.length > 0;
//   }
//   throw new InternalError(`Invalid variant ${this._variant}`);
// }

// function containsUnknown(): boolean {
//   switch (this._variant) {
//     case Datatype.Variants.Primitive:
//       return this.isUnknown();
//     case Datatype.Variants.Function:
//       if (!this._functionReturnType) {
//         throw new InternalError("bullshit happening");
//       }
//       if (this._functionReturnType.isUnknown()) {
//         return true;
//       }
//       for (const [name, type] of this._functionParameters) {
//         if (type.isUnknown()) {
//           return true;
//         }
//       }
//       return false;
//   }
//   throw new InternalError(`Invalid variant ${this._variant}`);
// }

export function generateDefinitionCCode(datatype: Datatype): string {
  switch (datatype.variant) {
    case "Primitive":
      return "";

    case "Struct":
      let out = `typedef struct __${generateUsageCode(datatype)}__ {`;
      for (const memberSymbol of datatype.members) {
        out += `    ${generateUsageCode(memberSymbol.type)} ${memberSymbol.name};`;
      }
      out += `} ${generateUsageCode(datatype)};`;
      return out;

    case "Function":
      const params = datatype.functionParameters.map(([name, tp]) =>
        generateUsageCode(datatype),
      );
      return `typedef ${generateUsageCode(datatype.functionReturnType)} (*${generateUsageCode(datatype)})(${params.join(", ")});`;
  }
  throw new InternalError(`Invalid variant ${datatype.variant}`);
}

export function generateUsageCode(dt: Datatype): string {
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
          return "bool";
        case Primitive.booleanptr:
          return "bool*";
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
        case Primitive.stringview:
          return "char*";
      }
      throw new UnreachableCode();

    // case Datatype.Variants.Pointer:
    //   if (!this._pointee) {
    //     throw new InternalError("bullshit happening");
    //   }
    //   return `${this._pointee.generateUsageCode()}*`;

    case "Deferred":
      throw new InternalError("Cannot generate usage code for deferred");
    case "Struct":
      return `_H${mangleDatatype(dt)}`;
    case "Function":
      return `_H${mangleDatatype(dt)}`;

    case "Generic":
      throw new InternalError("Cannot generate usage code for generic");
  }
  // throw new InternalError(`Invalid variant ${dt.variant}`);
}

export function isSame(a: Datatype, b: Datatype): boolean {
  if (a.variant === "Primitive" && b.variant === "Primitive") {
    return a.primitive === b.primitive;
  }

  // if (a.isPointer() && b.isPointer()) {
  //   if (!a._pointee || !b._pointee) {
  //     return false;
  //   }
  //   return a._pointee.isSame(b._pointee);
  // }

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
      if (
        a.members[i].name !== b.members[i].name ||
        !isSame(a.members[i].type, b.members[i].type)
      ) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export function implicitConversion(
  _from: Datatype,
  _to: Datatype,
  expr: string,
  scope: Scope,
  loc: Location,
): string {
  const from = resolveGenerics(_from, scope, loc);
  const to = resolveGenerics(_to, scope, loc);

  if (isSame(from, to)) {
    return expr;
  }

  if (from.variant === "Primitive" && to.variant === "Primitive") {
    if (isInteger(from) && isInteger(to)) {
      return `(${generateUsageCode(to)})(${expr})`;
    }
    throw new CompilerError(
      `No implicit conversion from ${serializeDatatype(from)} to ${serializeDatatype(to)}`,
      loc,
    );
  }

  // if (from.variant === "Pointer" && to.variant === "Pointer") {
  //   throw new CompilerError(
  //     "Pointer types are not convertible. Polymorphism is not implemented yet",
  //     loc,
  //   );
  // }

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

    const exactMatchInTheOther = (
      a: VariableSymbol,
      bList: VariableSymbol[],
    ) => {
      for (const b of bList) {
        if (a.name === b.name && isSame(a.type, b.type)) {
          return true;
        }
      }
      return false;
    };

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
