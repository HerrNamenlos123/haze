import { EBinaryOperation, EDatatypeMutability } from "../shared/AST";
import { EPrimitive, primitiveToString } from "../shared/common";
import { assert, CompilerError, type SourceLoc } from "../shared/Errors";
import { Conversion } from "./Conversion";
import { makePrimitiveAvailable, Semantic, type SemanticResult } from "./Elaborate";

function makeBoolValue(sr: SemanticResult, value: boolean, sourceloc: SourceLoc) {
  return Semantic.addExpr(sr, {
    variant: Semantic.ENode.LiteralExpr,
    literal: {
      type: EPrimitive.bool,
      value: value,
    },
    isTemporary: true,
    type: makePrimitiveAvailable(sr, EPrimitive.bool, EDatatypeMutability.Const, sourceloc),
    sourceloc: null,
  });
}

const TRIVIAL_LITERAL_COMPARISONS = [
  EPrimitive.str,
  EPrimitive.c_str,
  EPrimitive.f32,
  EPrimitive.f64,
  EPrimitive.u8,
  EPrimitive.u16,
  EPrimitive.u32,
  EPrimitive.u64,
  EPrimitive.i8,
  EPrimitive.i16,
  EPrimitive.i32,
  EPrimitive.i64,
  EPrimitive.int,
  EPrimitive.usize,
  EPrimitive.null,
  EPrimitive.real,
  EPrimitive.bool,
] as const;

export function CanEvaluateCTFE(sr: SemanticResult, exprId: Semantic.ExprId): boolean {
  const expr = sr.exprNodes.get(exprId);
  switch (expr.variant) {
    case Semantic.ENode.BinaryExpr: {
      if (!CanEvaluateCTFE(sr, expr.left) || !CanEvaluateCTFE(sr, expr.right)) {
        return false;
      }

      const [left, leftId] = EvalCTFE(sr, expr.left);
      const [right, rightId] = EvalCTFE(sr, expr.right);

      switch (expr.operation) {
        case EBinaryOperation.Equal:
          if (
            left.variant === Semantic.ENode.LiteralExpr &&
            right.variant === Semantic.ENode.LiteralExpr
          ) {
            if (
              TRIVIAL_LITERAL_COMPARISONS.includes(left.literal.type) &&
              TRIVIAL_LITERAL_COMPARISONS.includes(right.literal.type) &&
              left.literal.type === right.literal.type
            ) {
              return true;
            }
            return false;
          } else {
            return false;
          }

        case EBinaryOperation.BoolAnd:
        case EBinaryOperation.BoolOr: {
          return CanEvaluateCTFE(sr, leftId) && CanEvaluateCTFE(sr, leftId);
        }

        case EBinaryOperation.Add:
        case EBinaryOperation.Subtract:
        case EBinaryOperation.Multiply:
        case EBinaryOperation.Divide:
        case EBinaryOperation.Modulo:
          return false;

        default:
          assert(false);
      }
    }

    case Semantic.ENode.SymbolValueExpr: {
      const symbol = sr.symbolNodes.get(expr.symbol);
      if (symbol.variant === Semantic.ENode.VariableSymbol && symbol.comptime) {
        return true;
      } else if (
        symbol.variant === Semantic.ENode.TypeDefSymbol &&
        sr.typeDefNodes.get(symbol.datatype).variant === Semantic.ENode.ParameterPackDatatype
      ) {
        return true;
      }
      return false;
    }

    case Semantic.ENode.LiteralExpr: {
      return true;
    }

    default:
      break;
  }

  return false;
}

export function EvalCTFE(
  sr: SemanticResult,
  exprId: Semantic.ExprId
): [Semantic.Expression, Semantic.ExprId] {
  const expr = sr.exprNodes.get(exprId);
  switch (expr.variant) {
    case Semantic.ENode.BinaryExpr: {
      const [left, leftId] = EvalCTFE(sr, expr.left);
      const [right, rightId] = EvalCTFE(sr, expr.right);

      switch (expr.operation) {
        case EBinaryOperation.Equal:
        case EBinaryOperation.Unequal: {
          const negate = expr.operation === EBinaryOperation.Unequal;
          if (
            left.variant === Semantic.ENode.LiteralExpr &&
            right.variant === Semantic.ENode.LiteralExpr
          ) {
            if (
              TRIVIAL_LITERAL_COMPARISONS.includes(left.literal.type) &&
              TRIVIAL_LITERAL_COMPARISONS.includes(right.literal.type) &&
              left.literal.type === right.literal.type
            ) {
              if (left.literal.type === EPrimitive.null || right.literal.type === EPrimitive.null) {
                return makeBoolValue(sr, negate ? false : true, expr.sourceloc);
              }
              return makeBoolValue(
                sr,
                negate
                  ? left.literal.value !== right.literal.value
                  : left.literal.value === right.literal.value,
                expr.sourceloc
              );
            }
            throw new CompilerError(
              `Cannot compare primitives ${primitiveToString(
                left.literal.type
              )} and ${primitiveToString(right.literal.type)} at compile time`,
              "sourceloc" in expr ? expr.sourceloc : null
            );
          } else {
            throw new CompilerError(
              `Cannot compare expressions of types ${Semantic.serializeTypeUse(
                sr,
                left.type
              )} and ${Semantic.serializeTypeUse(sr, left.type)} at compile time`,
              "sourceloc" in expr ? expr.sourceloc : null
            );
          }
        }

        case EBinaryOperation.BoolAnd: {
          const leftValue = EvalCTFEBoolean(sr, leftId);
          const rightValue = EvalCTFEBoolean(sr, rightId);
          return makeBoolValue(sr, leftValue && rightValue, expr.sourceloc);
        }

        case EBinaryOperation.BoolOr: {
          const leftValue = EvalCTFEBoolean(sr, leftId);
          const rightValue = EvalCTFEBoolean(sr, rightId);
          return makeBoolValue(sr, leftValue || rightValue, expr.sourceloc);
        }

        case EBinaryOperation.Subtract: {
          const leftValue = EvalCTFENumericValue(sr, leftId);
          const rightValue = EvalCTFENumericValue(sr, rightId);
          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.LiteralExpr,
            isTemporary: true,
            literal: {
              type: EPrimitive.int,
              unit: null,
              value: leftValue - rightValue,
            },
            type: expr.type,
            sourceloc: expr.sourceloc,
          });
        }

        default:
          assert(false, expr.operation.toString());
      }
    }

    case Semantic.ENode.ExplicitCastExpr: {
      const [value, valueId] = EvalCTFE(sr, expr.expr);

      const targetType = sr.typeUseNodes.get(expr.type);
      const targetTypeDef = sr.typeDefNodes.get(targetType.type);
      if (value.variant === Semantic.ENode.LiteralExpr) {
        if (
          targetTypeDef.variant === Semantic.ENode.PrimitiveDatatype &&
          (value.literal.type === EPrimitive.i8 ||
            value.literal.type === EPrimitive.i16 ||
            value.literal.type === EPrimitive.i32 ||
            value.literal.type === EPrimitive.i64 ||
            value.literal.type === EPrimitive.int ||
            value.literal.type === EPrimitive.u8 ||
            value.literal.type === EPrimitive.u16 ||
            value.literal.type === EPrimitive.u32 ||
            value.literal.type === EPrimitive.u64 ||
            value.literal.type === EPrimitive.usize) &&
          (targetTypeDef.primitive === EPrimitive.i8 ||
            targetTypeDef.primitive === EPrimitive.i16 ||
            targetTypeDef.primitive === EPrimitive.i32 ||
            targetTypeDef.primitive === EPrimitive.i64 ||
            targetTypeDef.primitive === EPrimitive.int ||
            targetTypeDef.primitive === EPrimitive.u8 ||
            targetTypeDef.primitive === EPrimitive.u16 ||
            targetTypeDef.primitive === EPrimitive.u32 ||
            targetTypeDef.primitive === EPrimitive.u64 ||
            targetTypeDef.primitive === EPrimitive.usize)
        ) {
          const limit = Conversion.getIntegerMinMax(targetTypeDef.primitive);
          const literalValue = value.literal.value;
          if (literalValue < limit[0] || literalValue > limit[1]) {
            throw new CompilerError(
              `This expression evaluated to a value of ${literalValue}, which is outside of the valid integer range ${Conversion.prettyRange(
                limit[0],
                limit[1],
                targetTypeDef.primitive
              )} for type ${primitiveToString(targetTypeDef.primitive)}.`,
              expr.sourceloc
            );
          }

          return Semantic.addExpr(sr, {
            variant: Semantic.ENode.LiteralExpr,
            isTemporary: true,
            literal: {
              type: targetTypeDef.primitive,
              unit: null,
              value: literalValue,
            },
            type: expr.type,
            sourceloc: expr.sourceloc,
          });
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
          return [expr, exprId];
        } else if (symbol.comptime) {
          assert(symbol.comptimeValue);
          const value = sr.exprNodes.get(symbol.comptimeValue);
          return [value, symbol.comptimeValue];
        }
      }

      if (
        symbol.variant === Semantic.ENode.TypeDefSymbol &&
        sr.typeDefNodes.get(symbol.datatype).variant === Semantic.ENode.ParameterPackDatatype
      ) {
        return [expr, exprId];
      }
      break;
    }

    case Semantic.ENode.LiteralExpr: {
      return [expr, exprId];
    }

    default:
      break;
  }
  throw new CompilerError(
    `This Expression cannot be evaluated at compile time`,
    "sourceloc" in expr ? expr.sourceloc : null
  );
}

export function EvalCTFENumericValue(sr: SemanticResult, exprId: Semantic.ExprId) {
  const [result, resultId] = EvalCTFE(sr, exprId);
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

export function EvalCTFEBoolean(sr: SemanticResult, exprId: Semantic.ExprId) {
  const [result, resultId] = EvalCTFE(sr, exprId);
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
