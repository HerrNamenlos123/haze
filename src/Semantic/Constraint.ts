import { BinaryOperationToString, EBinaryOperation } from "../shared/AST";
import { assert } from "../shared/Errors";
import { Semantic } from "./SemanticTypes";

// ============================================================================
// Path-based constraint system
// ============================================================================

export type ConstraintPathRoot = {
  kind: "symbol";
  symbolId: Semantic.SymbolId;
};

export type ConstraintPathElement = ConstraintPathMember | ConstraintPathSubscript;

export type ConstraintPathMember = {
  kind: "member";
  member: Semantic.SymbolId; // VariableSymbol representing the member
};

export type ConstraintPathSubscript = {
  kind: "subscript";
  index: ConstraintPathSubscriptIndex;
};

export type ConstraintPathSubscriptIndex =
  | { kind: "literal"; value: string } // Serialized literal value for stable comparison
  | { kind: "variable"; symbol: Semantic.SymbolId };

export type ConstraintPath = {
  root: ConstraintPathRoot;
  path: ConstraintPathElement[]; // Empty for simple variables
};

// ============================================================================
// Legacy constraint types (kept for backward compatibility)
// ============================================================================

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

// ============================================================================
// Path manipulation functions
// ============================================================================

export function pathToKey(path: ConstraintPath): string {
  let key = `${path.root.symbolId}`;
  for (const element of path.path) {
    if (element.kind === "member") {
      key += `.${element.member}`;
    } else if (element.index.kind === "literal") {
      key += `[${element.index.value}]`;
    } else {
      key += `[V${element.index.symbol}]`;
    }
  }
  return key;
}

function pathConstraintKey(path: ConstraintPath, value: ConstraintValue): string {
  const base = pathToKey(path);
  if (value.kind === "comparison") {
    return [base, "cmp", value.operation, value.value].join("|");
  }
  return [base, "union", value.operation, value.typeUse ?? "", value.typeDef ?? ""].join("|");
}

export function pathsMatch(a: ConstraintPath, b: ConstraintPath): boolean {
  if (a.root.symbolId !== b.root.symbolId) return false;
  if (a.path.length !== b.path.length) return false;

  for (let i = 0; i < a.path.length; i++) {
    const elemA = a.path[i];
    const elemB = b.path[i];

    if (elemA.kind !== elemB.kind) return false;

    if (elemA.kind === "member" && elemB.kind === "member") {
      if (elemA.member !== elemB.member) return false;
    } else if (elemA.kind === "subscript" && elemB.kind === "subscript") {
      if (elemA.index.kind !== elemB.index.kind) return false;
      if (elemA.index.kind === "literal" && elemB.index.kind === "literal") {
        // Compare literal values (serialized strings)
        if (elemA.index.value !== elemB.index.value) return false;
      } else if (elemA.index.kind === "variable" && elemB.index.kind === "variable") {
        if (elemA.index.symbol !== elemB.index.symbol) return false;
      }
    }
  }

  return true;
}

export function isPathPrefix(prefix: ConstraintPath, path: ConstraintPath): boolean {
  if (prefix.root.symbolId !== path.root.symbolId) return false;
  if (prefix.path.length > path.path.length) return false;

  for (let i = 0; i < prefix.path.length; i++) {
    const elemA = prefix.path[i];
    const elemB = path.path[i];

    if (elemA.kind !== elemB.kind) return false;

    if (elemA.kind === "member" && elemB.kind === "member") {
      if (elemA.member !== elemB.member) return false;
    } else if (elemA.kind === "subscript" && elemB.kind === "subscript") {
      if (elemA.index.kind !== elemB.index.kind) return false;
      if (elemA.index.kind === "literal" && elemB.index.kind === "literal") {
        if (elemA.index.value !== elemB.index.value) return false;
      } else if (elemA.index.kind === "variable" && elemB.index.kind === "variable") {
        if (elemA.index.symbol !== elemB.index.symbol) return false;
      }
    }
  }

  return true;
}

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

function invertConstraintValue(v: ConstraintValue): ConstraintValue {
  if (v.kind === "comparison") {
    return {
      kind: "comparison",
      operation: invertComparison(v.operation),
      value: v.value,
    };
  }

  // union constraint
  return {
    kind: "union",
    operation: v.operation === "is" ? "isNot" : "is",
    typeUse: v.typeUse,
    typeDef: v.typeDef,
  };
}

export class ConstraintSet {
  private readonly map: Map<string, Constraint>;
  private readonly pathMap: Map<string, { path: ConstraintPath; value: ConstraintValue }>;

  private _inverse?: ConstraintSet;

  private constructor(
    map?: Map<string, Constraint>,
    pathMap?: Map<string, { path: ConstraintPath; value: ConstraintValue }>,
  ) {
    this.map = map ?? new Map();
    this.pathMap = pathMap ?? new Map();
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
    return new ConstraintSet(new Map(this.map), new Map(this.pathMap));
  }

  // ---- path-based operations -----------------------------------------------

  addPath(path: ConstraintPath, value: ConstraintValue): this {
    this.pathMap.set(pathConstraintKey(path, value), { path, value });
    this._inverse = undefined;
    return this;
  }

  getPathConstraint(path: ConstraintPath): ConstraintValue[] {
    const out: ConstraintValue[] = [];
    for (const entry of this.pathMap.values()) {
      if (pathsMatch(entry.path, path)) {
        out.push(entry.value);
      }
    }
    return out;
  }

  deletePathAndChildren(path: ConstraintPath): this {
    const pathKey = pathToKey(path);

    // Delete exact path constraints and children
    const prefix = pathKey + ".";
    const subscriptPrefix = pathKey + "[";
    const exactPrefix = pathKey + "|";

    for (const key of this.pathMap.keys()) {
      if (
        key.startsWith(prefix) ||
        key.startsWith(subscriptPrefix) ||
        key.startsWith(exactPrefix)
      ) {
        this.pathMap.delete(key);
      }
    }

    this._inverse = undefined;
    return this;
  }

  deleteSymbolWrites(symbolId: Semantic.SymbolId): this {
    // Delete if symbol is the root
    for (const [key, entry] of this.pathMap) {
      // Root was written
      if (entry.path.root.symbolId === symbolId) {
        this.pathMap.delete(key);
        continue;
      }

      // Symbol used as array index - invalidate if written
      for (const element of entry.path.path) {
        if (
          element.kind === "subscript" &&
          element.index.kind === "variable" &&
          element.index.symbol === symbolId
        ) {
          this.pathMap.delete(key);
          break;
        }
      }
    }

    this._inverse = undefined;
    return this;
  }

  // ---- basic operations ----------------------------------------------------

  add(c: Constraint): this {
    this.map.set(constraintKey(c), c);
    this._inverse = undefined; // invalidate cache
    return this;
  }

  addAll(other: ConstraintSet): this {
    // Copy legacy constraints
    for (const c of other.map.values()) {
      this.map.set(constraintKey(c), c);
    }
    // Copy path-based constraints
    for (const [key, value] of other.pathMap) {
      this.pathMap.set(key, value);
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

  /** Get the total number of constraints in this set */
  constraintCount(): number {
    return this.map.size + this.pathMap.size;
  }

  // ---- inversion -----------------------------------------------------------

  inverse(): ConstraintSet {
    if (this._inverse) return this._inverse;

    // If there are multiple constraints (A && B), we cannot properly invert them
    // because the correct inverse would be (!A || !B), which is not representable
    // in the constraint system. So we return an empty constraint set instead of
    // an incorrect inversion (!A && !B).
    if (this.constraintCount() > 1) {
      const empty = ConstraintSet.empty();
      empty._inverse = this;
      this._inverse = empty;
      return empty;
    }

    const inv = new ConstraintSet();

    // Invert legacy constraints
    for (const c of this.map.values()) {
      inv.add(invertConstraint(c));
    }

    // Invert path-based constraints
    for (const { path, value } of this.pathMap.values()) {
      inv.addPath(path, invertConstraintValue(value));
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

  serialize(sr: Semantic.Context) {
    let constraints = [] as string[];
    for (const [_, constraint] of this.map) {
      const symbol = sr.symbolNodes.get(constraint.variableSymbol);
      assert(symbol.variant === Semantic.ENode.VariableSymbol);

      if (constraint.constraintValue.kind === "comparison") {
        constraints.push(
          `${symbol.name} ${BinaryOperationToString(constraint.constraintValue.operation)} ${Semantic.serializeExpr(sr, constraint.constraintValue.value)}`,
        );
      } else {
        if (constraint.constraintValue.typeDef) {
          constraints.push(
            `${symbol.name} ${constraint.constraintValue.operation} ${Semantic.serializeTypeDef(sr, constraint.constraintValue.typeDef)}`,
          );
        } else if (constraint.constraintValue.typeUse) {
          constraints.push(
            `${symbol.name} ${constraint.constraintValue.operation} ${Semantic.serializeTypeUse(sr, constraint.constraintValue.typeUse)}`,
          );
        } else {
          assert(false);
        }
      }
    }
    return constraints;
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
