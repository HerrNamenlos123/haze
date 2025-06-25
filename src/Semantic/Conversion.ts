import { EPrimitive } from "../shared/common";
import { InternalError } from "../shared/Errors";
import { Semantic } from "./SemanticSymbols";

export namespace Conversion {
  export function isSignedInteger(type: Semantic.PrimitiveDatatypeSymbol): boolean {
    switch (type.primitive) {
      case EPrimitive.i8:
      case EPrimitive.i16:
      case EPrimitive.i32:
      case EPrimitive.i64:
        return true;
      default:
        return false;
    }
  }

  export function isUnsignedInteger(type: Semantic.PrimitiveDatatypeSymbol): boolean {
    switch (type.primitive) {
      case EPrimitive.u8:
      case EPrimitive.u16:
      case EPrimitive.u32:
      case EPrimitive.u64:
        return true;
      default:
        return false;
    }
  }

  export function isStruct(type: Semantic.Symbol): type is Semantic.StructDatatypeSymbol {
    if (type.variant !== "StructDatatype") return false;
    return true;
  }

  export function isF32(type: Semantic.Symbol): type is Semantic.PrimitiveDatatypeSymbol {
    if (type.variant !== "PrimitiveDatatype") return false;
    return type.primitive === EPrimitive.f32;
  }

  export function isF64(type: Semantic.Symbol): type is Semantic.PrimitiveDatatypeSymbol {
    if (type.variant !== "PrimitiveDatatype") return false;
    return type.primitive === EPrimitive.f64;
  }

  export function isFloat(type: Semantic.Symbol): type is Semantic.PrimitiveDatatypeSymbol {
    return isF32(type) || isF64(type);
  }

  export function isBoolean(type: Semantic.Symbol): type is Semantic.PrimitiveDatatypeSymbol {
    if (type.variant !== "PrimitiveDatatype") return false;
    return type.primitive === EPrimitive.boolean;
  }

  export function isInteger(type: Semantic.Symbol): type is Semantic.PrimitiveDatatypeSymbol {
    if (type.variant !== "PrimitiveDatatype") return false;
    return isSignedInteger(type) || isUnsignedInteger(type);
  }

  export function getIntegerBits(type: Semantic.PrimitiveDatatypeSymbol): number {
    switch (type.primitive) {
      case EPrimitive.i8:
      case EPrimitive.u8:
        return 8;
      case EPrimitive.i16:
      case EPrimitive.u16:
        return 16;
      case EPrimitive.i32:
      case EPrimitive.u32:
        return 32;
      case EPrimitive.i64:
      case EPrimitive.u64:
        return 64;
    }
    throw new InternalError("Requested getIntegerBits from a non-integer");
  }

  function promoteInteger(
    a: Semantic.PrimitiveDatatypeSymbol,
    b: Semantic.PrimitiveDatatypeSymbol,
  ): Semantic.PrimitiveDatatypeSymbol {
    if (a.variant !== "PrimitiveDatatype" || b.variant !== "PrimitiveDatatype") {
      throw new InternalError("promoteInteger got non primitives");
    }

    const getWiderInteger = (a: Semantic.PrimitiveDatatypeSymbol, b: Semantic.PrimitiveDatatypeSymbol) => {
      const aBits = getIntegerBits(a);
      const bBits = getIntegerBits(b);
      return aBits > bBits ? a : b;
    };

    const widenInteger = (a: Semantic.PrimitiveDatatypeSymbol, b: Semantic.PrimitiveDatatypeSymbol) => {
      if (a.primitive == b.primitive) {
        return a;
      }

      let sizeA = getIntegerBits(a);
      let sizeB = getIntegerBits(b);

      // If one of the types is unsigned and larger in size, widen accordingly
      if (isUnsignedInteger(a) && !isUnsignedInteger(b)) {
        if (sizeA > sizeB) {
          return a; // Promote the unsigned type
        } else {
          return b; // Promote the signed type to the larger unsigned type
        }
      }

      if (isUnsignedInteger(b) && !isUnsignedInteger(a)) {
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
    };

    if (a.primitive == b.primitive) return a;
    if (isUnsignedInteger(a) && !isUnsignedInteger(b)) return widenInteger(a, b);
    if (!isUnsignedInteger(a) && isUnsignedInteger(b)) return widenInteger(a, b);
    return getWiderInteger(a, b);
  }

  export function getIntegerBinaryResult(
    a: Semantic.PrimitiveDatatypeSymbol,
    b: Semantic.PrimitiveDatatypeSymbol,
  ): Semantic.PrimitiveDatatypeSymbol {
    return promoteInteger(a, b);
  }
}
