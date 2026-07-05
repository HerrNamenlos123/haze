import { Collect } from "../SymbolCollection/SymbolCollection";
import {
  BinaryOperationToString,
  EBinaryOperation,
  EDatatypeMutability,
  EUnaryOperation,
  UnaryOperationToString,
} from "../shared/AST";
import {
  EPrimitive,
  type LiteralValue,
  primitiveToString,
} from "../shared/common";
import {
  assert,
  CompilerError,
  InternalError,
  type SourceLoc,
} from "../shared/Errors";
import type {
  ConstraintPath,
  ConstraintPathSubscriptIndex,
  ConstraintSet,
  ConstraintValue,
} from "./Constraint";
import { makePrimitiveAvailable, makeRawPrimitiveAvailable } from "./Elaborate";
import { makeTypeUse } from "./LookupDatatype";
import { Semantic } from "./SemanticTypes";

export namespace Conversion {
  // Helper function to extract constraint path from expression
  function extractConstraintPath(
    sr: Semantic.Context,
    exprId: Semantic.ExprId
  ): ConstraintPath | null {
    const expr = sr.exprNodes.get(exprId);
    if (!expr) {
      return null;
    }

    if (expr.variant === Semantic.ENode.ReactiveReadExpr) {
      const inner = sr.exprNodes.get(expr.value);
      if (inner.variant === Semantic.ENode.SymbolValueExpr) {
        return {
          root: { kind: "reactive-symbol", symbolId: inner.symbol },
          path: [],
        };
      }
      return extractConstraintPath(sr, expr.value);
    }

    // Unwrap union casts to extract path from the underlying expression
    if (
      expr.variant === Semantic.ENode.UnionToValueCastExpr ||
      expr.variant === Semantic.ENode.UnionToUnionCastExpr
    ) {
      return extractConstraintPath(sr, expr.expr);
    }

    // Base case: variable reference
    if (expr.variant === Semantic.ENode.SymbolValueExpr) {
      return {
        root: { kind: "symbol", symbolId: expr.symbol },
        path: [],
      };
    }

    // Member access: obj.member
    if (expr.variant === Semantic.ENode.MemberAccessExpr) {
      const basePath = extractConstraintPath(sr, expr.expr);
      if (!basePath) {
        return null;
      }

      // Find the member symbol by name
      const resolvedExprTypeUse = sr.typeUseNodes.get(
        sr.e.resolveAlias(sr.exprNodes.get(expr.expr).type)
      );
      const exprTypeDef = sr.typeDefNodes.get(resolvedExprTypeUse.type);

      if (
        exprTypeDef.variant === Semantic.ENode.DynamicArrayDatatype ||
        exprTypeDef.variant === Semantic.ENode.FixedArrayDatatype
      ) {
        for (const fieldId of exprTypeDef.syntheticFields) {
          const field = sr.symbolNodes.get(fieldId);
          assert(field.variant === Semantic.ENode.VariableSymbol);
          if (field.name === expr.memberName) {
            return {
              root: basePath.root,
              path: [...basePath.path, { kind: "member", member: fieldId }],
            };
          }
        }
      }

      if (exprTypeDef.variant === Semantic.ENode.StructDatatype) {
        const memberSymbol = exprTypeDef.members.find((m) => {
          const sym = sr.symbolNodes.get(m);
          return (
            sym.variant === Semantic.ENode.VariableSymbol &&
            sym.name === expr.memberName
          );
        });
        if (!memberSymbol) {
          return null;
        }

        return {
          root: basePath.root,
          path: [...basePath.path, { kind: "member", member: memberSymbol }],
        };
      }

      if (exprTypeDef.variant === Semantic.ENode.DeepDatatype) {
        const clonedTypeDef = sr.typeDefNodes.get(
          sr.typeUseNodes.get(sr.e.resolveAlias(exprTypeDef.clonedType)).type
        );
        if (clonedTypeDef.variant === Semantic.ENode.StructDatatype) {
          const memberSymbol = clonedTypeDef.members.find((m) => {
            const sym = sr.symbolNodes.get(m);
            return (
              sym.variant === Semantic.ENode.VariableSymbol &&
              sym.name === expr.memberName
            );
          });
          if (memberSymbol) {
            return {
              root: basePath.root,
              path: [
                ...basePath.path,
                { kind: "member", member: memberSymbol },
              ],
            };
          }
        }
      }
    }

    // Array subscript: arr[index]
    if (expr.variant === Semantic.ENode.ArraySubscriptExpr) {
      const basePath = extractConstraintPath(sr, expr.expr);
      if (!basePath) {
        return null;
      }

      // Only support single index for now
      if (expr.indices.length !== 1) {
        return null;
      }

      const indexExpr = sr.exprNodes.get(expr.indices[0]);
      let subscriptIndex: ConstraintPathSubscriptIndex;

      // Check if index is a literal
      if (indexExpr.variant === Semantic.ENode.LiteralExpr) {
        const literalValue = Semantic.serializeLiteralValue(
          sr,
          indexExpr.literal
        );
        subscriptIndex = { kind: "literal", value: literalValue };
      }
      // Check if index is a variable reference
      else if (indexExpr.variant === Semantic.ENode.SymbolValueExpr) {
        subscriptIndex = { kind: "variable", symbol: indexExpr.symbol };
      }
      // Complex expression - not supported for path-based narrowing
      else {
        return null;
      }

      return {
        root: basePath.root,
        path: [...basePath.path, { kind: "subscript", index: subscriptIndex }],
      };
    }

    // Cannot extract path from other expression types
    return null;
  }

  export function isSignedInteger(primitive: EPrimitive): boolean {
    switch (primitive) {
      case EPrimitive.i8:
      case EPrimitive.i16:
      case EPrimitive.i32:
      case EPrimitive.i64:
      case EPrimitive.int:
        return true;
      default:
        return false;
    }
  }

  export function isUnsignedInteger(primitive: EPrimitive): boolean {
    switch (primitive) {
      case EPrimitive.u8:
      case EPrimitive.u16:
      case EPrimitive.u32:
      case EPrimitive.u64:
      case EPrimitive.usize:
        return true;
      default:
        return false;
    }
  }

  export function getIntegerMinMax(primitive: EPrimitive): [bigint, bigint] {
    switch (primitive) {
      case EPrimitive.u8:
        return [0n, 255n];
      case EPrimitive.i8:
        return [-128n, 127n];
      case EPrimitive.u16:
        return [0n, 65535n];
      case EPrimitive.i16:
        return [-32768n, 32767n];
      case EPrimitive.u32:
        return [0n, 4294967295n]; // 2^32 - 1
      case EPrimitive.i32:
        return [-2147483648n, 2147483647n]; // -2^31 .. 2^31-1
      case EPrimitive.u64:
      case EPrimitive.usize:
        return [0n, 18446744073709551615n]; // 2^64 - 1
      case EPrimitive.i64:
      case EPrimitive.int:
        return [-9223372036854775808n, 9223372036854775807n]; // -2^63 .. 2^63-1
      default:
        assert(
          false,
          `Unknown primitive type: ${primitiveToString(primitive)}`
        );
    }
  }

  export function getFloatMinMaxSafeIntegerRange(
    primitive: EPrimitive
  ): [bigint, bigint] {
    // Constants derived from IEEE 754 standard:
    // f32 (Single Precision): 23 fraction bits + 1 hidden bit = 24 effective mantissa bits
    const F32_SAFE_BITS = 24;
    // f64 (Double Precision): 52 fraction bits + 1 hidden bit = 53 effective mantissa bits
    const F64_SAFE_BITS = 53;

    switch (primitive) {
      case EPrimitive.f32: {
        // The maximum safe integer is 2^24.
        const maxSafe = 2n ** BigInt(F32_SAFE_BITS);
        // The range is [-maxSafe, +maxSafe].
        return [maxSafe * -1n, maxSafe];
      }
      case EPrimitive.f64:
      case EPrimitive.real: {
        // The maximum safe integer is 2^53.
        const maxSafe = 2n ** BigInt(F64_SAFE_BITS);
        // The range is [-maxSafe, +maxSafe].
        return [maxSafe * -1n, maxSafe];
      }
      default:
        assert(
          false,
          `Unknown primitive type: ${primitiveToString(primitive)}`
        );
    }
  }

  export function prettyRanges(
    ranges: ValueRange[],
    primitive: EPrimitive,
    mode: "float" | "integer"
  ): string {
    if (ranges.length > 0) {
      return ranges
        .map((r) => prettyRange(r.min, r.max, primitive, mode))
        .join(" u ");
    }
    return "()";
  }

  export function prettyRange(
    min: bigint | undefined,
    max: bigint | undefined,
    primitive: EPrimitive,
    mode: "float" | "integer"
  ): string {
    let minStr: string;
    let maxStr: string;

    // check if min matches exact type min
    let minSymbol = "[";
    minStr = (() => {
      if (min === undefined) {
        minSymbol = "(";
        return "-∞";
      }
      if (primitive) {
        if (mode === "integer") {
          const typeLimits = getIntegerMinMax(primitive);
          switch (primitive) {
            case EPrimitive.i32:
              return min === typeLimits[0] ? "-2^31" : min.toString();
            case EPrimitive.u32:
              return min === typeLimits[0] ? "0" : min.toString();
            case EPrimitive.i64:
            case EPrimitive.int:
              return min === typeLimits[0] ? "-2^63" : min.toString();
            case EPrimitive.u64:
            case EPrimitive.usize:
              return min === typeLimits[0] ? "0" : min.toString();
            default:
              return min.toString();
          }
        }
        const typeLimits = getFloatMinMaxSafeIntegerRange(primitive);
        switch (primitive) {
          case EPrimitive.real:
          case EPrimitive.f64:
            return min === typeLimits[0] ? "-2^53" : min.toString();
          case EPrimitive.f32:
            return min === typeLimits[0] ? "-2^24" : min.toString();
          default:
            assert(false);
        }
      }
      return min.toString();
    })();

    // check if max matches exact type max
    let maxSymbol = "]";
    maxStr = (() => {
      if (max === undefined) {
        maxSymbol = ")";
        return "+∞";
      }
      if (primitive) {
        if (mode === "integer") {
          const typeLimits = getIntegerMinMax(primitive);
          switch (primitive) {
            case EPrimitive.i32:
              return max === typeLimits[1] ? "2^31-1" : max.toString();
            case EPrimitive.u32:
              return max === typeLimits[1] ? "2^32-1" : max.toString();
            case EPrimitive.i64:
            case EPrimitive.int:
              return max === typeLimits[1] ? "2^63-1" : max.toString();
            case EPrimitive.u64:
            case EPrimitive.usize:
              return max === typeLimits[1] ? "2^64-1" : max.toString();
            default:
              return max.toString();
          }
        }
        const typeLimits = getFloatMinMaxSafeIntegerRange(primitive);
        switch (primitive) {
          case EPrimitive.f64:
          case EPrimitive.real:
            return max === typeLimits[1] ? "2^53" : max.toString();
          case EPrimitive.f32:
            return max === typeLimits[1] ? "2^24" : max.toString();
          default:
            assert(false);
        }
      }
      return max.toString();
    })();

    return `${minSymbol}${minStr}, ${maxStr}${maxSymbol}`;
  }

  export function isString(
    sr: Semantic.Context,
    typeId: Semantic.TypeDefId
  ): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) {
      return false;
    }
    return (
      type.primitive === EPrimitive.str ||
      type.primitive === EPrimitive.cstr ||
      type.primitive === EPrimitive.ccstr
    );
  }

  export function isStruct(
    sr: Semantic.Context,
    typeId: Semantic.TypeDefId
  ): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant !== Semantic.ENode.StructDatatype) {
      return false;
    }
    return true;
  }

  export function isF32(
    sr: Semantic.Context,
    typeId: Semantic.TypeDefId
  ): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) {
      return false;
    }
    return type.primitive === EPrimitive.f32;
  }

  export function isF64(
    sr: Semantic.Context,
    typeId: Semantic.TypeDefId
  ): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) {
      return false;
    }
    return type.primitive === EPrimitive.f64;
  }

  export function isReal(
    sr: Semantic.Context,
    typeId: Semantic.TypeDefId
  ): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) {
      return false;
    }
    return type.primitive === EPrimitive.real;
  }

  export function isFloat(
    sr: Semantic.Context,
    typeId: Semantic.TypeDefId
  ): boolean {
    return isF32(sr, typeId) || isF64(sr, typeId) || isReal(sr, typeId);
  }

  export function isBoolean(
    sr: Semantic.Context,
    typeId: Semantic.TypeDefId
  ): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) {
      return false;
    }
    return type.primitive === EPrimitive.bool;
  }

  export function isStr(
    sr: Semantic.Context,
    typeId: Semantic.TypeDefId
  ): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) {
      return false;
    }
    return type.primitive === EPrimitive.str;
  }

  export function isInteger(primitive: EPrimitive): boolean {
    return isSignedInteger(primitive) || isUnsignedInteger(primitive);
  }

  export function isIntegerById(
    sr: Semantic.Context,
    typeId: Semantic.TypeDefId
  ): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) {
      return false;
    }
    return isInteger(type.primitive);
  }

  export function isNoneById(
    sr: Semantic.Context,
    typeUseId: Semantic.TypeUseId
  ): boolean {
    const type = sr.typeDefNodes.get(sr.typeUseNodes.get(typeUseId).type);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) {
      return false;
    }
    return type.primitive === EPrimitive.none;
  }

  export function isVoidById(
    sr: Semantic.Context,
    typeUseId: Semantic.TypeUseId
  ): boolean {
    const type = sr.typeDefNodes.get(sr.typeUseNodes.get(typeUseId).type);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) {
      return false;
    }
    return type.primitive === EPrimitive.void;
  }

  export function isNodiscardById(
    sr: Semantic.Context,
    typeId: Semantic.TypeDefId
  ): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant === Semantic.ENode.TaggedUnionDatatype) {
      return type.nodiscard;
    }
    return false;
  }

  export function getIntegerBits(primitive: EPrimitive): number {
    switch (primitive) {
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
      case EPrimitive.usize:
      case EPrimitive.int:
        return 64;
      default:
        break;
    }
    throw new InternalError("Requested getIntegerBits from a non-integer");
  }

  // export function IsStructurallyEquivalent(
  //   sr: Semantic.Context,
  //   a: Semantic.TypeDefId,
  //   b: Semantic.TypeDefId,
  //   seen: Map<Semantic.TypeDefId, Set<Semantic.TypeDefId>> = new Map(),
  // ): boolean {
  //   // Symmetric check: has this pair already been seen?
  //   if (seen.get(a)?.has(b) || seen.get(b)?.has(a)) {
  //     return true;
  //   }

  //   // Mark pair as seen
  //   if (!seen.has(a)) seen.set(a, new Set());
  //   seen.get(a)!.add(b);

  //   if (!sr.typeDefNodes.get(a).concrete || !sr.typeDefNodes.get(b).concrete) {
  //     throw new InternalError(
  //       "Cannot check structural equivalence of a non-concrete datatype",
  //       undefined,
  //       1,
  //     );
  //   }

  //   const at = sr.typeDefNodes.get(a);
  //   const bt = sr.typeDefNodes.get(b);

  //   if (at.variant !== bt.variant) {
  //     return false;
  //   }
  //   switch (at.variant) {
  //     case Semantic.ENode.PrimitiveDatatype:
  //       assert(bt.variant === Semantic.ENode.PrimitiveDatatype);
  //       return at.primitive === bt.primitive;

  //     case Semantic.ENode.FixedArrayDatatype: {
  //       assert(bt.variant === Semantic.ENode.FixedArrayDatatype);
  //       const a = sr.typeUseNodes.get(at.datatype);
  //       const b = sr.typeUseNodes.get(bt.datatype);
  //       return IsStructurallyEquivalent(sr, a.type, b.type, seen) && at.length === bt.length;
  //     }

  //     case Semantic.ENode.DynamicArrayDatatype: {
  //       assert(bt.variant === Semantic.ENode.DynamicArrayDatatype);
  //       const a = sr.typeUseNodes.get(at.datatype);
  //       const b = sr.typeUseNodes.get(bt.datatype);
  //       return IsStructurallyEquivalent(sr, a.type, b.type, seen);
  //     }

  //     case Semantic.ENode.FunctionDatatype: {
  //       assert(bt.variant === Semantic.ENode.FunctionDatatype);
  //       const aa = sr.typeUseNodes.get(at.returnType);
  //       const bb = sr.typeUseNodes.get(bt.returnType);
  //       return (
  //         at.vararg === bt.vararg &&
  //         IsStructurallyEquivalent(sr, aa.type, bb.type, seen) &&
  //         at.parameters.length === bt.parameters.length &&
  //         at.parameters.every((p, index) =>
  //           IsStructurallyEquivalent(
  //             sr,
  //             sr.typeUseNodes.get(p.type).type,
  //             sr.typeUseNodes.get(bt.parameters[index].type).type,
  //             seen,
  //           ),
  //         )
  //       );
  //     }

  //     case Semantic.ENode.UntaggedUnionDatatype: {
  //       assert(bt.variant === Semantic.ENode.UntaggedUnionDatatype);
  //       if (
  //         at.members.length === bt.members.length &&
  //         at.members.every((a, i) => a === bt.members[i])
  //       )
  //         return true;
  //       return false;
  //     }

  //     case Semantic.ENode.TaggedUnionDatatype: {
  //       assert(bt.variant === Semantic.ENode.TaggedUnionDatatype);
  //       if (
  //         at.members.length === bt.members.length &&
  //         at.members.every((a, i) => a.tag === bt.members[i].tag && a.type === bt.members[i].type)
  //       )
  //         return true;
  //       return false;
  //     }

  //     case Semantic.ENode.CallableDatatype: {
  //       assert(bt.variant === Semantic.ENode.CallableDatatype);
  //       if (Boolean(at.thisExprType) !== Boolean(bt.thisExprType)) return false;
  //       if (
  //         at.thisExprType &&
  //         bt.thisExprType &&
  //         IsStructurallyEquivalent(
  //           sr,
  //           sr.typeUseNodes.get(at.thisExprType).type,
  //           sr.typeUseNodes.get(bt.thisExprType).type,
  //           seen,
  //         )
  //       )
  //         return false;
  //       return IsStructurallyEquivalent(sr, at.functionType, bt.functionType, seen);
  //     }

  //     case Semantic.ENode.GenericParameterDatatype: {
  //       throw new InternalError("Cannot check structural equivalence of a generic parameter");
  //     }

  //     case Semantic.ENode.StructDatatype: {
  //       assert(bt.variant === Semantic.ENode.StructDatatype);
  //       if (at.generics.length !== bt.generics.length) {
  //         return false;
  //       }

  //       for (let i = 0; i < at.generics.length; i++) {
  //         if (
  //           !IsStructurallyEquivalent(
  //             sr,
  //             sr.typeUseNodes.get(sr.exprNodes.get(at.generics[i]).type).type,
  //             sr.typeUseNodes.get(sr.exprNodes.get(bt.generics[i]).type).type,
  //             seen,
  //           )
  //         )
  //           return false;
  //       }

  //       if (at.members.length !== bt.members.length) {
  //         return false;
  //       }

  //       // All members are unique
  //       const remainingMembersA = [
  //         ...new Set(
  //           at.members.map((mId) => {
  //             const m = sr.symbolNodes.get(mId);
  //             assert(m.variant === Semantic.ENode.VariableSymbol);
  //             return m.name;
  //           }),
  //         ),
  //       ];
  //       assert(remainingMembersA.length === at.members.length);
  //       let remainingMembersB = [
  //         ...new Set(
  //           bt.members.map((mId) => {
  //             const m = sr.symbolNodes.get(mId);
  //             assert(m.variant === Semantic.ENode.VariableSymbol);
  //             return m.name;
  //           }),
  //         ),
  //       ];
  //       assert(remainingMembersB.length === bt.members.length);

  //       // All members are unique and the same count. So if all members from A are in B, the inverse must also be true.

  //       for (const m of remainingMembersA) {
  //         if (!remainingMembersB.includes(m)) {
  //           return false; // Member from A is not available in B
  //         }
  //         remainingMembersB = remainingMembersB.filter((k) => k !== m);

  //         const amId = at.members.find((mmId) => {
  //           const mm = sr.symbolNodes.get(mmId);
  //           assert(mm.variant === Semantic.ENode.VariableSymbol);
  //           return mm.name;
  //         });
  //         const bmId = bt.members.find((mmId) => {
  //           const mm = sr.symbolNodes.get(mmId);
  //           assert(mm.variant === Semantic.ENode.VariableSymbol);
  //           return mm.name;
  //         });
  //         assert(amId && bmId);
  //         const am = sr.symbolNodes.get(amId);
  //         const bm = sr.symbolNodes.get(bmId);
  //         assert(am.variant === Semantic.ENode.VariableSymbol);
  //         assert(bm.variant === Semantic.ENode.VariableSymbol);
  //         assert(am.type && bm.type);
  //         if (
  //           !IsStructurallyEquivalent(
  //             sr,
  //             sr.typeUseNodes.get(am.type).type,
  //             sr.typeUseNodes.get(bm.type).type,
  //             seen,
  //           )
  //         ) {
  //           return false;
  //         }
  //       }

  //       return true;
  //     }

  //     default:
  //       assert(false, "All cases handled: " + Semantic.ENode[at.variant]);
  //   }
  // }

  type ValueRange = {
    max: bigint | undefined;
    min: bigint | undefined;
  };

  function valueNarrowing(sr: Semantic.Context) {
    const values = {
      ranges: [] as ValueRange[],
      normalize: () => {
        if (values.ranges.length === 0) {
          return [];
        }

        values.ranges.sort((a, b) => {
          if (a.min === undefined) {
            return -1;
          }
          if (b.min === undefined) {
            return 1;
          }
          if (a.min < b.min) {
            return -1;
          }
          if (a.min > b.min) {
            return 1;
          }
          return 0;
        });

        const result: ValueRange[] = [];
        let current = { ...values.ranges[0] };

        for (let i = 1; i < values.ranges.length; i++) {
          const next = values.ranges[i];

          if (
            next.min !== undefined &&
            next.max !== undefined &&
            next.min > next.max
          ) {
            continue;
          }

          if (
            current.max === undefined || // current goes to +∞
            next.min === undefined || // next starts at -∞
            current.max + 1n >= (next.min ?? current.max) // overlap or adjacent
          ) {
            if (current.max === undefined || next.max === undefined) {
              current.max = undefined;
            } else {
              current.max = current.max > next.max ? current.max : next.max;
            }
          } else {
            result.push(current);
            current = { ...next };
          }
        }
        result.push({ ...current });
        values.ranges = result;
        return values;
      },
      addRange: (min: bigint | undefined, max: bigint | undefined) => {
        if (min !== undefined && max !== undefined && min > max) {
          return [];
        }
        values.ranges.push({
          max: max,
          min: min,
        });
        return values.normalize();
      },
      intersect: (a: ValueRange, b: ValueRange): ValueRange | null => {
        let min: bigint | undefined;
        if (a.min === undefined) {
          min = b.min;
        } else if (b.min === undefined) {
          min = a.min;
        } else {
          min = a.min > b.min ? a.min : b.min;
        }

        let max: bigint | undefined;
        if (a.max === undefined) {
          max = b.max;
        } else if (b.max === undefined) {
          max = a.max;
        } else {
          max = a.max < b.max ? a.max : b.max;
        }
        if (min !== undefined && max !== undefined && min > max) {
          return null;
        }
        return { min: min, max: max };
      },
      constrainMin: (v: bigint) => {
        if (values.ranges.length === 0) {
          values.addRange(v, undefined);
          return;
        }
        values.ranges = values.ranges
          .map((r) => values.intersect(r, { min: v, max: undefined }))
          .filter((r): r is ValueRange => r !== null);
        return values.normalize();
      },
      constrainMax: (v: bigint) => {
        if (values.ranges.length === 0) {
          values.addRange(undefined, v);
          return;
        }
        values.ranges = values.ranges
          .map((r) => values.intersect(r, { min: undefined, max: v }))
          .filter((r): r is ValueRange => r !== null);
        return values.normalize();
      },
      constrainEq: (v: bigint) => {
        if (values.ranges.length === 0) {
          values.addRange(v, v);
          return;
        }
        values.ranges = values.ranges
          .map((r) => values.intersect(r, { min: v, max: v }))
          .filter((r): r is ValueRange => r !== null);
        return values.normalize();
      },
      constrainNe: (v: bigint) => {
        const out: ValueRange[] = [];
        for (const r of values.ranges) {
          // left part
          if (r.min === undefined || r.min <= v - 1n) {
            const max = r.max !== undefined && r.max < v ? r.max : v - 1n;
            if (r.min === undefined || max >= r.min) {
              out.push({ min: r.min, max: max });
            }
          }
          // right part
          if (r.max === undefined || r.max >= v + 1n) {
            const min = r.min !== undefined && r.min > v ? r.min : v + 1n;
            if (r.max === undefined || min <= r.max) {
              out.push({ min: min, max: r.max });
            }
          }
        }
        values.ranges = out;
        return values.normalize();
      },
      isExact: (): bigint | null => {
        if (values.ranges.length !== 1) {
          return null;
        }
        const r = values.ranges[0];
        if (r.min !== undefined && r.max !== undefined && r.min === r.max) {
          return r.min;
        }
        return null;
      },
      canHaveValue: (v: bigint): boolean => {
        for (const r of values.ranges) {
          if (
            (r.min === undefined || v >= r.min) &&
            (r.max === undefined || v <= r.max)
          ) {
            return true;
          }
        }
        return false;
      },
      isWithinRange: (min: bigint, max: bigint): boolean => {
        for (const r of values.ranges) {
          if (r.min !== undefined && r.min < min) {
            return false;
          }
          if (r.max !== undefined && r.max > max) {
            return false;
          }
          if (r.min === undefined || r.max === undefined) {
            return false;
          }
        }
        return values.ranges.length > 0;
      },
      constrainFromConstraints: (
        constraints: ConstraintSet,
        fromExprId: Semantic.ExprId
      ) => {
        const path = extractConstraintPath(sr, fromExprId);
        if (path) {
          const pathConstraints = constraints.getPathConstraint(path);
          if (pathConstraints.length > 0) {
            for (const c of pathConstraints) {
              values.constrainFromConstraint(c);
            }
            return;
          }
        }
        const fromExpr = sr.exprNodes.get(fromExprId);
        for (const constraint of constraints.toArray()) {
          if (fromExpr.variant !== Semantic.ENode.SymbolValueExpr) {
            continue;
          }
          if (constraint.variableSymbol !== fromExpr.symbol) {
            continue;
          }
          values.constrainFromConstraint(constraint.constraintValue);
        }
      },
      constrainFromConstraint: (constraintValue: ConstraintValue) => {
        if (constraintValue.kind === "comparison") {
          const valueExpr = sr.exprNodes.get(constraintValue.value);
          if (
            valueExpr.variant === Semantic.ENode.LiteralExpr &&
            valueExpr.literal.type !== EPrimitive.null &&
            (valueExpr.literal.type === EPrimitive.u8 ||
              valueExpr.literal.type === EPrimitive.u16 ||
              valueExpr.literal.type === EPrimitive.u32 ||
              valueExpr.literal.type === EPrimitive.u64 ||
              valueExpr.literal.type === EPrimitive.usize ||
              valueExpr.literal.type === EPrimitive.i8 ||
              valueExpr.literal.type === EPrimitive.i16 ||
              valueExpr.literal.type === EPrimitive.i32 ||
              valueExpr.literal.type === EPrimitive.i64 ||
              valueExpr.literal.type === EPrimitive.int)
          ) {
            const value = valueExpr.literal.value;
            if (constraintValue.operation === EBinaryOperation.GreaterEqual) {
              values.constrainMin(value);
            }
            if (constraintValue.operation === EBinaryOperation.GreaterThan) {
              values.constrainMin(value + 1n);
            }
            if (constraintValue.operation === EBinaryOperation.LessEqual) {
              values.constrainMax(value);
            }
            if (constraintValue.operation === EBinaryOperation.LessThan) {
              values.constrainMax(value - 1n);
            }
            if (constraintValue.operation === EBinaryOperation.Equal) {
              values.constrainEq(value);
            }
            if (constraintValue.operation === EBinaryOperation.NotEqual) {
              values.constrainNe(value);
            }
          }
        }
      },
      constrainExactFromExprIfPossible: (fromExprId: Semantic.ExprId) => {
        const fromExpr = sr.exprNodes.get(fromExprId);
        function applyLiteral(literal: Semantic.ExprId) {
          const value = sr.exprNodes.get(literal);
          assert(value.variant === Semantic.ENode.LiteralExpr);
          assert(
            value.literal.type === EPrimitive.u8 ||
              value.literal.type === EPrimitive.u16 ||
              value.literal.type === EPrimitive.u32 ||
              value.literal.type === EPrimitive.u64 ||
              value.literal.type === EPrimitive.usize ||
              value.literal.type === EPrimitive.i8 ||
              value.literal.type === EPrimitive.i16 ||
              value.literal.type === EPrimitive.i32 ||
              value.literal.type === EPrimitive.i64 ||
              value.literal.type === EPrimitive.int
          );
          values.constrainEq(value.literal.value);
        }

        if (fromExpr.variant === Semantic.ENode.LiteralExpr) {
          applyLiteral(fromExprId);
        } else if (fromExpr.variant === Semantic.ENode.SymbolValueExpr) {
          const symbol = sr.symbolNodes.get(fromExpr.symbol);
          assert(symbol.variant === Semantic.ENode.VariableSymbol);
          if (symbol.comptime && symbol.comptimeValue) {
            applyLiteral(symbol.comptimeValue);
          }
        } else if (fromExpr.variant === Semantic.ENode.ExplicitCastExpr) {
          values.constrainExactFromExprIfPossible(fromExpr.expr);
        }
      },
    };

    return values;
  }

  export function typeNarrowing(sr: Semantic.Context) {
    return {
      possibleVariants: new Set<Semantic.TypeUseId>(),

      addVariants: function (members: Semantic.TypeUseId[]) {
        for (const m of members) {
          this.possibleVariants.add(m);
        }
      },

      constrainFromConstraints: function (
        constraints: ConstraintSet,
        fromExprId: Semantic.ExprId
      ) {
        const fromExpr = sr.exprNodes.get(fromExprId);
        if (fromExpr.variant === Semantic.ENode.SymbolValueExpr) {
          for (const c of constraints.toArray()) {
            if (c.variableSymbol !== fromExpr.symbol) {
              continue;
            }
            this.constrainFromConstraint(c.constraintValue);
          }
        }

        if (fromExpr.variant === Semantic.ENode.ReactiveReadExpr) {
          const inner = sr.exprNodes.get(fromExpr.value);
          if (inner.variant === Semantic.ENode.SymbolValueExpr) {
            const path: ConstraintPath = {
              root: { kind: "symbol", symbolId: inner.symbol },
              path: [],
            };
            const constraintsForPath = constraints.getPathConstraint(path);
            for (const c of constraintsForPath) {
              this.constrainFromConstraint(c);
            }
            return;
          }
        }

        const path = extractConstraintPath(sr, fromExprId);
        if (path) {
          const constraintsForPath = constraints.getPathConstraint(path);
          if (constraintsForPath.length > 0) {
            for (const c of constraintsForPath) {
              this.constrainFromConstraint(c);
            }
            return;
          }
        }
      },

      constrainFromConstraint: function (cv: ConstraintValue) {
        if (cv.kind === "union") {
          if (cv.operation === "is") {
            // Keep only this variant
            const oldMembers = new Set(this.possibleVariants);
            if (cv.typeUse || cv.typeDef) {
              this.possibleVariants.clear();
            }

            if (cv.typeUse) {
              this.possibleVariants.add(cv.typeUse);
            }
            if (cv.typeDef) {
              oldMembers.forEach((m) => {
                const typeDef = sr.typeUseNodes.get(m).type;
                if (typeDef === cv.typeDef) {
                  this.possibleVariants.add(m);
                }
              });
            }
          } else if (cv.operation === "isNot") {
            // Exclude this variant
            if (cv.typeUse) {
              this.possibleVariants.delete(cv.typeUse);
            }
            if (cv.typeDef) {
              const remove = new Set<Semantic.TypeUseId>();
              this.possibleVariants.forEach((m) => {
                const typeDef = sr.typeUseNodes.get(m).type;
                if (typeDef === cv.typeDef) {
                  remove.add(m);
                }
              });
              for (const r of remove) {
                this.possibleVariants.delete(r);
              }
            }
          }
        }
      },
    };
  }

  export enum Mode {
    Implicit = 0,
    Explicit = 1,
  }

  export function MakeConversionOrThrow(
    sr: Semantic.Context,
    fromExprId: Semantic.ExprId,
    toId: Semantic.TypeUseId,
    constraints: ConstraintSet,
    sourceloc: SourceLoc,
    mode: Mode,
    unsafe: boolean
  ) {
    const c = MakeConversion(
      sr,
      fromExprId,
      toId,
      constraints,
      sourceloc,
      mode,
      unsafe
    );
    if (c.ok) {
      return c.expr;
    }
    throw new CompilerError(c.error, sourceloc, 4001);
  }

  type ConversionPlanSuccess =
    | {
        kind: "keep";
      }
    | {
        kind: "produce-literal";
        literalValue: LiteralValue;
      }
    | {
        kind: "basic-c-cast";
        integerNarrowingRange?: { min: bigint; max: bigint };
      }
    | {
        kind: "reactive-read";
      }
    | {
        kind: "computed-read";
      }
    | {
        kind: "reactive-read-to-union";
        index: number;
        memberTypeUseId: Semantic.TypeUseId;
      }
    | {
        kind: "computed-read-to-union";
        index: number;
        memberTypeUseId: Semantic.TypeUseId;
      }
    | {
        kind: "union-to-value";
        tag: number;
      }
    | {
        kind: "value-to-union";
        index: number;
      }
    | {
        kind: "union-to-union";
      }
    | {
        kind: "union-tag-check";
        comparisonTypesAnd: Semantic.TypeUseId[];
        invertCheck: boolean;
      }
    | {
        kind: "clone-struct-to-target-type";
      }
    | {
        kind: "construct-via-constructor";
        unsafe: boolean;
      };

  type ConversionPlanError = {
    kind: "error";
    message: string;
  };

  type ConversionPlan = ConversionPlanSuccess | ConversionPlanError;

  function checkFunctionDatatypeCompatibility(
    sr: Semantic.Context,
    resolvedSourceTypeDef: Semantic.FunctionDatatypeDef,
    sourceTypeText: string,
    resolvedTargetTypeDef: Semantic.FunctionDatatypeDef,
    targetTypeText: string
  ): ConversionPlan | "success" {
    if (!resolvedTargetTypeDef.requires.final) {
      return {
        kind: "error",
        message:
          "Cannot use a non-final function datatype as a conversion target",
      };
    }

    if (!resolvedSourceTypeDef.requires.final) {
      return {
        kind: "error",
        message:
          "Cannot convert a non-final function datatype, that is not fully elaborated yet. Remember to manually mark functions as final if they are extern or participate in recursion.",
      };
    }

    assert(resolvedSourceTypeDef.concrete && resolvedTargetTypeDef.concrete);

    if (
      resolvedSourceTypeDef.parameters.length !==
      resolvedTargetTypeDef.parameters.length
    ) {
      return {
        kind: "error",
        message: `Value of type ${sourceTypeText} cannot be used as type ${targetTypeText}, because the number of parameters does not match`,
      };
    }

    assert(
      resolvedSourceTypeDef.parameters.length ===
        resolvedTargetTypeDef.parameters.length
    );
    const paramsMatch = resolvedSourceTypeDef.parameters.map(
      (p, i) =>
        sr.e.resolveAlias(resolvedTargetTypeDef.parameters[i].type) ===
        sr.e.resolveAlias(p.type)
    );
    if (paramsMatch.some((m) => !m)) {
      const nonmatchingParameters: string[] = [];
      for (let i = 0; i < paramsMatch.length; i++) {
        if (!paramsMatch[i]) {
          nonmatchingParameters.push(`#${i}`);
        }
      }
      return {
        kind: "error",
        message: `Value of type ${sourceTypeText} cannot be used as type ${targetTypeText}, because the parameters ${nonmatchingParameters.join(", ")} are not compatible`,
      };
    }

    if (
      sr.e.resolveAlias(resolvedSourceTypeDef.returnType) !==
      sr.e.resolveAlias(resolvedTargetTypeDef.returnType)
    ) {
      return {
        kind: "error",
        message: `Value of type ${sourceTypeText} cannot be used as type ${targetTypeText}, because the return types do not match`,
      };
    }

    if (
      resolvedSourceTypeDef.requires.noreturnIf !==
      resolvedTargetTypeDef.requires.noreturnIf
    ) {
      return {
        kind: "error",
        message: `Value of type ${sourceTypeText} cannot be used as type ${targetTypeText}, because the functions have different noreturn_if requirements`,
      };
    }

    if (
      resolvedSourceTypeDef.requires.noreturn !==
      resolvedTargetTypeDef.requires.noreturn
    ) {
      return {
        kind: "error",
        message: `Value of type ${sourceTypeText} cannot be used as type ${targetTypeText}, because the functions have different noreturn requirements`,
      };
    }

    if (resolvedSourceTypeDef.vararg !== resolvedTargetTypeDef.vararg) {
      return {
        kind: "error",
        message: `Value of type ${sourceTypeText} cannot be used as type ${targetTypeText}, because the functions have different variadic argument requirements`,
      };
    }

    if (
      !resolvedSourceTypeDef.requires.pure &&
      resolvedTargetTypeDef.requires.pure
    ) {
      return {
        kind: "error",
        message:
          "Passing an impure function to a value that requires it to be pure. This is not safe as the caller may assume no side effects which the given function could have.",
      };
    }

    return "success";
  }

  function buildConversionPlan(
    sr: Semantic.Context,
    sourceExprId: Semantic.ExprId,
    rawTargetTypeUseId: Semantic.TypeUseId,
    constraints: ConstraintSet,
    _sourceloc: SourceLoc,
    mode: Mode,
    unsafe: boolean
  ): ConversionPlan {
    // WARNING: It is very important that the types are canonicalized here!!! (Resolving aliases)
    // In order to make aliases comparable.
    // All of those types are already fully resolved. They all must be used for type checking, BUT they cannot be
    // used for anything else, they CANNOT be returned, because otherwise later code will use the incorrect alias
    // values.
    const sourceExpr = sr.exprNodes.get(sourceExprId);
    const resolvedSourceTypeUseId = sr.e.resolveAlias(sourceExpr.type);
    const resolvedSourceTypeUse = sr.typeUseNodes.get(resolvedSourceTypeUseId);
    const resolvedSourceTypeDefId = resolvedSourceTypeUse.type;
    const resolvedSourceTypeDef = sr.typeDefNodes.get(resolvedSourceTypeDefId);
    const resolvedTargetTypeUseId = sr.e.resolveAlias(rawTargetTypeUseId);
    const resolvedTargetTypeUse = sr.typeUseNodes.get(resolvedTargetTypeUseId);
    const resolvedTargetTypeDefId = resolvedTargetTypeUse.type;
    const resolvedTargetTypeDef = sr.typeDefNodes.get(resolvedTargetTypeDefId);
    const sourceTypeText = Semantic.serializeTypeUseWithAliasAKA(
      sr,
      sourceExpr.type
    );
    const targetTypeText = Semantic.serializeTypeUseWithAliasAKA(
      sr,
      rawTargetTypeUseId
    );

    // naive return, it's the same type so just remove the cast
    if (resolvedSourceTypeUseId === resolvedTargetTypeUseId) {
      return { kind: "keep" };
    }

    // Computed<Alias<T>> → Computed<T>: the identity check above fails when the
    // wrapped types differ only by alias, so resolve inner aliases explicitly.
    if (
      resolvedSourceTypeDef.variant === Semantic.ENode.ComputedDatatype &&
      resolvedTargetTypeDef.variant === Semantic.ENode.ComputedDatatype &&
      sr.e.resolveAlias(resolvedSourceTypeDef.wrappedType) ===
        sr.e.resolveAlias(resolvedTargetTypeDef.wrappedType)
    ) {
      return { kind: "keep" };
    }

    // Conversion from LiteralDatatype to PrimitiveDatatype
    // When a literal type like "hello" (LiteralDatatype) needs to become str (PrimitiveDatatype)
    if (
      resolvedSourceTypeDef.variant === Semantic.ENode.LiteralDatatype &&
      resolvedTargetTypeDef.variant === Semantic.ENode.PrimitiveDatatype
    ) {
      if (
        resolvedSourceTypeDef.literalValue.type ===
        resolvedTargetTypeDef.primitive
      ) {
        return {
          kind: "produce-literal",
          literalValue: resolvedSourceTypeDef.literalValue,
        };
      }
      // Handle conversion from string literal to cstr/ccstr
      if (
        resolvedSourceTypeDef.literalValue.type === EPrimitive.str &&
        (resolvedTargetTypeDef.primitive === EPrimitive.cstr ||
          resolvedTargetTypeDef.primitive === EPrimitive.ccstr)
      ) {
        return {
          kind: "produce-literal",
          literalValue: {
            type: resolvedTargetTypeDef.primitive,
            prefix: null,
            value: resolvedSourceTypeDef.literalValue.value,
          },
        };
      }
    }

    // Conversion from str to cstr
    if (
      resolvedSourceTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
      resolvedTargetTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
      resolvedSourceTypeDef.primitive === EPrimitive.str &&
      (resolvedTargetTypeDef.primitive === EPrimitive.cstr ||
        resolvedTargetTypeDef.primitive === EPrimitive.ccstr)
    ) {
      if (sourceExpr.variant === Semantic.ENode.LiteralExpr) {
        assert(sourceExpr.literal.type === EPrimitive.str);
        return {
          kind: "produce-literal",
          literalValue: {
            type: resolvedTargetTypeDef.primitive,
            prefix: null,
            value: sourceExpr.literal.value,
          },
        };
      }
      return {
        kind: "error",
        message:
          "Conversion from str to cstr/ccstr (char*/const char*) is not possible because the value is not known at compile time, therefore no C string literal can be emitted that preserves null termination. Either make sure the value is known at compile time, or use 'str.cstr(arena)' to clone the string at runtime.",
      };
    }

    // Conversion between inline/non-inline structs of the same type
    // Since a copy always happens, mutability doesn't matter
    if (
      resolvedSourceTypeDef.variant === Semantic.ENode.StructDatatype &&
      resolvedTargetTypeDef.variant === Semantic.ENode.StructDatatype &&
      resolvedSourceTypeUse.type === resolvedTargetTypeUse.type &&
      resolvedSourceTypeUse.inline !== resolvedTargetTypeUse.inline
    ) {
      return {
        kind: "clone-struct-to-target-type",
      };
    }

    // Conversion from T[N] to T[]
    // if (
    //   resolvedSourceTypeDef.variant === Semantic.ENode.ArrayDatatype &&
    //   resolvedTargetTypeDef.variant === Semantic.ENode.SliceDatatype &&
    //   resolvedSourceTypeDef.datatype === resolvedTargetTypeDef.datatype
    // ) {
    //   return Semantic.addNode(sr, {
    //     variant:
    //   })
    // }

    // From none to cptr (represents nullptr)
    if (
      resolvedSourceTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
      resolvedSourceTypeDef.primitive === EPrimitive.none &&
      resolvedTargetTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
      resolvedTargetTypeDef.primitive === EPrimitive.cptr
    ) {
      return {
        kind: "basic-c-cast",
      };
    }

    // From object reference to cptr
    if (
      resolvedSourceTypeDef.variant === Semantic.ENode.StructDatatype &&
      !resolvedSourceTypeUse.inline &&
      resolvedTargetTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
      resolvedTargetTypeDef.primitive === EPrimitive.cptr
    ) {
      return {
        kind: "basic-c-cast",
      };
    }

    // Function conversions
    if (
      resolvedSourceTypeDef.variant === Semantic.ENode.FunctionDatatype &&
      resolvedTargetTypeDef.variant === Semantic.ENode.FunctionDatatype
    ) {
      const result = checkFunctionDatatypeCompatibility(
        sr,
        resolvedSourceTypeDef,
        sourceTypeText,
        resolvedTargetTypeDef,
        targetTypeText
      );
      if (result === "success") {
        return {
          kind: "basic-c-cast",
        };
      } else {
        return result;
      }
    }

    // Conversion between Integers
    if (
      Conversion.isIntegerById(sr, resolvedSourceTypeUse.type) &&
      Conversion.isIntegerById(sr, resolvedTargetTypeUse.type)
    ) {
      const fi = sr.typeUseNodes.get(sourceExpr.type);
      const f = sr.typeDefNodes.get(fi.type);
      assert(f.variant === Semantic.ENode.PrimitiveDatatype);
      const ti = sr.typeUseNodes.get(resolvedTargetTypeUseId);
      const t = sr.typeDefNodes.get(ti.type);
      assert(t.variant === Semantic.ENode.PrimitiveDatatype);
      const fromSigned = Conversion.isSignedInteger(f.primitive);
      const toSigned = Conversion.isSignedInteger(t.primitive);
      const fromBits = Conversion.getIntegerBits(f.primitive);
      const toBits = Conversion.getIntegerBits(t.primitive);

      if (fromSigned === toSigned && toBits >= fromBits) {
        // Totally safe
        return {
          kind: "basic-c-cast",
        };
      }
      const source = valueNarrowing(sr);
      source.addRange(...Conversion.getIntegerMinMax(f.primitive));
      source.constrainExactFromExprIfPossible(sourceExprId);
      source.constrainFromConstraints(constraints, sourceExprId);

      if (source.isWithinRange(...Conversion.getIntegerMinMax(t.primitive))) {
        const [min, max] = Conversion.getIntegerMinMax(t.primitive);
        return {
          kind: "basic-c-cast",
          integerNarrowingRange: { min: min, max: max },
        };
      }

      let sourceRangeText = "";
      if (source.isExact()) {
        sourceRangeText = `value ${source.isExact()!}`;
      } else {
        sourceRangeText = `range ${Conversion.prettyRanges(
          source.ranges,
          f.primitive,
          "integer"
        )}`;
      }

      const targetRangeText = Conversion.prettyRange(
        ...Conversion.getIntegerMinMax(t.primitive),
        t.primitive,
        "integer"
      );

      return {
        kind: "error",
        message: `Cannot implicitly convert ${sourceTypeText} to ${targetTypeText}: the value ${sourceRangeText} does not fit in the target range ${targetRangeText}. Constrain the value first with a conditional or an assertion.`,
      };
    }

    // Trivial Float <-> Float conversions for literals
    if (
      Conversion.isFloat(sr, resolvedSourceTypeUse.type) &&
      Conversion.isFloat(sr, resolvedTargetTypeUse.type)
    ) {
      // If it is a conversion between floats, it is trivially allowed if the value comes directly
      // from a literal, since it would generally not be an issue that precision is lost.
      // E.g. for "let x: f32 = 0.1" it's clear that we just want 0.1 as the closest representation
      // that fits in f32. For "let x: f32 = y", this is not the case and losing precision may be an issue.
      if (sourceExpr.variant === Semantic.ENode.LiteralExpr) {
        return {
          kind: "basic-c-cast",
        };
      }
    }

    // Explicit Integer <-> Float conversion
    if (
      ((Conversion.isFloat(sr, resolvedSourceTypeUse.type) &&
        Conversion.isIntegerById(sr, resolvedTargetTypeUse.type)) ||
        (Conversion.isIntegerById(sr, resolvedSourceTypeUse.type) &&
          Conversion.isFloat(sr, resolvedTargetTypeUse.type))) &&
      mode === Mode.Explicit
    ) {
      return {
        kind: "basic-c-cast",
      };
    }

    // Conversions from Integer to float
    if (
      Conversion.isIntegerById(sr, resolvedSourceTypeUse.type) &&
      Conversion.isFloat(sr, resolvedTargetTypeUse.type)
    ) {
      const fi = sr.typeUseNodes.get(sourceExpr.type);
      const f = sr.typeDefNodes.get(fi.type);
      assert(f.variant === Semantic.ENode.PrimitiveDatatype);
      const ti = sr.typeUseNodes.get(resolvedTargetTypeUseId);
      const t = sr.typeDefNodes.get(ti.type);
      assert(t.variant === Semantic.ENode.PrimitiveDatatype);
      const floatSafeIntegerRange = Conversion.getFloatMinMaxSafeIntegerRange(
        t.primitive
      );

      const source = valueNarrowing(sr);
      source.addRange(...Conversion.getIntegerMinMax(f.primitive));
      source.constrainExactFromExprIfPossible(sourceExprId);
      source.constrainFromConstraints(constraints, sourceExprId);

      if (source.isWithinRange(...floatSafeIntegerRange)) {
        return {
          kind: "basic-c-cast",
        };
      }

      let sourceRangeText = "";
      if (source.isExact()) {
        sourceRangeText = `value ${source.isExact()!}`;
      } else {
        sourceRangeText = `range ${Conversion.prettyRanges(source.ranges, f.primitive, "integer")}`;
      }

      const targetRangeText = Conversion.prettyRange(
        ...floatSafeIntegerRange,
        t.primitive,
        "float"
      );

      return {
        kind: "error",
        message: `Cannot implicitly convert ${sourceTypeText} to ${targetTypeText}: ${targetTypeText} can only exactly represent integers in the range ${targetRangeText}, but the source has ${sourceRangeText}. Constrain the value first with a conditional or assertion, or use an explicit cast ('... as ${targetTypeText}') if precision loss is acceptable.`,
      };
    }

    // From Float to Integer
    if (
      Conversion.isFloat(sr, resolvedSourceTypeUse.type) &&
      Conversion.isIntegerById(sr, resolvedTargetTypeUse.type)
    ) {
      const fi = sr.typeUseNodes.get(sourceExpr.type);
      const f = sr.typeDefNodes.get(fi.type);
      assert(f.variant === Semantic.ENode.PrimitiveDatatype);
      const ti = sr.typeUseNodes.get(resolvedTargetTypeUseId);
      const t = sr.typeDefNodes.get(ti.type);
      assert(t.variant === Semantic.ENode.PrimitiveDatatype);

      return {
        kind: "error",
        message: `Cannot implicitly convert ${sourceTypeText} to ${targetTypeText}: floating-point values may have a fractional part that cannot be represented as an integer. Use an explicit cast ('... as ${targetTypeText}') if truncating toward zero is acceptable.`,
      };
    }

    // Conversions between floats
    if (
      (resolvedSourceTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
        resolvedSourceTypeDef.primitive === EPrimitive.real &&
        resolvedTargetTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
        resolvedTargetTypeDef.primitive === EPrimitive.f64) ||
      (resolvedSourceTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
        resolvedSourceTypeDef.primitive === EPrimitive.f64 &&
        resolvedTargetTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
        resolvedTargetTypeDef.primitive === EPrimitive.real)
    ) {
      return {
        kind: "basic-c-cast",
      };
    }
    if (
      (resolvedSourceTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
        resolvedSourceTypeDef.primitive === EPrimitive.f32 &&
        resolvedTargetTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
        resolvedTargetTypeDef.primitive === EPrimitive.f64) ||
      (resolvedSourceTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
        resolvedSourceTypeDef.primitive === EPrimitive.f32 &&
        resolvedTargetTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
        resolvedTargetTypeDef.primitive === EPrimitive.real)
    ) {
      return {
        kind: "basic-c-cast",
      };
    }

    if (
      (resolvedSourceTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
        resolvedSourceTypeDef.primitive === EPrimitive.real &&
        resolvedTargetTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
        resolvedTargetTypeDef.primitive === EPrimitive.f32) ||
      (resolvedSourceTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
        resolvedSourceTypeDef.primitive === EPrimitive.f64 &&
        resolvedTargetTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
        resolvedTargetTypeDef.primitive === EPrimitive.f32)
    ) {
      if (mode !== Mode.Explicit) {
        return {
          kind: "error",
          message: `Cannot implicitly convert ${sourceTypeText} to ${targetTypeText}: the conversion is narrowing and may lose precision. If precision loss is acceptable, cast explicitly using '... as ${targetTypeText}'.`,
        };
      }
      return {
        kind: "basic-c-cast",
      };
    }

    // Mutability conversions
    if (resolvedSourceTypeUse.type === resolvedTargetTypeUse.type) {
      // Same type but different mutability
      if (resolvedSourceTypeUse.inline === resolvedTargetTypeUse.inline) {
        if (
          resolvedSourceTypeUse.mutability === resolvedTargetTypeUse.mutability
        ) {
          return {
            kind: "basic-c-cast",
          };
        }

        if (
          (resolvedSourceTypeUse.mutability === EDatatypeMutability.Mut ||
            resolvedSourceTypeUse.mutability === EDatatypeMutability.Const) &&
          resolvedTargetTypeUse.mutability === EDatatypeMutability.Default
        ) {
          return {
            kind: "basic-c-cast",
          };
        }

        // If it is a direct literal, allow conversions from anything to const
        if (
          (sourceExpr.variant === Semantic.ENode.StructLiteralExpr ||
            sourceExpr.variant === Semantic.ENode.ArrayLiteralExpr) &&
          resolvedTargetTypeUse.mutability === EDatatypeMutability.Const
        ) {
          return {
            kind: "basic-c-cast",
          };
        }

        if (resolvedTargetTypeUse.mutability === EDatatypeMutability.Const) {
          if (mode === Mode.Explicit && unsafe) {
            return {
              kind: "basic-c-cast",
            };
          }

          return {
            kind: "error",
            message: `This value cannot be converted to 'const' since other references may exist, which may allow mutation of a const value. Use .freezeClone() to safely clone the object and make it deeply immutable.`,
          };
        }
      }
    }

    // Core conversions
    // if (
    //   IsStructurallyEquivalent(
    //     sr,
    //     sr.typeUseNodes.get(sourceExpr.type).type,
    //     sr.typeUseNodes.get(toId).type
    //   )
    // ) {
    //   return ok(
    //     Semantic.addExpr(sr, {
    //       variant: Semantic.ENode.ExplicitCastExpr,
    //       instanceIds: sourceExpr.instanceIds,
    //       expr: fromExprId,
    //       type: toId,
    //       sourceloc: sourceloc,
    //       isTemporary: sourceExpr.isTemporary,
    //     })[1]
    //   );
    // }

    // Union Conversions: Value to Union (simple)
    if (
      resolvedTargetTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype
    ) {
      const matching = resolvedTargetTypeDef.members.findIndex((m) => {
        // Check Direct match against the resolved (alias-canonicalized) source type
        if (sr.e.resolveAlias(m) === resolvedSourceTypeUseId) {
          return true;
        }

        if (
          sr.typeUseNodes.get(sr.e.resolveAlias(m)).type !==
          sr.typeUseNodes.get(resolvedSourceTypeUseId).type
        ) {
          return false;
        }

        // Check match with implicit mutability change
        if (
          resolvedSourceTypeUse.mutability ===
          sr.typeUseNodes.get(sr.e.resolveAlias(m)).mutability
        ) {
          return true;
        }
        if (
          resolvedSourceTypeUse.mutability === EDatatypeMutability.Const &&
          sr.typeUseNodes.get(sr.e.resolveAlias(m)).mutability ===
            EDatatypeMutability.Default
        ) {
          return true;
        }
        if (
          resolvedSourceTypeUse.mutability === EDatatypeMutability.Mut &&
          sr.typeUseNodes.get(sr.e.resolveAlias(m)).mutability ===
            EDatatypeMutability.Default
        ) {
          return true;
        }

        return false;
      });

      if (matching !== -1) {
        return {
          kind: "value-to-union",
          index: matching,
        };
      }
    }

    // Value To Tagged Union (i.e. Value-To-Result)
    if (resolvedTargetTypeDef.variant === Semantic.ENode.TaggedUnionDatatype) {
      const matchFunc = (m: { tag: string; type: Semantic.TypeUseId }) => {
        // Check Direct match
        if (sr.e.resolveAlias(m.type) === sr.e.resolveAlias(sourceExpr.type)) {
          return true;
        }

        // Check match with implicit mutability change
        const mUse = sr.typeUseNodes.get(sr.e.resolveAlias(m.type));
        if (
          resolvedSourceTypeUse.mutability === EDatatypeMutability.Const &&
          mUse.mutability === EDatatypeMutability.Default &&
          mUse.type === resolvedSourceTypeUse.type
        ) {
          return true;
        }
        if (
          resolvedSourceTypeUse.mutability === EDatatypeMutability.Mut &&
          sr.typeUseNodes.get(sr.e.resolveAlias(m.type)).mutability ===
            EDatatypeMutability.Default &&
          mUse.type === resolvedSourceTypeUse.type
        ) {
          return true;
        }

        return false;
      };

      const allMatches = resolvedTargetTypeDef.members.filter(matchFunc);
      const matchingIndex = resolvedTargetTypeDef.members.findIndex(matchFunc);

      if (allMatches.length === 1 && matchingIndex !== -1) {
        return {
          kind: "value-to-union",
          index: matchingIndex,
        };
      }
    }

    // Union to Union conversion
    if (
      (resolvedSourceTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype &&
        resolvedTargetTypeDef.variant ===
          Semantic.ENode.UntaggedUnionDatatype) ||
      (resolvedSourceTypeDef.variant === Semantic.ENode.TaggedUnionDatatype &&
        resolvedTargetTypeDef.variant === Semantic.ENode.TaggedUnionDatatype)
    ) {
      const fromUnionMembers =
        resolvedSourceTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype
          ? resolvedSourceTypeDef.members
          : resolvedSourceTypeDef.members.map((m) => sr.e.resolveAlias(m.type));
      const membersFrom = typeNarrowing(sr);
      membersFrom.addVariants(fromUnionMembers);
      membersFrom.constrainFromConstraints(constraints, sourceExprId);

      const toUnionMembers =
        resolvedTargetTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype
          ? resolvedTargetTypeDef.members
          : resolvedTargetTypeDef.members.map((m) => sr.e.resolveAlias(m.type));
      const membersTo = typeNarrowing(sr);
      membersTo.addVariants(toUnionMembers);
      membersTo.constrainFromConstraints(constraints, sourceExprId);

      if (
        [...membersFrom.possibleVariants].every((v) =>
          membersTo.possibleVariants.has(v)
        )
      ) {
        return {
          kind: "union-to-union",
        };
      }
    }

    // Union Conversions: Union to Value (complex)
    if (
      resolvedSourceTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype ||
      resolvedSourceTypeDef.variant === Semantic.ENode.TaggedUnionDatatype
    ) {
      const unionMembers =
        resolvedSourceTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype
          ? resolvedSourceTypeDef.members
          : resolvedSourceTypeDef.members.map((m) => sr.e.resolveAlias(m.type));

      const members = typeNarrowing(sr);
      members.addVariants(unionMembers);
      members.constrainFromConstraints(constraints, sourceExprId);

      // Union to bool
      if (
        resolvedTargetTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
        resolvedTargetTypeDef.primitive === EPrimitive.bool
      ) {
        // Result check
        if (
          resolvedSourceTypeDef.variant === Semantic.ENode.TaggedUnionDatatype
        ) {
          const okTag = resolvedSourceTypeDef.members.find(
            (m) => m.tag === "Ok"
          );
          const errTag = resolvedSourceTypeDef.members.find(
            (m) => m.tag === "Err"
          );
          if (okTag && errTag) {
            // It's a result type
            return {
              kind: "union-tag-check",
              comparisonTypesAnd: [okTag.type],
              invertCheck: false,
            };
          }
        }

        // Existence check (Only for untagged unions, otherwise Result<null,none> completely breaks everything)
        if (
          resolvedSourceTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype
        ) {
          const types: Semantic.TypeUseId[] = [];
          for (const mId of members.possibleVariants) {
            const mUse = sr.typeUseNodes.get(sr.e.resolveAlias(mId));
            const mDef = sr.typeDefNodes.get(mUse.type);

            if (
              mDef.variant === Semantic.ENode.PrimitiveDatatype &&
              mDef.primitive === EPrimitive.null
            ) {
              types.push(mId);
            }
            if (
              mDef.variant === Semantic.ENode.PrimitiveDatatype &&
              mDef.primitive === EPrimitive.none
            ) {
              types.push(mId);
            }
          }

          if (types.length === 0) {
            return {
              kind: "error",
              message: `Type ${sourceTypeText} is not implicitly convertible to bool: Union does not contain a null- or none-Variant.`,
            };
          }

          return {
            kind: "union-tag-check",
            comparisonTypesAnd: types,
            invertCheck: true,
          };
        }
      }

      if (
        members.possibleVariants.size === 1 &&
        sr.e.resolveAlias([...members.possibleVariants][0]) ===
          resolvedTargetTypeUseId
      ) {
        const tag = unionMembers.findIndex(
          (m) => m === [...members.possibleVariants][0]
        );
        assert(tag !== -1);

        return {
          kind: "union-to-value",
          tag: tag,
        };
      }

      // Union to Union (e.g. A | B | null to A | B)
      if (
        members.possibleVariants.size === unionMembers.length &&
        unionMembers.length > 1
      ) {
        let missing = false;
        for (const member of unionMembers) {
          if (members.possibleVariants.has(member)) {
            missing = true;
            break;
          }
        }

        if (!missing) {
          // Fine, it is either the same union or one with the same members in a different order
          return {
            kind: "union-to-union",
          };
        }
      }

      if (
        members.possibleVariants.size < unionMembers.length &&
        members.possibleVariants.size > 1
      ) {
        // Validity check: First apply narrowing to know the actual source type.
        // Then: only if all members match exactly, is it valid.
        // Exception: IFF the source is NOT a mutable reference, extension is valid (e.g. const A to A | B)

        // First the check for narrowing
        let allFound = true;
        for (const member of members.possibleVariants) {
          if (!unionMembers.find((m) => m === member)) {
            allFound = false;
          }
        }
        for (const member of unionMembers) {
          if (!members.possibleVariants.has(member)) {
            allFound = false;
          }
        }

        if (allFound) {
          // Union matches exactly after narrowing
          return {
            kind: "union-to-union",
          };
        }

        // Union does not match exactly, but may be extended
      }
    }

    // Callable conversions
    if (
      resolvedSourceTypeDef.variant === Semantic.ENode.CallableDatatype &&
      resolvedTargetTypeDef.variant === Semantic.ENode.CallableDatatype
    ) {
      const fType = sr.typeDefNodes.get(resolvedSourceTypeDef.functionType);
      assert(fType.variant === Semantic.ENode.FunctionDatatype);
      const tType = sr.typeDefNodes.get(resolvedTargetTypeDef.functionType);
      assert(tType.variant === Semantic.ENode.FunctionDatatype);

      const result = checkFunctionDatatypeCompatibility(
        sr,
        fType,
        sourceTypeText,
        tType,
        targetTypeText
      );
      if (result === "success") {
        return {
          kind: "basic-c-cast",
        };
      } else {
        return result;
      }
    }

    // Conversion to LiteralDatatype
    if (resolvedTargetTypeDef.variant === Semantic.ENode.LiteralDatatype) {
      // If the source is a literal, check if it matches the literal datatype
      if (sourceExpr.variant === Semantic.ENode.LiteralExpr) {
        const fromLiteral = sourceExpr.literal;
        const toLiteral = resolvedTargetTypeDef.literalValue;

        // Check if the literal types and values match
        // Need to check property existence for union discriminants that may not have 'value'
        const fromValue =
          "value" in fromLiteral ? fromLiteral.value : undefined;
        const toValue = "value" in toLiteral ? toLiteral.value : undefined;
        if (fromLiteral.type === toLiteral.type && fromValue === toValue) {
          // The literals match, so we can just return the expression as-is
          // since a literal matches the literal type it represents
          return {
            kind: "basic-c-cast",
          };
        }
      }
    }

    // Read Conversion: ShallowReactive<T> to T
    if (
      resolvedSourceTypeDef.variant === Semantic.ENode.ShallowReactiveDatatype
    ) {
      const wrapped = sr.e.resolveAlias(resolvedSourceTypeDef.wrappedType);
      if (wrapped === resolvedTargetTypeUseId) {
        return { kind: "reactive-read" };
      }

      if (
        resolvedTargetTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype
      ) {
        for (const [index, m] of resolvedTargetTypeDef.members.entries()) {
          if (sr.e.resolveAlias(m) === wrapped) {
            return {
              kind: "reactive-read-to-union",
              index: index,
              memberTypeUseId: m,
            };
          }
          const mUse = sr.typeUseNodes.get(m);
          const wrappedUse = sr.typeUseNodes.get(wrapped);
          if (mUse.type === wrappedUse.type) {
            if (
              wrappedUse.mutability === EDatatypeMutability.Const &&
              mUse.mutability === EDatatypeMutability.Default
            ) {
              return {
                kind: "reactive-read-to-union",
                index: index,
                memberTypeUseId: m,
              };
            }
            if (
              wrappedUse.mutability === EDatatypeMutability.Mut &&
              mUse.mutability === EDatatypeMutability.Default
            ) {
              return {
                kind: "reactive-read-to-union",
                index: index,
                memberTypeUseId: m,
              };
            }
          }
        }
      }
    }

    if (resolvedSourceTypeDef.variant === Semantic.ENode.ReactiveDatatype) {
      const wrapped = sr.e.resolveAlias(resolvedSourceTypeDef.wrappedType);
      if (wrapped === resolvedTargetTypeUseId) {
        return { kind: "reactive-read" };
      }
      if (
        resolvedTargetTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype
      ) {
        for (const [index, m] of resolvedTargetTypeDef.members.entries()) {
          if (sr.e.resolveAlias(m) === wrapped) {
            return {
              kind: "reactive-read-to-union",
              index: index,
              memberTypeUseId: m,
            };
          }
          const mUse = sr.typeUseNodes.get(m);
          const wrappedUse = sr.typeUseNodes.get(wrapped);
          if (mUse.type === wrappedUse.type) {
            if (
              wrappedUse.mutability === EDatatypeMutability.Const &&
              mUse.mutability === EDatatypeMutability.Default
            ) {
              return {
                kind: "reactive-read-to-union",
                index: index,
                memberTypeUseId: m,
              };
            }
            if (
              wrappedUse.mutability === EDatatypeMutability.Mut &&
              mUse.mutability === EDatatypeMutability.Default
            ) {
              return {
                kind: "reactive-read-to-union",
                index: index,
                memberTypeUseId: m,
              };
            }
          }
        }
      }
    }

    if (resolvedSourceTypeDef.variant === Semantic.ENode.ComputedDatatype) {
      const wrapped = sr.e.resolveAlias(resolvedSourceTypeDef.wrappedType);
      if (wrapped === resolvedTargetTypeUseId) {
        return { kind: "computed-read" };
      }
      if (
        resolvedTargetTypeDef.variant === Semantic.ENode.UntaggedUnionDatatype
      ) {
        for (const [index, m] of resolvedTargetTypeDef.members.entries()) {
          if (sr.e.resolveAlias(m) === wrapped) {
            return {
              kind: "computed-read-to-union",
              index: index,
              memberTypeUseId: m,
            };
          }
          const mUse = sr.typeUseNodes.get(m);
          const wrappedUse = sr.typeUseNodes.get(wrapped);
          if (mUse.type === wrappedUse.type) {
            if (
              wrappedUse.mutability === EDatatypeMutability.Const &&
              mUse.mutability === EDatatypeMutability.Default
            ) {
              return {
                kind: "computed-read-to-union",
                index: index,
                memberTypeUseId: m,
              };
            }
            if (
              wrappedUse.mutability === EDatatypeMutability.Mut &&
              mUse.mutability === EDatatypeMutability.Default
            ) {
              return {
                kind: "computed-read-to-union",
                index: index,
                memberTypeUseId: m,
              };
            }
          }
        }
      }
    }

    // Implicit conversion via a struct constructor (like an implicit/non-explicit
    // constructor in C++): if the target is a struct that provides a constructor
    // callable with the source value (taking default parameter values into account),
    // rewrite the conversion to a call to that constructor. Generic constructors do
    // not count.
    if (
      resolvedTargetTypeDef.variant === Semantic.ENode.StructDatatype &&
      sr.e.canImplicitlyConstructStructFrom(
        sourceExprId,
        rawTargetTypeUseId,
        _sourceloc
      )
    ) {
      return {
        kind: "construct-via-constructor",
        unsafe: unsafe,
      };
    }

    return {
      kind: "error",
      message: `No suitable conversion from ${sourceTypeText} to ${targetTypeText} is known`,
    };
  }

  function materializeConversionPlan(
    sr: Semantic.Context,
    sourceExprId: Semantic.ExprId,
    targetTypeId: Semantic.TypeUseId,
    conversionPlan: ConversionPlanSuccess,
    sourceloc: SourceLoc
  ): Semantic.ExprId {
    const sourceExpr = sr.exprNodes.get(sourceExprId);
    const rawSourceTypeUseId = sourceExpr.type;
    const rawSourceTypeUse = sr.typeUseNodes.get(rawSourceTypeUseId);
    const resolvedSourceTypeDef = sr.typeDefNodes.get(rawSourceTypeUse.type);

    switch (conversionPlan.kind) {
      case "clone-struct-to-target-type": {
        assert(resolvedSourceTypeDef.variant === Semantic.ENode.StructDatatype);
        // Create a struct literal that copies all members from the source struct
        const assign: { name: string; value: Semantic.ExprId }[] = [];

        resolvedSourceTypeDef.members.forEach((memberSymbolId) => {
          const memberSymbol = sr.symbolNodes.get(memberSymbolId);
          if (memberSymbol.variant !== Semantic.ENode.VariableSymbol) {
            return;
          }

          const memberName = memberSymbol.name;
          const memberType = memberSymbol.type;
          assert(memberType);

          // Create a member access expression for this member
          const memberAccessId = sr.b.addExpr(sr, {
            variant: Semantic.ENode.MemberAccessExpr,
            instanceIds: [...sourceExpr.instanceIds],
            expr: sourceExprId,
            memberName: memberName,
            type: memberType,
            sourceloc: sourceloc,
            isTemporary: true,
            flow: sourceExpr.flow,
            writes: sourceExpr.writes,
          })[1];

          assign.push({
            name: memberName,
            value: memberAccessId,
          });
        });

        // Create the struct literal expression
        const [literal, literalId] = sr.b.addExpr<Semantic.StructLiteralExpr>(
          sr,
          {
            variant: Semantic.ENode.StructLiteralExpr,
            instanceIds: [Semantic.makeInstanceId(sr)],
            assign: assign,
            type: targetTypeId,
            inFunction: sr.e.inFunction,
            allocator: null,
            sourceloc: sourceloc,
            isTemporary: true,
            flow: sourceExpr.flow,
            writes: sourceExpr.writes,
          }
        );

        // Add instance dependencies
        if (sr.e.inFunction) {
          const functionSymbol = sr.e.sr.symbolNodes.get(sr.e.inFunction);
          assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
          literal.instanceIds.forEach((i) =>
            functionSymbol.createsInstanceIds.add(i)
          );
        }

        assign.forEach((a) => {
          const member = resolvedSourceTypeDef.members.find((m) => {
            const varsym = sr.symbolNodes.get(m);
            return (
              varsym.variant === Semantic.ENode.VariableSymbol &&
              varsym.name === a.name
            );
          });
          assert(member);

          const value = sr.exprNodes.get(a.value);
          literal.flow.addAll(value.flow);
          literal.writes.addAll(value.writes);

          Semantic.addStructMemberInstanceDeps(
            sr.e.currentContext.instanceDeps,
            literal.instanceIds[0],
            member,
            value.instanceIds
          );
        });

        return literalId;
      }

      case "basic-c-cast": {
        return sr.b.addExpr(sr, {
          variant: Semantic.ENode.ExplicitCastExpr,
          instanceIds: sourceExpr.instanceIds,
          expr: sourceExprId,
          type: targetTypeId,
          integerNarrowingRange: conversionPlan.integerNarrowingRange ?? null,
          sourceloc: sourceloc,
          isTemporary: sourceExpr.isTemporary,
          flow: sourceExpr.flow,
          writes: sourceExpr.writes,
        })[1];
      }

      case "construct-via-constructor": {
        return sr.e.buildImplicitConstructorConversion(
          sourceExprId,
          targetTypeId,
          sourceloc,
          conversionPlan.unsafe
        );
      }

      case "keep": {
        return sourceExprId;
      }

      case "produce-literal": {
        return sr.b.literalValue(conversionPlan.literalValue, sourceloc)[1];
      }

      case "value-to-union": {
        return sr.b.addExpr(sr, {
          variant: Semantic.ENode.ValueToUnionCastExpr,
          expr: sourceExprId,
          instanceIds: sourceExpr.instanceIds,
          type: targetTypeId,
          index: conversionPlan.index,
          sourceloc: sourceloc,
          isTemporary: sourceExpr.isTemporary,
          flow: sourceExpr.flow,
          writes: sourceExpr.writes,
        })[1];
      }

      case "union-to-value": {
        return sr.b.addExpr(sr, {
          variant: Semantic.ENode.UnionToValueCastExpr,
          instanceIds: sourceExpr.instanceIds,
          expr: sourceExprId,
          type: targetTypeId,
          tag: conversionPlan.tag,
          canBeUnwrappedForLHS: false,
          sourceloc: sourceloc,
          isTemporary: sourceExpr.isTemporary,
          flow: sourceExpr.flow,
          writes: sourceExpr.writes,
        })[1];
      }

      case "union-to-union": {
        return sr.b.addExpr(sr, {
          variant: Semantic.ENode.UnionToUnionCastExpr,
          instanceIds: sourceExpr.instanceIds,
          expr: sourceExprId,
          type: targetTypeId,
          castComesFromNarrowingAndMayBeUnwrapped: false,
          sourceloc: sourceloc,
          isTemporary: sourceExpr.isTemporary,
          flow: sourceExpr.flow,
          writes: sourceExpr.writes,
        })[1];
      }

      case "union-tag-check": {
        return sr.b.addExpr(sr, {
          variant: Semantic.ENode.UnionTagCheckExpr,
          comparisonTypesAnd: conversionPlan.comparisonTypesAnd,
          expr: sourceExprId,
          sourceloc: sourceloc,
          invertCheck: conversionPlan.invertCheck,
          isTemporary: true,
          instanceIds: [],
          type: targetTypeId,
          flow: sourceExpr.flow,
          writes: sourceExpr.writes,
        })[1];
      }

      case "reactive-read": {
        return sr.b.addExpr(sr, {
          variant: Semantic.ENode.ReactiveReadExpr,
          instanceIds: [],
          value: sourceExprId,
          type: targetTypeId,
          sourceloc: sourceloc,
          isTemporary: true,
          flow: Semantic.FlowResult.fallthrough(),
          writes: Semantic.WriteResult.empty(),
        })[1];
      }

      case "reactive-read-to-union": {
        const readExprId = sr.b.addExpr(sr, {
          variant: Semantic.ENode.ReactiveReadExpr,
          instanceIds: [],
          value: sourceExprId,
          type: conversionPlan.memberTypeUseId,
          sourceloc: sourceloc,
          isTemporary: true,
          flow: Semantic.FlowResult.fallthrough(),
          writes: Semantic.WriteResult.empty(),
        })[1];
        return sr.b.addExpr(sr, {
          variant: Semantic.ENode.ValueToUnionCastExpr,
          expr: readExprId,
          instanceIds: [],
          type: targetTypeId,
          index: conversionPlan.index,
          sourceloc: sourceloc,
          isTemporary: true,
          flow: Semantic.FlowResult.fallthrough(),
          writes: Semantic.WriteResult.empty(),
        })[1];
      }

      case "computed-read": {
        return sr.b.addExpr(sr, {
          variant: Semantic.ENode.ComputedReadExpr,
          instanceIds: [],
          value: sourceExprId,
          type: targetTypeId,
          sourceloc: sourceloc,
          isTemporary: true,
          flow: Semantic.FlowResult.fallthrough(),
          writes: Semantic.WriteResult.empty(),
        })[1];
      }

      case "computed-read-to-union": {
        const readExprId = sr.b.addExpr(sr, {
          variant: Semantic.ENode.ComputedReadExpr,
          instanceIds: [],
          value: sourceExprId,
          type: conversionPlan.memberTypeUseId,
          sourceloc: sourceloc,
          isTemporary: true,
          flow: Semantic.FlowResult.fallthrough(),
          writes: Semantic.WriteResult.empty(),
        })[1];
        return sr.b.addExpr(sr, {
          variant: Semantic.ENode.ValueToUnionCastExpr,
          expr: readExprId,
          instanceIds: [],
          type: targetTypeId,
          index: conversionPlan.index,
          sourceloc: sourceloc,
          isTemporary: true,
          flow: Semantic.FlowResult.fallthrough(),
          writes: Semantic.WriteResult.empty(),
        })[1];
      }

      default:
        break;
    }
    assert(false);
  }

  export function CanImplicitlyConvert(
    sr: Semantic.Context,
    sourceExprId: Semantic.ExprId,
    targetTypeUseId: Semantic.TypeUseId,
    constraints: ConstraintSet,
    sourceloc: SourceLoc
  ): { ok: true } | { ok: false; error: string } {
    const sourceExpr = sr.exprNodes.get(sourceExprId);
    if (sourceExpr.variant === Semantic.ENode.IntrinsicSymbol) {
      return {
        ok: false,
        error:
          "Intrinsic functions cannot be assigned to variables. They may only be called directly.",
      };
    }
    const plan = buildConversionPlan(
      sr,
      sourceExprId,
      targetTypeUseId,
      constraints,
      sourceloc,
      Mode.Implicit,
      false
    );
    if (plan.kind === "error") {
      return { ok: false, error: plan.message };
    }
    return { ok: true };
  }

  export function MakeConversion(
    sr: Semantic.Context,
    sourceExprId: Semantic.ExprId,
    targetTypeUseId: Semantic.TypeUseId,
    constraints: ConstraintSet,
    sourceloc: SourceLoc,
    mode: Mode,
    unsafe?: boolean
  ): { ok: true; expr: Semantic.ExprId } | { ok: false; error: string } {
    const sourceExpr = sr.exprNodes.get(sourceExprId);

    // Intrinsic values cannot be assigned to variables - they can only be called
    if (sourceExpr.variant === Semantic.ENode.IntrinsicSymbol) {
      return {
        ok: false as const,
        error:
          "Intrinsic functions cannot be assigned to variables. They may only be called directly.",
      };
    }

    const conversionPlan = buildConversionPlan(
      sr,
      sourceExprId,
      targetTypeUseId,
      constraints,
      sourceloc,
      mode,
      unsafe ?? false
    );

    if (conversionPlan.kind === "error") {
      // If the source is reactive/computed, try a two-step conversion:
      // unwrap to the inner type first, then convert inner → target.
      // This handles e.g. Reactive<str | null> → str when inside a narrowing context.
      const resolvedSourceTypeDef = sr.typeDefNodes.get(
        sr.typeUseNodes.get(sr.e.resolveAlias(sourceExpr.type)).type
      );
      if (
        resolvedSourceTypeDef.variant === Semantic.ENode.ReactiveDatatype ||
        resolvedSourceTypeDef.variant ===
          Semantic.ENode.ShallowReactiveDatatype ||
        resolvedSourceTypeDef.variant === Semantic.ENode.ComputedDatatype
      ) {
        const wrappedTypeUseId = resolvedSourceTypeDef.wrappedType;
        const unwrapResult = MakeConversion(
          sr,
          sourceExprId,
          wrappedTypeUseId,
          constraints,
          sourceloc,
          mode,
          unsafe
        );
        if (unwrapResult.ok) {
          const finalResult = MakeConversion(
            sr,
            unwrapResult.expr,
            targetTypeUseId,
            constraints,
            sourceloc,
            mode,
            unsafe
          );
          if (finalResult.ok) {
            return finalResult;
          }
        }
      }
      return { ok: false, error: conversionPlan.message };
    }

    return {
      ok: true,
      expr: materializeConversionPlan(
        sr,
        sourceExprId,
        targetTypeUseId,
        conversionPlan,
        sourceloc
      ),
    };
  }

  export function MakeDefaultValue(
    sr: Semantic.Context,
    targetTypeId: Semantic.TypeUseId,
    sourceloc: SourceLoc
  ): Semantic.ExprId {
    const typeInstance = sr.typeUseNodes.get(targetTypeId);
    const targetType = sr.typeDefNodes.get(typeInstance.type);

    if (targetType.variant === Semantic.ENode.PrimitiveDatatype) {
      if (
        targetType.primitive === EPrimitive.u8 ||
        targetType.primitive === EPrimitive.u16 ||
        targetType.primitive === EPrimitive.u32 ||
        targetType.primitive === EPrimitive.u64 ||
        targetType.primitive === EPrimitive.i8 ||
        targetType.primitive === EPrimitive.i16 ||
        targetType.primitive === EPrimitive.i32 ||
        targetType.primitive === EPrimitive.i64 ||
        targetType.primitive === EPrimitive.int
      ) {
        return sr.b.literalValue(
          {
            type: targetType.primitive,
            unit: null,
            value: 0n,
          },
          sourceloc
        )[1];
      }
      if (
        targetType.primitive === EPrimitive.f32 ||
        targetType.primitive === EPrimitive.f64 ||
        targetType.primitive === EPrimitive.real
      ) {
        return sr.b.literalValue(
          {
            type: targetType.primitive,
            unit: null,
            value: 0,
          },
          sourceloc
        )[1];
      }
      if (targetType.primitive === EPrimitive.bool) {
        return sr.b.literal(false, sourceloc)[1];
      }
      if (targetType.primitive === EPrimitive.null) {
        return sr.b.literalValue(
          {
            type: EPrimitive.null,
          },
          sourceloc
        )[1];
      }
      if (targetType.primitive === EPrimitive.none) {
        return sr.b.literalValue(
          {
            type: EPrimitive.none,
          },
          sourceloc
        )[1];
      }
    }

    if (targetType.variant === Semantic.ENode.StructDatatype) {
      function arraysAreEquivalent(a: string[], b: string[]): boolean {
        const setA = new Set(a);
        const setB = new Set(b);
        if (setA.size !== setB.size) {
          return false;
        }
        for (const x of setA) {
          if (!setB.has(x)) {
            return false;
          }
        }
        return true;
      }

      const requiredMembers = targetType.members.map((m) => {
        const mVar = sr.symbolNodes.get(m);
        assert(mVar.variant === Semantic.ENode.VariableSymbol);
        return mVar.name;
      });
      const assignedMembers = targetType.memberDefaultValues.map(
        (m) => m.memberName
      );

      if (arraysAreEquivalent(requiredMembers, assignedMembers)) {
        const collectedStruct = sr.cc.typeDefNodes.get(
          targetType.originalCollectedDefinition
        );
        assert(collectedStruct.variant === Collect.ENode.StructTypeDef);
        // Make an empty struct instantiation and let it handle the default values, since we know they all exist.
        return sr.b.structLiteral(
          targetTypeId,
          [],
          sr.e.inFunction,
          null,
          sourceloc
        )[1];
      }

      throw new CompilerError(
        `Default value for type '${Semantic.serializeTypeUse(
          sr,
          targetTypeId
        )}' is requested, but this struct has no default value because not all members specify a default value`,
        sourceloc,
        4002
      );
    }

    throw new CompilerError(
      `Default value for type '${Semantic.serializeTypeUse(
        sr,
        targetTypeId
      )}' is requested, but no safe default value is known for that type`,
      sourceloc,
      4003
    );
  }

  export function makeComparisonResultType(
    sr: Semantic.Context,
    a: Semantic.ExprId,
    b: Semantic.ExprId,
    sourceloc: SourceLoc
  ): Semantic.TypeUseId {
    const leftTypeUseId = sr.exprNodes.get(a).type;
    const rightTypeUseId = sr.exprNodes.get(b).type;
    const leftTypeId = sr.typeUseNodes.get(
      sr.e.resolveAlias(leftTypeUseId)
    ).type;
    const rightTypeId = sr.typeUseNodes.get(
      sr.e.resolveAlias(rightTypeUseId)
    ).type;

    if (isIntegerById(sr, leftTypeId) && isIntegerById(sr, rightTypeId)) {
      return sr.b.boolType();
    }

    const leftIsFloat = isFloat(sr, leftTypeId);
    const rightIsFloat = isFloat(sr, rightTypeId);
    if (leftIsFloat && rightIsFloat) {
      if (leftTypeId === rightTypeId) {
        return makePrimitiveAvailable(
          sr,
          EPrimitive.bool,
          EDatatypeMutability.Const,
          sourceloc
        );
      }
      throw new CompilerError(
        `No safe comparison is available between types '${Semantic.serializeTypeUse(
          sr,
          leftTypeUseId
        )}' and '${Semantic.serializeTypeUse(sr, rightTypeUseId)}'`,
        sourceloc,
        4004
      );
    }

    if (
      (leftIsFloat && isIntegerById(sr, rightTypeId)) ||
      (rightIsFloat && isIntegerById(sr, leftTypeId))
    ) {
      return makePrimitiveAvailable(
        sr,
        EPrimitive.bool,
        EDatatypeMutability.Const,
        sourceloc
      );
    }

    const comparisons = [
      {
        comparable: [makeRawPrimitiveAvailable(sr, EPrimitive.str)],
      },
      {
        comparable: [makeRawPrimitiveAvailable(sr, EPrimitive.null)],
      },
      {
        comparable: [makeRawPrimitiveAvailable(sr, EPrimitive.bool)],
      },
    ];
    for (const c of comparisons) {
      if (
        c.comparable.includes(leftTypeId) &&
        c.comparable.includes(rightTypeId)
      ) {
        return makePrimitiveAvailable(
          sr,
          EPrimitive.bool,
          EDatatypeMutability.Const,
          sourceloc
        );
      }
    }

    const leftType = sr.typeDefNodes.get(leftTypeId);
    const rightType = sr.typeDefNodes.get(rightTypeId);

    if (
      leftType.variant === Semantic.ENode.EnumDatatype &&
      rightType.variant === Semantic.ENode.EnumDatatype &&
      leftTypeId === rightTypeId
    ) {
      return makePrimitiveAvailable(
        sr,
        EPrimitive.bool,
        EDatatypeMutability.Const,
        sourceloc
      );
    }

    throw new CompilerError(
      `No safe comparison is available between types '${Semantic.serializeTypeUse(
        sr,
        leftTypeUseId
      )}' and '${Semantic.serializeTypeUse(sr, rightTypeUseId)}'`,
      sourceloc,
      4005
    );
  }

  export function makeBinaryResultType(
    sr: Semantic.Context,
    a: Semantic.ExprId,
    b: Semantic.ExprId,
    operation: EBinaryOperation,
    sourceloc: SourceLoc
  ): Semantic.TypeUseId {
    const leftTypeUseId = sr.exprNodes.get(a).type;
    const rightTypeUseId = sr.exprNodes.get(b).type;
    const leftTypeId = sr.typeUseNodes.get(
      sr.e.resolveAlias(leftTypeUseId)
    ).type;
    const rightTypeId = sr.typeUseNodes.get(
      sr.e.resolveAlias(rightTypeUseId)
    ).type;

    switch (operation) {
      case EBinaryOperation.Equal:
      case EBinaryOperation.NotEqual:
      case EBinaryOperation.GreaterEqual:
      case EBinaryOperation.LessEqual:
      case EBinaryOperation.LessThan:
      case EBinaryOperation.GreaterThan:
        return makeComparisonResultType(sr, a, b, sourceloc);

      case EBinaryOperation.Multiply:
      case EBinaryOperation.Divide:
      case EBinaryOperation.Modulo:
      case EBinaryOperation.Add:
      case EBinaryOperation.Subtract:
        if (
          leftTypeId === rightTypeId &&
          (isIntegerById(sr, leftTypeId) || isFloat(sr, leftTypeId))
        ) {
          return makeTypeUse(
            sr,
            leftTypeId,
            EDatatypeMutability.Const,
            false,
            sourceloc
          )[1];
        }
        break;

      case EBinaryOperation.BoolAnd:
      case EBinaryOperation.BoolOr:
        assert(false, "Should be handled outside");
        break;

      default:
        break;
    }

    throw new CompilerError(
      `No safe ${BinaryOperationToString(
        operation
      )} operation is known between types '${Semantic.serializeTypeUseWithAliasAKA(
        sr,
        leftTypeUseId
      )}' and '${Semantic.serializeTypeUseWithAliasAKA(sr, rightTypeUseId)}'`,
      sourceloc,
      4006
    );
  }

  const UnaryOperationResults = (sr: Semantic.Context) => ({
    [EUnaryOperation.Plus]: [
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.i8),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.i8),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.i16),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.i16),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.i32),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.i32),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.i64),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.i64),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.u8),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.u8),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.u16),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.u16),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.u32),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.u32),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.u64),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.u64),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.f32),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.f32),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.f64),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.f64),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.int),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.int),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.real),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.real),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.usize),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.usize),
      },
    ],
    [EUnaryOperation.Minus]: [
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.i8),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.i8),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.i16),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.i16),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.i32),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.i32),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.i64),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.i64),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.u8),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.u8),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.u16),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.u16),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.u32),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.u32),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.u64),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.u64),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.f32),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.f32),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.f64),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.f64),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.int),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.int),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.real),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.real),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.usize),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.usize),
      },
    ],
    [EUnaryOperation.Negate]: [
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.i8),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.i16),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.i32),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.i64),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.u8),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.u16),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.u32),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.u64),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.f32),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.f64),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.int),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.real),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makeRawPrimitiveAvailable(sr, EPrimitive.usize),
        to: makeRawPrimitiveAvailable(sr, EPrimitive.bool),
      },
    ],
  });

  export function makeUnaryResultType(
    sr: Semantic.Context,
    a: Semantic.TypeUseId,
    operation: EUnaryOperation,
    sourceloc: SourceLoc
  ): Semantic.TypeUseId {
    const ops = UnaryOperationResults(sr)[operation];

    for (const op of ops) {
      if (op.from === sr.typeUseNodes.get(a).type) {
        return makeTypeUse(
          sr,
          op.to,
          EDatatypeMutability.Const,
          false,
          sourceloc
        )[1];
      }
    }

    throw new CompilerError(
      `No unary ${UnaryOperationToString(
        operation
      )} operation is known for type '${Semantic.serializeTypeUse(sr, a)}'`,
      sourceloc,
      4007
    );
  }
}
