import { EVariableContext, stringToPrimitive } from "../shared/common";
import { assert, CompilerError, type SourceLoc } from "../shared/Errors";
import { Collect, funcSymHasParameterPack } from "../SymbolCollection/SymbolCollection";
import {
  elaborateFunctionSymbol,
  elaborateNamespace,
  isolateSubstitutionContext,
  lookupSymbol,
  mergeSubstitutionContext,
  type SubstitutionContext,
} from "./Elaborate";
import {
  asType,
  isTypeConcrete,
  makePrimitiveAvailable,
  Semantic,
  type SemanticResult,
} from "./SemanticSymbols";
import { EExternLanguage, EVariableMutability } from "../shared/AST";

export function makeFunctionDatatypeAvailable(
  sr: SemanticResult,
  args: {
    parameters: Semantic.Id[];
    returnType: Semantic.Id;
    vararg: boolean;
  }
): Semantic.Id {
  for (const id of sr.functionTypeCache) {
    const type = sr.nodes.get(id);
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

    // Everything matches
    return id;
  }

  // Nothing found
  const [ftype, ftypeId] = Semantic.addNode(sr, {
    variant: Semantic.ENode.FunctionDatatype,
    parameters: args.parameters,
    returnType: args.returnType,
    vararg: args.vararg,
    concrete:
      args.parameters.every((p) => isTypeConcrete(sr, p)) && isTypeConcrete(sr, args.returnType),
  });
  sr.functionTypeCache.push(ftypeId);
  return ftypeId;
}

export function makePointerDatatypeAvailable(
  sr: SemanticResult,
  pointee: Semantic.Id
): Semantic.Id {
  for (const id of sr.pointerTypeCache) {
    const type = sr.nodes.get(id);
    assert(type.variant === Semantic.ENode.PointerDatatype);
    if (type.pointee !== pointee) {
      continue;
    }
    return id;
  }

  // Nothing found
  const [type, typeId] = Semantic.addNode(sr, {
    variant: Semantic.ENode.PointerDatatype,
    pointee: pointee,
    concrete: isTypeConcrete(sr, pointee),
  });
  sr.pointerTypeCache.push(typeId);
  return typeId;
}

export function makeReferenceDatatypeAvailable(
  sr: SemanticResult,
  referee: Semantic.Id
): Semantic.Id {
  for (const id of sr.referenceTypeCache) {
    const type = sr.nodes.get(id);
    assert(type.variant === Semantic.ENode.ReferenceDatatype);
    if (type.referee !== referee) {
      continue;
    }
    return id;
  }

  // Nothing found
  const [type, typeId] = Semantic.addNode(sr, {
    variant: Semantic.ENode.ReferenceDatatype,
    referee: referee,
    concrete: isTypeConcrete(sr, referee),
  });
  sr.referenceTypeCache.push(typeId);
  return typeId;
}

export function makeArrayDatatypeAvailable(
  sr: SemanticResult,
  datatype: Semantic.Id,
  length: number
): Semantic.Id {
  for (const id of sr.arrayTypeCache) {
    const type = sr.nodes.get(id);
    assert(type.variant === Semantic.ENode.ArrayDatatype);
    if (type.datatype !== datatype || type.length !== length) {
      continue;
    }
    return id;
  }

  // Nothing found
  const [type, typeId] = Semantic.addNode(sr, {
    variant: Semantic.ENode.ArrayDatatype,
    datatype: datatype,
    length: length,
    concrete: isTypeConcrete(sr, datatype),
  });
  sr.arrayTypeCache.push(typeId);
  return typeId;
}

export function makeSliceDatatypeAvailable(sr: SemanticResult, datatype: Semantic.Id): Semantic.Id {
  for (const id of sr.sliceTypeCache) {
    const type = sr.nodes.get(id);
    assert(type.variant === Semantic.ENode.SliceDatatype);
    if (type.datatype !== datatype) {
      continue;
    }
    return id;
  }

  // Nothing found
  const [type, typeId] = Semantic.addNode(sr, {
    variant: Semantic.ENode.SliceDatatype,
    datatype: datatype,
    concrete: isTypeConcrete(sr, datatype),
  });
  sr.sliceTypeCache.push(typeId);
  return typeId;
}

export function elaborateParentSymbolFromCache(
  sr: SemanticResult,
  args: {
    parentScope: Collect.Id;
    context: SubstitutionContext;
    currentScope: Collect.Id;
  }
): Semantic.Id | null {
  let parentStructOrNS = null as Semantic.Id | null;
  const parentScope = sr.cc.nodes.get(args.parentScope);
  if (parentScope.variant === Collect.ENode.StructScope) {
    // This parenting works by elaborating the lexical parent on demand. If we somehow got into it, to access one
    // of its children, then we must have the substitution context from the parent, and it must also be cached.
    // So we take the lexical parent, substitute all generics, and then use the cache to get the finished parent.
    const parentStruct = sr.cc.nodes.get(parentScope.owningSymbol);
    assert(parentStruct.variant === Collect.ENode.StructDefinitionSymbol);
    const parentGenericArgs = parentStruct.generics.map((g) => {
      const subst = args.context.substitute.get(g);
      assert(subst);
      return subst;
    });
    for (const cache of sr.elaboratedStructDatatypes) {
      if (
        cache.originalSymbol === parentScope.owningSymbol &&
        cache.generics.length === parentGenericArgs.length &&
        cache.generics.every((g, i) => g === parentGenericArgs[i])
      ) {
        parentStructOrNS = cache.resultSymbol;
        break;
      }
    }
    assert(parentStructOrNS, "Parent struct not found in cache: Impossible");
  } else if (parentScope.variant === Collect.ENode.NamespaceScope) {
    parentStructOrNS = elaborateNamespace(sr, parentScope.owningSymbol, {
      context: args.context,
      currentScope: args.currentScope,
    });
  }
  return parentStructOrNS;
}

export function instantiateAndElaborateStruct(
  sr: SemanticResult,
  args: {
    definedStructTypeId: Collect.Id; // The defining struct datatype to be instantiated (e.g. struct Foo<T> {})
    genericArgs: Semantic.Id[];
    sourceloc: SourceLoc;
    currentScope: Collect.Id;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    context: SubstitutionContext;
  }
) {
  const definedStructType = sr.cc.nodes.get(args.definedStructTypeId);
  assert(definedStructType.variant === Collect.ENode.StructDefinitionSymbol);

  // If already existing, return cached to prevent loops
  for (const s of sr.elaboratedStructDatatypes) {
    if (
      s.generics.length === args.genericArgs.length &&
      s.generics.every((g, index) => g === args.genericArgs[index]) &&
      s.originalSymbol === args.definedStructTypeId
    ) {
      return s.resultSymbol;
    }
  }

  if (definedStructType.generics.length !== args.genericArgs.length) {
    throw new CompilerError(
      `Type ${definedStructType.name} expects ${definedStructType.generics.length} type parameters but got ${args.genericArgs.length}`,
      args.sourceloc
    );
  }

  const [struct, structId] = Semantic.addNode<Semantic.StructDatatypeSymbol>(sr, {
    variant: Semantic.ENode.StructDatatype,
    name: definedStructType.name,
    generics: args.genericArgs,
    extern: definedStructType.extern,
    noemit: definedStructType.noemit,
    parentStructOrNS: elaborateParentSymbolFromCache(sr, {
      parentScope: definedStructType.parentScope,
      context: args.context,
      currentScope: args.currentScope,
    }),
    collectedSymbol: args.definedStructTypeId,
    isMonomorphized: definedStructType.generics.length > 0,
    members: [],
    methods: [],
    nestedStructs: [],
    sourceloc: definedStructType.sourceloc,
    concrete: args.genericArgs.every((g) => isTypeConcrete(sr, g)),
    originalCollectedSymbol: args.definedStructTypeId,
  });

  // New local substitution context
  const newContext = isolateSubstitutionContext(args.context);
  for (let i = 0; i < definedStructType.generics.length; i++) {
    newContext.substitute.set(definedStructType.generics[i], args.genericArgs[i]);
  }

  if (isTypeConcrete(sr, structId)) {
    sr.elaboratedStructDatatypes.push({
      generics: args.genericArgs,
      originalSymbol: args.definedStructTypeId,
      substitutionContext: newContext,
      resultSymbol: structId,
    });

    const structScope = sr.cc.nodes.get(definedStructType.structScope);
    assert(structScope.variant === Collect.ENode.StructScope);

    structScope.symbols.forEach((symbolId) => {
      const symbol = sr.cc.nodes.get(symbolId);
      if (symbol.variant === Collect.ENode.VariableSymbol) {
        assert(symbol.type);
        const type = lookupAndElaborateDatatype(sr, {
          typeId: symbol.type,
          // Start lookup in the struct itself, these are members, so both the type and
          // its generics must be found from within the struct
          startLookupInScopeForSymbol: definedStructType.structScope,
          startLookupInScopeForGenerics: definedStructType.structScope,
          currentScope: args.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          context: newContext,
          isInCFuncdecl: false,
        });
        const [variable, variableId] = Semantic.addNode(sr, {
          variant: Semantic.ENode.VariableSymbol,
          name: symbol.name,
          export: false,
          extern: EExternLanguage.None,
          mutability: EVariableMutability.Mutable,
          sourceloc: symbol.sourceloc,
          memberOfStruct: structId,
          type: type,
          variableContext: EVariableContext.MemberOfStruct,
          parentStructOrNS: structId,
          comptime: false,
          comptimeValue: null,
          concrete: asType(sr.nodes.get(type)).concrete,
        });
        struct.members.push(variableId);
      } else if (symbol.variant === Collect.ENode.FunctionOverloadGroup) {
        symbol.overloads.forEach((overloadId) => {
          const overloadedFunc = sr.cc.nodes.get(overloadId);
          assert(overloadedFunc.variant === Collect.ENode.FunctionSymbol);
          if (overloadedFunc.generics.length !== 0 || funcSymHasParameterPack(sr.cc, overloadId)) {
            return;
          }
          const funcId = elaborateFunctionSymbol(sr, overloadId, {
            genericArgs: [],
            paramPackTypes: [],
            context: newContext,
            usageSite: overloadedFunc.sourceloc,
            isMonomorphized: struct.isMonomorphized,
            currentScope: args.currentScope,
            elaboratedVariables: args.elaboratedVariables,
            parentStructOrNS: structId,
          });
          const func = sr.nodes.get(funcId);
          assert(funcId && func && func.variant === Semantic.ENode.FunctionSymbol);
          struct.methods.push(funcId);
        });
      } else if (symbol.variant === Collect.ENode.StructDefinitionSymbol) {
        if (symbol.generics.length !== 0) {
          return;
        }
        // If the nested struct is not generic, instantiate it without generics for early errors
        const subStructId = instantiateAndElaborateStruct(sr, {
          definedStructTypeId: symbolId,
          context: newContext,
          genericArgs: [],
          currentScope: args.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          sourceloc: symbol.sourceloc,
        });
        struct.nestedStructs.push(subStructId);
      } else if (symbol.variant === Collect.ENode.GenericTypeParameter) {
        // Skip this, don't elaborate, it's only used for resolving and instantiation
      } else {
        assert(false, "unexpected type: " + symbol.variant);
      }
    });
  }

  return structId;
}

export function lookupAndElaborateDatatype(
  sr: SemanticResult,
  args: {
    typeId: Collect.Id;
    startLookupInScopeForSymbol: Collect.Id;
    startLookupInScopeForGenerics: Collect.Id;
    context: SubstitutionContext;
    currentScope: Collect.Id;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    isInCFuncdecl: boolean;
  }
): Semantic.Id {
  const type = sr.cc.nodes.get(args.typeId);

  switch (type.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.FunctionDatatype: {
      return makeFunctionDatatypeAvailable(sr, {
        parameters: type.parameters.map((p) =>
          lookupAndElaborateDatatype(sr, {
            typeId: p,
            startLookupInScopeForSymbol: args.startLookupInScopeForSymbol,
            startLookupInScopeForGenerics: args.startLookupInScopeForGenerics,
            context: args.context,
            currentScope: args.currentScope,
            elaboratedVariables: args.elaboratedVariables,
            isInCFuncdecl: args.isInCFuncdecl,
          })
        ),
        returnType: lookupAndElaborateDatatype(sr, {
          typeId: type.returnType,
          startLookupInScopeForSymbol: args.startLookupInScopeForSymbol,
          startLookupInScopeForGenerics: args.startLookupInScopeForGenerics,
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          currentScope: args.currentScope,
          isInCFuncdecl: args.isInCFuncdecl,
        }),
        vararg: type.vararg,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.PointerDatatype: {
      return makePointerDatatypeAvailable(
        sr,
        lookupAndElaborateDatatype(sr, {
          typeId: type.pointee,
          startLookupInScopeForSymbol: args.startLookupInScopeForSymbol,
          startLookupInScopeForGenerics: args.startLookupInScopeForGenerics,
          context: args.context,
          currentScope: args.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          isInCFuncdecl: args.isInCFuncdecl,
        })
      );
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ArrayDatatype: {
      return makeArrayDatatypeAvailable(
        sr,
        lookupAndElaborateDatatype(sr, {
          typeId: type.datatype,
          startLookupInScopeForSymbol: args.startLookupInScopeForSymbol,
          startLookupInScopeForGenerics: args.startLookupInScopeForGenerics,
          context: args.context,
          currentScope: args.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          isInCFuncdecl: args.isInCFuncdecl,
        }),
        type.length
      );
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.SliceDatatype: {
      return makeSliceDatatypeAvailable(
        sr,
        lookupAndElaborateDatatype(sr, {
          typeId: type.datatype,
          startLookupInScopeForSymbol: args.startLookupInScopeForSymbol,
          startLookupInScopeForGenerics: args.startLookupInScopeForGenerics,
          context: args.context,
          currentScope: args.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          isInCFuncdecl: args.isInCFuncdecl,
        })
      );
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ReferenceDatatype: {
      return makeReferenceDatatypeAvailable(
        sr,
        lookupAndElaborateDatatype(sr, {
          typeId: type.referee,
          startLookupInScopeForSymbol: args.startLookupInScopeForSymbol,
          startLookupInScopeForGenerics: args.startLookupInScopeForGenerics,
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          currentScope: args.currentScope,
          isInCFuncdecl: args.isInCFuncdecl,
        })
      );
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.AliasTypeSymbol: {
      return lookupAndElaborateDatatype(sr, {
        typeId: type.target,
        startLookupInScopeForSymbol: args.startLookupInScopeForSymbol,
        startLookupInScopeForGenerics: args.startLookupInScopeForGenerics,
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        currentScope: args.currentScope,
        isInCFuncdecl: args.isInCFuncdecl,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.NamedDatatype: {
      const primitive = stringToPrimitive(type.name);
      if (primitive) {
        if (type.genericArgs.length > 0) {
          throw new CompilerError(`Type ${type.name} is not generic`, type.sourceloc);
        }
        return makePrimitiveAvailable(sr, primitive);
      }

      if (type.name === "Callable") {
        if (type.genericArgs.length != 1) {
          throw new CompilerError(
            `Type Callable<> must take exactly 1 type parameter`,
            type.sourceloc
          );
        }
        const farg = sr.cc.nodes.get(type.genericArgs[0]);
        if (farg.variant !== Collect.ENode.FunctionDatatype) {
          throw new CompilerError(
            `Type Callable<> must take a function datatype as the generic argument`,
            type.sourceloc
          );
        }
        const functype = lookupAndElaborateDatatype(sr, {
          typeId: type.genericArgs[0],
          startLookupInScopeForSymbol: args.startLookupInScopeForSymbol,
          startLookupInScopeForGenerics: args.startLookupInScopeForGenerics,
          context: args.context,
          isInCFuncdecl: args.isInCFuncdecl,
          currentScope: args.currentScope,
          elaboratedVariables: args.elaboratedVariables,
        });
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.CallableDatatype,
          functionType: functype,
          thisExprType: undefined,
          concrete: isTypeConcrete(sr, functype),
        })[1];
      }

      let foundResult = lookupSymbol(sr, type.name, {
        startLookupInScope: args.startLookupInScopeForSymbol,
        sourceloc: type.sourceloc,
      });
      if (foundResult.type === "semantic") {
        const e = sr.nodes.get(foundResult.id);
        if (e.variant === Semantic.ENode.DatatypeAsValueExpr) {
          return e.type;
        }
        assert(false);
      }
      let foundId = foundResult.id;
      let found = sr.cc.nodes.get(foundId);

      if (found.variant === Collect.ENode.AliasTypeSymbol) {
        return lookupAndElaborateDatatype(sr, {
          typeId: foundId,
          context: args.context,
          currentScope: args.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          isInCFuncdecl: false,
          startLookupInScopeForGenerics: args.startLookupInScopeForGenerics,
          startLookupInScopeForSymbol: args.startLookupInScopeForSymbol,
        });
      }

      if (found.variant === Collect.ENode.StructDefinitionSymbol) {
        const generics = type.genericArgs.map((g) => {
          return lookupAndElaborateDatatype(sr, {
            typeId: g,
            // This is intentionally generics twice, because in A<X>.B<Y>, Y must be resolved in the usage scope,
            // not inside A<X>
            startLookupInScopeForSymbol: args.startLookupInScopeForGenerics,
            startLookupInScopeForGenerics: args.startLookupInScopeForGenerics,
            context: args.context,
            isInCFuncdecl: false,
            elaboratedVariables: args.elaboratedVariables,
            currentScope: args.currentScope,
          });
        });
        const structId = instantiateAndElaborateStruct(sr, {
          definedStructTypeId: foundId,
          genericArgs: generics,
          context: args.context,
          currentScope: args.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          sourceloc: type.sourceloc,
        });
        const struct = sr.nodes.get(structId);
        assert(struct.variant === Semantic.ENode.StructDatatype);
        const structScope = sr.cc.nodes.get(found.structScope);
        assert(structScope.variant === Collect.ENode.StructScope);

        if (type.innerNested) {
          // Here we need to merge the context from the parent into the child
          let cachedParentSubstitutions = undefined as SubstitutionContext | undefined;
          for (const cache of sr.elaboratedStructDatatypes) {
            if (
              cache.originalSymbol === foundId &&
              cache.generics.length === generics.length &&
              cache.generics.every((g, i) => g === generics[i])
            ) {
              cachedParentSubstitutions = cache.substitutionContext;
              break;
            }
          }
          assert(cachedParentSubstitutions);
          return lookupAndElaborateDatatype(sr, {
            startLookupInScopeForSymbol: found.structScope,
            startLookupInScopeForGenerics: args.startLookupInScopeForGenerics,
            typeId: type.innerNested,
            currentScope: args.currentScope,
            elaboratedVariables: args.elaboratedVariables,
            isInCFuncdecl: false,
            context: mergeSubstitutionContext(cachedParentSubstitutions, args.context),
          });
        } else {
          return structId;
        }
      } else if (found.variant === Collect.ENode.NamespaceDefinitionSymbol) {
        if (!type.innerNested) {
          throw new CompilerError(`Namespace cannot be used as a datatype here`, type.sourceloc);
        }
        return lookupAndElaborateDatatype(sr, {
          typeId: type.innerNested,
          startLookupInScopeForSymbol: found.namespaceScope,
          startLookupInScopeForGenerics: args.startLookupInScopeForGenerics,
          currentScope: args.currentScope,
          context: isolateSubstitutionContext(args.context),
          elaboratedVariables: args.elaboratedVariables,
          isInCFuncdecl: args.isInCFuncdecl,
        });
      } else if (found.variant === Collect.ENode.GenericTypeParameter) {
        const mappedTo = args.context.substitute.get(foundId);
        if (mappedTo) {
          return mappedTo;
        } else {
          // This type is returned any time something cannot be substituted, with concrete=false
          // TODO: This may be solved cleaner
          return Semantic.addNode(sr, {
            variant: Semantic.ENode.GenericParameterDatatype,
            name: found.name,
            concrete: false,
          })[1];
        }
      } else {
        throw new CompilerError(
          `Symbol '${type.name}' cannot be used as a datatype here`,
          type.sourceloc
        );
      }
    }

    case Collect.ENode.LiteralExpr: {
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.LiteralValueDatatype,
        literal: type.literal,
        concrete: true,
        sourceloc: type.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    default:
      assert(false, "" + type.variant);
  }
}
