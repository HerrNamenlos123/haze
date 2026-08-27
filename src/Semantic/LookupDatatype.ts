import {
  EDatatypeMutability,
  EExternLanguage,
  EVariableMutability,
  EStorageClass,
} from "../shared/AST";
import { EVariableContext } from "../shared/common";
import { assert, type SourceLoc } from "../shared/Errors";
import { isTypeConcrete } from "./Elaborate";
import { Semantic } from "./SemanticTypes";

function createLengthFieldSymbol(
  sr: Semantic.Context,
  sourceloc: SourceLoc
): Semantic.SymbolId {
  // Create a synthetic VariableSymbol for the "length" field
  const [_, lengthFieldId] = sr.b.addSymbol(sr, {
    variant: Semantic.ENode.VariableSymbol,
    name: "length",
    export: false,
    extern: EExternLanguage.None,
    mutability: EVariableMutability.Default,
    sourceloc: sourceloc,
    memberOfStruct: null,
    type: sr.b.usizeType(),
    consumed: false,
    requiresHoisting: false,
    variableContext: EVariableContext.Global,
    parentSymbolId: null,
    comptime: false,
    comptimeValue: null,
    concrete: true,
  });

  return lengthFieldId;
}

export function makeDeferredFunctionDatatypeAvailable(
  sr: Semantic.Context,
  args: {
    parameters: {
      optional: boolean;
      type: Semantic.TypeUseId;
    }[];
    vararg: boolean;
    sourceloc: SourceLoc;
  }
): Semantic.TypeDefId {
  // Only entries with the same parameter count can match, so the original
  // comparison below now runs over that bucket instead of every cached type.
  let deferredBucket = sr.deferredFunctionTypeCache.get(args.parameters.length);
  for (const id of deferredBucket ?? []) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.DeferredFunctionDatatype);
    if (type.parameters.length !== args.parameters.length) {
      continue;
    }
    let wrong = false;
    for (let i = 0; i < args.parameters.length; i++) {
      if (
        type.parameters[i].type !== args.parameters[i].type ||
        type.parameters[i].optional !== args.parameters[i].optional
      ) {
        wrong = true;
        break;
      }
    }
    if (wrong) {
      continue;
    }
    if (type.vararg !== args.vararg) {
      continue;
    }

    // Everything matches
    return id;
  }

  // Nothing found
  const [_, ftypeId] = sr.b.addType(sr, {
    variant: Semantic.ENode.DeferredFunctionDatatype,
    parameters: args.parameters,
    vararg: args.vararg,
    concrete: args.parameters.every((p) => isTypeConcrete(sr, p.type)),
  });
  if (!deferredBucket) {
    deferredBucket = [];
    sr.deferredFunctionTypeCache.set(args.parameters.length, deferredBucket);
  }
  deferredBucket.push(ftypeId);
  return ftypeId;
}

export function makeRawCallableDatatypeAvailable(
  sr: Semantic.Context,
  args: {
    functionType: Semantic.TypeDefId;
    sourceloc: SourceLoc;
  }
): Semantic.TypeDefId {
  // The only thing the scan compared was functionType, so this is a plain map.
  const cachedCallable = sr.callableTypeCache.get(args.functionType);
  if (cachedCallable !== undefined) {
    return cachedCallable;
  }

  // Nothing found
  const [_, ftypeId] = sr.b.addType(sr, {
    variant: Semantic.ENode.CallableDatatype,
    functionType: args.functionType,
    concrete: sr.typeDefNodes.get(args.functionType).concrete,
  });
  sr.callableTypeCache.set(args.functionType, ftypeId);
  return ftypeId;
}

export function makeCallableDatatypeAvailable(
  sr: Semantic.Context,
  args: {
    functionType: Semantic.TypeDefId;
    sourceloc: SourceLoc;
  }
): Semantic.TypeUseId {
  return makeTypeUse(
    sr,
    makeRawCallableDatatypeAvailable(sr, args),
    EDatatypeMutability.Default,
    EStorageClass.Value,
    args.sourceloc
  )[1];
}

export function makeRawFunctionDatatypeAvailable(
  sr: Semantic.Context,
  args: {
    parameters: { optional: boolean; type: Semantic.TypeUseId }[];
    returnType: Semantic.TypeUseId;
    vararg: boolean;
    requires: Semantic.FunctionRequireBlock;
    sourceloc: SourceLoc;
  }
): Semantic.TypeDefId {
  // Identity is compared THROUGH aliases, so a signature written with an
  // alias and the same signature written with the target are one type.
  // Left unresolved, `from m import Props` in two files -- two file-scoped
  // aliases of one struct -- built two FunctionDatatypes for `() => Props`,
  // hence two CallableDatatypes, hence one C struct emitted twice under the
  // one name mangleTypeUse now gives both.
  //
  // Only the comparison resolves. The node keeps the types AS WRITTEN,
  // because Export.ts serialises them back out as the module's interface
  // source: an alias printed as its target loses more than the name --
  // `type Result = nodiscard union {...}` comes back as a bare annotated
  // union, which is not a type the parser accepts in return position.
  const resolvedReturn = sr.e.resolveAlias(args.returnType);
  const resolvedParams = args.parameters.map((p) => sr.e.resolveAlias(p.type));

  // Bucketed by return type and parameter count -- both necessary conditions
  // the scan checked anyway. Everything else is compared exactly as before,
  // just over the handful of entries that share those two.
  let byParamCount = sr.functionTypeCache.get(resolvedReturn);
  let fnBucket = byParamCount?.get(args.parameters.length);
  for (const id of fnBucket ?? []) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.FunctionDatatype);
    if (type.parameters.length !== args.parameters.length) {
      continue;
    }
    let wrong = false;
    for (let i = 0; i < args.parameters.length; i++) {
      if (
        sr.e.resolveAlias(type.parameters[i].type) !== resolvedParams[i] ||
        type.parameters[i].optional !== args.parameters[i].optional
      ) {
        wrong = true;
        break;
      }
    }
    if (wrong) {
      continue;
    }
    if (sr.e.resolveAlias(type.returnType) !== resolvedReturn) {
      continue;
    }
    if (type.vararg !== args.vararg) {
      continue;
    }
    if (type.requires.final !== args.requires.final) {
      continue;
    }
    if (type.requires.pure !== args.requires.pure) {
      continue;
    }
    if (type.requires.noreturn !== args.requires.noreturn) {
      continue;
    }
    if (type.requires.noreturnIf?.expr !== args.requires.noreturnIf?.expr) {
      continue;
    }

    // Everything matches
    return id;
  }

  // Nothing found
  const [_, ftypeId] = sr.b.addType(sr, {
    variant: Semantic.ENode.FunctionDatatype,
    parameters: args.parameters,
    returnType: args.returnType,
    vararg: args.vararg,
    requires: args.requires,
    concrete:
      args.parameters.every((p) => isTypeConcrete(sr, p.type)) &&
      isTypeConcrete(sr, args.returnType),
  });
  if (!byParamCount) {
    byParamCount = new Map();
    sr.functionTypeCache.set(resolvedReturn, byParamCount);
  }
  if (!fnBucket) {
    fnBucket = [];
    byParamCount.set(args.parameters.length, fnBucket);
  }
  fnBucket.push(ftypeId);
  return ftypeId;
}

export function makeFunctionDatatypeAvailable(
  sr: Semantic.Context,
  args: {
    parameters: { optional: boolean; type: Semantic.TypeUseId }[];
    returnType: Semantic.TypeUseId;
    vararg: boolean;
    mutability: EDatatypeMutability;
    requires: Semantic.FunctionRequireBlock;
    sourceloc: SourceLoc;
  }
): Semantic.TypeUseId {
  return makeTypeUse(
    sr,
    makeRawFunctionDatatypeAvailable(sr, args),
    args.mutability,
    EStorageClass.Value,
    args.sourceloc
  )[1];
}

function cacheTypeInstance(
  sr: Semantic.Context,
  typeId: Semantic.TypeDefId,
  mutability: EDatatypeMutability,
  storage: EStorageClass,
  id: Semantic.TypeUseId
): void {
  let byMutability = sr.typeInstanceCache.get(typeId);
  if (!byMutability) {
    byMutability = new Map();
    sr.typeInstanceCache.set(typeId, byMutability);
  }
  let byStorage = byMutability.get(mutability);
  if (!byStorage) {
    byStorage = new Map();
    byMutability.set(mutability, byStorage);
  }
  byStorage.set(storage, id);
}

/**
 * Returns the storage class a type *use* actually has, given the requested
 * modifier and the definition's default (R&D/Storage Classes and References.md §3):
 *
 *  - struct: `ref struct` is always at least Ref; `stackref` wins over
 *    everything (last modifier wins), so a stackref to a `ref struct` is a
 *    stackref to the heap object.
 *  - callable: Value (ordinary GC-env callable) or Stackref.
 *  - everything else: only Value exists. Callers that need to *reject*
 *    `ref int` / `stackref []T` do so before calling this (elaborateDatatype).
 */
export function effectiveStorageClass(
  sr: Semantic.Context,
  typeId: Semantic.TypeDefId,
  storage: EStorageClass
): EStorageClass {
  const type = sr.typeDefNodes.get(typeId);
  if (type.variant === Semantic.ENode.TypeAliasDatatype) {
    // Modifiers stack through aliases: `type Bar = mut ref Foo` then `Bar`
    // inherits Foo's ref-ness, and `stackref Bar` wins over it. The alias use
    // itself records the effective class so readers of the unresolved use see
    // the truth without chasing the chain.
    const targetUse = sr.typeUseNodes.get(sr.e.resolveAlias(type.targetType));
    if (storage === EStorageClass.Value) {
      return targetUse.storage;
    }
    return effectiveStorageClass(sr, targetUse.type, storage);
  }
  if (type.variant === Semantic.ENode.StructDatatype) {
    if (storage === EStorageClass.Stackref) {
      return EStorageClass.Stackref;
    }
    if (type.refByDefault) {
      return EStorageClass.Ref;
    }
    return storage;
  }
  if (type.variant === Semantic.ENode.CallableDatatype) {
    return storage === EStorageClass.Stackref
      ? EStorageClass.Stackref
      : EStorageClass.Value;
  }
  if (type.variant === Semantic.ENode.GenericParameterDatatype) {
    // An uninstantiated `ref T` / `stackref T` pattern keeps the request so
    // deduction and later substitution can see it; the instantiated body is
    // re-elaborated with T bound, where the modifier is applied for real.
    return storage;
  }
  return EStorageClass.Value;
}

export function makeTypeUse(
  sr: Semantic.Context,
  typeId: Semantic.TypeDefId,
  mutability: EDatatypeMutability,
  storage: EStorageClass,
  sourceloc: SourceLoc
) {
  const effective = effectiveStorageClass(sr, typeId, storage);

  // `mut` on a value struct is meaningless: nothing can be mutated *through* a
  // copy, and a value can always be mutated in place where it lives. Normalise
  // it away so `mut Foo` (e.g. a struct literal, which is created Mut) and
  // `Foo` are one interned use -- union members and conversions compare uses
  // by identity. `const` stays: deep immutability is meaningful on a value.
  if (
    mutability === EDatatypeMutability.Mut &&
    effective === EStorageClass.Value &&
    sr.typeDefNodes.get(typeId).variant === Semantic.ENode.StructDatatype
  ) {
    mutability = EDatatypeMutability.Default;
  }

  // Nested maps rather than one packed key: the levels are the three things
  // that identify a use, so no key object or string is built per call.
  const cached = sr.typeInstanceCache
    .get(typeId)
    ?.get(mutability)
    ?.get(effective);
  if (cached !== undefined) {
    return [sr.typeUseNodes.get(cached), cached] as const;
  }

  const instance = sr.b.addTypeInstance<Semantic.TypeUse>(sr, {
    mutability: mutability,
    storage: effective,
    type: typeId,
    sourceloc: sourceloc,
  });
  cacheTypeInstance(sr, typeId, mutability, effective, instance[1]);
  return instance;
}

export function makeStackArrayDatatypeAvailable(
  sr: Semantic.Context,
  datatype: Semantic.TypeUseId,
  length: bigint,
  mutability: EDatatypeMutability,
  storage: EStorageClass,
  sourceloc: SourceLoc
): Semantic.TypeUseId {
  const resolvedElemDefId = sr.typeUseNodes.get(sr.e.resolveAlias(datatype)).type;
  for (const id of sr.fixedArrayTypeCache) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.FixedArrayDatatype);
    const cachedElemDefId = sr.typeUseNodes.get(sr.e.resolveAlias(type.datatype)).type;
    if (cachedElemDefId !== resolvedElemDefId || type.length !== length) {
      continue;
    }
    return makeTypeUse(sr, id, mutability, storage, sourceloc)[1];
  }

  // Nothing found - create new type with lengthField
  const lengthFieldId = createLengthFieldSymbol(sr, sourceloc);
  const [_, typeId] = sr.b.addType(sr, {
    variant: Semantic.ENode.FixedArrayDatatype,
    datatype: datatype,
    length: length,
    concrete: isTypeConcrete(sr, datatype),
    syntheticFields: [lengthFieldId],
  });
  sr.fixedArrayTypeCache.push(typeId);
  return makeTypeUse(sr, typeId, mutability, storage, sourceloc)[1];
}

export function makeDynamicArrayDatatypeAvailable(
  sr: Semantic.Context,
  datatype: Semantic.TypeUseId,
  mutability: EDatatypeMutability,
  storage: EStorageClass,
  sourceloc: SourceLoc
): Semantic.TypeUseId {
  const resolvedElemDefId = sr.typeUseNodes.get(sr.e.resolveAlias(datatype)).type;
  for (const id of sr.dynamicArrayTypeCache) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.DynamicArrayDatatype);
    const cachedElemDefId = sr.typeUseNodes.get(sr.e.resolveAlias(type.datatype)).type;
    if (cachedElemDefId !== resolvedElemDefId) {
      continue;
    }
    return makeTypeUse(sr, id, mutability, storage, sourceloc)[1];
  }

  // Nothing found - create new type with lengthField
  const lengthFieldId = createLengthFieldSymbol(sr, sourceloc);
  const [_, typeId] = sr.b.addType<Semantic.DynamicArrayDatatypeDef>(sr, {
    variant: Semantic.ENode.DynamicArrayDatatype,
    datatype: datatype,
    concrete: isTypeConcrete(sr, datatype),
    syntheticFields: [lengthFieldId],
  });
  sr.dynamicArrayTypeCache.push(typeId);
  return makeTypeUse(sr, typeId, mutability, storage, sourceloc)[1];
}
