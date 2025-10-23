import { EBinaryOperation } from "../shared/AST";
import { EPrimitive, primitiveToString, type LiteralValue } from "../shared/common";
import { assert, CompilerError, type SourceLoc } from "../shared/Errors";
import { Conversion } from "./Conversion";
import { Semantic, type SemanticResult } from "./Elaborate";

export const getLiteralIntegerValue = (literalValue: LiteralValue) => {
  if (
    literalValue.type === EPrimitive.i8 ||
    literalValue.type === EPrimitive.i16 ||
    literalValue.type === EPrimitive.i32 ||
    literalValue.type === EPrimitive.i64 ||
    literalValue.type === EPrimitive.int ||
    literalValue.type === EPrimitive.u8 ||
    literalValue.type === EPrimitive.u16 ||
    literalValue.type === EPrimitive.u32 ||
    literalValue.type === EPrimitive.u64 ||
    literalValue.type === EPrimitive.usize
  ) {
    return [literalValue.value, literalValue.type] as const;
  }
  return undefined;
};

export function EvalCTFE(
  sr: SemanticResult,
  exprId: Semantic.ExprId
): { ok: true; value: [Semantic.Expression, Semantic.ExprId] } | { ok: false; error: string } {
  const expr = sr.exprNodes.get(exprId);

  const ok = (value: [Semantic.Expression, Semantic.ExprId]) =>
    ({ ok: true, value: value } as const);
  const err = (error: string) => ({ ok: false, error: error } as const);

  switch (expr.variant) {
    case Semantic.ENode.BinaryExpr: {
      const leftR = EvalCTFE(sr, expr.left);
      const rightR = EvalCTFE(sr, expr.right);
      if (!leftR.ok) return err(leftR.error);
      if (!rightR.ok) return err(rightR.error);
      const [left, leftId] = leftR.value;
      const [right, rightId] = rightR.value;

      switch (expr.operation) {
        case EBinaryOperation.Equal:
        case EBinaryOperation.Unequal: {
          const negate = expr.operation === EBinaryOperation.Unequal;
          if (
            left.variant === Semantic.ENode.LiteralExpr &&
            right.variant === Semantic.ENode.LiteralExpr
          ) {
            const leftInteger = getLiteralIntegerValue(left.literal);
            const rightInteger = getLiteralIntegerValue(right.literal);

            if (leftInteger && rightInteger) {
              const equal = leftInteger[0] === rightInteger[0];
              return ok(sr.b.literal(negate ? !equal : equal, expr.sourceloc));
            }

            if (left.literal.type === right.literal.type) {
              if (left.literal.type === EPrimitive.null || right.literal.type === EPrimitive.null) {
                return ok(sr.b.literal(negate ? false : true, expr.sourceloc));
              }
              if (left.literal.type === EPrimitive.none || right.literal.type === EPrimitive.none) {
                return ok(sr.b.literal(negate ? false : true, expr.sourceloc));
              }
              const equal = left.literal.value === right.literal.value;
              return ok(sr.b.literal(negate ? !equal : equal, expr.sourceloc));
            }
            return err(
              `Cannot compare primitives ${primitiveToString(
                left.literal.type
              )} and ${primitiveToString(right.literal.type)} at compile time`
            );
          } else {
            return err(
              `Cannot compare expressions of types ${Semantic.serializeTypeUse(
                sr,
                left.type
              )} and ${Semantic.serializeTypeUse(sr, left.type)} at compile time`
            );
          }
        }

        case EBinaryOperation.BoolAnd: {
          const leftValue = EvalCTFEBoolean(sr, leftId, expr.sourceloc);
          const rightValue = EvalCTFEBoolean(sr, rightId, expr.sourceloc);
          return ok(sr.b.literal(leftValue && rightValue, expr.sourceloc));
        }

        case EBinaryOperation.BoolOr: {
          const leftValue = EvalCTFEBoolean(sr, leftId, expr.sourceloc);
          const rightValue = EvalCTFEBoolean(sr, rightId, expr.sourceloc);
          return ok(sr.b.literal(leftValue || rightValue, expr.sourceloc));
        }

        case EBinaryOperation.Subtract: {
          const leftValue = EvalCTFENumericValue(sr, leftId, expr.sourceloc);
          const rightValue = EvalCTFENumericValue(sr, rightId, expr.sourceloc);
          return ok(sr.b.literal(leftValue - rightValue, expr.sourceloc));
        }

        default:
          assert(false, expr.operation.toString());
      }
    }

    case Semantic.ENode.ExplicitCastExpr: {
      const r = EvalCTFE(sr, expr.expr);
      if (!r.ok) return err(r.error);
      const [value, valueId] = r.value;

      const targetType = sr.typeUseNodes.get(expr.type);
      const targetTypeDef = sr.typeDefNodes.get(targetType.type);
      if (value.variant === Semantic.ENode.LiteralExpr) {
        const integerLiteralValue = getLiteralIntegerValue(value.literal);
        if (targetTypeDef.variant === Semantic.ENode.PrimitiveDatatype && integerLiteralValue) {
          const limit = Conversion.getIntegerMinMax(targetTypeDef.primitive);
          const literalValue = integerLiteralValue[0];
          if (literalValue < limit[0] || literalValue > limit[1]) {
            return err(
              `This expression evaluated to a value of ${literalValue}, which is outside of the valid integer range ${Conversion.prettyRange(
                limit[0],
                limit[1],
                targetTypeDef.primitive
              )} for type ${primitiveToString(targetTypeDef.primitive)}.`
            );
          }

          return ok(
            sr.b.literalValue(
              {
                type: integerLiteralValue[1],
                unit: null,
                value: literalValue,
              },
              expr.sourceloc
            )
          );
        }
      }

      break;
    }

    case Semantic.ENode.SymbolValueExpr: {
      const symbol = sr.symbolNodes.get(expr.symbol);

      if (symbol.variant === Semantic.ENode.VariableSymbol) {
        assert(symbol.type);
        const symbolType = sr.typeUseNodes.get(symbol.type);
        const symbolTypeDef = sr.typeDefNodes.get(symbolType.type);

        if (symbolTypeDef.variant === Semantic.ENode.ParameterPackDatatype) {
          return ok([expr, exprId]);
        } else if (symbol.comptime) {
          assert(symbol.comptimeValue);
          const value = sr.exprNodes.get(symbol.comptimeValue);
          return ok([value, symbol.comptimeValue]);
        }
      }

      if (
        symbol.variant === Semantic.ENode.TypeDefSymbol &&
        sr.typeDefNodes.get(symbol.datatype).variant === Semantic.ENode.ParameterPackDatatype
      ) {
        return ok([expr, exprId]);
      }
      break;
    }

    case Semantic.ENode.LiteralExpr: {
      return ok([expr, exprId]);
    }

    default:
      break;
  }
  return err(`This Expression cannot be evaluated at compile time`);
}

export function EvalCTFENumericValue(
  sr: SemanticResult,
  exprId: Semantic.ExprId,
  sourceloc: SourceLoc
) {
  const r = EvalCTFE(sr, exprId);
  if (!r.ok) {
    throw new CompilerError(r.error, sourceloc);
  }
  const [result, resultId] = r.value;
  assert(result.variant === Semantic.ENode.LiteralExpr);

  if (
    result.literal.type === EPrimitive.u8 ||
    result.literal.type === EPrimitive.u16 ||
    result.literal.type === EPrimitive.u32 ||
    result.literal.type === EPrimitive.u64 ||
    result.literal.type === EPrimitive.usize ||
    result.literal.type === EPrimitive.i8 ||
    result.literal.type === EPrimitive.i16 ||
    result.literal.type === EPrimitive.i32 ||
    result.literal.type === EPrimitive.i64 ||
    result.literal.type === EPrimitive.int
  ) {
    return result.literal.value;
  } else {
    throw new CompilerError(`This value cannot be evaluated as an integer`, result.sourceloc);
  }
}

export function EvalCTFEBoolean(sr: SemanticResult, exprId: Semantic.ExprId, sourceloc: SourceLoc) {
  const r = EvalCTFE(sr, exprId);
  if (!r.ok) throw new CompilerError(r.error, sourceloc);
  const [result, resultId] = r.value;
  assert(result.variant === Semantic.ENode.LiteralExpr);

  if (result.literal.type === EPrimitive.bool) {
    return result.literal.value;
  } else {
    throw new CompilerError(
      `A primitive ${primitiveToString(
        result.literal.type
      )} value cannot be tested for truthiness, use explicit comparisons.`,
      result.sourceloc
    );
  }
}
