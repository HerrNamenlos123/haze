import { EBinaryOperation } from "../shared/AST";
import { assert } from "../shared/Errors";
import type { Semantic } from "./Elaborate";

export type Constraint = {
  variableSymbol: Semantic.SymbolId;
  constraintValue: ConstraintValue;
};

export type ConstraintValue =
  | {
      kind: "comparison";
      operation: EBinaryOperation;
      value: Semantic.ExprId;
    }
  | {
      kind: "union";
      operation: "is" | "isNot";
      typeUse?: Semantic.TypeUseId;
      typeDef?: Semantic.TypeDefId;
    };

function constraintKey(c: Constraint): string {
  if (c.constraintValue.kind === "comparison") {
    return ["cmp", c.variableSymbol, c.constraintValue.operation, c.constraintValue.value].join(
      "|",
    );
  }

  // union constraint
  return [
    "union",
    c.variableSymbol,
    c.constraintValue.operation,
    c.constraintValue.typeUse ?? "",
    c.constraintValue.typeDef ?? "",
  ].join("|");
}

function invertComparison(op: EBinaryOperation): EBinaryOperation {
  switch (op) {
    case EBinaryOperation.Equal:
      return EBinaryOperation.NotEqual;
    case EBinaryOperation.NotEqual:
      return EBinaryOperation.Equal;
    case EBinaryOperation.LessThan:
      return EBinaryOperation.GreaterEqual;
    case EBinaryOperation.LessEqual:
      return EBinaryOperation.GreaterThan;
    case EBinaryOperation.GreaterThan:
      return EBinaryOperation.LessEqual;
    case EBinaryOperation.GreaterEqual:
      return EBinaryOperation.LessThan;
    default:
      assert(false);
  }
}

function invertConstraint(c: Constraint): Constraint {
  const v = c.constraintValue;

  if (v.kind === "comparison") {
    return {
      variableSymbol: c.variableSymbol,
      constraintValue: {
        kind: "comparison",
        operation: invertComparison(v.operation),
        value: v.value,
      },
    };
  }

  // union constraint
  return {
    variableSymbol: c.variableSymbol,
    constraintValue: {
      kind: "union",
      operation: v.operation === "is" ? "isNot" : "is",
      typeUse: v.typeUse,
      typeDef: v.typeDef,
    },
  };
}

export class ConstraintSet {
  private readonly map: Map<string, Constraint>;

  private _inverse?: ConstraintSet;

  private constructor(map?: Map<string, Constraint>) {
    this.map = map ?? new Map();
  }

  // ---- construction --------------------------------------------------------

  static empty(): ConstraintSet {
    return new ConstraintSet();
  }

  static fromArray(constraints: Constraint[]): ConstraintSet {
    const set = new ConstraintSet();
    for (const c of constraints) set.add(c);
    return set;
  }

  clone(): ConstraintSet {
    return new ConstraintSet(new Map(this.map));
  }

  // ---- basic operations ----------------------------------------------------

  add(c: Constraint): this {
    this.map.set(constraintKey(c), c);
    this._inverse = undefined; // invalidate cache
    return this;
  }

  addAll(other: ConstraintSet): this {
    for (const c of other.map.values()) {
      this.map.set(constraintKey(c), c);
    }
    this._inverse = undefined;
    return this;
  }

  with(c: Constraint): ConstraintSet {
    const copy = this.clone();
    copy.add(c);
    return copy;
  }

  withAll(other: ConstraintSet): ConstraintSet {
    const copy = this.clone();
    copy.addAll(other);
    return copy;
  }

  // ---- queries -------------------------------------------------------------

  isEmpty(): boolean {
    return this.map.size === 0;
  }

  has(c: Constraint): boolean {
    return this.map.has(constraintKey(c));
  }

  toArray(): Constraint[] {
    return [...this.map.values()];
  }

  // ---- inversion -----------------------------------------------------------

  inverse(): ConstraintSet {
    if (this._inverse) return this._inverse;

    const inv = new ConstraintSet();

    for (const c of this.map.values()) {
      inv.add(invertConstraint(c));
    }

    // cache both directions
    inv._inverse = this;
    this._inverse = inv;

    return inv;
  }

  /** Remove all constraints that apply to a given symbol */
  deleteSymbol(symbol: Semantic.SymbolId): this {
    for (const [key, c] of this.map) {
      if (c.variableSymbol === symbol) {
        this.map.delete(key);
      }
    }
    this._inverse = undefined;
    return this;
  }
}

export class ConditionChain {
  private readonly conditions: ConstraintSet[] = [];

  add(condition: ConstraintSet): void {
    this.conditions.push(condition);
  }

  /** All previous conditions inverted (used for else / else-if guards) */
  private invertedPrefix(): ConstraintSet {
    const out = ConstraintSet.empty();
    for (const c of this.conditions) {
      out.addAll(c.inverse());
    }
    return out;
  }

  /** All previous conditions inverted + this condition */
  branchConstraints(current: ConstraintSet): ConstraintSet {
    const out = this.invertedPrefix();
    out.addAll(current);
    return out;
  }
}
