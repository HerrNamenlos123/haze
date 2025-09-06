import { EBinaryOperation, EDatatypeMutability } from "../shared/AST";
import { EPrimitive, primitiveToString } from "../shared/common";
import { assert, CompilerError, type SourceLoc } from "../shared/Errors";
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
                return makeBoolValue(sr, true, expr.sourceloc);
              }
              return makeBoolValue(sr, left.literal.value === right.literal.value, expr.sourceloc);
            }
            throw new CompilerError(
              `Cannot compare primitives ${primitiveToString(
                left.literal.type
              )} and ${primitiveToString(left.literal.type)} at compile time`,
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

        default:
          assert(false);
      }
    }

    case Semantic.ENode.SymbolValueExpr: {
      const symbol = sr.symbolNodes.get(expr.symbol);
      if (symbol.variant === Semantic.ENode.VariableSymbol && symbol.comptime) {
        assert(symbol.comptimeValue);
        const value = sr.exprNodes.get(symbol.comptimeValue);
        return [value, symbol.comptimeValue];
      } else if (
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
