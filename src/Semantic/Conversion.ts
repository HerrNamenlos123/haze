import { scaleRadial } from "d3";
import {
  BinaryOperationToString,
  EBinaryOperation,
  EClonability,
  EExternLanguage,
  EOperator,
  EUnaryOperation,
  UnaryOperationToString,
} from "../shared/AST";
import { EMethodType, EPrimitive, primitiveToString } from "../shared/common";
import {
  assert,
  CompilerError,
  ImpossibleSituation,
  InternalError,
  type SourceLoc,
} from "../shared/Errors";
import {
  asType,
  getExprType,
  isExpression,
  isType,
  isTypeConcrete,
  makePrimitiveAvailable,
  Semantic,
  type SemanticResult,
} from "./SemanticSymbols";
import { serializeDatatype } from "./Serialize";

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

  export function prettyRange(
    min: bigint,
    max: bigint,
    type: Semantic.PrimitiveDatatypeSymbol
  ): string {
    const typeLimits = getIntegerMinMax(type.primitive);

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
    minStr = (() => {
      switch (type.primitive) {
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
    })();

    // check if max matches exact type max
    maxStr = (() => {
      switch (type.primitive) {
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
    })();

    return `[${minStr}, ${maxStr}]`;
  }

  export function isStruct(sr: SemanticResult, typeId: Semantic.Id): boolean {
    const type = sr.nodes.get(typeId);
    if (type.variant !== Semantic.ENode.StructDatatype) return false;
    return true;
  }

  export function isF32(sr: SemanticResult, typeId: Semantic.Id): boolean {
    const type = sr.nodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) return false;
    return type.primitive === EPrimitive.f32;
  }

  export function isF64(sr: SemanticResult, typeId: Semantic.Id): boolean {
    const type = sr.nodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) return false;
    return type.primitive === EPrimitive.f64;
  }

  export function isFloat(sr: SemanticResult, typeId: Semantic.Id): boolean {
    return isF32(sr, typeId) || isF64(sr, typeId);
  }

  export function isBoolean(sr: SemanticResult, typeId: Semantic.Id): boolean {
    const type = sr.nodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) return false;
    return type.primitive === EPrimitive.bool;
  }

  export function isInteger(primitive: EPrimitive): boolean {
    return isSignedInteger(primitive) || isUnsignedInteger(primitive);
  }

  export function isIntegerById(sr: SemanticResult, typeId: Semantic.Id): boolean {
    const type = sr.nodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) return false;
    return isInteger(type.primitive);
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
      case EPrimitive.usize:
      case EPrimitive.int:
        return 64;
    }
    throw new InternalError("Requested getIntegerBits from a non-integer");
  }

  function promoteInteger(
    a: Semantic.PrimitiveDatatypeSymbol,
    b: Semantic.PrimitiveDatatypeSymbol
  ): Semantic.PrimitiveDatatypeSymbol {
    if (
      a.variant !== Semantic.ENode.PrimitiveDatatype ||
      b.variant !== Semantic.ENode.PrimitiveDatatype
    ) {
      throw new InternalError("promoteInteger got non primitives");
    }

    const getWiderInteger = (
      a: Semantic.PrimitiveDatatypeSymbol,
      b: Semantic.PrimitiveDatatypeSymbol
    ) => {
      const aBits = getIntegerBits(a);
      const bBits = getIntegerBits(b);
      return aBits > bBits ? a : b;
    };

    const widenInteger = (
      a: Semantic.PrimitiveDatatypeSymbol,
      b: Semantic.PrimitiveDatatypeSymbol
    ) => {
      if (a.primitive == b.primitive) {
        return a;
      }

      let sizeA = getIntegerBits(a);
      let sizeB = getIntegerBits(b);

      // If one of the types is unsigned and larger in size, widen accordingly
      if (isUnsignedInteger(a.primitive) && !isUnsignedInteger(b.primitive)) {
        if (sizeA > sizeB) {
          return a; // Promote the unsigned type
        } else {
          return b; // Promote the signed type to the larger unsigned type
        }
      }

      if (isUnsignedInteger(b.primitive) && !isUnsignedInteger(a.primitive)) {
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
    if (isUnsignedInteger(a.primitive) && !isUnsignedInteger(b.primitive))
      return widenInteger(a, b);
    if (!isUnsignedInteger(a.primitive) && isUnsignedInteger(b.primitive))
      return widenInteger(a, b);
    return getWiderInteger(a, b);
  }

  export function getIntegerBinaryResult(
    sr: SemanticResult,
    a: Semantic.Id,
    b: Semantic.Id
  ): Semantic.PrimitiveDatatypeSymbol {
    const aa = sr.nodes.get(a);
    const bb = sr.nodes.get(b);
    assert(
      aa.variant === Semantic.ENode.PrimitiveDatatype &&
        bb.variant === Semantic.ENode.PrimitiveDatatype
    );
    return promoteInteger(aa, bb);
  }

  export function IsStructurallyEquivalent(
    sr: SemanticResult,
    a: Semantic.Id,
    b: Semantic.Id,
    seen: Map<Semantic.Id, Set<Semantic.Id>> = new Map()
  ): boolean {
    // Symmetric check: has this pair already been seen?
    if (seen.get(a)?.has(b) || seen.get(b)?.has(a)) {
      return true;
    }

    // Mark pair as seen
    if (!seen.has(a)) seen.set(a, new Set());
    seen.get(a)!.add(b);

    if (!isTypeConcrete(sr, a) || !isTypeConcrete(sr, b)) {
      throw new InternalError(
        "Cannot check structural equivalence of a non-concrete datatype",
        undefined,
        1
      );
    }

    const at = sr.nodes.get(a);
    const bt = sr.nodes.get(b);

    if (at.variant !== bt.variant) {
      return false;
    }
    switch (at.variant) {
      case Semantic.ENode.PrimitiveDatatype:
        assert(bt.variant === Semantic.ENode.PrimitiveDatatype);
        return at.primitive === bt.primitive;

      case Semantic.ENode.LiteralValueDatatype:
        assert(bt.variant === Semantic.ENode.LiteralValueDatatype);
        if (at.literal.type === EPrimitive.null) {
          return at.literal.type === bt.literal.type;
        } else {
          return at.literal.type === bt.literal.type && at.literal.value === bt.literal.value;
        }

      case Semantic.ENode.PointerDatatype:
        assert(bt.variant === Semantic.ENode.PointerDatatype);
        return IsStructurallyEquivalent(sr, at.pointee, bt.pointee, seen);

      case Semantic.ENode.ReferenceDatatype:
        assert(bt.variant === Semantic.ENode.ReferenceDatatype);
        return IsStructurallyEquivalent(sr, at.referee, bt.referee, seen);

      case Semantic.ENode.ArrayDatatype:
        assert(bt.variant === Semantic.ENode.ArrayDatatype);
        return (
          IsStructurallyEquivalent(sr, at.datatype, bt.datatype, seen) && at.length === bt.length
        );

      case Semantic.ENode.SliceDatatype:
        assert(bt.variant === Semantic.ENode.SliceDatatype);
        return IsStructurallyEquivalent(sr, at.datatype, bt.datatype, seen);

      case Semantic.ENode.FunctionDatatype:
        assert(bt.variant === Semantic.ENode.FunctionDatatype);
        return (
          at.vararg === bt.vararg &&
          IsStructurallyEquivalent(sr, at.returnType, bt.returnType, seen) &&
          at.parameters.every((p, index) =>
            IsStructurallyEquivalent(sr, p, bt.parameters[index], seen)
          )
        );

      case Semantic.ENode.CallableDatatype:
        assert(bt.variant === Semantic.ENode.CallableDatatype);
        if (Boolean(at.thisExprType) !== Boolean(bt.thisExprType)) return false;
        if (
          at.thisExprType &&
          bt.thisExprType &&
          IsStructurallyEquivalent(sr, at.thisExprType, bt.thisExprType, seen)
        )
          return false;
        return IsStructurallyEquivalent(sr, at.functionType, bt.functionType, seen);

      case Semantic.ENode.GenericParameterDatatype:
        throw new InternalError("Cannot check structural equivalence of a generic parameter");

      case Semantic.ENode.StructDatatype:
        assert(bt.variant === Semantic.ENode.StructDatatype);
        if (at.generics.length !== bt.generics.length) {
          return false;
        }

        for (let i = 0; i < at.generics.length; i++) {
          if (!IsStructurallyEquivalent(sr, at.generics[i], bt.generics[i], seen)) return false;
        }

        if (at.members.length !== bt.members.length) {
          return false;
        }

        // All members are unique
        const remainingMembersA = [
          ...new Set(
            at.members.map((mId) => {
              const m = sr.nodes.get(mId);
              assert(m.variant === Semantic.ENode.VariableSymbol);
              return m.name;
            })
          ),
        ];
        assert(remainingMembersA.length === at.members.length);
        let remainingMembersB = [
          ...new Set(
            bt.members.map((mId) => {
              const m = sr.nodes.get(mId);
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
            const mm = sr.nodes.get(mmId);
            assert(mm.variant === Semantic.ENode.VariableSymbol);
            return mm.name;
          });
          const bmId = bt.members.find((mmId) => {
            const mm = sr.nodes.get(mmId);
            assert(mm.variant === Semantic.ENode.VariableSymbol);
            return mm.name;
          });
          assert(amId && bmId);
          const am = sr.nodes.get(amId);
          const bm = sr.nodes.get(bmId);
          assert(am.variant === Semantic.ENode.VariableSymbol);
          assert(bm.variant === Semantic.ENode.VariableSymbol);
          assert(am.type && bm.type);
          if (!IsStructurallyEquivalent(sr, am.type, bm.type, seen)) {
            return false;
          }
        }

        return true;

      default:
        assert(false, "All cases handled");
    }
  }

  export enum Mode {
    Implicit,
    Explicit,
  }

  export function MakeConversion(
    sr: SemanticResult,
    fromExprId: Semantic.Id,
    toId: Semantic.Id,
    constraints: Semantic.Constraint[],
    sourceloc: SourceLoc,
    mode: Mode
  ) {
    const from = sr.nodes.get(fromExprId);
    assert(isExpression(from));
    const fromType = sr.nodes.get(from.type);
    assert(isType(fromType));
    const to = sr.nodes.get(toId);

    // Conversion of Struct to Struct
    if (
      fromType.variant === Semantic.ENode.StructDatatype &&
      to.variant === Semantic.ENode.StructDatatype &&
      from.type === toId &&
      !from.isTemporary
    ) {
      const msg =
        to.clonability === EClonability.NonClonableFromAttribute
          ? "marked as 'nonclonable'"
          : "non-clonable because it contains raw pointers or other non-clonable structures";
      throw new CompilerError(
        `Struct '${fromType.name}' is passed by value here, which would create a copy, but the struct definition is ${msg}`,
        sourceloc
      );
    }

    if (from.type === toId) {
      return fromExprId;
    }

    // Conversion from T to T&
    if (to.variant === Semantic.ENode.ReferenceDatatype) {
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromExprId,
        type: toId,
        sourceloc: sourceloc,
        isTemporary: from.isTemporary,
      })[1];
    }

    // Conversion from T& to T
    if (sr.nodes.get(from.type).variant === Semantic.ENode.ReferenceDatatype) {
      if (
        fromType.variant === Semantic.ENode.ReferenceDatatype &&
        to.variant === Semantic.ENode.StructDatatype &&
        fromType.referee === toId
      ) {
        const fromTypeReferee = sr.nodes.get(fromType.referee);
        assert(
          isType(fromTypeReferee) && fromTypeReferee.variant === Semantic.ENode.StructDatatype
        );
        if (
          fromTypeReferee.clonability === EClonability.NonClonableFromAttribute ||
          fromTypeReferee.clonability === EClonability.NonClonableFromMembers
        ) {
          const msg =
            to.clonability === EClonability.NonClonableFromAttribute
              ? "marked as 'nonclonable'"
              : "non-clonable because it contains raw pointers or other non-clonable structures";
          throw new CompilerError(
            `Conversion from '${serializeDatatype(sr, from.type)}' to '${serializeDatatype(
              sr,
              toId
            )}' would create a copy of the struct, but the struct definition is ${msg}`,
            sourceloc
          );
        }
      }

      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromExprId,
        type: toId,
        sourceloc: sourceloc,
        isTemporary: from.isTemporary,
      })[1];
    }

    // Conversion between Integers
    if (Conversion.isIntegerById(sr, from.type) && Conversion.isIntegerById(sr, toId)) {
      const f = sr.nodes.get(from.type);
      assert(f.variant === Semantic.ENode.PrimitiveDatatype);
      const t = sr.nodes.get(toId);
      assert(t.variant === Semantic.ENode.PrimitiveDatatype);
      const fromSigned = Conversion.isSignedInteger(f.primitive);
      const toSigned = Conversion.isSignedInteger(t.primitive);
      const fromBits = Conversion.getIntegerBits(f);
      const toBits = Conversion.getIntegerBits(t);

      if (fromSigned === toSigned && toBits >= fromBits) {
        // Totally safe
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.ExplicitCastExpr,
          expr: fromExprId,
          type: toId,
          sourceloc: sourceloc,
          isTemporary: from.isTemporary,
        })[1];
      } else {
        let [sourceMinValue, sourceMaxValue] = Conversion.getIntegerMinMax(f.primitive);
        let [targetMinValue, targetMaxValue] = Conversion.getIntegerMinMax(t.primitive);

        function applyLiteral(literal: Semantic.Id) {
          const value = sr.nodes.get(literal);
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
          if (value.literal.value > sourceMinValue) {
            sourceMinValue = value.literal.value;
          }
          if (value.literal.value < sourceMaxValue) {
            sourceMaxValue = value.literal.value;
          }
        }

        if (from.variant === Semantic.ENode.LiteralExpr) {
          applyLiteral(fromExprId);
        } else if (from.variant === Semantic.ENode.SymbolValueExpr) {
          const symbol = sr.nodes.get(from.symbol);
          assert(symbol.variant === Semantic.ENode.VariableSymbol);
          if (symbol.comptime && symbol.comptimeValue) {
            applyLiteral(symbol.comptimeValue);
          }
        }

        for (const constraint of constraints) {
          if (from.variant !== Semantic.ENode.SymbolValueExpr) {
            continue;
          }

          if (constraint.variableSymbol !== from.symbol) {
            continue;
          }

          if (constraint.constraintValue.kind === "comparison") {
            if (
              constraint.constraintValue.operation === EBinaryOperation.GreaterEqual &&
              constraint.constraintValue.value > sourceMinValue
            ) {
              sourceMinValue = constraint.constraintValue.value;
            }
            if (
              constraint.constraintValue.operation === EBinaryOperation.GreaterThan &&
              constraint.constraintValue.value + 1n > sourceMinValue
            ) {
              sourceMinValue = constraint.constraintValue.value + 1n;
            }
            if (
              constraint.constraintValue.operation === EBinaryOperation.LessEqual &&
              constraint.constraintValue.value < sourceMaxValue
            ) {
              sourceMaxValue = constraint.constraintValue.value;
            }
            if (
              constraint.constraintValue.operation === EBinaryOperation.LessThan &&
              constraint.constraintValue.value - 1n < sourceMaxValue
            ) {
              sourceMaxValue = constraint.constraintValue.value - 1n;
            }
          }
        }

        if (sourceMinValue >= targetMinValue && sourceMaxValue <= targetMaxValue) {
          return Semantic.addNode(sr, {
            variant: Semantic.ENode.ExplicitCastExpr,
            expr: fromExprId,
            type: toId,
            sourceloc: sourceloc,
            isTemporary: from.isTemporary,
          })[1];
        }

        let sourceRangeText = "";
        if (sourceMaxValue !== sourceMinValue) {
          sourceRangeText = `range ${Conversion.prettyRange(sourceMinValue, sourceMaxValue, f)}`;
        } else {
          sourceRangeText = `value ${sourceMinValue}`;
        }

        throw new CompilerError(
          `No safe conversion from '${serializeDatatype(sr, from.type)}' to '${serializeDatatype(
            sr,
            toId
          )}' is known: Target type has integer range ${Conversion.prettyRange(
            targetMinValue,
            targetMaxValue,
            t
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
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromExprId,
        type: toId,
        sourceloc: sourceloc,
        isTemporary: from.isTemporary,
      })[1];
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
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromExprId,
        type: toId,
        sourceloc: sourceloc,
        isTemporary: from.isTemporary,
      })[1];
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
          `Conversion from '${serializeDatatype(sr, from.type)}' to '${serializeDatatype(
            sr,
            toId
          )}' is lossy. If wanted, cast explicitly using '... as ${serializeDatatype(sr, toId)}'`,
          sourceloc
        );
      }
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromExprId,
        type: toId,
        sourceloc: sourceloc,
        isTemporary: from.isTemporary,
      })[1];
    }

    // Pointer conversions
    if (
      fromType.variant === Semantic.ENode.PointerDatatype &&
      to.variant === Semantic.ENode.PointerDatatype
    ) {
      const frompointee = sr.nodes.get(fromType.pointee);
      // Conversion from void* to T*
      if (
        frompointee.variant === Semantic.ENode.PrimitiveDatatype &&
        frompointee.primitive === EPrimitive.void
      ) {
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.ExplicitCastExpr,
          expr: fromExprId,
          type: toId,
          sourceloc: sourceloc,
          isTemporary: from.isTemporary,
        })[1];
      }
      // Conversion from T* to void*
      const topointee = sr.nodes.get(to.pointee);
      if (
        topointee.variant === Semantic.ENode.PrimitiveDatatype &&
        topointee.primitive === EPrimitive.void
      ) {
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.ExplicitCastExpr,
          expr: fromExprId,
          type: toId,
          sourceloc: sourceloc,
          isTemporary: from.isTemporary,
        })[1];
      }
    }

    // Core conversions
    if (IsStructurallyEquivalent(sr, from.type, toId)) {
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromExprId,
        type: toId,
        sourceloc: sourceloc,
        isTemporary: from.isTemporary,
      })[1];
    }

    throw new CompilerError(
      `No suitable conversion from '${serializeDatatype(sr, from.type)}' to '${serializeDatatype(
        sr,
        toId
      )}' is known`,
      sourceloc
    );
  }

  export function makeComparisonResultType(
    sr: SemanticResult,
    a: Semantic.Id,
    b: Semantic.Id,
    sourceloc: SourceLoc
  ): Semantic.Id {
    const leftTypeId = getExprType(sr, a);
    const rightTypeId = getExprType(sr, b);

    const comparisons = [
      {
        comparable: [
          makePrimitiveAvailable(sr, EPrimitive.i8),
          makePrimitiveAvailable(sr, EPrimitive.i16),
          makePrimitiveAvailable(sr, EPrimitive.i32),
          makePrimitiveAvailable(sr, EPrimitive.i64),
          makePrimitiveAvailable(sr, EPrimitive.int),
        ],
      },
      {
        comparable: [
          makePrimitiveAvailable(sr, EPrimitive.u8),
          makePrimitiveAvailable(sr, EPrimitive.u16),
          makePrimitiveAvailable(sr, EPrimitive.u32),
          makePrimitiveAvailable(sr, EPrimitive.u64),
          makePrimitiveAvailable(sr, EPrimitive.usize),
        ],
      },
      {
        comparable: [makePrimitiveAvailable(sr, EPrimitive.null)],
      },
      {
        comparable: [
          makePrimitiveAvailable(sr, EPrimitive.f32),
          makePrimitiveAvailable(sr, EPrimitive.f64),
          makePrimitiveAvailable(sr, EPrimitive.real),
        ],
      },
    ];
    for (const c of comparisons) {
      if (c.comparable.includes(leftTypeId) && c.comparable.includes(rightTypeId)) {
        return makePrimitiveAvailable(sr, EPrimitive.bool);
      }
    }

    const leftType = sr.nodes.get(leftTypeId);
    assert(isType(leftType));
    const rightType = sr.nodes.get(rightTypeId);
    assert(isType(rightType));

    if (
      leftType.variant === Semantic.ENode.PointerDatatype &&
      rightType.variant === Semantic.ENode.PointerDatatype
    ) {
      return makePrimitiveAvailable(sr, EPrimitive.bool);
    }

    throw new CompilerError(
      `No safe comparison is available between types '${serializeDatatype(
        sr,
        leftTypeId
      )}' and '${serializeDatatype(sr, rightTypeId)}'`,
      sourceloc
    );
  }

  export function makeBinaryResultType(
    sr: SemanticResult,
    a: Semantic.Id,
    b: Semantic.Id,
    operation: EBinaryOperation,
    sourceloc: SourceLoc
  ): Semantic.Id {
    const leftType = getExprType(sr, a);
    const rightType = getExprType(sr, b);

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
          return leftType;
        }
        break;

      case EBinaryOperation.BoolAnd:
      case EBinaryOperation.BoolOr:
        assert(false, "Should be handled outside");
    }

    throw new CompilerError(
      `No safe ${BinaryOperationToString(
        operation
      )} operation is known between types '${serializeDatatype(
        sr,
        leftType
      )}' and '${serializeDatatype(sr, rightType)}'`,
      sourceloc
    );
  }

  const UnaryOperationResults = (sr: SemanticResult) => ({
    [EUnaryOperation.Plus]: [
      {
        from: makePrimitiveAvailable(sr, EPrimitive.i8),
        to: makePrimitiveAvailable(sr, EPrimitive.i8),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.i16),
        to: makePrimitiveAvailable(sr, EPrimitive.i16),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.i32),
        to: makePrimitiveAvailable(sr, EPrimitive.i32),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.i64),
        to: makePrimitiveAvailable(sr, EPrimitive.i64),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.u8),
        to: makePrimitiveAvailable(sr, EPrimitive.u8),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.u16),
        to: makePrimitiveAvailable(sr, EPrimitive.u16),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.u32),
        to: makePrimitiveAvailable(sr, EPrimitive.u32),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.u64),
        to: makePrimitiveAvailable(sr, EPrimitive.u64),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.f32),
        to: makePrimitiveAvailable(sr, EPrimitive.f32),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.f64),
        to: makePrimitiveAvailable(sr, EPrimitive.f64),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.int),
        to: makePrimitiveAvailable(sr, EPrimitive.int),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.real),
        to: makePrimitiveAvailable(sr, EPrimitive.real),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.usize),
        to: makePrimitiveAvailable(sr, EPrimitive.usize),
      },
    ],
    [EUnaryOperation.Minus]: [
      {
        from: makePrimitiveAvailable(sr, EPrimitive.i8),
        to: makePrimitiveAvailable(sr, EPrimitive.i8),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.i16),
        to: makePrimitiveAvailable(sr, EPrimitive.i16),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.i32),
        to: makePrimitiveAvailable(sr, EPrimitive.i32),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.i64),
        to: makePrimitiveAvailable(sr, EPrimitive.i64),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.u8),
        to: makePrimitiveAvailable(sr, EPrimitive.u8),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.u16),
        to: makePrimitiveAvailable(sr, EPrimitive.u16),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.u32),
        to: makePrimitiveAvailable(sr, EPrimitive.u32),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.u64),
        to: makePrimitiveAvailable(sr, EPrimitive.u64),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.f32),
        to: makePrimitiveAvailable(sr, EPrimitive.f32),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.f64),
        to: makePrimitiveAvailable(sr, EPrimitive.f64),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.int),
        to: makePrimitiveAvailable(sr, EPrimitive.int),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.real),
        to: makePrimitiveAvailable(sr, EPrimitive.real),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.usize),
        to: makePrimitiveAvailable(sr, EPrimitive.usize),
      },
    ],
    [EUnaryOperation.Negate]: [
      {
        from: makePrimitiveAvailable(sr, EPrimitive.bool),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.i8),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.i16),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.i32),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.i64),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.u8),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.u16),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.u32),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.u64),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.f32),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.f64),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.int),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.real),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
      {
        from: makePrimitiveAvailable(sr, EPrimitive.usize),
        to: makePrimitiveAvailable(sr, EPrimitive.bool),
      },
    ],
  });

  export function makeUnaryResultType(
    sr: SemanticResult,
    a: Semantic.Id,
    operation: EUnaryOperation,
    sourceloc: SourceLoc
  ): Semantic.Id {
    const ops = UnaryOperationResults(sr)[operation];

    for (const op of ops) {
      if (op.from === a) {
        return op.to;
      }
    }

    throw new CompilerError(
      `No unary ${UnaryOperationToString(
        operation
      )} operation is known for type '${serializeDatatype(sr, a)}'`,
      sourceloc
    );
  }
}
