import { assert, type SourceLoc } from "../shared/Errors";
import { isTypeConcrete } from "./Elaborate";
import { EDatatypeMutability, EVariableMutability, EExternLanguage } from "../shared/AST";
import { EVariableContext } from "../shared/common";
import { Semantic } from "./SemanticTypes";

function createLengthFieldSymbol(sr: Semantic.Context, sourceloc: SourceLoc): Semantic.SymbolId {
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
    variableContext: EVariableContext.Global,
    parentStructOrNS: null,
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
  },
): Semantic.TypeDefId {
  for (const id of sr.deferredFunctionTypeCache) {
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
    if (wrong) continue;
    if (type.vararg !== args.vararg) continue;

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
  sr.deferredFunctionTypeCache.push(ftypeId);
  return ftypeId;
}

export function makeRawFunctionDatatypeAvailable(
  sr: Semantic.Context,
  args: {
    parameters: { optional: boolean; type: Semantic.TypeUseId }[];
    returnType: Semantic.TypeUseId;
    vararg: boolean;
    requires: Semantic.FunctionRequireBlock;
    sourceloc: SourceLoc;
  },
): Semantic.TypeDefId {
  for (const id of sr.functionTypeCache) {
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
    if (wrong) continue;
    if (type.returnType !== args.returnType) {
      continue;
    }
    if (type.vararg !== args.vararg) continue;
    if (type.requires.final !== args.requires.final) continue;
    if (type.requires.pure !== args.requires.pure) continue;
    if (type.requires.noreturn !== args.requires.noreturn) continue;
    if (type.requires.noreturnIf?.expr !== args.requires.noreturnIf?.expr) continue;

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
  sr.functionTypeCache.push(ftypeId);
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
  },
): Semantic.TypeUseId {
  return makeTypeUse(
    sr,
    makeRawFunctionDatatypeAvailable(sr, args),
    args.mutability,
    false,
    args.sourceloc,
  )[1];
}

export function makeTypeUse(
  sr: Semantic.Context,
  typeId: Semantic.TypeDefId,
  mutability: EDatatypeMutability,
  inline: boolean,
  sourceloc: SourceLoc,
) {
  const type = sr.typeDefNodes.get(typeId);
  if (
    type.variant === Semantic.ENode.StructDatatype ||
    type.variant === Semantic.ENode.FixedArrayDatatype ||
    type.variant === Semantic.ENode.DynamicArrayDatatype
  ) {
    for (const id of sr.typeInstanceCache) {
      const typeUse = sr.typeUseNodes.get(id);
      if (
        typeUse.mutability !== mutability ||
        typeUse.type !== typeId ||
        typeUse.inline !== inline
      ) {
        continue;
      }

      return [typeUse, id] as const;
    }

    const instance = sr.b.addTypeInstance(sr, {
      mutability: mutability,
      inline: inline,
      type: typeId,
      sourceloc: sourceloc,
    });
    sr.typeInstanceCache.push(instance[1]);
    return instance;
  } else {
    for (const id of sr.typeInstanceCache) {
      const typeUse = sr.typeUseNodes.get(id);
      if (typeUse.type !== typeId) {
        continue;
      }
      return [typeUse, id] as const;
    }

    const instance = sr.b.addTypeInstance(sr, {
      mutability: EDatatypeMutability.Default,
      inline: false,
      type: typeId,
      sourceloc: sourceloc,
    });
    sr.typeInstanceCache.push(instance[1]);
    return instance;
  }
}

export function makeStackArrayDatatypeAvailable(
  sr: Semantic.Context,
  datatype: Semantic.TypeUseId,
  length: bigint,
  mutability: EDatatypeMutability,
  inline: boolean,
  sourceloc: SourceLoc,
): Semantic.TypeUseId {
  for (const id of sr.fixedArrayTypeCache) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.FixedArrayDatatype);
    if (type.datatype !== datatype || type.length !== length) {
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
  sourceloc: SourceLoc,
): Semantic.TypeUseId {
  for (const id of sr.dynamicArrayTypeCache) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.DynamicArrayDatatype);
    if (type.datatype !== datatype) {
      continue;
    }
    return makeTypeUse(sr, id, mutability, inline, sourceloc)[1];
  }

  // Nothing found - create new type with lengthField
  const lengthFieldId = createLengthFieldSymbol(sr, sourceloc);
  const [_, typeId] = sr.b.addType(sr, {
    variant: Semantic.ENode.DynamicArrayDatatype,
    datatype: datatype,
    concrete: isTypeConcrete(sr, datatype),
    syntheticFields: [lengthFieldId],
  });
  sr.dynamicArrayTypeCache.push(typeId);
  return makeTypeUse(sr, typeId, mutability, inline, sourceloc)[1];
}
