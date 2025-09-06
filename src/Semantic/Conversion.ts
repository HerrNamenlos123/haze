import {
  BinaryOperationToString,
  EBinaryOperation,
  EClonability,
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

  export function prettyRange(
    min: bigint,
    max: bigint,
    type: Semantic.PrimitiveDatatypeDef
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

      case Semantic.ENode.LiteralValueDatatype:
        assert(bt.variant === Semantic.ENode.LiteralValueDatatype);
        if (at.literal.type === EPrimitive.null) {
          return at.literal.type === bt.literal.type;
        } else {
          return at.literal.type === bt.literal.type && at.literal.value === bt.literal.value;
        }

      case Semantic.ENode.PointerDatatype: {
        assert(bt.variant === Semantic.ENode.PointerDatatype);
        const aPointee = sr.typeUseNodes.get(at.pointee);
        const bPointee = sr.typeUseNodes.get(bt.pointee);
        return IsStructurallyEquivalent(sr, aPointee.type, bPointee.type, seen);
      }

      case Semantic.ENode.ReferenceDatatype: {
        assert(bt.variant === Semantic.ENode.ReferenceDatatype);
        const aReferee = sr.typeUseNodes.get(at.referee);
        const bReferee = sr.typeUseNodes.get(bt.referee);
        return IsStructurallyEquivalent(sr, aReferee.type, bReferee.type, seen);
      }

      case Semantic.ENode.ArrayDatatype: {
        assert(bt.variant === Semantic.ENode.ArrayDatatype);
        const a = sr.typeUseNodes.get(at.datatype);
        const b = sr.typeUseNodes.get(bt.datatype);
        return IsStructurallyEquivalent(sr, a.type, b.type, seen) && at.length === bt.length;
      }

      case Semantic.ENode.SliceDatatype: {
        assert(bt.variant === Semantic.ENode.SliceDatatype);
        const a = sr.typeUseNodes.get(at.datatype);
        const b = sr.typeUseNodes.get(bt.datatype);
        return IsStructurallyEquivalent(sr, a.type, b.type, seen);
      }

      case Semantic.ENode.FunctionDatatype: {
        assert(bt.variant === Semantic.ENode.FunctionDatatype);
        const a = sr.typeUseNodes.get(at.returnType);
        const b = sr.typeUseNodes.get(bt.returnType);
        return (
          at.vararg === bt.vararg &&
          IsStructurallyEquivalent(sr, a.type, b.type, seen) &&
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
              sr.typeUseNodes.get(at.generics[i]).type,
              sr.typeUseNodes.get(bt.generics[i]).type,
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
        assert(false, "All cases handled");
    }
  }

  export enum Mode {
    Implicit,
    Explicit,
  }

  export function MakeConversion(
    sr: SemanticResult,
    fromExprId: Semantic.ExprId,
    toId: Semantic.TypeUseId,
    constraints: Semantic.Constraint[],
    sourceloc: SourceLoc,
    mode: Mode
  ) {
    const fromExpr = sr.exprNodes.get(fromExprId);
    const fromTypeInstance = sr.typeUseNodes.get(fromExpr.type);
    const fromType = sr.typeDefNodes.get(fromTypeInstance.type);
    const toInstance = sr.typeUseNodes.get(toId);
    const to = sr.typeDefNodes.get(toInstance.type);

    // Conversion of Struct to Struct
    if (
      fromType.variant === Semantic.ENode.StructDatatype &&
      to.variant === Semantic.ENode.StructDatatype &&
      fromExpr.type === toId &&
      !fromExpr.isTemporary &&
      (to.clonability === EClonability.NonClonableFromAttribute ||
        to.clonability === EClonability.NonClonableFromMembers)
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

    if (fromExpr.type === toId) {
      return fromExprId;
    }

    // Conversion from T to T&
    if (to.variant === Semantic.ENode.ReferenceDatatype) {
      if (fromExpr.isTemporary) {
        throw new CompilerError(
          `This expression of type '${Semantic.serializeTypeUse(
            sr,
            fromExpr.type
          )}' cannot be turned into a reference, because it is a temporary and not associated with a stable memory address. Store it in a variable to be able to reference it.`,
          sourceloc
        );
      }
      return Semantic.addExpr(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromExprId,
        type: toId,
        sourceloc: sourceloc,
        isTemporary: fromExpr.isTemporary,
      })[1];
    }

    // Conversion from T& to T
    if (fromType.variant === Semantic.ENode.ReferenceDatatype) {
      if (
        fromType.variant === Semantic.ENode.ReferenceDatatype &&
        to.variant === Semantic.ENode.StructDatatype &&
        fromType.referee === toId
      ) {
        const fromTypeRefereeInstance = sr.typeUseNodes.get(fromType.referee);
        const fromTypeReferee = sr.typeDefNodes.get(fromTypeRefereeInstance.type);
        assert(fromTypeReferee.variant === Semantic.ENode.StructDatatype);
        if (
          fromTypeReferee.clonability === EClonability.NonClonableFromAttribute ||
          fromTypeReferee.clonability === EClonability.NonClonableFromMembers
        ) {
          const msg =
            to.clonability === EClonability.NonClonableFromAttribute
              ? "marked as 'nonclonable'"
              : "non-clonable because it contains raw pointers or other non-clonable structures";
          throw new CompilerError(
            `Conversion from '${Semantic.serializeTypeUse(
              sr,
              fromExpr.type
            )}' to '${Semantic.serializeTypeUse(
              sr,
              toId
            )}' would create a copy of the struct, but the struct definition is ${msg}`,
            sourceloc
          );
        }
      }

      return Semantic.addExpr(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromExprId,
        type: toId,
        sourceloc: sourceloc,
        isTemporary: fromExpr.isTemporary,
      })[1];
    }

    // Conversion from str to c_str
    if (
      fromType.variant === Semantic.ENode.PrimitiveDatatype &&
      to.variant === Semantic.ENode.PrimitiveDatatype &&
      fromType.primitive === EPrimitive.str &&
      to.primitive === EPrimitive.c_str
    ) {
      if (fromExpr.variant === Semantic.ENode.LiteralExpr) {
        assert(fromExpr.literal.type === EPrimitive.str);
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.LiteralExpr,
          literal: {
            type: EPrimitive.c_str,
            value: fromExpr.literal.value,
          },
          isTemporary: true,
          type: makePrimitiveAvailable(sr, EPrimitive.c_str, EDatatypeMutability.Const, sourceloc),
          sourceloc: fromExpr.sourceloc,
        })[1];
      }
      throw new CompilerError(
        `Conversion from str to c_str (const char*) is not possible because the value is not known at compile time, therefore no C string literal can be emitted that preserves null termination. For runtime strings, use str.c_str(arena).`,
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
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.ExplicitCastExpr,
          expr: fromExprId,
          type: toId,
          sourceloc: sourceloc,
          isTemporary: fromExpr.isTemporary,
        })[1];
      } else {
        let [sourceMinValue, sourceMaxValue] = Conversion.getIntegerMinMax(f.primitive);
        let [targetMinValue, targetMaxValue] = Conversion.getIntegerMinMax(t.primitive);

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
          if (value.literal.value > sourceMinValue) {
            sourceMinValue = value.literal.value;
          }
          if (value.literal.value < sourceMaxValue) {
            sourceMaxValue = value.literal.value;
          }
        }

        if (fromExpr.variant === Semantic.ENode.LiteralExpr) {
          applyLiteral(fromExprId);
        } else if (fromExpr.variant === Semantic.ENode.SymbolValueExpr) {
          const symbol = sr.symbolNodes.get(fromExpr.symbol);
          assert(symbol.variant === Semantic.ENode.VariableSymbol);
          if (symbol.comptime && symbol.comptimeValue) {
            applyLiteral(symbol.comptimeValue);
          }
        }

        for (const constraint of constraints) {
          if (fromExpr.variant !== Semantic.ENode.SymbolValueExpr) {
            continue;
          }

          if (constraint.variableSymbol !== fromExpr.symbol) {
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
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.ExplicitCastExpr,
            expr: fromExprId,
            type: toId,
            sourceloc: sourceloc,
            isTemporary: fromExpr.isTemporary,
          })[1];
        }

        let sourceRangeText = "";
        if (sourceMaxValue !== sourceMinValue) {
          sourceRangeText = `range ${Conversion.prettyRange(sourceMinValue, sourceMaxValue, f)}`;
        } else {
          sourceRangeText = `value ${sourceMinValue}`;
        }

        throw new CompilerError(
          `No safe conversion from '${Semantic.serializeTypeUse(
            sr,
            fromExpr.type
          )}' to '${Semantic.serializeTypeUse(
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
      return Semantic.addExpr(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromExprId,
        type: toId,
        sourceloc: sourceloc,
        isTemporary: fromExpr.isTemporary,
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
      return Semantic.addExpr(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromExprId,
        type: toId,
        sourceloc: sourceloc,
        isTemporary: fromExpr.isTemporary,
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
      return Semantic.addExpr(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromExprId,
        type: toId,
        sourceloc: sourceloc,
        isTemporary: fromExpr.isTemporary,
      })[1];
    }

    // Pointer conversions
    if (
      fromType.variant === Semantic.ENode.PointerDatatype &&
      to.variant === Semantic.ENode.PointerDatatype
    ) {
      const frompointeeInstance = sr.typeUseNodes.get(fromType.pointee);
      const frompointee = sr.typeDefNodes.get(frompointeeInstance.type);
      // Conversion from void* to T*
      if (
        frompointee.variant === Semantic.ENode.PrimitiveDatatype &&
        frompointee.primitive === EPrimitive.void
      ) {
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.ExplicitCastExpr,
          expr: fromExprId,
          type: toId,
          sourceloc: sourceloc,
          isTemporary: fromExpr.isTemporary,
        })[1];
      }
      // Conversion from T* to void*
      const topointeeInstance = sr.typeUseNodes.get(to.pointee);
      const topointee = sr.typeDefNodes.get(topointeeInstance.type);
      if (
        topointee.variant === Semantic.ENode.PrimitiveDatatype &&
        topointee.primitive === EPrimitive.void
      ) {
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.ExplicitCastExpr,
          expr: fromExprId,
          type: toId,
          sourceloc: sourceloc,
          isTemporary: fromExpr.isTemporary,
        })[1];
      }
    }

    // Core conversions
    if (
      IsStructurallyEquivalent(
        sr,
        sr.typeUseNodes.get(fromExpr.type).type,
        sr.typeUseNodes.get(toId).type
      )
    ) {
      return Semantic.addExpr(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromExprId,
        type: toId,
        sourceloc: sourceloc,
        isTemporary: fromExpr.isTemporary,
      })[1];
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
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.LiteralExpr,
          isTemporary: true,
          literal: {
            type: targetType.primitive,
            unit: null,
            value: 0n,
          },
          type: targetTypeId,
          sourceloc: sourceloc,
        } satisfies Semantic.LiteralExpr)[1];
      } else if (
        targetType.primitive === EPrimitive.f32 ||
        targetType.primitive === EPrimitive.f64 ||
        targetType.primitive === EPrimitive.real
      ) {
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.LiteralExpr,
          isTemporary: true,
          literal: {
            type: targetType.primitive,
            unit: null,
            value: 0,
          },
          type: targetTypeId,
          sourceloc: sourceloc,
        } satisfies Semantic.LiteralExpr)[1];
      } else if (targetType.primitive === EPrimitive.bool) {
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.LiteralExpr,
          isTemporary: true,
          literal: {
            type: EPrimitive.bool,
            value: false,
          },
          type: targetTypeId,
          sourceloc: sourceloc,
        } satisfies Semantic.LiteralExpr)[1];
      } else if (targetType.primitive === EPrimitive.null) {
        return Semantic.addExpr(sr, {
          variant: Semantic.ENode.LiteralExpr,
          isTemporary: true,
          literal: {
            type: EPrimitive.null,
          },
          type: targetTypeId,
          sourceloc: sourceloc,
        } satisfies Semantic.LiteralExpr)[1];
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
        const collectedStruct = sr.cc.nodes.get(targetType.collectedSymbol);
        assert(collectedStruct.variant === Collect.ENode.StructDefinitionSymbol);
        // Make an empty struct instantiation and let it handle the default values, since we know they all exist.
        return Semantic.makeStructInstantiation(sr, sr.typeUseNodes.get(targetTypeId).type, {
          blockScope: null,
          context: Semantic.makeElaborationContext({
            currentScope: collectedStruct.structScope,
            genericsScope: collectedStruct.structScope,
          }),
          elaboratedVariables: new Map(),
          isMonomorphized: false,
          sourceloc: sourceloc,
          memberValues: [],
        })[1];
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

    if (
      leftType.variant === Semantic.ENode.PointerDatatype &&
      rightType.variant === Semantic.ENode.PointerDatatype
    ) {
      return makePrimitiveAvailable(sr, EPrimitive.bool, EDatatypeMutability.Const, sourceloc);
    }

    throw new CompilerError(
      `No safe comparison is available between types '${Semantic.serializeTypeUseFromDef(
        sr,
        leftTypeId
      )}' and '${Semantic.serializeTypeUseFromDef(sr, rightTypeId)}'`,
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
          return makeTypeUse(sr, leftType, EDatatypeMutability.Const, sourceloc)[1];
        }
        break;

      case EBinaryOperation.BoolAnd:
      case EBinaryOperation.BoolOr:
        assert(false, "Should be handled outside");
    }

    throw new CompilerError(
      `No safe ${BinaryOperationToString(
        operation
      )} operation is known between types '${Semantic.serializeTypeUseFromDef(
        sr,
        leftType
      )}' and '${Semantic.serializeTypeUseFromDef(sr, rightType)}'`,
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
        return makeTypeUse(sr, op.to, EDatatypeMutability.Const, sourceloc)[1];
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
