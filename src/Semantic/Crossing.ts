import {
  EDatatypeMutability,
  EExternLanguage,
  EStorageClass,
} from "../shared/AST";
import { EPrimitive, EStructCrossthread } from "../shared/common";
import { InternalError } from "../shared/Errors";
import { Semantic } from "./SemanticTypes";

/**
 * The crossing rule (docs/async-decisions.md S5-1): the one place that decides
 * whether a value of a type may reach another thread, and why not.
 *
 * A type crosses when every value of it can be used on another thread without
 * a hard race (C142): it holds nothing changeable that the sending thread can
 * still reach, unless the changeable thing synchronizes itself. Values copy;
 * `const` data never changes (C603); atomic data synchronizes itself (C165);
 * an `unsafe crossthread` struct is its author's promise (C171). Everything
 * the rule does not name is decided through its members, so a type holding a
 * `cptr` fails on the `cptr` wherever it sits.
 *
 * Recursive types are checked coinductively: a type being checked is assumed
 * to cross, and the answer is the conjunction of everything it holds. Generic
 * code is checked where it is instantiated, so a generic parameter never
 * reaches this module.
 *
 * Every rejection names the path to the culprit, e.g. "its field 'log' is
 * 'mut ref Logger', a reference to a struct that is not atomic".
 */
export namespace Crossing {
  type Step = {
    // "field 'log'", "element", "variant 'Ok'", ...: what the step reaches.
    what: string;
    type: Semantic.TypeUseId;
  };

  export type Failure = {
    path: Step[];
    culprit: string;
  };

  /** Why a value of this type cannot cross threads, or null when it can. */
  export function failure(
    sr: Semantic.Context,
    typeUseId: Semantic.TypeUseId
  ): Failure | null {
    return check(sr, typeUseId, false, new Set());
  }

  export function crosses(
    sr: Semantic.Context,
    typeUseId: Semantic.TypeUseId
  ): boolean {
    return failure(sr, typeUseId) === null;
  }

  /**
   * The failure as the rest of a sentence. `first` is the step the caller
   * starts from ("its capture 'log'"); without one, the sentence is about
   * the type itself:
   *
   *   is '[]Job', a dynamic array that is neither atomic nor const
   *   ...: its capture 'jobs' is '[]Job', a dynamic array that is ...
   */
  export function explain(
    sr: Semantic.Context,
    f: Failure,
    first: { what: string; type: Semantic.TypeUseId } | null
  ): string {
    const steps = first === null ? f.path : [first, ...f.path];
    if (steps.length === 0) {
      return `it is ${f.culprit}`;
    }
    const parts = steps.map((s, i) => {
      const owner = i === 0 ? "its" : "whose";
      return `${owner} ${s.what} is '${Semantic.serializeTypeUse(sr, s.type)}'`;
    });
    return `${parts.join(", ")}, ${f.culprit}`;
  }

  /**
   * Why a value of this type cannot cross threads, as the rest of a
   * sentence after "cannot cross threads: ", or null when it crosses.
   */
  export function whyNot(
    sr: Semantic.Context,
    typeUseId: Semantic.TypeUseId
  ): string | null {
    const f = failure(sr, typeUseId);
    if (f === null) {
      return null;
    }
    return `is '${Semantic.serializeTypeUse(sr, typeUseId)}', which cannot cross threads: ${explain(sr, f, null)}`;
  }

  function fail(culprit: string): Failure {
    return { path: [], culprit: culprit };
  }

  function through(step: Step, inner: Failure | null): Failure | null {
    if (inner === null) {
      return null;
    }
    return { path: [step, ...inner.path], culprit: inner.culprit };
  }

  function check(
    sr: Semantic.Context,
    typeUseId: Semantic.TypeUseId,
    asConst: boolean,
    assumed: Set<string>
  ): Failure | null {
    const use = sr.typeUseNodes.get(sr.e.resolveAlias(typeUseId));
    const def = sr.typeDefNodes.get(use.type);
    // Const is deep (C603): what is reached through const data is const. Only
    // a struct's or an array's use says const data; a union's or a
    // primitive's is const by default and says nothing about its variants.
    const isConst =
      asConst ||
      (use.mutability === EDatatypeMutability.Const &&
        (def.variant === Semantic.ENode.StructDatatype ||
          def.variant === Semantic.ENode.DynamicArrayDatatype ||
          def.variant === Semantic.ENode.FixedArrayDatatype));

    // A stack reference carries its owning thread and never leaves it
    // (C264, C277, C280), whatever it points to.
    if (use.storage === EStorageClass.Stackref) {
      return fail("a stack reference, which never leaves its thread");
    }

    // Coinductive: a type already being checked (or already passed) is
    // assumed to cross. A failure ends the whole check, so nothing assumed
    // ever needs taking back.
    const key = `${use.type}:${use.storage}:${isConst}`;
    if (assumed.has(key)) {
      return null;
    }
    assumed.add(key);

    switch (def.variant) {
      case Semantic.ENode.PrimitiveDatatype:
        switch (def.primitive) {
          case EPrimitive.cptr:
          case EPrimitive.cstr:
          case EPrimitive.ccstr:
            // C273, C274: nothing is known about what a raw pointer points to.
            return fail("a raw C pointer, which never crosses threads");
          case EPrimitive.Regex:
            return fail(
              "a regular expression, which is not known to be thread safe"
            );
          default:
            // Numbers, bool, none and str (immutable) are values.
            return null;
        }

      case Semantic.ENode.LiteralDatatype:
      case Semantic.ENode.EnumDatatype:
      case Semantic.ENode.UnionTagRefDatatype:
        return null;

      // A plain function has no environment: on the other thread it reads
      // that thread's own globals (C604).
      case Semantic.ENode.FunctionDatatype:
        return null;

      // A closure crosses only when its type says its environment was
      // checked (C592, C594).
      case Semantic.ENode.CallableDatatype:
        if (def.crossthread) {
          return null;
        }
        return fail("a closure whose type is not 'crossthread'");

      case Semantic.ENode.StructDatatype:
        return checkStruct(sr, def, use, isConst, assumed);

      case Semantic.ENode.DynamicArrayDatatype:
        if (def.atomic) {
          // Its element was checked when the type was formed (C193).
          return null;
        }
        if (isConst) {
          return through(
            { what: "element", type: def.datatype },
            check(sr, def.datatype, true, assumed)
          );
        }
        return fail("a dynamic array that is neither atomic nor const");

      case Semantic.ENode.FixedArrayDatatype:
        return through(
          { what: "element", type: def.datatype },
          check(sr, def.datatype, isConst, assumed)
        );

      case Semantic.ENode.SliceDatatype:
        return fail("a slice, a view into the storage of an array");

      case Semantic.ENode.UntaggedUnionDatatype:
        for (const member of def.members) {
          const f = check(sr, member, isConst, assumed);
          if (f !== null) {
            return through({ what: "variant", type: member }, f);
          }
        }
        return null;

      case Semantic.ENode.TaggedUnionDatatype:
        for (const member of def.members) {
          const f = check(sr, member.type, isConst, assumed);
          if (f !== null) {
            return through(
              { what: `variant '${member.tag}'`, type: member.type },
              f
            );
          }
        }
        return null;

      case Semantic.ENode.ReactiveDatatype:
      case Semantic.ENode.ShallowReactiveDatatype:
      case Semantic.ENode.ComputedDatatype:
      case Semantic.ENode.DeepDatatype:
        return fail("reactive state, which belongs to one thread");

      case Semantic.ENode.GenericParameterDatatype:
      case Semantic.ENode.ParameterPackDatatype:
      case Semantic.ENode.DeferredFunctionDatatype:
      case Semantic.ENode.NamespaceDatatype:
      case Semantic.ENode.TypeAliasDatatype:
        throw new InternalError(
          `the crossing rule was asked about a ${Semantic.ENode[def.variant]}, which has no values of its own`
        );

      default: {
        const unhandled: never = def;
        throw new InternalError(`unhandled type ${String(unhandled)}`);
      }
    }
  }

  function checkStruct(
    sr: Semantic.Context,
    def: Semantic.StructDatatypeDef,
    use: Semantic.TypeUse,
    isConst: boolean,
    assumed: Set<string>
  ): Failure | null {
    // The author promises it is thread safe; nothing inside is checked (C171).
    if (def.crossthread === EStructCrossthread.Unsafe) {
      return null;
    }
    // A struct C defines that declares none of its members (Logger,
    // Allocator, UserBox) hides everything it holds: nothing is known about
    // it, as of a raw pointer (S5-C1).
    if (
      def.noemit &&
      def.extern !== EExternLanguage.None &&
      !def.members.some(
        (m) => sr.symbolNodes.get(m).variant === Semantic.ENode.VariableSymbol
      )
    ) {
      return fail(
        "a struct defined in C that shows none of what it holds, which never crosses threads unless it is declared 'unsafe crossthread'"
      );
    }
    if (use.storage === EStorageClass.Ref && !def.atomic && !isConst) {
      return fail("a reference to a struct that is not atomic");
    }
    // A value (every member copies), an atomic struct (its non-unsafe fields
    // are atomic or const, S5-7; S5-8), or const data (its members as const).
    for (const memberId of def.members) {
      const member = sr.symbolNodes.get(memberId);
      if (member.variant !== Semantic.ENode.VariableSymbol) {
        continue;
      }
      if (member.atomic === true || member.unsafe === true) {
        continue;
      }
      if (member.type === null) {
        throw new InternalError(`struct member '${member.name}' has no type`);
      }
      const f = check(sr, member.type, isConst, assumed);
      if (f !== null) {
        return through(
          { what: `field '${member.name}'`, type: member.type },
          f
        );
      }
    }
    // An atomic struct's generic arguments are its elements (C193, S5-8): a
    // `Future<T>` crosses exactly when `T` does, whatever its fields hold.
    if (def.atomic) {
      for (const argId of def.generics) {
        const arg = sr.exprNodes.get(argId);
        if (arg.variant !== Semantic.ENode.DatatypeAsValueExpr) {
          continue;
        }
        const f = check(sr, arg.type, isConst, assumed);
        if (f !== null) {
          return through({ what: "type argument", type: arg.type }, f);
        }
      }
    }
    return null;
  }

  /**
   * Whether a value of this type holds no stack reference anywhere: what a
   * closure that outlives its frame, and so a task, may hold (S5-3, C264).
   */
  export function capturableByTask(
    sr: Semantic.Context,
    typeUseId: Semantic.TypeUseId
  ): boolean {
    return !reachesStackref(sr, typeUseId, new Set());
  }

  function reachesStackref(
    sr: Semantic.Context,
    typeUseId: Semantic.TypeUseId,
    seen: Set<Semantic.TypeDefId>
  ): boolean {
    const use = sr.typeUseNodes.get(sr.e.resolveAlias(typeUseId));
    if (use.storage === EStorageClass.Stackref) {
      return true;
    }
    if (seen.has(use.type)) {
      return false;
    }
    seen.add(use.type);
    const def = sr.typeDefNodes.get(use.type);
    switch (def.variant) {
      case Semantic.ENode.StructDatatype:
        for (const memberId of def.members) {
          const member = sr.symbolNodes.get(memberId);
          if (
            member.variant === Semantic.ENode.VariableSymbol &&
            member.type !== null &&
            reachesStackref(sr, member.type, seen)
          ) {
            return true;
          }
        }
        return false;
      case Semantic.ENode.DynamicArrayDatatype:
      case Semantic.ENode.FixedArrayDatatype:
      case Semantic.ENode.SliceDatatype:
        return reachesStackref(sr, def.datatype, seen);
      case Semantic.ENode.UntaggedUnionDatatype:
        return def.members.some((m) => reachesStackref(sr, m, seen));
      case Semantic.ENode.TaggedUnionDatatype:
        return def.members.some((m) => reachesStackref(sr, m.type, seen));
      case Semantic.ENode.ReactiveDatatype:
      case Semantic.ENode.ShallowReactiveDatatype:
      case Semantic.ENode.ComputedDatatype:
        return reachesStackref(sr, def.wrappedType, seen);
      case Semantic.ENode.DeepDatatype:
        return reachesStackref(sr, def.clonedType, seen);
      default:
        return false;
    }
  }
}
