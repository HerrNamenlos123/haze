import type { ASTMetaAnnotationItem } from "../shared/AST";
import { EPrimitive, type LiteralValue, primitiveToString } from "../shared/common";
import { assert, InternalError } from "../shared/Errors";
import { Semantic } from "./SemanticTypes";

// Structural type fingerprinting.
//
// A fingerprint is a 64-bit hash of a type's complete binary shape, exposed
// to Haze source as `T.fingerprint`. Two types with an equal fingerprint are
// guaranteed (modulo hash collision, treated as a non-issue -- see below) to
// be both the same identity and binary-compatible in layout. This is the
// mechanism the hot-reload design (`CLAUDE_MODULE_HOTRELOAD_NOTES.md`,
// `R&D/Hot Reload & Module Identity.md`, `R&D/Module Memory Model & Reload
// Mechanics.md`) uses to detect when reloading a module would be unsafe, and
// what `TypeErasedBox` (`stdlib/core/src/memory.hz`) checks on retrieval.
//
// Invariants this implementation depends on -- violate any of these and
// fingerprints stop meaning what callers assume they mean:
//
// 1. COLLISIONS ARE ACCEPTED, NOT DEFENDED AGAINST. A collision only matters
//    if it also coincides with an actual runtime type violation -- both
//    happening by accident is treated as never. Do not "fix" this by
//    widening to 128 bits or adding collision detection; that was a
//    deliberate scope decision, not an oversight.
//
// 2. A TYPE'S OWN MANGLED NAME (via `Semantic.mangleTypeDef`/`mangleTypeUse`)
//    IS A DIRECT HASH INPUT, WHICH MEANS FINGERPRINT ALREADY IMPLIES
//    IDENTITY. A different fully-qualified name produces a different hash
//    input and therefore (collisions aside) a different fingerprint. This is
//    why `TypeErasedBox` only needs to compare fingerprints, not fingerprint
//    + mangled name separately.
//
// 3. A STRUCT MEMBER IS NOT A SYMBOL AND HAS NO FINGERPRINT OF ITS OWN. A
//    member is exactly the pair (name, type). Haze has no equivalent of
//    C++'s `Foo::name` for members, and this design does not invent one.
//    Only the type half is fingerprintable; the name half is always hashed
//    as a separate, plain string alongside it, never folded into "a member
//    fingerprint".
//
// 4. TYPEUSE FOLDS ITS OWN MANGLED NAME, NOT RAW MODIFIER FLAGS.
//    `Semantic.mangleTypeUse` already bakes const/mut and pointer/inline
//    into the mangled string itself (the c/m/p/i prefix scheme -- see
//    `SemanticTypes.ts` around `mangleTypeDef`'s scheme comment). So
//    `computeTypeUseFingerprint` hashes `mangleTypeUse(...)`'s string
//    directly, the same way `computeTypeDefFingerprint` hashes
//    `mangleTypeDef(...)`'s string -- it does NOT separately re-hash
//    `mutability`/`inline` as raw enum values. Doing both would be exactly
//    the same redundancy invariant (3) rules out for member names, just for
//    modifiers instead.
//
// 5. NEVER FINGERPRINT `CallableDatatype` VIA ITS OWN MANGLED NAME.
//    `Semantic.mangleTypeDef`'s `CallableDatatype` case assigns an arbitrary,
//    per-compilation-session incrementing counter
//    (`CallableManglingHashStore`, keyed by object reference) as part of its
//    name -- non-deterministic across separate compiler runs, elaboration-
//    order-dependent. Folding that into a fingerprint would make a Callable
//    type's fingerprint different on every single build, defeating the
//    entire point. `computeTypeDefFingerprint` must delegate straight to the
//    wrapped `functionType`'s fingerprint instead, never touching Callable's
//    own name.
//
// 6. `TypeDefId`/`TypeUseId` (the raw compiler-internal integer indices)
//    NEVER APPEAR IN A HASH INPUT. They're allocation-order-dependent, not
//    meaningful across separate compilations, and would make fingerprints
//    flap for reasons having nothing to do with the type actually changing.
//    Only fully-qualified mangled *name strings* stand in for identity.
//
// 7. CYCLE-BREAKING PLACEHOLDER MUST BE THE SPECIFIC TYPE'S OWN MANGLED
//    NAME, NEVER A GENERIC/CONTENT-FREE MARKER. Proof this matters: compare
//    `A{f:B},B{f:A}` (mutual recursion) against `A{f:B},B{f:B}` (B
//    self-referencing instead of cycling back to A). Computing
//    `fingerprint(B)` in both hits an in-progress marker while resolving
//    field `f`. A generic marker makes both produce
//    `hash("B","f",GENERIC)` -- identical, despite `B` genuinely referring
//    to a different type in each case. Using the specific mangled name of
//    whichever type's in-progress marker was hit avoids this and
//    generalizes correctly to indirect/longer cycles.
//
// 8. COMPUTE ONCE, PERMANENTLY MEMOIZED, NEVER RECOMPUTED OR INVALIDATED
//    within one compilation (`sr.typeDefFingerprints`/`typeUseFingerprints`).
//    This is what makes invariant 7 safe: there is no "later, more complete"
//    recomputation for a cycle-broken result to be inconsistent with --
//    whatever a type's one computation converges to is final.
//
// 9. PRIMITIVES ARE A HARDCODED, PERMANENTLY-STABLE SEED, not derived from
//    anything recursive: `hash(primitiveToString(primitive))`. This seed
//    table is a cross-compiler-version compatibility promise -- every other
//    fingerprint transitively touches a primitive eventually, so changing
//    these values would silently invalidate virtually every fingerprint in
//    existence for no structural reason.
//
// 10. `Semantic.mangleTypeDef`/`mangleTypeUse` ARE SAFE TO CALL BEFORE A
//     STRUCT'S MEMBERS ARE FINALIZED -- they only read the struct's own
//     name and parent-symbol chain, never `.members`. This is what makes it
//     safe to construct the cycle-breaking placeholder (invariant 7)
//     mid-elaboration, the same way `instantiateAndElaborateStruct`
//     (`Elaborate.ts`) registers a struct's cache entry before its members
//     are elaborated.
//
// 11. ASSUMES FULLY-ELABORATED INPUT, same as every other structural
//     reflection property (`T.fields`, `T.category`, etc.) already assumes.
//     No defensive handling for a struct mid-elaboration with unresolved
//     generics -- if that's ever reachable via `T.fingerprint` in practice,
//     it should surface as the same kind of error those properties already
//     produce, not be silently guessed at here.
//
// 12. EXTERN-C TYPES MANGLE TO THEIR BARE, UNQUALIFIED C NAME
//     (`Semantic.mangleTypeDef`'s `StructDatatype` case, `extern ===
//     Extern_C` branch) -- intentional, not a bug. Two Haze modules both
//     declaring `extern C struct Foo` for the same real C struct should
//     fingerprint identically; C has no namespacing to disambiguate with
//     regardless.
//
// 13. ENUM FINGERPRINTS DO NOT INCORPORATE EXACT DISCRIMINANT VALUES, only
//     variant name and order plus the underlying representation type's
//     fingerprint. Extracting a resolved integer constant from
//     `EnumValue.valueExpr` reliably was judged not worth the complexity for
//     this pass -- name+order+underlying-type already catches the dominant
//     real-world case (reordering/renaming/retyping variants). Revisit if a
//     case surfaces where only the raw discriminant value changed with name
//     and order held fixed.

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export function fnv1a64Init(): bigint {
  return FNV_OFFSET_BASIS;
}

function fnv1a64FoldByte(state: bigint, byte: bigint): bigint {
  return (((state ^ byte) * FNV_PRIME) & MASK_64) as bigint;
}

// Length-prefixed, so ("ab","c") can never hash the same as ("a","bc").
export function fnv1a64FoldString(state: bigint, str: string): bigint {
  state = fnv1a64FoldBigint(state, BigInt(str.length));
  for (let i = 0; i < str.length; i++) {
    state = fnv1a64FoldByte(state, BigInt(str.charCodeAt(i)));
  }
  return state;
}

export function fnv1a64FoldBigint(state: bigint, value: bigint): bigint {
  let v = value & MASK_64;
  for (let i = 0; i < 8; i++) {
    state = fnv1a64FoldByte(state, v & 0xffn);
    v >>= 8n;
  }
  return state;
}

const PRIMITIVE_FINGERPRINT_SEEDS = new Map<EPrimitive, bigint>();
function primitiveFingerprint(primitive: EPrimitive): bigint {
  const cached = PRIMITIVE_FINGERPRINT_SEEDS.get(primitive);
  if (cached !== undefined) {
    return cached;
  }
  const seed = fnv1a64FoldString(fnv1a64Init(), primitiveToString(primitive));
  PRIMITIVE_FINGERPRINT_SEEDS.set(primitive, seed);
  return seed;
}

function mangledTypeDefName(
  sr: Semantic.Context,
  typeDefId: Semantic.TypeDefId
): string {
  const mangled = Semantic.mangleTypeDef(sr, typeDefId);
  return mangled.wasMangled ? "_H" + mangled.name : mangled.name;
}

function mangledTypeUseName(
  sr: Semantic.Context,
  typeUseId: Semantic.TypeUseId
): string {
  const mangled = Semantic.mangleTypeUse(sr, typeUseId);
  return mangled.wasMangled ? "_H" + mangled.name : mangled.name;
}

// Compile-time annotations (`[[json.discriminator="foo"]]`) can change how
// code compiles/behaves around a type (e.g. a JSON serializer branching on
// the annotation), so two otherwise-identical types that differ only in
// annotations must NOT fingerprint equal. Only `StructDatatypeDef` and
// `TypeAliasDatatypeDef` carry `annotations` today -- enums, unions, and
// individual struct members do not (member-level annotations are parsed,
// `ASTStructMemberDefinition.annotations`, but dropped when lowered into
// `Collect.VariableSymbol`/`Semantic.VariableSymbol` -- they never survive
// to this point at all, a separate, pre-existing gap, not something this
// function can fold in because there's nothing here to read).
function foldAnnotations(
  sr: Semantic.Context,
  state: bigint,
  annotations: ASTMetaAnnotationItem[]
): bigint {
  // Order is not semantically meaningful (annotations are addressed by key,
  // linear `.find` by key elsewhere in the compiler) -- sort so a harmless
  // reordering in source doesn't produce a spurious fingerprint mismatch.
  const sorted = [...annotations].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  );
  state = fnv1a64FoldBigint(state, BigInt(sorted.length));
  for (const item of sorted) {
    state = fnv1a64FoldString(state, item.key);
    state = foldLiteralValue(sr, state, item.value);
  }
  return state;
}

function foldLiteralValue(
  sr: Semantic.Context,
  state: bigint,
  value: LiteralValue | null
): bigint {
  if (value === null) {
    return fnv1a64FoldString(state, "null");
  }
  if (value.type === "enum") {
    state = fnv1a64FoldString(state, "enum");
    state = fnv1a64FoldBigint(
      state,
      computeTypeDefFingerprint(sr, value.enumType)
    );
    return fnv1a64FoldString(state, value.valueName);
  }
  state = fnv1a64FoldString(state, primitiveToString(value.type));
  switch (value.type) {
    case EPrimitive.bool:
      return fnv1a64FoldBigint(state, value.value ? 1n : 0n);
    case EPrimitive.null:
    case EPrimitive.none:
      return state;
    case EPrimitive.str:
    case EPrimitive.cstr:
    case EPrimitive.ccstr:
      state = fnv1a64FoldString(state, value.prefix ?? "");
      return fnv1a64FoldString(state, value.value);
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
      return fnv1a64FoldBigint(state, value.value);
    case EPrimitive.f32:
    case EPrimitive.f64:
    case EPrimitive.real:
      return fnv1a64FoldString(state, value.value.toString());
    default:
      // Annotation values are only ever simple literals in practice
      // (string/bool/null/none/number). Fail loudly rather than silently
      // ignore a value kind this hasn't been taught about yet.
      throw new InternalError(
        `Fingerprint: unhandled annotation literal value kind '${primitiveToString(value.type)}'`
      );
  }
}

export function computeTypeDefFingerprint(
  sr: Semantic.Context,
  typeDefId: Semantic.TypeDefId
): bigint {
  const memoized = sr.typeDefFingerprints.get(typeDefId);
  if (memoized !== undefined) {
    return memoized;
  }

  // Cycle break (invariant 7): substitute the specific type's own mangled
  // name, never a generic marker. Safe to call mangleTypeDef here even if
  // this type is mid-elaboration (invariant 10).
  if (sr.typeDefFingerprintInProgress.has(typeDefId)) {
    return fnv1a64FoldString(fnv1a64Init(), mangledTypeDefName(sr, typeDefId));
  }

  sr.typeDefFingerprintInProgress.add(typeDefId);
  const result = computeTypeDefFingerprintUncached(sr, typeDefId);
  sr.typeDefFingerprintInProgress.delete(typeDefId);

  sr.typeDefFingerprints.set(typeDefId, result);
  return result;
}

function computeTypeDefFingerprintUncached(
  sr: Semantic.Context,
  typeDefId: Semantic.TypeDefId
): bigint {
  const def = sr.typeDefNodes.get(typeDefId);

  switch (def.variant) {
    case Semantic.ENode.PrimitiveDatatype: {
      return primitiveFingerprint(def.primitive);
    }

    case Semantic.ENode.StructDatatype: {
      let state = fnv1a64FoldString(
        fnv1a64Init(),
        mangledTypeDefName(sr, typeDefId)
      );
      state = foldAnnotations(sr, state, def.annotations);
      state = fnv1a64FoldBigint(state, BigInt(def.members.length));
      for (const memberSymbolId of def.members) {
        const member = sr.symbolNodes.get(memberSymbolId);
        if (member.variant !== Semantic.ENode.VariableSymbol) {
          // Methods/nested typedefs live in `.members` too but don't
          // contribute to binary layout -- only data fields do.
          continue;
        }
        assert(member.type !== null, "Struct field must have a resolved type");
        state = fnv1a64FoldString(state, member.name);
        state = fnv1a64FoldBigint(
          state,
          computeTypeUseFingerprint(sr, member.type)
        );
      }
      return state;
    }

    case Semantic.ENode.EnumDatatype: {
      let state = fnv1a64FoldString(
        fnv1a64Init(),
        mangledTypeDefName(sr, typeDefId)
      );
      state = fnv1a64FoldBigint(state, computeTypeUseFingerprint(sr, def.type));
      state = fnv1a64FoldBigint(state, BigInt(def.values.length));
      for (const value of def.values) {
        // See invariant 13: name+order+underlying-type only, no discriminant value.
        state = fnv1a64FoldString(state, value.name);
      }
      return state;
    }

    case Semantic.ENode.TaggedUnionDatatype: {
      let state = fnv1a64FoldString(fnv1a64Init(), "TaggedUnion");
      state = fnv1a64FoldBigint(state, BigInt(def.members.length));
      for (const member of def.members) {
        state = fnv1a64FoldString(state, member.tag);
        state = fnv1a64FoldBigint(
          state,
          computeTypeUseFingerprint(sr, member.type)
        );
      }
      return state;
    }

    case Semantic.ENode.UntaggedUnionDatatype: {
      let state = fnv1a64FoldString(fnv1a64Init(), "UntaggedUnion");
      state = fnv1a64FoldBigint(state, BigInt(def.members.length));
      for (const memberType of def.members) {
        state = fnv1a64FoldBigint(
          state,
          computeTypeUseFingerprint(sr, memberType)
        );
      }
      return state;
    }

    case Semantic.ENode.FunctionDatatype:
    case Semantic.ENode.DeferredFunctionDatatype: {
      let state = fnv1a64FoldString(fnv1a64Init(), "Function");
      state = fnv1a64FoldBigint(state, BigInt(def.parameters.length));
      for (const param of def.parameters) {
        state = fnv1a64FoldBigint(
          state,
          computeTypeUseFingerprint(sr, param.type)
        );
      }
      state = fnv1a64FoldBigint(state, def.vararg ? 1n : 0n);
      if (def.variant === Semantic.ENode.FunctionDatatype) {
        state = fnv1a64FoldBigint(
          state,
          computeTypeUseFingerprint(sr, def.returnType)
        );
      }
      return state;
    }

    case Semantic.ENode.CallableDatatype: {
      // Invariant 5: delegate straight to the wrapped function type's
      // fingerprint. Never call mangleTypeDef on `def` itself.
      let state = fnv1a64FoldString(fnv1a64Init(), "Callable");
      state = fnv1a64FoldBigint(
        state,
        computeTypeDefFingerprint(sr, def.functionType)
      );
      return state;
    }

    case Semantic.ENode.FixedArrayDatatype: {
      let state = fnv1a64FoldString(fnv1a64Init(), "FixedArray");
      state = fnv1a64FoldBigint(
        state,
        computeTypeUseFingerprint(sr, def.datatype)
      );
      state = fnv1a64FoldBigint(state, def.length);
      return state;
    }

    case Semantic.ENode.DynamicArrayDatatype: {
      let state = fnv1a64FoldString(fnv1a64Init(), "DynamicArray");
      state = fnv1a64FoldBigint(
        state,
        computeTypeUseFingerprint(sr, def.datatype)
      );
      return state;
    }

    case Semantic.ENode.SliceDatatype: {
      let state = fnv1a64FoldString(fnv1a64Init(), "Slice");
      state = fnv1a64FoldBigint(
        state,
        computeTypeUseFingerprint(sr, def.datatype)
      );
      return state;
    }

    case Semantic.ENode.ReactiveDatatype: {
      let state = fnv1a64FoldString(fnv1a64Init(), "Reactive");
      state = fnv1a64FoldBigint(
        state,
        computeTypeUseFingerprint(sr, def.wrappedType)
      );
      return state;
    }

    case Semantic.ENode.ShallowReactiveDatatype: {
      let state = fnv1a64FoldString(fnv1a64Init(), "ShallowReactive");
      state = fnv1a64FoldBigint(
        state,
        computeTypeUseFingerprint(sr, def.wrappedType)
      );
      return state;
    }

    case Semantic.ENode.ComputedDatatype: {
      let state = fnv1a64FoldString(fnv1a64Init(), "Computed");
      state = fnv1a64FoldBigint(
        state,
        computeTypeUseFingerprint(sr, def.wrappedType)
      );
      return state;
    }

    case Semantic.ENode.DeepDatatype: {
      let state = fnv1a64FoldString(fnv1a64Init(), "Deep");
      // Use the cloned (current-shape) type, not the original it was cloned
      // from -- the clone is what actually determines this type's layout.
      state = fnv1a64FoldBigint(
        state,
        computeTypeUseFingerprint(sr, def.clonedType)
      );
      return state;
    }

    case Semantic.ENode.TypeAliasDatatype: {
      // Transparent regarding identity/name (an alias is not a distinct
      // nominal identity from its target -- unwrap and start from the
      // target's fingerprint), but NOT transparent regarding annotations:
      // `[[json.discriminator="foo"]] type Foo = A | B;` attaches real,
      // behaviorally-relevant metadata at the alias itself (e.g. read by
      // reflection-driven serialization code), which the bare union/target
      // has no way to carry. Two aliases of the same target with different
      // annotations must NOT fingerprint equal.
      let state = fnv1a64FoldBigint(
        fnv1a64Init(),
        computeTypeUseFingerprint(sr, def.targetType)
      );
      state = foldAnnotations(sr, state, def.annotations);
      return state;
    }

    case Semantic.ENode.ParameterPackDatatype:
    case Semantic.ENode.GenericParameterDatatype:
    case Semantic.ENode.NamespaceDatatype:
    case Semantic.ENode.UnionTagRefDatatype:
    case Semantic.ENode.LiteralDatatype: {
      throw new InternalError(
        `T.fingerprint is not defined for ${Semantic.ENode[def.variant]} -- ` +
          "this variant should not be reachable via reflection on well-typed, " +
          "fully-elaborated user code. If this fires, a real case surfaced and " +
          "the composition rule needs to be designed, not guessed."
      );
    }

    default: {
      def satisfies never;
      throw new InternalError(
        "Unhandled TypeDef variant in computeTypeDefFingerprint"
      );
    }
  }
}

export function computeTypeUseFingerprint(
  sr: Semantic.Context,
  typeUseId: Semantic.TypeUseId
): bigint {
  const memoized = sr.typeUseFingerprints.get(typeUseId);
  if (memoized !== undefined) {
    return memoized;
  }

  const use = sr.typeUseNodes.get(typeUseId);

  // Invariant 4: mangleTypeUse's own string already bakes in mutability and
  // pointer/inline via the c/m/p/i prefix scheme -- fold that string, don't
  // separately re-hash `use.mutability`/`use.inline` as raw values too.
  let state = fnv1a64FoldString(
    fnv1a64Init(),
    mangledTypeUseName(sr, typeUseId)
  );
  state = fnv1a64FoldBigint(state, computeTypeDefFingerprint(sr, use.type));

  sr.typeUseFingerprints.set(typeUseId, state);
  return state;
}

// Converts an unsigned 64-bit hash into Haze `int`'s signed 64-bit range
// (two's complement wraparound), since `literalValue` does not range-check
// or convert this for the caller.
export function fingerprintToHazeInt(fingerprint: bigint): bigint {
  const unsigned = fingerprint & MASK_64;
  return unsigned > 0x7fffffffffffffffn
    ? unsigned - 0x10000000000000000n
    : unsigned;
}
