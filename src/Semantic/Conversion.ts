import { EExternLanguage, EOperator } from "../shared/AST";
import { EMethodType, EPrimitive } from "../shared/common";
import {
  assert,
  CompilerError,
  ImpossibleSituation,
  InternalError,
  type SourceLoc,
} from "../shared/Errors";
import { Semantic, type SemanticResult } from "./SemanticSymbols";
import { serializeDatatype } from "./Serialize";

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

    const getWiderInteger = (
      a: Semantic.PrimitiveDatatypeSymbol,
      b: Semantic.PrimitiveDatatypeSymbol,
    ) => {
      const aBits = getIntegerBits(a);
      const bBits = getIntegerBits(b);
      return aBits > bBits ? a : b;
    };

    const widenInteger = (
      a: Semantic.PrimitiveDatatypeSymbol,
      b: Semantic.PrimitiveDatatypeSymbol,
    ) => {
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

  export function IsStructurallyEquivalent(
    a: Semantic.DatatypeSymbol,
    b: Semantic.DatatypeSymbol,
    seen: WeakMap<Semantic.DatatypeSymbol, WeakSet<Semantic.DatatypeSymbol>> = new WeakMap(),
  ): boolean {
    // Symmetric check: has this pair already been seen?
    if (seen.get(a)?.has(b) || seen.get(b)?.has(a)) {
      return true;
    }

    // Mark pair as seen
    if (!seen.has(a)) seen.set(a, new WeakSet());
    seen.get(a)!.add(b);

    if (!a.concrete || !b.concrete) {
      throw new InternalError(
        "Cannot check structural equivalence of a non-concrete datatype",
        undefined,
        1,
      );
    }
    if (a.variant !== b.variant) {
      return false;
    }
    switch (a.variant) {
      case "PrimitiveDatatype":
        assert(b.variant === "PrimitiveDatatype");
        return a.primitive === b.primitive;

      case "DeferredDatatype":
        throw new InternalError("Cannot check structural equivalence of a deferred datatype");

      case "RawPointerDatatype":
        assert(b.variant === "RawPointerDatatype");
        return IsStructurallyEquivalent(a.pointee, b.pointee, seen);

      case "ReferenceDatatype":
        assert(b.variant === "ReferenceDatatype");
        return IsStructurallyEquivalent(a.referee, b.referee, seen);

      case "FunctionDatatype":
        assert(b.variant === "FunctionDatatype");
        return (
          a.vararg === b.vararg &&
          IsStructurallyEquivalent(a.returnType, b.returnType, seen) &&
          a.parameters.every((p, index) => IsStructurallyEquivalent(p, b.parameters[index], seen))
        );

      case "CallableDatatype":
        assert(b.variant === "CallableDatatype");
        if (Boolean(a.thisExprType) !== Boolean(b.thisExprType)) return false;
        if (
          a.thisExprType &&
          b.thisExprType &&
          IsStructurallyEquivalent(a.thisExprType, b.thisExprType, seen)
        )
          return false;
        return IsStructurallyEquivalent(a.functionType, b.functionType, seen);

      case "GenericParameterDatatype":
        throw new InternalError("Cannot check structural equivalence of a generic parameter");

      case "StructDatatype":
        assert(b.variant === "StructDatatype");
        if (a.generics.length !== b.generics.length) {
          return false;
        }

        for (let i = 0; i < a.generics.length; i++) {
          if (!IsStructurallyEquivalent(a.generics[i], b.generics[i], seen)) return false;
        }

        if (a.members.length !== b.members.length) {
          return false;
        }

        // All members are unique
        const remainingMembersA = [...new Set(a.members.map((m) => m.name))];
        assert(remainingMembersA.length === a.members.length);
        let remainingMembersB = [...new Set(b.members.map((m) => m.name))];
        assert(remainingMembersB.length === b.members.length);

        // All members are unique and the same count. So if all members from A are in B, the inverse must also be true.

        for (const m of remainingMembersA) {
          if (!remainingMembersB.includes(m)) {
            return false; // Member from A is not available in B
          }
          remainingMembersB = remainingMembersB.filter((k) => k !== m);

          const am = a.members.find((mm) => mm.name === m);
          const bm = b.members.find((mm) => mm.name === m);
          assert(am && bm);
          if (!IsStructurallyEquivalent(am.type, bm.type, seen)) {
            return false;
          }
        }

        return true;

      default:
        assert(false, "All cases handled");
    }
  }

  const SafeImplicitPrimitiveConversionTable = [
    // Integer
    {
      from: EPrimitive.i8,
      to: [EPrimitive.i16, EPrimitive.i32, EPrimitive.i64],
    },
    {
      from: EPrimitive.i16,
      to: [EPrimitive.i32, EPrimitive.i64],
    },
    {
      from: EPrimitive.i32,
      to: [EPrimitive.i64],
    },
    {
      from: EPrimitive.u8,
      to: [
        EPrimitive.u16,
        EPrimitive.u32,
        EPrimitive.u64,
        EPrimitive.i16,
        EPrimitive.i32,
        EPrimitive.i64,
      ],
    },
    {
      from: EPrimitive.u16,
      to: [EPrimitive.i32, EPrimitive.i64, EPrimitive.u32, EPrimitive.u64],
    },
    {
      from: EPrimitive.u32,
      to: [EPrimitive.i64, EPrimitive.u64],
    },
    // Floats
    {
      from: EPrimitive.i8,
      to: [EPrimitive.f32, EPrimitive.f64],
    },
    {
      from: EPrimitive.u8,
      to: [EPrimitive.f32, EPrimitive.f64],
    },
    {
      from: EPrimitive.i16,
      to: [EPrimitive.f32, EPrimitive.f64],
    },
    {
      from: EPrimitive.u16,
      to: [EPrimitive.f32, EPrimitive.f64],
    },
    {
      from: EPrimitive.i32,
      to: [EPrimitive.f64],
    },
    {
      from: EPrimitive.u32,
      to: [EPrimitive.f64],
    },
    {
      from: EPrimitive.f32,
      to: [EPrimitive.f64],
    },
  ];

  export function IsImplicitConversionAvailable(
    from: Semantic.DatatypeSymbol,
    to: Semantic.DatatypeSymbol,
  ) {
    if (IsStructurallyEquivalent(from, to)) {
      return true;
    }

    if (to.variant === "ReferenceDatatype") {
      return IsStructurallyEquivalent(from, to.referee);
    }
    if (from.variant === "ReferenceDatatype") {
      return IsStructurallyEquivalent(from.referee, to);
    }

    if (from.variant === "PrimitiveDatatype" && to.variant === "PrimitiveDatatype") {
      for (const conv of SafeImplicitPrimitiveConversionTable) {
        if (conv.from === from.primitive) {
          if (conv.to.includes(to.primitive)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  export function IsExplicitConversionAvailable(
    from: Semantic.DatatypeSymbol,
    to: Semantic.DatatypeSymbol,
  ) {
    if (IsImplicitConversionAvailable(from, to)) {
      return true;
    }
    return false;
  }

  export function MakeImplicitConversion(
    from: Semantic.Expression,
    to: Semantic.DatatypeSymbol,
    sourceloc: SourceLoc,
  ) {
    if (!IsImplicitConversionAvailable(from.type, to)) {
      throw new CompilerError(
        `No implicit Conversion from ${serializeDatatype(from.type)} to ${serializeDatatype(to)} available`,
        sourceloc,
      );
    }
    return MakeExplicitConversion(from, to, sourceloc);
  }

  export function MakeExplicitConversion(
    from: Semantic.Expression,
    to: Semantic.DatatypeSymbol,
    sourceloc: SourceLoc,
  ) {
    if (IsStructurallyEquivalent(from.type, to)) {
      return {
        variant: "ExplicitCast",
        expr: from,
        type: to,
        sourceloc: sourceloc,
      } satisfies Semantic.ExplicitCastExpr;
    }

    if (!IsExplicitConversionAvailable(from.type, to)) {
      throw new CompilerError(
        `No explicit Conversion from ${serializeDatatype(from.type)} to ${serializeDatatype(to)} available`,
        sourceloc,
      );
    }

    if (to.variant === "ReferenceDatatype") {
      // Conversion from anything to a reference
      return {
        variant: "ExplicitCast",
        expr: from,
        type: to,
        sourceloc: sourceloc,
      } satisfies Semantic.ExplicitCastExpr;
    }

    if (from.type.variant === "ReferenceDatatype") {
      // Conversion from a reference to whatever it references
      return {
        variant: "ExplicitCast",
        expr: from,
        type: to,
        sourceloc: sourceloc,
      } satisfies Semantic.ExplicitCastExpr;
    }

    if (from.type.variant === "PrimitiveDatatype" && to.variant === "PrimitiveDatatype") {
      for (const conv of SafeImplicitPrimitiveConversionTable) {
        if (conv.from === from.type.primitive) {
          if (conv.to.includes(to.primitive)) {
            return {
              variant: "ExplicitCast",
              expr: from,
              type: to,
              sourceloc: sourceloc,
            } satisfies Semantic.ExplicitCastExpr;
          }
        }
      }
    }

    throw new ImpossibleSituation();
  }

  export function makeAsOperator(
    sr: SemanticResult,
    targetType: Semantic.DatatypeSymbol,
  ): Semantic.FunctionDefinitionSymbol {
    for (const f of sr.overloadedOperators) {
      if (
        f.name === "__operator_as" &&
        f.operatorOverloading?.operator === EOperator.As &&
        IsStructurallyEquivalent(f.operatorOverloading.asTarget, targetType)
      ) {
        return f;
      }
    }
    const func = {
      variant: "FunctionDefinition",
      concrete: true,
      export: false,
      staticMethod: false,
      externLanguage: EExternLanguage.None,
      methodType: EMethodType.NotAMethod,
      name: "__operator_as",
      generics: [],
      parameterNames: [],
      type: {
        variant: "FunctionDatatype",
        concrete: true,
        parameters: [],
        returnType: targetType,
        vararg: false,
      },
      parent: null,
      sourceloc: null,
      operatorOverloading: {
        operator: EOperator.As,
        asTarget: targetType,
      },
    } satisfies Semantic.FunctionDefinitionSymbol;
    sr.overloadedOperators.push(func);
    return func;
  }
}
