import {
  EDatatypeMutability,
  EExternLanguage,
  EVariableMutability,
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
    false,
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
  // Bucketed by return type and parameter count -- both necessary conditions
  // the scan checked anyway. Everything else is compared exactly as before,
  // just over the handful of entries that share those two.
  let byParamCount = sr.functionTypeCache.get(args.returnType);
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
    if (type.returnType !== args.returnType) {
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
    sr.functionTypeCache.set(args.returnType, byParamCount);
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
    false,
    args.sourceloc
  )[1];
}

function cacheTypeInstance(
  sr: Semantic.Context,
  typeId: Semantic.TypeDefId,
  mutability: EDatatypeMutability,
  inline: boolean,
  id: Semantic.TypeUseId
): void {
  let byMutability = sr.typeInstanceCache.get(typeId);
  if (!byMutability) {
    byMutability = new Map();
    sr.typeInstanceCache.set(typeId, byMutability);
  }
  let byInline = byMutability.get(mutability);
  if (!byInline) {
    byInline = new Map();
    byMutability.set(mutability, byInline);
  }
  byInline.set(inline, id);
}

export function makeTypeUse(
  sr: Semantic.Context,
  typeId: Semantic.TypeDefId,
  mutability: EDatatypeMutability,
  inline: boolean | "force-no-inline",
  sourceloc: SourceLoc
) {
  const type = sr.typeDefNodes.get(typeId);
  if (type.variant === Semantic.ENode.StructDatatype) {
    let shouldBeInline = type.inlineByDefault;
    if (inline === "force-no-inline") {
      shouldBeInline = false;
    } else {
      shouldBeInline ||= inline;
    }

    // Nested maps rather than one packed key: the levels are the three
    // things the scan compared, so nothing here assumes how many values
    // EDatatypeMutability has, and no key object or string is built per call.
    const cachedStruct = sr.typeInstanceCache
      .get(typeId)
      ?.get(mutability)
      ?.get(shouldBeInline);
    if (cachedStruct !== undefined) {
      return [sr.typeUseNodes.get(cachedStruct), cachedStruct] as const;
    }

    const instance = sr.b.addTypeInstance(sr, {
      mutability: mutability,
      inline: shouldBeInline,
      type: typeId,
      sourceloc: sourceloc,
    });
    cacheTypeInstance(sr, typeId, mutability, shouldBeInline, instance[1]);
    return instance;
  }
  // Non-structs never compared inline, so they all live in the false slot:
  // the scan matched on type and mutability alone, so the first entry for a
  // pair won whatever its inline was. A typeId is a struct or it is not, so
  // these two branches never share an entry.
  const cachedPlain = sr.typeInstanceCache.get(typeId)?.get(mutability)?.get(false);
  if (cachedPlain !== undefined) {
    return [sr.typeUseNodes.get(cachedPlain), cachedPlain] as const;
  }

  let shouldBeInline = inline;
  if (shouldBeInline === "force-no-inline") {
    shouldBeInline = false;
  }

  const instance = sr.b.addTypeInstance<Semantic.TypeUse>(sr, {
    mutability: mutability,
    inline: shouldBeInline,
    type: typeId,
    sourceloc: sourceloc,
  });
  cacheTypeInstance(sr, typeId, mutability, false, instance[1]);
  return instance;
}

export function makeStackArrayDatatypeAvailable(
  sr: Semantic.Context,
  datatype: Semantic.TypeUseId,
  length: bigint,
  mutability: EDatatypeMutability,
  inline: boolean,
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
    return makeTypeUse(sr, id, mutability, inline, sourceloc)[1];
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
  return makeTypeUse(sr, typeId, mutability, inline, sourceloc)[1];
}

export function makeDynamicArrayDatatypeAvailable(
  sr: Semantic.Context,
  datatype: Semantic.TypeUseId,
  mutability: EDatatypeMutability,
  inline: boolean,
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
    return makeTypeUse(sr, id, mutability, inline, sourceloc)[1];
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
  return makeTypeUse(sr, typeId, mutability, inline, sourceloc)[1];
}
