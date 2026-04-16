import { EBinaryOperation } from "../shared/AST";
import {
  EPrimitive,
  primitiveToString,
  CTValueHelpers,
  type CTValue,
  type LiteralValue,
} from "../shared/common";
import { assert, CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
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

  // CTValue is the primary comptime evaluator. Keep EvalCTFE as a compatibility wrapper
  // for existing call sites that still expect an expression result.
  const ct = evalCT(sr, exprId);
  if (ct !== null) {
    return { ok: true, value: ctValueToExpr(sr, ct, expr.sourceloc) };
  }

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

    case Semantic.ENode.MemberAccessExpr: {
      const objectValue = evalCT(sr, expr.expr);
      if (objectValue === null) {
        return err(`This Expression cannot be evaluated at compile time`);
      }

      const memberValue = evalCTMemberAccess(sr, objectValue, expr.memberName);
      if (memberValue === null) {
        return err(`No compile-time member named '${expr.memberName}' on this value`);
      }

      return ok(ctValueToExpr(sr, memberValue, expr.sourceloc));
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

/**
 * Evaluate an expression to a unified CTValue representation
 * Returns null if the expression cannot be evaluated at compile time
 * First checks expr.comptimeValue, then falls back to evaluation
 */
export function evalCT(sr: Semantic.Context, exprId: Semantic.ExprId): CTValue | null {
  const expr = sr.exprNodes.get(exprId);

  switch (expr.variant) {
    case Semantic.ENode.LiteralExpr:
      return literalValueToCTValue(expr.literal);

    case Semantic.ENode.DatatypeAsValueExpr: {
      const typeUse = sr.typeUseNodes.get(expr.type);
      return CTValueHelpers.type(typeUse.type);
    }

    case Semantic.ENode.StructLiteralExpr:
      return evalCTStructLiteral(sr, expr);

    case Semantic.ENode.ArrayLiteralExpr: {
      const items: CTValue[] = [];
      for (const elementExprId of expr.elements) {
        const item = evalCT(sr, elementExprId);
        if (item === null) {
          return null;
        }
        items.push(item);
      }
      return CTValueHelpers.list(items);
    }

    case Semantic.ENode.SymbolValueExpr: {
      const symbol = sr.symbolNodes.get(expr.symbol);
      if (
        symbol.variant === Semantic.ENode.VariableSymbol &&
        symbol.comptime &&
        symbol.comptimeValue
      ) {
        return evalCT(sr, symbol.comptimeValue);
      }
      return null;
    }

    case Semantic.ENode.MemberAccessExpr: {
      const objectValue = evalCT(sr, expr.expr);
      if (objectValue === null) {
        return null;
      }
      return evalCTMemberAccess(sr, objectValue, expr.memberName);
    }

    case Semantic.ENode.ArraySubscriptExpr: {
      if (expr.indices.length !== 1) {
        return null;
      }

      const listValue = evalCT(sr, expr.expr);
      if (listValue === null || listValue.kind !== "list") {
        return null;
      }

      const indexValue = evalCT(sr, expr.indices[0]);
      if (indexValue === null || indexValue.kind !== "int") {
        return null;
      }

      const indexAsBigint = indexValue.value;
      if (indexAsBigint < 0n) {
        return null;
      }

      const indexAsNumber = Number(indexAsBigint);
      if (!Number.isSafeInteger(indexAsNumber)) {
        return null;
      }

      if (indexAsNumber >= listValue.items.length) {
        return null;
      }

      return listValue.items[indexAsNumber];
    }

    case Semantic.ENode.BinaryExpr:
      return evalCTBinary(sr, expr);

    case Semantic.ENode.ComputedReadExpr:
    case Semantic.ENode.ReactiveReadExpr:
      return evalCT(sr, expr.value);

    default:
      return null;
  }
}

function evalCTBinary(sr: Semantic.Context, expr: Semantic.BinaryExpr): CTValue | null {
  const left = evalCT(sr, expr.left);
  const right = evalCT(sr, expr.right);
  if (left === null || right === null) {
    return null;
  }

  switch (expr.operation) {
    case EBinaryOperation.Add:
      if (left.kind === "int" && right.kind === "int") {
        return CTValueHelpers.int(left.value + right.value, left.width || right.width);
      }
      if (left.kind === "float" && right.kind === "float") {
        return CTValueHelpers.float(left.value + right.value, left.width || right.width);
      }
      if (left.kind === "string" && right.kind === "string") {
        return CTValueHelpers.string(left.value + right.value, left.prefix ?? right.prefix ?? null);
      }
      return null;

    case EBinaryOperation.Subtract:
      if (left.kind === "int" && right.kind === "int") {
        return CTValueHelpers.int(left.value - right.value, left.width || right.width);
      }
      if (left.kind === "float" && right.kind === "float") {
        return CTValueHelpers.float(left.value - right.value, left.width || right.width);
      }
      return null;

    case EBinaryOperation.Equal:
      return CTValueHelpers.bool(equalCTValues(left, right));

    case EBinaryOperation.NotEqual:
      return CTValueHelpers.bool(!equalCTValues(left, right));

    case EBinaryOperation.BoolAnd:
      if (left.kind === "bool" && right.kind === "bool") {
        return CTValueHelpers.bool(left.value && right.value);
      }
      return null;

    case EBinaryOperation.BoolOr:
      if (left.kind === "bool" && right.kind === "bool") {
        return CTValueHelpers.bool(left.value || right.value);
      }
      return null;

    default:
      return null;
  }
}

function equalCTValues(left: CTValue, right: CTValue): boolean {
  if (left.kind === "int" && right.kind === "int") {
    return left.value === right.value;
  }
  if (left.kind === "float" && right.kind === "float") {
    return left.value === right.value;
  }
  if (left.kind === "string" && right.kind === "string") {
    return left.value === right.value;
  }
  if (left.kind === "bool" && right.kind === "bool") {
    return left.value === right.value;
  }
  if (left.kind === "null" && right.kind === "null") {
    return true;
  }
  if (left.kind === "none" && right.kind === "none") {
    return true;
  }
  if (left.kind === "type" && right.kind === "type") {
    return left.typeDefId === right.typeDefId;
  }
  if (left.kind === "enum" && right.kind === "enum") {
    return left.enumType === right.enumType && left.valueName === right.valueName;
  }
  if (left.kind === "struct" && right.kind === "struct") {
    return (
      left.typeDefId === right.typeDefId &&
      left.fields.length === right.fields.length &&
      left.fields.every((field, index) => equalCTValues(field, right.fields[index]))
    );
  }
  if (left.kind === "list" && right.kind === "list") {
    return (
      left.items.length === right.items.length &&
      left.items.every((item, index) => equalCTValues(item, right.items[index]))
    );
  }
  return false;
}

/**
 * Evaluate a struct literal to CTValue
 * Returns null if any field cannot be evaluated at compile time
 */
function evalCTStructLiteral(
  sr: Semantic.Context,
  structLiteral: Semantic.StructLiteralExpr,
): CTValue | null {
  const typeUse = sr.typeUseNodes.get(structLiteral.type);
  const structTypeDef = sr.typeDefNodes.get(typeUse.type);
  assert(structTypeDef.variant === Semantic.ENode.StructDatatype);

  // Evaluate all fields to CTValue
  const fieldValues: CTValue[] = [];

  // Build a map of field names to their evaluated values
  const fieldMap = new Map<string, CTValue>();

  for (const fieldAssignment of structLiteral.assign) {
    const fieldValue = evalCT(sr, fieldAssignment.value);
    if (fieldValue === null) {
      // If any field cannot be evaluated at compile time, the struct cannot be
      return null;
    }
    fieldMap.set(fieldAssignment.name, fieldValue);
  }

  // Build the fields array in declaration order
  for (const memberSymbolId of structTypeDef.members) {
    const memberSymbol = sr.symbolNodes.get(memberSymbolId);
    assert(memberSymbol.variant === Semantic.ENode.VariableSymbol);

    const fieldValue = fieldMap.get(memberSymbol.name);
    if (fieldValue === undefined) {
      // This shouldn't happen if struct literal was properly validated
      return null;
    }

    fieldValues.push(fieldValue);
  }

  return CTValueHelpers.struct(typeUse.type, fieldValues);
}

/**
 * Convert a LiteralValue to CTValue wrapper
 */
function literalValueToCTValue(lit: LiteralValue): CTValue {
  // Handle Regex separately (has pattern, not value)
  if ("pattern" in lit && lit.type === EPrimitive.Regex) {
    return CTValueHelpers.string(lit.pattern);
  }

  if ("value" in lit) {
    switch (lit.type) {
      case EPrimitive.bool:
        return CTValueHelpers.bool(lit.value);
      case EPrimitive.i8:
      case EPrimitive.i16:
      case EPrimitive.i32:
      case EPrimitive.i64:
      case EPrimitive.u8:
      case EPrimitive.u16:
      case EPrimitive.u32:
      case EPrimitive.u64:
      case EPrimitive.usize:
      case EPrimitive.int:
        return CTValueHelpers.int(lit.value, lit.type);
      case EPrimitive.f32:
      case EPrimitive.f64:
      case EPrimitive.real:
        return CTValueHelpers.float(lit.value, lit.type);
      case EPrimitive.str:
      case EPrimitive.cstr:
      case EPrimitive.ccstr:
        return CTValueHelpers.string(lit.value, lit.prefix);
    }
  } else if ("type" in lit) {
    if (lit.type === EPrimitive.null) {
      return CTValueHelpers.null_();
    } else if (lit.type === EPrimitive.none) {
      return CTValueHelpers.none_();
    } else if (lit.type === "enum") {
      return CTValueHelpers.enum_(lit.enumType, lit.valueName);
    }
  }
  throw new InternalError("Unknown literal value type in literalValueToCTValue");
}

/**
 * Try to evaluate a symbol's comptime value to CTValue
 * Returns null if not evaluable at compile time
 */
export function evalCTSymbol(_sr: Semantic.Context, _symbolId: Semantic.SymbolId): CTValue | null {
  // This will be used in Phase 2 to evaluate symbols
  // For now, we'll implement this as we process symbols in elaboration
  return null;
}

/**
 * Evaluate member access on a compile-time struct value
 * Given a CTValue struct and field name, returns the field value
 * Returns null if not a struct or field not found
 */
export function evalCTMemberAccess(
  sr: Semantic.Context,
  ctValue: CTValue,
  fieldName: string,
): CTValue | null {
  if (ctValue.kind !== "struct") {
    return null;
  }

  const structTypeDef = sr.typeDefNodes.get(ctValue.typeDefId);
  assert(structTypeDef.variant === Semantic.ENode.StructDatatype);

  // Find the field index
  let fieldIndex = -1;
  for (let i = 0; i < structTypeDef.members.length; i++) {
    const memberSymbolId = structTypeDef.members[i];
    const memberSymbol = sr.symbolNodes.get(memberSymbolId);
    assert(memberSymbol.variant === Semantic.ENode.VariableSymbol);

    if (memberSymbol.name === fieldName) {
      fieldIndex = i;
      break;
    }
  }

  if (fieldIndex === -1) {
    return null; // Field not found
  }

  if (fieldIndex >= ctValue.fields.length) {
    return null; // Shouldn't happen
  }

  return ctValue.fields[fieldIndex];
}

/**
 * Convert a CTValue back to a Semantic Expression
 * This is used when we want to return a compile-time value in the semantic tree
 */
export function ctValueToExpr(
  sr: Semantic.Context,
  ctValue: CTValue,
  sourceloc: SourceLoc,
): [Semantic.Expression, Semantic.ExprId] {
  switch (ctValue.kind) {
    case "int":
      return sr.b.literalValue(
        {
          type: ctValue.width || EPrimitive.int,
          value: ctValue.value,
          unit: null,
        },
        sourceloc,
      );
    case "float":
      return sr.b.literalValue(
        {
          type: ctValue.width || EPrimitive.real,
          value: ctValue.value,
          unit: null,
        },
        sourceloc,
      );
    case "string":
      return sr.b.literalValue(
        {
          type: EPrimitive.str,
          value: ctValue.value,
          prefix: ctValue.prefix || null,
        },
        sourceloc,
      );
    case "bool":
      return sr.b.literalValue(
        {
          type: EPrimitive.bool,
          value: ctValue.value,
        },
        sourceloc,
      );
    case "null":
      return sr.b.literalValue(
        {
          type: EPrimitive.null,
        },
        sourceloc,
      );
    case "none":
      return sr.b.literalValue(
        {
          type: EPrimitive.none,
        },
        sourceloc,
      );
    case "type":
      return sr.b.datatypeDefAsValue(ctValue.typeDefId, sourceloc);
    case "enum":
      return sr.b.literalValue(
        {
          type: "enum",
          enumType: ctValue.enumType,
          valueName: ctValue.valueName,
        },
        sourceloc,
      );
    case "struct":
    case "list":
      throw new CompilerError("Cannot convert complex CTValue to expression yet", sourceloc);
  }
}
