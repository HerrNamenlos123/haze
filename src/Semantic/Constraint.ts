import { BinaryOperationToString, EBinaryOperation } from "../shared/AST";
import { assert } from "../shared/Errors";
import { Semantic } from "./SemanticTypes";

// ============================================================================
// Path-based constraint system
// ============================================================================

export type ConstraintPathRoot =
  | {
      kind: "symbol";
      symbolId: Semantic.SymbolId;
    }
  | {
      kind: "reactive-symbol";
      symbolId: Semantic.SymbolId;
    };

export type ConstraintPathElement =
  | ConstraintPathMember
  | ConstraintPathSubscript;

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
    }
  | {
      // The value is one of these variants: the inverse of several `isNot`s
      // about it (`if !v` for `v: A | null | none` leaves `null | none`).
      kind: "union-one-of";
      alternatives: {
        typeUse?: Semantic.TypeUseId;
        typeDef?: Semantic.TypeDefId;
      }[];
    };

// ============================================================================
// Path manipulation functions
// ============================================================================

export function pathToKey(path: ConstraintPath): string {
  let key = "";

  if (path.root.kind === "reactive-symbol") {
    key += "reactive";
  }

  key += `${path.root.symbolId}`;
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

function valueKey(value: ConstraintValue): string {
  if (value.kind === "comparison") {
    return ["cmp", value.operation, value.value].join("|");
  }
  if (value.kind === "union-one-of") {
    return [
      "oneof",
      ...value.alternatives.map((a) => `${a.typeUse ?? ""}/${a.typeDef ?? ""}`),
    ].join("|");
  }
  return [
    "union",
    value.operation,
    value.typeUse ?? "",
    value.typeDef ?? "",
  ].join("|");
}

function pathConstraintKey(
  path: ConstraintPath,
  value: ConstraintValue
): string {
  return `${pathToKey(path)}|${valueKey(value)}`;
}

export function pathsMatch(a: ConstraintPath, b: ConstraintPath): boolean {
  if (a.root.symbolId !== b.root.symbolId) {
    return false;
  }
  if (a.path.length !== b.path.length) {
    return false;
  }

  for (let i = 0; i < a.path.length; i++) {
    const elemA = a.path[i];
    const elemB = b.path[i];

    if (elemA.kind !== elemB.kind) {
      return false;
    }

    if (elemA.kind === "member" && elemB.kind === "member") {
      if (elemA.member !== elemB.member) {
        return false;
      }
    } else if (elemA.kind === "subscript" && elemB.kind === "subscript") {
      if (elemA.index.kind !== elemB.index.kind) {
        return false;
      }
      if (elemA.index.kind === "literal" && elemB.index.kind === "literal") {
        // Compare literal values (serialized strings)
        if (elemA.index.value !== elemB.index.value) {
          return false;
        }
      } else if (
        elemA.index.kind === "variable" &&
        elemB.index.kind === "variable" &&
        elemA.index.symbol !== elemB.index.symbol
      ) {
        return false;
      }
    }
  }

  return true;
}

export function isPathPrefix(
  prefix: ConstraintPath,
  path: ConstraintPath
): boolean {
  if (prefix.root.symbolId !== path.root.symbolId) {
    return false;
  }
  if (prefix.path.length > path.path.length) {
    return false;
  }

  for (let i = 0; i < prefix.path.length; i++) {
    const elemA = prefix.path[i];
    const elemB = path.path[i];

    if (elemA.kind !== elemB.kind) {
      return false;
    }

    if (elemA.kind === "member" && elemB.kind === "member") {
      if (elemA.member !== elemB.member) {
        return false;
      }
    } else if (elemA.kind === "subscript" && elemB.kind === "subscript") {
      if (elemA.index.kind !== elemB.index.kind) {
        return false;
      }
      if (elemA.index.kind === "literal" && elemB.index.kind === "literal") {
        if (elemA.index.value !== elemB.index.value) {
          return false;
        }
      } else if (
        elemA.index.kind === "variable" &&
        elemB.index.kind === "variable" &&
        elemA.index.symbol !== elemB.index.symbol
      ) {
        return false;
      }
    }
  }

  return true;
}

function constraintKey(c: Constraint): string {
  return `${c.variableSymbol}|${valueKey(c.constraintValue)}`;
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

// The inverse of a conjunction of facts about ONE value. A constraint set can
// only say "and", and the inverse of `A && B` is `!A || !B`, so it holds only
// where that disjunction is itself a single fact: one fact inverts, several
// `isNot`s (a truthiness check on `A | null | none`) invert to "one of them",
// and anything else (`n isNot none && n > 2`) inverts to no fact at all.
// Inverting each fact on its own (`!A && !B`) claimed far more than is known:
// `n is none && n <= 2`, or the empty union `is null && is none`.
function invertFacts(values: ConstraintValue[]): ConstraintValue[] {
  if (values.length === 1) {
    const v = values[0];
    if (v.kind === "comparison") {
      return [
        {
          kind: "comparison",
          operation: invertComparison(v.operation),
          value: v.value,
        },
      ];
    }
    if (v.kind === "union-one-of") {
      return v.alternatives.map((a) => ({
        kind: "union" as const,
        operation: "isNot" as const,
        typeUse: a.typeUse,
        typeDef: a.typeDef,
      }));
    }
    return [
      {
        kind: "union",
        operation: v.operation === "is" ? "isNot" : "is",
        typeUse: v.typeUse,
        typeDef: v.typeDef,
      },
    ];
  }
  if (values.every((v) => v.kind === "union" && v.operation === "isNot")) {
    return [
      {
        kind: "union-one-of",
        alternatives: values.map((v) => {
          assert(v.kind === "union");
          return { typeUse: v.typeUse, typeDef: v.typeDef };
        }),
      },
    ];
  }
  return [];
}

export class ConstraintSet {
  private readonly map: Map<string, Constraint>;
  private readonly pathMap: Map<
    string,
    { path: ConstraintPath; value: ConstraintValue }
  >;

  private _inverse?: ConstraintSet;

  private constructor(
    map?: Map<string, Constraint>,
    pathMap?: Map<string, { path: ConstraintPath; value: ConstraintValue }>
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
    for (const c of constraints) {
      set.add(c);
    }
    return set;
  }

  clone(): ConstraintSet {
    return new ConstraintSet(new Map(this.map), new Map(this.pathMap));
  }

  // ---- path-based operations -----------------------------------------------

  addPath(path: ConstraintPath, value: ConstraintValue): this {
    this.pathMap.set(pathConstraintKey(path, value), {
      path: path,
      value: value,
    });
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

  /**
   * Get the number of distinct constraint targets (variables or paths).
   * Two constraints on different paths that merely share the same root
   * symbol (e.g. `result.result` and `result.error`) must count as distinct
   * targets here: they are independent facts, not two constraints on the
   * same thing, so `A && B` over them cannot be soundly inverted into
   * `!A && !B` (see inverse()).
   *
   * Legacy (variableSymbol-based) and path-based constraints are keyed
   * through the same pathToKey() format — a legacy constraint on a plain
   * variable and a path constraint on that same variable (empty path,
   * matching root) must land on the same key, since both are commonly
   * recorded for the exact same simple-variable guard (see the "Legacy:
   * also add symbol-based constraint for backward compatibility" comment in
   * buildLogicalConstraintSet). Prefixing them into separate namespaces
   * would double-count a single variable as two distinct targets and
   * wrongly block narrowing on the most common single-symbol guard clause.
   */
  distinctSymbolCount(): number {
    const targets = new Set<string>();
    for (const c of this.map.values()) {
      targets.add(
        pathToKey({
          root: { kind: "symbol", symbolId: c.variableSymbol },
          path: [],
        })
      );
    }
    for (const { path } of this.pathMap.values()) {
      targets.add(pathToKey(path));
    }
    return targets.size;
  }

  // ---- inversion -----------------------------------------------------------

  inverse(): ConstraintSet {
    if (this._inverse) {
      return this._inverse;
    }

    // If there are multiple distinct symbols with constraints (A && B), we cannot properly invert them
    // because the correct inverse would be (!A || !B), which is not representable
    // in the constraint system. So we return an empty constraint set instead of
    // an incorrect inversion (!A && !B).
    if (this.distinctSymbolCount() > 1) {
      const empty = ConstraintSet.empty();
      empty._inverse = this;
      this._inverse = empty;
      return empty;
    }

    // Every entry is about the one value. A legacy entry on a plain variable
    // and a path entry on it record the same facts (see
    // distinctSymbolCount()), so invert their union once -- the facts
    // together, never each on its own (see invertFacts()) -- and record the
    // result in both forms again.
    const facts = new Map<string, ConstraintValue>();
    let legacySymbol: Semantic.SymbolId | undefined;
    for (const c of this.map.values()) {
      legacySymbol = c.variableSymbol;
      facts.set(valueKey(c.constraintValue), c.constraintValue);
    }
    let path: ConstraintPath | undefined;
    for (const entry of this.pathMap.values()) {
      path = entry.path;
      facts.set(valueKey(entry.value), entry.value);
    }

    const inv = new ConstraintSet();
    for (const value of invertFacts([...facts.values()])) {
      if (legacySymbol !== undefined) {
        inv.add({ variableSymbol: legacySymbol, constraintValue: value });
      }
      if (path) {
        inv.addPath(path, value);
      }
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
    const constraints = [] as string[];
    for (const [_, constraint] of this.map) {
      const symbol = sr.symbolNodes.get(constraint.variableSymbol);
      assert(symbol.variant === Semantic.ENode.VariableSymbol);

      if (constraint.constraintValue.kind === "comparison") {
        constraints.push(
          `${symbol.name} ${BinaryOperationToString(constraint.constraintValue.operation)} ${Semantic.serializeExpr(sr, constraint.constraintValue.value)}`
        );
      } else if (constraint.constraintValue.kind === "union-one-of") {
        const alternatives = constraint.constraintValue.alternatives.map((a) =>
          a.typeDef
            ? Semantic.serializeTypeDef(sr, a.typeDef)
            : Semantic.serializeTypeUse(sr, a.typeUse!)
        );
        constraints.push(`${symbol.name} is one of ${alternatives.join(", ")}`);
      } else if (constraint.constraintValue.typeDef) {
        constraints.push(
          `${symbol.name} ${constraint.constraintValue.operation} ${Semantic.serializeTypeDef(sr, constraint.constraintValue.typeDef)}`
        );
      } else if (constraint.constraintValue.typeUse) {
        constraints.push(
          `${symbol.name} ${constraint.constraintValue.operation} ${Semantic.serializeTypeUse(sr, constraint.constraintValue.typeUse)}`
        );
      } else {
        assert(false);
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
      const inverted = c.inverse();
      // Only add the inverted constraints if they are not empty (which indicates inversion failed)
      // If inversion failed, we skip the constraint rather than add an empty one
      if (!inverted.isEmpty()) {
        out.addAll(inverted);
      }
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
