import { EBinaryOperation } from "../shared/AST";
import { EPrimitive, primitiveToString, type LiteralValue } from "../shared/common";
import { assert, CompilerError, type SourceLoc } from "../shared/Errors";
import { Conversion } from "./Conversion";
import { Semantic } from "./SemanticTypes";

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

export function EvalCTFEOrFail(
  sr: Semantic.Context,
  exprId: Semantic.ExprId,
  sourceloc: SourceLoc,
) {
  const valueResult = EvalCTFE(sr, exprId);
  if (!valueResult.ok) {
    throw new CompilerError(valueResult.error, sourceloc);
  }
  return valueResult.value;
}

export function EvalCTFE(
  sr: Semantic.Context,
  exprId: Semantic.ExprId,
): { ok: true; value: [Semantic.Expression, Semantic.ExprId] } | { ok: false; error: string } {
  const expr = sr.exprNodes.get(exprId);

  const ok = (value: [Semantic.Expression, Semantic.ExprId]) =>
    ({ ok: true, value: value }) as const;
  const err = (error: string) => ({ ok: false, error: error }) as const;

  switch (expr.variant) {
    case Semantic.ENode.BinaryExpr: {
      let left = EvalCTFE(sr, expr.left);
      let right = EvalCTFE(sr, expr.right);
      if (!left.ok) return err(left.error);
      if (!right.ok) return err(right.error);

      left = EvalCTFE(sr, sr.e.unwrapReactiveOrComputedIfPossible(left.value[1]));
      right = EvalCTFE(sr, sr.e.unwrapReactiveOrComputedIfPossible(right.value[1]));
      if (!left.ok) return err(left.error);
      if (!right.ok) return err(right.error);

      switch (expr.operation) {
        case EBinaryOperation.Equal:
        case EBinaryOperation.NotEqual: {
          const negate = expr.operation === EBinaryOperation.NotEqual;

          if (
            left.value[0].variant === Semantic.ENode.LiteralExpr &&
            right.value[0].variant === Semantic.ENode.LiteralExpr
          ) {
            const leftInteger = getLiteralIntegerValue(left.value[0].literal);
            const rightInteger = getLiteralIntegerValue(right.value[0].literal);

            if (leftInteger && rightInteger) {
              const equal = leftInteger[0] === rightInteger[0];
              return ok(sr.b.literal(negate ? !equal : equal, expr.sourceloc));
            }

            if (left.value[0].literal.type === right.value[0].literal.type) {
              if (left.value[0].literal.type === EPrimitive.null) {
                assert(right.value[0].literal.type === EPrimitive.null);
                return ok(sr.b.literal(negate ? false : true, expr.sourceloc));
              }
              if (left.value[0].literal.type === EPrimitive.none) {
                assert(right.value[0].literal.type === EPrimitive.none);
                return ok(sr.b.literal(negate ? false : true, expr.sourceloc));
              }
              if (left.value[0].literal.type === EPrimitive.Regex) {
                assert(right.value[0].literal.type === EPrimitive.Regex);
                assert(left.value[0].literal.id);
                assert(right.value[0].literal.id);
                return ok(
                  sr.b.literal(
                    left.value[0].literal.id === right.value[0].literal.id,
                    expr.sourceloc,
                  ),
                );
              }
              if (left.value[0].literal.type === "enum") {
                assert(right.value[0].literal.type === "enum");
                const equal =
                  left.value[0].literal.enumType === right.value[0].literal.enumType &&
                  left.value[0].literal.valueName === right.value[0].literal.valueName;
                return ok(sr.b.literal(negate ? !equal : equal, expr.sourceloc));
              }
              assert(
                right.value[0].literal.type !== EPrimitive.null &&
                  right.value[0].literal.type !== EPrimitive.none &&
                  right.value[0].literal.type !== EPrimitive.Regex &&
                  right.value[0].literal.type !== "enum",
              );
              const equal = left.value[0].literal.value === right.value[0].literal.value;
              return ok(sr.b.literal(negate ? !equal : equal, expr.sourceloc));
            }

            return err(
              `Cannot compare values of type ${Semantic.serializeLiteralType(
                sr,
                left.value[0].literal,
              )} and ${Semantic.serializeLiteralType(sr, right.value[0].literal)} at compile time`,
            );
          } else if (
            left.value[0].variant === Semantic.ENode.DatatypeAsValueExpr &&
            right.value[0].variant === Semantic.ENode.DatatypeAsValueExpr
          ) {
            const equal = left.value[0].type === right.value[0].type;
            return ok(sr.b.literal(negate ? !equal : equal, expr.sourceloc));
          } else {
            return err(
              `Cannot compare expressions of types ${Semantic.serializeTypeUse(
                sr,
                left.value[0].type,
              )} and ${Semantic.serializeTypeUse(sr, right.value[0].type)} at compile time`,
            );
          }
        }

        case EBinaryOperation.BoolAnd: {
          const leftValue = EvalCTFEBoolean(sr, left.value[1]);
          // Short-circuit: if left is false, we don't need to evaluate right
          if (!leftValue) {
            return ok(sr.b.literal(false, expr.sourceloc));
          }
          const rightValue = EvalCTFEBoolean(sr, right.value[1]);
          return ok(sr.b.literal(leftValue && rightValue, expr.sourceloc));
        }

        case EBinaryOperation.BoolOr: {
          const leftValue = EvalCTFEBoolean(sr, left.value[1]);
          // Short-circuit: if left is true, we don't need to evaluate right
          if (leftValue) {
            return ok(sr.b.literal(true, expr.sourceloc));
          }
          const rightValue = EvalCTFEBoolean(sr, right.value[1]);
          return ok(sr.b.literal(leftValue || rightValue, expr.sourceloc));
        }

        case EBinaryOperation.Add: {
          const leftValue = EvalCTFENumericValue(sr, left.value[1], expr.sourceloc);
          const rightValue = EvalCTFENumericValue(sr, right.value[1], expr.sourceloc);
          return ok(sr.b.literal(leftValue + rightValue, expr.sourceloc));
        }

        case EBinaryOperation.Subtract: {
          const leftValue = EvalCTFENumericValue(sr, left.value[1], expr.sourceloc);
          const rightValue = EvalCTFENumericValue(sr, right.value[1], expr.sourceloc);
          return ok(sr.b.literal(leftValue - rightValue, expr.sourceloc));
        }

        default:
          assert(false, expr.operation.toString());
      }
    }

    case Semantic.ENode.ExplicitCastExpr: {
      const r = EvalCTFE(sr, expr.expr);
      if (!r.ok) return err(r.error);
      const [value] = r.value;

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
                targetTypeDef.primitive,
                "integer",
              )} for type ${primitiveToString(targetTypeDef.primitive)}.`,
            );
          }

          return ok(
            sr.b.literalValue(
              {
                type: integerLiteralValue[1],
                unit: null,
                value: literalValue,
              },
              expr.sourceloc,
            ),
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

    case Semantic.ENode.DatatypeAsValueExpr:
    case Semantic.ENode.LiteralExpr: {
      return ok([expr, exprId]);
    }

    case Semantic.ENode.ComputedReadExpr:
    case Semantic.ENode.ReactiveReadExpr: {
      return EvalCTFE(sr, expr.value);
    }

    default:
      break;
  }
  return err(`This Expression cannot be evaluated at compile time`);
}

export function EvalCTFENumericValue(
  sr: Semantic.Context,
  exprId: Semantic.ExprId,
  sourceloc: SourceLoc,
) {
  const r = EvalCTFE(sr, exprId);
  if (!r.ok) {
    throw new CompilerError(r.error, sourceloc);
  }
  const [result] = r.value;
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

export function EvalCTFEBoolean(sr: Semantic.Context, exprId: Semantic.ExprId) {
  const r = EvalCTFE(sr, exprId);
  const expr = sr.exprNodes.get(exprId);
  if (!r.ok) throw new CompilerError(r.error, expr.sourceloc);
  const [result] = r.value;

  if (result.variant === Semantic.ENode.LiteralExpr) {
    if (result.literal.type === EPrimitive.bool) {
      return result.literal.value;
    } else {
      throw new CompilerError(
        `A ${
          result.literal.type === "enum" ? `Enum Literal` : primitiveToString(result.literal.type)
        } value cannot be tested for truthiness, use explicit comparisons.`,
        result.sourceloc,
      );
    }
  }

  // Handle DatatypeAsValueExpr that contains a LiteralDatatype
  if (result.variant === Semantic.ENode.DatatypeAsValueExpr) {
    const typeUse = sr.typeUseNodes.get(result.type);
    const typeDef = sr.typeDefNodes.get(typeUse.type);

    if (typeDef.variant === Semantic.ENode.LiteralDatatype) {
      if (typeDef.literalValue.type === EPrimitive.bool) {
        return typeDef.literalValue.value;
      } else {
        throw new CompilerError(
          `A ${
            typeDef.literalValue.type === "enum"
              ? `Enum Literal`
              : primitiveToString(typeDef.literalValue.type)
          } value cannot be tested for truthiness, use explicit comparisons.`,
          result.sourceloc,
        );
      }
    }

    throw new CompilerError(
      `Type expression cannot be evaluated as a boolean value`,
      result.sourceloc,
    );
  }

  throw new CompilerError(
    `Expression cannot be evaluated as a boolean value at compile time`,
    expr.sourceloc,
  );
}
