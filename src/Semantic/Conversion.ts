import {
  BinaryOperationToString,
  EBinaryOperation,
  EDatatypeMutability,
  EUnaryOperation,
  UnaryOperationToString,
} from "../shared/AST";
import { EPrimitive, primitiveToString } from "../shared/common";
import { assert, CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import {
  makePrimitiveAvailable,
  makeRawPrimitiveAvailable,
  Semantic,
  type SemanticResult,
} from "./Elaborate";
import { Collect } from "../SymbolCollection/SymbolCollection";
import { makeTypeUse } from "./LookupDatatype";

export namespace Conversion {
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
        assert(false, `Unknown primitive type: ${primitiveToString(primitive)}`);
    }
  }

  export function prettyRanges(ranges: ValueRange[], primitive?: EPrimitive): string {
    return ranges.map((r) => prettyRange(r.min, r.max, primitive)).join(" u ");
  }

  export function prettyRange(
    min: bigint | undefined,
    max: bigint | undefined,
    primitive?: EPrimitive
  ): string {
    function formatValue(value: bigint, exact: bigint, negPower = false): string {
      if (value === exact) {
        // print as power-of-two
        const exponent = negPower
          ? BigInt(Math.log2(Number(-value)))
          : BigInt(Math.log2(Number(value + (negPower ? 0n : 1n))));
        return negPower ? `-2^${exponent}` : `2^${exponent}-1`;
      } else {
        return value.toString();
      }
    }

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
        const typeLimits = getIntegerMinMax(primitive);
        switch (primitive) {
          case EPrimitive.i32:
            return min === typeLimits[0] ? `-2^31` : min.toString();
          case EPrimitive.u32:
            return min === typeLimits[0] ? `0` : min.toString();
          case EPrimitive.i64:
          case EPrimitive.int:
            return min === typeLimits[0] ? `-2^63` : min.toString();
          case EPrimitive.u64:
          case EPrimitive.usize:
            return min === typeLimits[0] ? `0` : min.toString();
          default:
            return min.toString();
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
        const typeLimits = getIntegerMinMax(primitive);
        switch (primitive) {
          case EPrimitive.i32:
            return max === typeLimits[1] ? `2^31-1` : max.toString();
          case EPrimitive.u32:
            return max === typeLimits[1] ? `2^32-1` : max.toString();
          case EPrimitive.i64:
          case EPrimitive.int:
            return max === typeLimits[1] ? `2^63-1` : max.toString();
          case EPrimitive.u64:
          case EPrimitive.usize:
            return max === typeLimits[1] ? `2^64-1` : max.toString();
          default:
            return max.toString();
        }
      }
      return max.toString();
    })();

    return `${minSymbol}${minStr}, ${maxStr}${maxSymbol}`;
  }

  export function isStruct(sr: SemanticResult, typeId: Semantic.TypeDefId): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant !== Semantic.ENode.StructDatatype) return false;
    return true;
  }

  export function isF32(sr: SemanticResult, typeId: Semantic.TypeDefId): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) return false;
    return type.primitive === EPrimitive.f32;
  }

  export function isF64(sr: SemanticResult, typeId: Semantic.TypeDefId): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) return false;
    return type.primitive === EPrimitive.f64;
  }

  export function isFloat(sr: SemanticResult, typeId: Semantic.TypeDefId): boolean {
    return isF32(sr, typeId) || isF64(sr, typeId);
  }

  export function isBoolean(sr: SemanticResult, typeId: Semantic.TypeDefId): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) return false;
    return type.primitive === EPrimitive.bool;
  }

  export function isInteger(primitive: EPrimitive): boolean {
    return isSignedInteger(primitive) || isUnsignedInteger(primitive);
  }

  export function isIntegerById(sr: SemanticResult, typeId: Semantic.TypeDefId): boolean {
    const type = sr.typeDefNodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) return false;
    return isInteger(type.primitive);
  }

  export function getIntegerBits(type: Semantic.PrimitiveDatatypeDef): number {
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
      case EPrimitive.usize:
      case EPrimitive.int:
        return 64;
    }
    throw new InternalError("Requested getIntegerBits from a non-integer");
  }

  export function IsStructurallyEquivalent(
    sr: SemanticResult,
    a: Semantic.TypeDefId,
    b: Semantic.TypeDefId,
    seen: Map<Semantic.TypeDefId, Set<Semantic.TypeDefId>> = new Map()
  ): boolean {
    // Symmetric check: has this pair already been seen?
    if (seen.get(a)?.has(b) || seen.get(b)?.has(a)) {
      return true;
    }

    // Mark pair as seen
    if (!seen.has(a)) seen.set(a, new Set());
    seen.get(a)!.add(b);

    if (!sr.typeDefNodes.get(a).concrete || !sr.typeDefNodes.get(b).concrete) {
      throw new InternalError(
        "Cannot check structural equivalence of a non-concrete datatype",
        undefined,
        1
      );
    }

    const at = sr.typeDefNodes.get(a);
    const bt = sr.typeDefNodes.get(b);

    if (at.variant !== bt.variant) {
      return false;
    }
    switch (at.variant) {
      case Semantic.ENode.PrimitiveDatatype:
        assert(bt.variant === Semantic.ENode.PrimitiveDatatype);
        return at.primitive === bt.primitive;

      case Semantic.ENode.FixedArrayDatatype: {
        assert(bt.variant === Semantic.ENode.FixedArrayDatatype);
        const a = sr.typeUseNodes.get(at.datatype);
        const b = sr.typeUseNodes.get(bt.datatype);
        return IsStructurallyEquivalent(sr, a.type, b.type, seen) && at.length === bt.length;
      }

      case Semantic.ENode.DynamicArrayDatatype: {
        assert(bt.variant === Semantic.ENode.DynamicArrayDatatype);
        const a = sr.typeUseNodes.get(at.datatype);
        const b = sr.typeUseNodes.get(bt.datatype);
        return IsStructurallyEquivalent(sr, a.type, b.type, seen);
      }

      case Semantic.ENode.FunctionDatatype: {
        assert(bt.variant === Semantic.ENode.FunctionDatatype);
        const aa = sr.typeUseNodes.get(at.returnType);
        const bb = sr.typeUseNodes.get(bt.returnType);
        return (
          at.vararg === bt.vararg &&
          IsStructurallyEquivalent(sr, aa.type, bb.type, seen) &&
          at.parameters.length === bt.parameters.length &&
          at.parameters.every((p, index) =>
            IsStructurallyEquivalent(
              sr,
              sr.typeUseNodes.get(p).type,
              sr.typeUseNodes.get(bt.parameters[index]).type,
              seen
            )
          )
        );
      }

      case Semantic.ENode.UntaggedUnionDatatype: {
        assert(bt.variant === Semantic.ENode.UntaggedUnionDatatype);
        if (
          at.members.length === bt.members.length &&
          at.members.every((a, i) => a === bt.members[i])
        )
          return true;
        return false;
      }

      case Semantic.ENode.TaggedUnionDatatype: {
        assert(bt.variant === Semantic.ENode.TaggedUnionDatatype);
        if (
          at.members.length === bt.members.length &&
          at.members.every((a, i) => a.tag === bt.members[i].tag && a.type === bt.members[i].type)
        )
          return true;
        return false;
      }

      case Semantic.ENode.CallableDatatype: {
        assert(bt.variant === Semantic.ENode.CallableDatatype);
        if (Boolean(at.thisExprType) !== Boolean(bt.thisExprType)) return false;
        if (
          at.thisExprType &&
          bt.thisExprType &&
          IsStructurallyEquivalent(
            sr,
            sr.typeUseNodes.get(at.thisExprType).type,
            sr.typeUseNodes.get(bt.thisExprType).type,
            seen
          )
        )
          return false;
        return IsStructurallyEquivalent(sr, at.functionType, bt.functionType, seen);
      }

      case Semantic.ENode.GenericParameterDatatype: {
        throw new InternalError("Cannot check structural equivalence of a generic parameter");
      }

      case Semantic.ENode.StructDatatype: {
        assert(bt.variant === Semantic.ENode.StructDatatype);
        if (at.generics.length !== bt.generics.length) {
          return false;
        }

        for (let i = 0; i < at.generics.length; i++) {
          if (
            !IsStructurallyEquivalent(
              sr,
              sr.typeUseNodes.get(sr.exprNodes.get(at.generics[i]).type).type,
              sr.typeUseNodes.get(sr.exprNodes.get(bt.generics[i]).type).type,
              seen
            )
          )
            return false;
        }

        if (at.members.length !== bt.members.length) {
          return false;
        }

        // All members are unique
        const remainingMembersA = [
          ...new Set(
            at.members.map((mId) => {
              const m = sr.symbolNodes.get(mId);
              assert(m.variant === Semantic.ENode.VariableSymbol);
              return m.name;
            })
          ),
        ];
        assert(remainingMembersA.length === at.members.length);
        let remainingMembersB = [
          ...new Set(
            bt.members.map((mId) => {
              const m = sr.symbolNodes.get(mId);
              assert(m.variant === Semantic.ENode.VariableSymbol);
              return m.name;
            })
          ),
        ];
        assert(remainingMembersB.length === bt.members.length);

        // All members are unique and the same count. So if all members from A are in B, the inverse must also be true.

        for (const m of remainingMembersA) {
          if (!remainingMembersB.includes(m)) {
            return false; // Member from A is not available in B
          }
          remainingMembersB = remainingMembersB.filter((k) => k !== m);

          const amId = at.members.find((mmId) => {
            const mm = sr.symbolNodes.get(mmId);
            assert(mm.variant === Semantic.ENode.VariableSymbol);
            return mm.name;
          });
          const bmId = bt.members.find((mmId) => {
            const mm = sr.symbolNodes.get(mmId);
            assert(mm.variant === Semantic.ENode.VariableSymbol);
            return mm.name;
          });
          assert(amId && bmId);
          const am = sr.symbolNodes.get(amId);
          const bm = sr.symbolNodes.get(bmId);
          assert(am.variant === Semantic.ENode.VariableSymbol);
          assert(bm.variant === Semantic.ENode.VariableSymbol);
          assert(am.type && bm.type);
          if (
            !IsStructurallyEquivalent(
              sr,
              sr.typeUseNodes.get(am.type).type,
              sr.typeUseNodes.get(bm.type).type,
              seen
            )
          ) {
            return false;
          }
        }

        return true;
      }

      default:
        assert(false, "All cases handled: " + Semantic.ENode[at.variant]);
    }
  }

  type ValueRange = {
    max: bigint | undefined;
    min: bigint | undefined;
  };

  function valueNarrowing(sr: SemanticResult) {
    const values = {
      ranges: [] as ValueRange[],
      normalize: () => {
        if (values.ranges.length === 0) return [];

        values.ranges.sort((a, b) => {
          if (a.min === undefined) return -1;
          if (b.min === undefined) return 1;
          return a.min < b.min ? -1 : a.min > b.min ? 1 : 0;
        });

        const result: ValueRange[] = [];
        let current = { ...values.ranges[0] };

        for (let i = 1; i < values.ranges.length; i++) {
          const next = values.ranges[i];

          if (next.min !== undefined && next.max !== undefined && next.min > next.max) {
            continue;
          }

          if (
            current.max === undefined || // current goes to +∞
            next.min === undefined || // next starts at -∞
            current.max + 1n >= (next.min ?? current.max) // overlap or adjacent
          ) {
            current.max =
              current.max === undefined
                ? undefined
                : next.max === undefined
                ? undefined
                : current.max > next.max
                ? current.max
                : next.max;
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
        if (min !== undefined && max !== undefined && min > max) return [];
        values.ranges.push({
          max: max,
          min: min,
        });
        return values.normalize();
      },
      intersect: (a: ValueRange, b: ValueRange): ValueRange | null => {
        const min =
          a.min === undefined ? b.min : b.min === undefined ? a.min : a.min > b.min ? a.min : b.min;
        const max =
          a.max === undefined ? b.max : b.max === undefined ? a.max : a.max < b.max ? a.max : b.max;
        if (min !== undefined && max !== undefined && min > max) return null;
        return { min, max };
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
            if (r.min === undefined || max >= r.min) out.push({ min: r.min, max });
          }
          // right part
          if (r.max === undefined || r.max >= v + 1n) {
            const min = r.min !== undefined && r.min > v ? r.min : v + 1n;
            if (r.max === undefined || min <= r.max) out.push({ min, max: r.max });
          }
        }
        values.ranges = out;
        return values.normalize();
      },
      isExact: (): bigint | null => {
        if (values.ranges.length !== 1) return null;
        const r = values.ranges[0];
        if (r.min !== undefined && r.max !== undefined && r.min === r.max) {
          return r.min;
        }
        return null;
      },
      canHaveValue: (v: bigint): boolean => {
        for (const r of values.ranges) {
          if ((r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max))
            return true;
        }
        return false;
      },
      isWithinRange: (min: bigint, max: bigint): boolean => {
        for (const r of values.ranges) {
          if (r.min !== undefined && r.min < min) return false;
          if (r.max !== undefined && r.max > max) return false;
          if (r.min === undefined || r.max === undefined) return false;
        }
        return values.ranges.length > 0;
      },
      constrainFromConstraints: (
        constraints: Semantic.Constraint[],
        fromExprId: Semantic.ExprId
      ) => {
        const fromExpr = sr.exprNodes.get(fromExprId);
        for (const constraint of constraints) {
          if (fromExpr.variant !== Semantic.ENode.SymbolValueExpr) {
            continue;
          }
          if (constraint.variableSymbol !== fromExpr.symbol) {
            continue;
          }
          values.constrainFromConstraint(constraint.constraintValue);
        }
      },
      constrainFromConstraint: (constraintValue: Semantic.ConstraintValue) => {
        if (constraintValue.kind === "comparison") {
          const valueExpr = sr.exprNodes.get(constraintValue.value);
          if (
            valueExpr.variant === Semantic.ENode.LiteralExpr &&
            valueExpr.literal.type !== EPrimitive.null
          ) {
            if (
              valueExpr.literal.type === EPrimitive.u8 ||
              valueExpr.literal.type === EPrimitive.u16 ||
              valueExpr.literal.type === EPrimitive.u32 ||
              valueExpr.literal.type === EPrimitive.u64 ||
              valueExpr.literal.type === EPrimitive.usize ||
              valueExpr.literal.type === EPrimitive.i8 ||
              valueExpr.literal.type === EPrimitive.i16 ||
              valueExpr.literal.type === EPrimitive.i32 ||
              valueExpr.literal.type === EPrimitive.i64 ||
              valueExpr.literal.type === EPrimitive.int
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
              if (constraintValue.operation === EBinaryOperation.Unequal) {
                values.constrainNe(value);
              }
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

  export function typeNarrowing(sr: SemanticResult) {
    return {
      possibleVariants: new Set<Semantic.TypeUseId>(),

      addVariants(members: Semantic.TypeUseId[]) {
        for (const m of members) {
          this.possibleVariants.add(m);
        }
      },

      constrainFromConstraints(constraints: Semantic.Constraint[], fromExprId: Semantic.ExprId) {
        const fromExpr = sr.exprNodes.get(fromExprId);
        if (fromExpr.variant !== Semantic.ENode.SymbolValueExpr) return;

        for (const c of constraints) {
          if (c.variableSymbol !== fromExpr.symbol) continue;
          this.constrainFromConstraint(c.constraintValue);
        }
      },

      constrainFromConstraint(cv: Semantic.ConstraintValue) {
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
    Implicit,
    Explicit,
  }

  export function MakeConversionOrThrow(
    sr: SemanticResult,
    fromExprId: Semantic.ExprId,
    toId: Semantic.TypeUseId,
    constraints: Semantic.Constraint[],
    sourceloc: SourceLoc,
    mode: Mode,
    unsafe?: boolean
  ) {
    const c = MakeConversion(sr, fromExprId, toId, constraints, sourceloc, mode, unsafe);
    if (c.ok) {
      return c.expr;
    }
    throw new CompilerError(c.error, sourceloc);
  }

  export function MakeConversion(
    sr: SemanticResult,
    fromExprId: Semantic.ExprId,
    toId: Semantic.TypeUseId,
    constraints: Semantic.Constraint[],
    sourceloc: SourceLoc,
    mode: Mode,
    unsafe?: boolean
  ): { ok: true; expr: Semantic.ExprId } | { ok: false; error: string } {
    const fromExpr = sr.exprNodes.get(fromExprId);
    const fromTypeInstance = sr.typeUseNodes.get(fromExpr.type);
    const fromType = sr.typeDefNodes.get(fromTypeInstance.type);
    const toInstance = sr.typeUseNodes.get(toId);
    const to = sr.typeDefNodes.get(toInstance.type);

    const fromTypeText = Semantic.serializeTypeUse(sr, fromExpr.type);
    const toTypeText = Semantic.serializeTypeUse(sr, toId);

    const ok = (v: Semantic.ExprId) => ({ ok: true as const, expr: v });

    if (fromExpr.type === toId) {
      return ok(fromExprId);
    }

    // Conversion from str to cstr
    if (
      fromType.variant === Semantic.ENode.PrimitiveDatatype &&
      to.variant === Semantic.ENode.PrimitiveDatatype &&
      fromType.primitive === EPrimitive.str &&
      (to.primitive === EPrimitive.cstr || to.primitive === EPrimitive.ccstr)
    ) {
      if (fromExpr.variant === Semantic.ENode.LiteralExpr) {
        assert(fromExpr.literal.type === EPrimitive.str);
        return ok(
          sr.b.literalValue(
            {
              type: to.primitive,
              value: fromExpr.literal.value,
            },
            fromExpr.sourceloc
          )[1]
        );
      }
      throw new CompilerError(
        `Conversion from str to cstr/ccstr (char*/const char*) is not possible because the value is not known at compile time, therefore no C string literal can be emitted that preserves null termination. For runtime strings, use str.cstr(arena).`,
        sourceloc
      );
    }

    // Conversion from T[N] to T[]
    // if (
    //   fromType.variant === Semantic.ENode.ArrayDatatype &&
    //   to.variant === Semantic.ENode.SliceDatatype &&
    //   fromType.datatype === to.datatype
    // ) {
    //   return Semantic.addNode(sr, {
    //     variant:
    //   })
    // }

    // Conversion between Integers
    if (
      Conversion.isIntegerById(sr, fromTypeInstance.type) &&
      Conversion.isIntegerById(sr, toInstance.type)
    ) {
      const fi = sr.typeUseNodes.get(fromExpr.type);
      const f = sr.typeDefNodes.get(fi.type);
      assert(f.variant === Semantic.ENode.PrimitiveDatatype);
      const ti = sr.typeUseNodes.get(toId);
      const t = sr.typeDefNodes.get(ti.type);
      assert(t.variant === Semantic.ENode.PrimitiveDatatype);
      const fromSigned = Conversion.isSignedInteger(f.primitive);
      const toSigned = Conversion.isSignedInteger(t.primitive);
      const fromBits = Conversion.getIntegerBits(f);
      const toBits = Conversion.getIntegerBits(t);

      if (fromSigned === toSigned && toBits >= fromBits) {
        // Totally safe
        return ok(
          Semantic.addExpr(sr, {
            variant: Semantic.ENode.ExplicitCastExpr,
            instanceIds: fromExpr.instanceIds,
            expr: fromExprId,
            type: toId,
            sourceloc: sourceloc,
            isTemporary: fromExpr.isTemporary,
          })[1]
        );
      } else {
        const source = valueNarrowing(sr);
        source.addRange(...Conversion.getIntegerMinMax(f.primitive));
        source.constrainExactFromExprIfPossible(fromExprId);
        source.constrainFromConstraints(constraints, fromExprId);

        if (source.isWithinRange(...Conversion.getIntegerMinMax(t.primitive))) {
          return ok(
            Semantic.addExpr(sr, {
              variant: Semantic.ENode.ExplicitCastExpr,
              instanceIds: fromExpr.instanceIds,
              expr: fromExprId,
              type: toId,
              sourceloc: sourceloc,
              isTemporary: fromExpr.isTemporary,
            })[1]
          );
        }

        let sourceRangeText = "";
        if (!source.isExact()) {
          const ranges = source.ranges;
          sourceRangeText = `range ${Conversion.prettyRanges(source.ranges, f.primitive)}`;
        } else {
          sourceRangeText = `value ${source.isExact()!}`;
        }

        throw new CompilerError(
          `No safe conversion from '${Semantic.serializeTypeUse(
            sr,
            fromExpr.type
          )}' to '${Semantic.serializeTypeUse(
            sr,
            toId
          )}' is known: Target type has integer range ${Conversion.prettyRange(
            ...Conversion.getIntegerMinMax(t.primitive),
            t.primitive
          )}, but the source has ${sourceRangeText}. Add a conditional that constrains the integer range.`,
          sourceloc
        );
      }
    }

    // Conversions between floats
    if (
      (fromType.variant === Semantic.ENode.PrimitiveDatatype &&
        fromType.primitive === EPrimitive.real &&
        to.variant === Semantic.ENode.PrimitiveDatatype &&
        to.primitive === EPrimitive.f64) ||
      (fromType.variant === Semantic.ENode.PrimitiveDatatype &&
        fromType.primitive === EPrimitive.f64 &&
        to.variant === Semantic.ENode.PrimitiveDatatype &&
        to.primitive === EPrimitive.real)
    ) {
      return ok(
        Semantic.addExpr(sr, {
          variant: Semantic.ENode.ExplicitCastExpr,
          instanceIds: fromExpr.instanceIds,
          expr: fromExprId,
          type: toId,
          sourceloc: sourceloc,
          isTemporary: fromExpr.isTemporary,
        })[1]
      );
    }
    if (
      (fromType.variant === Semantic.ENode.PrimitiveDatatype &&
        fromType.primitive === EPrimitive.f32 &&
        to.variant === Semantic.ENode.PrimitiveDatatype &&
        to.primitive === EPrimitive.f64) ||
      (fromType.variant === Semantic.ENode.PrimitiveDatatype &&
        fromType.primitive === EPrimitive.f32 &&
        to.variant === Semantic.ENode.PrimitiveDatatype &&
        to.primitive === EPrimitive.real)
    ) {
      return ok(
        Semantic.addExpr(sr, {
          variant: Semantic.ENode.ExplicitCastExpr,
          instanceIds: fromExpr.instanceIds,
          expr: fromExprId,
          type: toId,
          sourceloc: sourceloc,
          isTemporary: fromExpr.isTemporary,
        })[1]
      );
    }

    if (
      (fromType.variant === Semantic.ENode.PrimitiveDatatype &&
        fromType.primitive === EPrimitive.real &&
        to.variant === Semantic.ENode.PrimitiveDatatype &&
        to.primitive === EPrimitive.f32) ||
      (fromType.variant === Semantic.ENode.PrimitiveDatatype &&
        fromType.primitive === EPrimitive.f64 &&
        to.variant === Semantic.ENode.PrimitiveDatatype &&
        to.primitive === EPrimitive.f32)
    ) {
      if (mode !== Mode.Explicit) {
        throw new CompilerError(
          `Conversion from '${Semantic.serializeTypeUse(
            sr,
            fromExpr.type
          )}' to '${Semantic.serializeTypeUse(
            sr,
            toId
          )}' is lossy. If wanted, cast explicitly using '... as ${Semantic.serializeTypeUse(
            sr,
            toId
          )}'`,
          sourceloc
        );
      }
      return ok(
        Semantic.addExpr(sr, {
          variant: Semantic.ENode.ExplicitCastExpr,
          instanceIds: fromExpr.instanceIds,
          expr: fromExprId,
          type: toId,
          sourceloc: sourceloc,
          isTemporary: fromExpr.isTemporary,
        })[1]
      );
    }

    // Pointer conversions
    // if (
    //   fromType.variant === Semantic.ENode.NullableReferenceDatatype &&
    //   to.variant === Semantic.ENode.NullableReferenceDatatype
    // ) {
    //   const frompointeeInstance = sr.typeUseNodes.get(fromType.referee);
    //   const frompointee = sr.typeDefNodes.get(frompointeeInstance.type);
    //   // Conversion from void* to T*
    //   if (
    //     frompointee.variant === Semantic.ENode.PrimitiveDatatype &&
    //     frompointee.primitive === EPrimitive.void
    //   ) {
    //     return Semantic.addExpr(sr, {
    //       variant: Semantic.ENode.ExplicitCastExpr,
    //       expr: fromExprId,
    //       type: toId,
    //       sourceloc: sourceloc,
    //       isTemporary: fromExpr.isTemporary,
    //     })[1];
    //   }
    //   // Conversion from T* to void*
    //   const topointeeInstance = sr.typeUseNodes.get(to.referee);
    //   const topointee = sr.typeDefNodes.get(topointeeInstance.type);
    //   if (
    //     topointee.variant === Semantic.ENode.PrimitiveDatatype &&
    //     topointee.primitive === EPrimitive.void
    //   ) {
    //     return Semantic.addExpr(sr, {
    //       variant: Semantic.ENode.ExplicitCastExpr,
    //       expr: fromExprId,
    //       type: toId,
    //       sourceloc: sourceloc,
    //       isTemporary: fromExpr.isTemporary,
    //     })[1];
    //   }
    // }

    // Core conversions
    if (
      IsStructurallyEquivalent(
        sr,
        sr.typeUseNodes.get(fromExpr.type).type,
        sr.typeUseNodes.get(toId).type
      )
    ) {
      return ok(
        Semantic.addExpr(sr, {
          variant: Semantic.ENode.ExplicitCastExpr,
          instanceIds: fromExpr.instanceIds,
          expr: fromExprId,
          type: toId,
          sourceloc: sourceloc,
          isTemporary: fromExpr.isTemporary,
        })[1]
      );
    }

    // Union Conversions: Value to Union (simple)
    if (to.variant === Semantic.ENode.UntaggedUnionDatatype) {
      const matching = to.members.findIndex((m) => {
        // Check Direct match
        if (m === fromExpr.type) {
          return true;
        }

        // Check match with implicit mutability change
        if (
          fromTypeInstance.mutability === EDatatypeMutability.Const &&
          sr.typeUseNodes.get(m).mutability === EDatatypeMutability.Default
        ) {
          return true;
        }
        if (
          fromTypeInstance.mutability === EDatatypeMutability.Mut &&
          sr.typeUseNodes.get(m).mutability === EDatatypeMutability.Default
        ) {
          return true;
        }

        return false;
      });

      if (matching != -1) {
        return ok(
          Semantic.addExpr(sr, {
            variant: Semantic.ENode.ValueToUnionCastExpr,
            expr: fromExprId,
            instanceIds: fromExpr.instanceIds,
            type: toId,
            index: matching,
            sourceloc: sourceloc,
            isTemporary: fromExpr.isTemporary,
          })[1]
        );
      }
    }
    if (to.variant === Semantic.ENode.TaggedUnionDatatype) {
      const matching = to.members.findIndex((m) => {
        // Check Direct match
        if (m.type === fromExpr.type) {
          return true;
        }

        // Check match with implicit mutability change
        if (
          fromTypeInstance.mutability === EDatatypeMutability.Const &&
          sr.typeUseNodes.get(m.type).mutability === EDatatypeMutability.Default
        ) {
          return true;
        }
        if (
          fromTypeInstance.mutability === EDatatypeMutability.Mut &&
          sr.typeUseNodes.get(m.type).mutability === EDatatypeMutability.Default
        ) {
          return true;
        }

        return false;
      });

      if (matching != -1) {
        return ok(
          Semantic.addExpr(sr, {
            variant: Semantic.ENode.ValueToUnionCastExpr,
            expr: fromExprId,
            instanceIds: fromExpr.instanceIds,
            type: toId,
            index: matching,
            sourceloc: sourceloc,
            isTemporary: fromExpr.isTemporary,
          })[1]
        );
      }
    }

    // Union to Union conversion
    if (
      (fromType.variant === Semantic.ENode.UntaggedUnionDatatype &&
        to.variant === Semantic.ENode.UntaggedUnionDatatype) ||
      (fromType.variant === Semantic.ENode.TaggedUnionDatatype &&
        to.variant === Semantic.ENode.TaggedUnionDatatype)
    ) {
      const fromUnionMembers =
        fromType.variant === Semantic.ENode.UntaggedUnionDatatype
          ? fromType.members
          : fromType.members.map((m) => m.type);
      const membersFrom = typeNarrowing(sr);
      membersFrom.addVariants(fromUnionMembers);
      membersFrom.constrainFromConstraints(constraints, fromExprId);

      const toUnionMembers =
        to.variant === Semantic.ENode.UntaggedUnionDatatype
          ? to.members
          : to.members.map((m) => m.type);
      const membersTo = typeNarrowing(sr);
      membersTo.addVariants(toUnionMembers);
      membersTo.constrainFromConstraints(constraints, fromExprId);

      if ([...membersFrom.possibleVariants].every((v) => membersTo.possibleVariants.has(v))) {
        return ok(
          Semantic.addExpr(sr, {
            variant: Semantic.ENode.UnionToUnionCastExpr,
            instanceIds: fromExpr.instanceIds,
            expr: fromExprId,
            type: toId,
            sourceloc: sourceloc,
            isTemporary: fromExpr.isTemporary,
          })[1]
        );
      }
    }

    // Union Conversions: Union to Value (complex)
    if (
      fromType.variant === Semantic.ENode.UntaggedUnionDatatype ||
      fromType.variant === Semantic.ENode.TaggedUnionDatatype
    ) {
      const unionMembers =
        fromType.variant === Semantic.ENode.UntaggedUnionDatatype
          ? fromType.members
          : fromType.members.map((m) => m.type);

      const members = typeNarrowing(sr);
      members.addVariants(unionMembers);
      members.constrainFromConstraints(constraints, fromExprId);

      if (members.possibleVariants.size === 1 && [...members.possibleVariants][0] === toId) {
        const tag = unionMembers.findIndex((m) => m === [...members.possibleVariants][0]);
        assert(tag !== -1);

        return ok(
          Semantic.addExpr(sr, {
            variant: Semantic.ENode.UnionToValueCastExpr,
            instanceIds: fromExpr.instanceIds,
            expr: fromExprId,
            type: toId,
            tag: tag,
            sourceloc: sourceloc,
            isTemporary: fromExpr.isTemporary,
          })[1]
        );
      }
    }

    throw new CompilerError(
      `No suitable conversion from '${Semantic.serializeTypeUse(
        sr,
        fromExpr.type
      )}' to '${Semantic.serializeTypeUse(sr, toId)}' is known`,
      sourceloc
    );
  }

  export function MakeDefaultValue(
    sr: SemanticResult,
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
      } else if (
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
      } else if (targetType.primitive === EPrimitive.bool) {
        return sr.b.literal(false, sourceloc)[1];
      } else if (targetType.primitive === EPrimitive.null) {
        return sr.b.literalValue(
          {
            type: EPrimitive.null,
          },
          sourceloc
        )[1];
      } else if (targetType.primitive === EPrimitive.none) {
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
        if (setA.size !== setB.size) return false;
        for (const x of setA) if (!setB.has(x)) return false;
        return true;
      }

      const requiredMembers = targetType.members.map((m) => {
        const mVar = sr.symbolNodes.get(m);
        assert(mVar.variant === Semantic.ENode.VariableSymbol);
        return mVar.name;
      });
      const assignedMembers = targetType.memberDefaultValues.map((m) => m.memberName);

      if (arraysAreEquivalent(requiredMembers, assignedMembers)) {
        const collectedStruct = sr.cc.typeDefNodes.get(targetType.originalCollectedSymbol);
        assert(collectedStruct.variant === Collect.ENode.StructTypeDef);
        // Make an empty struct instantiation and let it handle the default values, since we know they all exist.
        // return sr.e.makeStructInstantiation(sr.typeUseNodes.get(targetTypeId).type, [], {
        //   context: Semantic.makeElaborationContext({
        //     currentScope: collectedStruct.structScope,
        //     genericsScope: collectedStruct.structScope,
        //   }),
        //   constraints: [],
        //   expectedReturnType: makePrimitiveAvailable(
        //     sr,
        //     EPrimitive.void,
        //     EDatatypeMutability.Default,
        //     sourceloc
        //   ),
        //   sourceloc: sourceloc,
        //   unsafe: false,
        // })[1];
      }

      throw new CompilerError(
        `Default value for type '${Semantic.serializeTypeUse(
          sr,
          targetTypeId
        )}' is requested, but this struct has no default value because not all members specify a default value`,
        sourceloc
      );
    }

    throw new CompilerError(
      `Default value for type '${Semantic.serializeTypeUse(
        sr,
        targetTypeId
      )}' is requested, but no safe default value is known for that type`,
      sourceloc
    );
  }

  export function makeComparisonResultType(
    sr: SemanticResult,
    a: Semantic.ExprId,
    b: Semantic.ExprId,
    sourceloc: SourceLoc
  ): Semantic.TypeUseId {
    const leftTypeId = sr.typeUseNodes.get(sr.exprNodes.get(a).type).type;
    const rightTypeId = sr.typeUseNodes.get(sr.exprNodes.get(b).type).type;

    const comparisons = [
      {
        comparable: [
          makeRawPrimitiveAvailable(sr, EPrimitive.i8),
          makeRawPrimitiveAvailable(sr, EPrimitive.i16),
          makeRawPrimitiveAvailable(sr, EPrimitive.i32),
          makeRawPrimitiveAvailable(sr, EPrimitive.i64),
          makeRawPrimitiveAvailable(sr, EPrimitive.int),
        ],
      },
      {
        comparable: [
          makeRawPrimitiveAvailable(sr, EPrimitive.u8),
          makeRawPrimitiveAvailable(sr, EPrimitive.u16),
          makeRawPrimitiveAvailable(sr, EPrimitive.u32),
          makeRawPrimitiveAvailable(sr, EPrimitive.u64),
          makeRawPrimitiveAvailable(sr, EPrimitive.usize),
        ],
      },
      {
        comparable: [makeRawPrimitiveAvailable(sr, EPrimitive.null)],
      },
      {
        comparable: [makeRawPrimitiveAvailable(sr, EPrimitive.bool)],
      },
      {
        comparable: [
          makeRawPrimitiveAvailable(sr, EPrimitive.f32),
          makeRawPrimitiveAvailable(sr, EPrimitive.f64),
          makeRawPrimitiveAvailable(sr, EPrimitive.real),
        ],
      },
    ];
    for (const c of comparisons) {
      if (c.comparable.includes(leftTypeId) && c.comparable.includes(rightTypeId)) {
        return makePrimitiveAvailable(sr, EPrimitive.bool, EDatatypeMutability.Const, sourceloc);
      }
    }

    const leftType = sr.typeDefNodes.get(leftTypeId);
    const rightType = sr.typeDefNodes.get(rightTypeId);

    throw new CompilerError(
      `No safe comparison is available between types '${Semantic.serializeTypeDef(
        sr,
        leftTypeId
      )}' and '${Semantic.serializeTypeDef(sr, rightTypeId)}'`,
      sourceloc
    );
  }

  export function makeBinaryResultType(
    sr: SemanticResult,
    a: Semantic.ExprId,
    b: Semantic.ExprId,
    operation: EBinaryOperation,
    sourceloc: SourceLoc
  ): Semantic.TypeUseId {
    const leftType = sr.typeUseNodes.get(sr.exprNodes.get(a).type).type;
    const rightType = sr.typeUseNodes.get(sr.exprNodes.get(b).type).type;

    switch (operation) {
      case EBinaryOperation.Equal:
      case EBinaryOperation.Unequal:
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
        if (leftType === rightType) {
          return makeTypeUse(sr, leftType, EDatatypeMutability.Const, false, sourceloc)[1];
        }
        break;

      case EBinaryOperation.BoolAnd:
      case EBinaryOperation.BoolOr:
        assert(false, "Should be handled outside");
    }

    throw new CompilerError(
      `No safe ${BinaryOperationToString(
        operation
      )} operation is known between types '${Semantic.serializeTypeDef(
        sr,
        leftType
      )}' and '${Semantic.serializeTypeDef(sr, rightType)}'`,
      sourceloc
    );
  }

  const UnaryOperationResults = (sr: SemanticResult) => ({
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
    sr: SemanticResult,
    a: Semantic.TypeUseId,
    operation: EUnaryOperation,
    sourceloc: SourceLoc
  ): Semantic.TypeUseId {
    const ops = UnaryOperationResults(sr)[operation];

    for (const op of ops) {
      if (op.from === sr.typeUseNodes.get(a).type) {
        return makeTypeUse(sr, op.to, EDatatypeMutability.Const, false, sourceloc)[1];
      }
    }

    throw new CompilerError(
      `No unary ${UnaryOperationToString(
        operation
      )} operation is known for type '${Semantic.serializeTypeUse(sr, a)}'`,
      sourceloc
    );
  }
}
