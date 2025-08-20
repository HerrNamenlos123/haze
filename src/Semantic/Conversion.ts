import { scaleRadial } from "d3";
import {
  BinaryOperationToString,
  EBinaryOperation,
  EExternLanguage,
  EOperator,
  EUnaryOperation,
  UnaryOperationToString,
} from "../shared/AST";
import { EMethodType, EPrimitive } from "../shared/common";
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
  isTypeConcrete,
  makePrimitiveAvailable,
  Semantic,
  type SemanticResult,
} from "./SemanticSymbols";
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

  export function isInteger(sr: SemanticResult, typeId: Semantic.Id): boolean {
    const type = sr.nodes.get(typeId);
    if (type.variant !== Semantic.ENode.PrimitiveDatatype) return false;
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
        return at.literal.value === bt.literal.value && at.literal.type === bt.literal.type;

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
    {
      from: EPrimitive.f64,
      to: [EPrimitive.real],
    },
    {
      from: EPrimitive.real,
      to: [EPrimitive.f64],
    },
    {
      from: EPrimitive.int,
      to: [EPrimitive.i64],
    },
    {
      from: EPrimitive.i64,
      to: [EPrimitive.int],
    },
  ];

  export function IsImplicitConversionAvailable(
    sr: SemanticResult,
    fromId: Semantic.Id,
    toId: Semantic.Id
  ) {
    const from = sr.nodes.get(fromId);
    const to = sr.nodes.get(toId);

    if (IsStructurallyEquivalent(sr, fromId, toId)) {
      return true;
    }

    if (to.variant === Semantic.ENode.ReferenceDatatype) {
      return IsStructurallyEquivalent(sr, fromId, to.referee);
    }
    if (from.variant === Semantic.ENode.ReferenceDatatype) {
      return IsStructurallyEquivalent(sr, from.referee, toId);
    }

    if (
      from.variant === Semantic.ENode.PrimitiveDatatype &&
      to.variant === Semantic.ENode.PrimitiveDatatype
    ) {
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

  function IsExplicitConversionAvailable(sr: SemanticResult, from: Semantic.Id, to: Semantic.Id) {
    if (IsImplicitConversionAvailable(sr, from, to)) {
      return true;
    }
    return false;
  }

  export function MakeImplicitConversion(
    sr: SemanticResult,
    fromExprId: Semantic.Id,
    toTypeId: Semantic.Id,
    sourceloc: SourceLoc
  ) {
    const from = sr.nodes.get(fromExprId);
    assert(isExpression(from));

    if (!IsImplicitConversionAvailable(sr, from.type, toTypeId)) {
      throw new CompilerError(
        `No implicit lossless Conversion from '${serializeDatatype(
          sr,
          from.type
        )}' to '${serializeDatatype(sr, toTypeId)}' available`,
        sourceloc
      );
    }
    return MakeExplicitConversion(sr, fromExprId, toTypeId, sourceloc);
  }

  export function MakeExplicitConversion(
    sr: SemanticResult,
    fromId: Semantic.Id,
    toId: Semantic.Id,
    sourceloc: SourceLoc
  ) {
    const from = sr.nodes.get(fromId);
    assert(isExpression(from));
    const to = sr.nodes.get(toId);
    // assert(isData(from));

    if (from.type === toId) {
      return fromId;
    }

    if (IsStructurallyEquivalent(sr, from.type, toId)) {
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromId,
        type: toId,
        sourceloc: sourceloc,
      })[1];
    }

    if (!IsExplicitConversionAvailable(sr, from.type, toId)) {
      throw new CompilerError(
        `No explicit Conversion from '${serializeDatatype(sr, from.type)}' to '${serializeDatatype(
          sr,
          toId
        )}' available`,
        sourceloc
      );
    }

    if (to.variant === Semantic.ENode.ReferenceDatatype) {
      // Conversion from anything to a reference
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromId,
        type: toId,
        sourceloc: sourceloc,
      })[1];
    }

    if (sr.nodes.get(from.type).variant === Semantic.ENode.ReferenceDatatype) {
      // Conversion from a reference to whatever it references
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        expr: fromId,
        type: toId,
        sourceloc: sourceloc,
      })[1];
    }

    const fromType = sr.nodes.get(from.type);
    if (
      fromType.variant === Semantic.ENode.PrimitiveDatatype &&
      to.variant === Semantic.ENode.PrimitiveDatatype
    ) {
      for (const conv of SafeImplicitPrimitiveConversionTable) {
        if (conv.from === fromType.primitive) {
          if (conv.to.includes(to.primitive)) {
            return Semantic.addNode(sr, {
              variant: Semantic.ENode.ExplicitCastExpr,
              expr: fromId,
              type: toId,
              sourceloc: sourceloc,
            })[1];
          }
        }
      }
    }

    throw new ImpossibleSituation();
  }

  export function makeComparisonResultType(
    sr: SemanticResult,
    a: Semantic.Id,
    b: Semantic.Id,
    sourceloc: SourceLoc
  ): Semantic.Id {
    const leftType = getExprType(sr, a);
    const rightType = getExprType(sr, b);

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
        ],
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
      if (c.comparable.includes(leftType) && c.comparable.includes(rightType)) {
        return makePrimitiveAvailable(sr, EPrimitive.bool);
      }
    }

    throw new CompilerError(
      `No safe comparison is available between types '${serializeDatatype(
        sr,
        leftType
      )}' and '${serializeDatatype(sr, rightType)}'`,
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

  export function makeAsOperator(
    sr: SemanticResult,
    targetType: Semantic.Id
  ): Semantic.FunctionSymbol {
    for (const f of sr.overloadedOperators) {
      if (
        f.name === "__operator_as" &&
        f.operatorOverloading?.operator === EOperator.As &&
        IsStructurallyEquivalent(sr, f.operatorOverloading.asTarget, targetType)
      ) {
        return f;
      }
    }
    // const func = {
    //   variant: Semantic.ENode.FunctionSymbol,
    //   concrete: true,
    //   export: false,
    //   staticMethod: false,
    //   extern: EExternLanguage.None,
    //   methodType: EMethodType.NotAMethod,
    //   name: "__operator_as",
    //   generics: [],
    //   parameterNames: [],
    //   type: {
    //     variant: "FunctionDatatype",
    //     concrete: true,
    //     parameters: [],
    //     returnType: targetType,
    //     vararg: false,
    //   },
    //   parentStructOrNS: null,
    //   sourceloc: null,
    //   operatorOverloading: {
    //     operator: EOperator.As,
    //     asTarget: targetType,
    //   },
    // } satisfies Semantic.FunctionSymbol;
    // sr.overloadedOperators.push(func);
    // return func;
    assert(false);
  }
}
