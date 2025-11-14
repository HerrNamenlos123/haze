import { assert, type SourceLoc } from "../shared/Errors";
import { isTypeConcrete, Semantic, type SemanticResult } from "./Elaborate";
import { EDatatypeMutability } from "../shared/AST";

export function makeDeferredFunctionDatatypeAvailable(
  sr: SemanticResult,
  args: {
    parameters: Semantic.TypeUseId[];
    vararg: boolean;
    sourceloc: SourceLoc;
  }
): Semantic.TypeDefId {
  for (const id of sr.deferredFunctionTypeCache) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.DeferredFunctionDatatype);
    if (type.parameters.length !== args.parameters.length) {
      continue;
    }
    let wrong = false;
    for (let i = 0; i < args.parameters.length; i++) {
      if (type.parameters[i] !== args.parameters[i]) {
        wrong = true;
        break;
      }
    }
    if (wrong) continue;
    if (type.vararg !== args.vararg) continue;

    // Everything matches
    return id;
  }

  // Nothing found
  const [ftype, ftypeId] = Semantic.addType(sr, {
    variant: Semantic.ENode.DeferredFunctionDatatype,
    parameters: args.parameters,
    vararg: args.vararg,
    concrete: args.parameters.every((p) => isTypeConcrete(sr, p)),
  });
  sr.deferredFunctionTypeCache.push(ftypeId);
  return ftypeId;
}

export function makeRawFunctionDatatypeAvailable(
  sr: SemanticResult,
  args: {
    parameters: Semantic.TypeUseId[];
    returnType: Semantic.TypeUseId;
    vararg: boolean;
    requires: Semantic.FunctionRequireBlock;
    sourceloc: SourceLoc;
  }
): Semantic.TypeDefId {
  for (const id of sr.functionTypeCache) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.FunctionDatatype);
    if (type.parameters.length !== args.parameters.length) {
      continue;
    }
    let wrong = false;
    for (let i = 0; i < args.parameters.length; i++) {
      if (type.parameters[i] !== args.parameters[i]) {
        wrong = true;
        break;
      }
    }
    if (wrong) continue;
    if (type.returnType !== args.returnType) {
      continue;
    }
    if (type.vararg !== args.vararg) continue;
    if (type.requires.final !== args.requires.final) continue;
    if (type.requires.autodest !== args.requires.autodest) continue;

    // Everything matches
    return id;
  }

  // Nothing found
  const [ftype, ftypeId] = Semantic.addType(sr, {
    variant: Semantic.ENode.FunctionDatatype,
    parameters: args.parameters,
    returnType: args.returnType,
    vararg: args.vararg,
    requires: args.requires,
    concrete:
      args.parameters.every((p) => isTypeConcrete(sr, p)) && isTypeConcrete(sr, args.returnType),
  });
  sr.functionTypeCache.push(ftypeId);
  return ftypeId;
}

export function makeFunctionDatatypeAvailable(
  sr: SemanticResult,
  args: {
    parameters: Semantic.TypeUseId[];
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

export function makeTypeUse(
  sr: SemanticResult,
  typeId: Semantic.TypeDefId,
  mutability: EDatatypeMutability,
  inline: boolean,
  sourceloc: SourceLoc
) {
  for (const id of sr.typeInstanceCache) {
    const type = sr.typeUseNodes.get(id);
    if (type.mutability !== mutability || type.type !== typeId || type.inline !== inline) {
      continue;
    }
    return [type, id] as const;
  }

  const instance = Semantic.addTypeInstance(sr, {
    mutability: mutability,
    inline: inline,
    type: typeId,
    sourceloc: sourceloc,
  });
  sr.typeInstanceCache.push(instance[1]);
  return instance;
}

export function makeStackArrayDatatypeAvailable(
  sr: SemanticResult,
  datatype: Semantic.TypeUseId,
  length: number,
  mutability: EDatatypeMutability,
  inline: boolean,
  sourceloc: SourceLoc
): Semantic.TypeUseId {
  for (const id of sr.fixedArrayTypeCache) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.FixedArrayDatatype);
    if (type.datatype !== datatype || type.length !== length) {
      continue;
    }
    return makeTypeUse(sr, id, mutability, inline, sourceloc)[1];
  }

  // Nothing found
  const [type, typeId] = Semantic.addType(sr, {
    variant: Semantic.ENode.FixedArrayDatatype,
    datatype: datatype,
    length: length,
    concrete: isTypeConcrete(sr, datatype),
  });
  sr.fixedArrayTypeCache.push(typeId);
  return makeTypeUse(sr, typeId, mutability, inline, sourceloc)[1];
}

export function makeDynamicArrayDatatypeAvailable(
  sr: SemanticResult,
  datatype: Semantic.TypeUseId,
  mutability: EDatatypeMutability,
  inline: boolean,
  sourceloc: SourceLoc
): Semantic.TypeUseId {
  for (const id of sr.dynamicArrayTypeCache) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.DynamicArrayDatatype);
    if (type.datatype !== datatype) {
      continue;
    }
    return makeTypeUse(sr, id, mutability, inline, sourceloc)[1];
  }

  // Nothing found
  const [type, typeId] = Semantic.addType(sr, {
    variant: Semantic.ENode.DynamicArrayDatatype,
    datatype: datatype,
    concrete: isTypeConcrete(sr, datatype),
  });
  sr.dynamicArrayTypeCache.push(typeId);
  return makeTypeUse(sr, typeId, mutability, inline, sourceloc)[1];
}
