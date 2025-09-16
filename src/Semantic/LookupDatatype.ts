import {
  EPrimitive,
  EVariableContext,
  primitiveToString,
  stringToPrimitive,
} from "../shared/common";
import { assert, CompilerError, type SourceLoc } from "../shared/Errors";
import {
  Collect,
  funcSymHasParameterPack,
  printCollectedExpr,
} from "../SymbolCollection/SymbolCollection";
import { isTypeConcrete, makePrimitiveAvailable, Semantic, type SemanticResult } from "./Elaborate";
import { EExternLanguage, EDatatypeMutability, EVariableMutability } from "../shared/AST";
import { Conversion } from "./Conversion";

export function makeRawFunctionDatatypeAvailable(
  sr: SemanticResult,
  args: {
    parameters: Semantic.TypeUseId[];
    returnType: Semantic.TypeUseId;
    vararg: boolean;
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

    // Everything matches
    return id;
  }

  // Nothing found
  const [ftype, ftypeId] = Semantic.addType(sr, {
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

export function makeFunctionDatatypeAvailable(
  sr: SemanticResult,
  args: {
    parameters: Semantic.TypeUseId[];
    returnType: Semantic.TypeUseId;
    vararg: boolean;
    mutability: EDatatypeMutability;
    sourceloc: SourceLoc;
  }
): Semantic.TypeUseId {
  return makeTypeUse(
    sr,
    makeRawFunctionDatatypeAvailable(sr, args),
    args.mutability,
    args.sourceloc
  )[1];
}

export function makeNullableReferenceDatatypeAvailable(
  sr: SemanticResult,
  referee: Semantic.TypeUseId,
  mutability: EDatatypeMutability,
  sourceloc: SourceLoc
): Semantic.TypeUseId {
  for (const id of sr.nullRefTypeCache) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.NullableReferenceDatatype);
    if (type.referee !== referee) {
      continue;
    }
    return makeTypeUse(sr, id, mutability, sourceloc)[1];
  }

  // Nothing found
  const [type, typeId] = Semantic.addType(sr, {
    variant: Semantic.ENode.NullableReferenceDatatype,
    referee: referee,
    concrete: isTypeConcrete(sr, referee),
  });
  sr.nullRefTypeCache.push(typeId);
  return makeTypeUse(sr, typeId, mutability, sourceloc)[1];
}

export function makeReferenceDatatypeAvailable(
  sr: SemanticResult,
  referee: Semantic.TypeUseId,
  mutability: EDatatypeMutability,
  sourceloc: SourceLoc
): Semantic.TypeUseId {
  for (const id of sr.referenceTypeCache) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.ReferenceDatatype);
    if (type.referee !== referee) {
      continue;
    }
    return makeTypeUse(sr, id, mutability, sourceloc)[1];
  }

  // Nothing found
  const [type, typeId] = Semantic.addType(sr, {
    variant: Semantic.ENode.ReferenceDatatype,
    referee: referee,
    concrete: isTypeConcrete(sr, referee),
  });
  sr.referenceTypeCache.push(typeId);
  return makeTypeUse(sr, typeId, mutability, sourceloc)[1];
}

export function makeTypeUse(
  sr: SemanticResult,
  typeId: Semantic.TypeDefId,
  mutability: EDatatypeMutability,
  sourceloc: SourceLoc
) {
  for (const id of sr.typeInstanceCache) {
    const type = sr.typeUseNodes.get(id);
    if (type.mutability !== mutability || type.type !== typeId) {
      continue;
    }
    return [type, id] as const;
  }

  const instance = Semantic.addTypeInstance(sr, {
    mutability: mutability,
    type: typeId,
    sourceloc: sourceloc,
  });
  sr.typeInstanceCache.push(instance[1]);
  return instance;
}

export function makeArrayDatatypeAvailable(
  sr: SemanticResult,
  datatype: Semantic.TypeUseId,
  length: number,
  mutability: EDatatypeMutability,
  sourceloc: SourceLoc
): Semantic.TypeUseId {
  for (const id of sr.arrayTypeCache) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.ArrayDatatype);
    if (type.datatype !== datatype || type.length !== length) {
      continue;
    }
    return makeTypeUse(sr, id, mutability, sourceloc)[1];
  }

  // Nothing found
  const [type, typeId] = Semantic.addType(sr, {
    variant: Semantic.ENode.ArrayDatatype,
    datatype: datatype,
    length: length,
    concrete: isTypeConcrete(sr, datatype),
  });
  sr.arrayTypeCache.push(typeId);
  return makeTypeUse(sr, typeId, mutability, sourceloc)[1];
}

export function makeSliceDatatypeAvailable(
  sr: SemanticResult,
  datatype: Semantic.TypeUseId,
  mutability: EDatatypeMutability,
  sourceloc: SourceLoc
): Semantic.TypeUseId {
  for (const id of sr.sliceTypeCache) {
    const type = sr.typeDefNodes.get(id);
    assert(type.variant === Semantic.ENode.SliceDatatype);
    if (type.datatype !== datatype) {
      continue;
    }
    return makeTypeUse(sr, id, mutability, sourceloc)[1];
  }

  // Nothing found
  const [type, typeId] = Semantic.addType(sr, {
    variant: Semantic.ENode.SliceDatatype,
    datatype: datatype,
    concrete: isTypeConcrete(sr, datatype),
  });
  sr.sliceTypeCache.push(typeId);
  return makeTypeUse(sr, typeId, mutability, sourceloc)[1];
}

export function elaborateParentSymbolFromCache(
  sr: SemanticResult,
  args: {
    parentScope: Collect.ScopeId;
    context: Semantic.ElaborationContext;
  }
): Semantic.TypeDefId | null {
  let parentStructOrNS = null as Semantic.TypeDefId | null;
  const parentScope = sr.cc.scopeNodes.get(args.parentScope);
  if (parentScope.variant === Collect.ENode.StructScope) {
    // This parenting works by elaborating the lexical parent on demand. If we somehow got into it, to access one
    // of its children, then we must have the substitution context from the parent, and it must also be cached.
    // So we take the lexical parent, substitute all generics, and then use the cache to get the finished parent.
    const parentStructSymbol = sr.cc.symbolNodes.get(parentScope.owningSymbol);
    assert(parentStructSymbol.variant === Collect.ENode.TypeDefSymbol);
    const parentStruct = sr.cc.typeDefNodes.get(parentStructSymbol.typeDef);
    assert(parentStruct.variant === Collect.ENode.StructTypeDef);
    const parentGenericArgs = parentStruct.generics.map((g) => {
      const subst = args.context.substitute.get(g);
      assert(subst);
      return subst;
    });
    for (const cache of sr.elaboratedStructDatatypes) {
      const parentOwning = sr.cc.symbolNodes.get(parentScope.owningSymbol);
      if (
        parentOwning.variant === Collect.ENode.TypeDefSymbol &&
        cache.originalSymbol === parentOwning.typeDef &&
        cache.generics.length === parentGenericArgs.length &&
        cache.generics.every((g, i) => g === parentGenericArgs[i])
      ) {
        parentStructOrNS = cache.result;
        break;
      }
    }
    assert(parentStructOrNS, "Parent struct not found in cache: Impossible");
  } else if (parentScope.variant === Collect.ENode.NamespaceScope) {
    const sym = sr.cc.symbolNodes.get(parentScope.owningSymbol);
    assert(sym.variant === Collect.ENode.TypeDefSymbol);
    parentStructOrNS = Semantic.elaborateNamespace(sr, sym.typeDef, {
      context: args.context,
    });
  }
  return parentStructOrNS;
}

export function instantiateAndElaborateStructWithGenerics(
  sr: SemanticResult,
  args: {
    definedStructTypeId: Collect.TypeDefId;
    genericArgs: Semantic.TypeUseId[];
    sourceloc: SourceLoc;
    context: Semantic.ElaborationContext;
  }
) {
  const definedStructType = sr.cc.typeDefNodes.get(args.definedStructTypeId);
  assert(definedStructType.variant === Collect.ENode.StructTypeDef);

  if (definedStructType.generics.length !== args.genericArgs.length) {
    throw new CompilerError(
      `Type ${definedStructType.name} expects ${definedStructType.generics.length} type parameters but got ${args.genericArgs.length}`,
      args.sourceloc
    );
  }

  if (definedStructType.generics.length !== 0) {
    assert(definedStructType.structScope);
    args.context = Semantic.isolateElaborationContext(args.context, {
      currentScope: args.context.currentScope,
      genericsScope: args.context.currentScope,
    });
    for (let i = 0; i < definedStructType.generics.length; i++) {
      args.context.substitute.set(definedStructType.generics[i], args.genericArgs[i]);
    }
  }

  return instantiateAndElaborateStruct(sr, {
    context: args.context,
    definedStructTypeId: args.definedStructTypeId,
    sourceloc: args.sourceloc,
  });
}

export function instantiateAndElaborateStruct(
  sr: SemanticResult,
  args: {
    definedStructTypeId: Collect.TypeDefId; // The defining struct datatype to be instantiated (e.g. struct Foo<T> {})
    sourceloc: SourceLoc;
    context: Semantic.ElaborationContext;
  }
) {
  const definedStructType = sr.cc.typeDefNodes.get(args.definedStructTypeId);
  assert(definedStructType.variant === Collect.ENode.StructTypeDef);

  const genericArgs = definedStructType.generics.map((g) => {
    const substitute = args.context.substitute.get(g);
    assert(substitute);
    return substitute;
  });

  // If already existing, return cached to prevent loops
  for (const s of sr.elaboratedStructDatatypes) {
    if (
      s.generics.length === genericArgs.length &&
      s.generics.every((g, index) => g === genericArgs[index]) &&
      s.originalSymbol === args.definedStructTypeId
    ) {
      return s.result;
    }
  }

  const [struct, structId] = Semantic.addType<Semantic.StructDatatypeDef>(sr, {
    variant: Semantic.ENode.StructDatatype,
    name: definedStructType.name,
    generics: genericArgs,
    extern: definedStructType.extern,
    noemit: definedStructType.noemit,
    parentStructOrNS: elaborateParentSymbolFromCache(sr, {
      parentScope: definedStructType.parentScope,
      context: args.context,
    }),
    isMonomorphized: definedStructType.generics.length > 0,
    members: [],
    memberDefaultValues: [],
    methods: [],
    nestedStructs: [],
    sourceloc: definedStructType.sourceloc,
    concrete: genericArgs.every((g) => isTypeConcrete(sr, g)),
    originalCollectedSymbol: args.definedStructTypeId,
  });

  if (struct.concrete) {
    sr.elaboratedStructDatatypes.push({
      generics: genericArgs,
      originalSymbol: args.definedStructTypeId,
      substitutionContext: args.context,
      result: structId,
      resultAsTypeDefSymbol: Semantic.addSymbol(sr, {
        variant: Semantic.ENode.TypeDefSymbol,
        datatype: structId,
      })[1],
    });

    const structScope = sr.cc.scopeNodes.get(definedStructType.structScope);
    assert(structScope.variant === Collect.ENode.StructScope);

    structScope.symbols.forEach((symbolId) => {
      const symbol = sr.cc.symbolNodes.get(symbolId);
      if (symbol.variant === Collect.ENode.VariableSymbol) {
        assert(symbol.type);
        const typeId = lookupAndElaborateDatatype(sr, {
          typeId: symbol.type,
          // Start lookup in the struct itself, these are members, so both the type and
          // its generics must be found from within the struct
          context: Semantic.isolateElaborationContext(args.context, {
            currentScope: definedStructType.structScope,
            genericsScope: definedStructType.structScope,
          }),
          isInCFuncdecl: false,
        });
        const typeInstance = sr.typeUseNodes.get(typeId);
        const type = sr.typeDefNodes.get(typeInstance.type);
        const [variable, variableId] = Semantic.addSymbol(sr, {
          variant: Semantic.ENode.VariableSymbol,
          name: symbol.name,
          export: false,
          extern: EExternLanguage.None,
          mutability: EVariableMutability.Default,
          sourceloc: symbol.sourceloc,
          memberOfStruct: structId,
          type: typeId,
          variableContext: EVariableContext.MemberOfStruct,
          parentStructOrNS: structId,
          comptime: false,
          comptimeValue: null,
          concrete: type.concrete,
        });
        struct.members.push(variableId);
        const defaultValue = definedStructType.defaultMemberValues.find(
          (v) => v.name === symbol.name
        );
        if (defaultValue) {
          const value = sr.cc.exprNodes.get(defaultValue.value);
          let defaultExprId: Semantic.ExprId;
          if (value.variant === Collect.ENode.SymbolValueExpr && value.name === "default") {
            if (value.genericArgs.length !== 0) {
              throw new CompilerError(
                `'default' initializer cannot take any generics`,
                symbol.sourceloc
              );
            }
            defaultExprId = Conversion.MakeDefaultValue(sr, typeId, symbol.sourceloc);
          } else {
            defaultExprId = Semantic.elaborateExpr(sr, defaultValue.value, {
              context: args.context,
              expectedReturnType: makePrimitiveAvailable(
                sr,
                EPrimitive.void,
                EDatatypeMutability.Default,
                definedStructType.sourceloc
              ),
              isMonomorphized: struct.isMonomorphized,
              gonnaInstantiateStructWithType: variable.type,
              scope: definedStructType.structScope,
              blockScope: null,
              unsafe: false,
            })[1];
          }
          struct.memberDefaultValues.push({
            memberName: variable.name,
            value: Conversion.MakeConversionOrThrow(
              sr,
              defaultExprId,
              typeId,
              [],
              symbol.sourceloc,
              Conversion.Mode.Implicit,
              false
            ),
          });
        }
      } else if (symbol.variant === Collect.ENode.FunctionOverloadGroupSymbol) {
        symbol.overloads.forEach((overloadId) => {
          const overloadedFunc = sr.cc.symbolNodes.get(overloadId);
          assert(overloadedFunc.variant === Collect.ENode.FunctionSymbol);
          if (overloadedFunc.generics.length !== 0 || funcSymHasParameterPack(sr.cc, overloadId)) {
            return;
          }
          const signature = Semantic.elaborateFunctionSignature(sr, overloadId, {
            context: args.context,
          });
          const funcId = Semantic.elaborateFunctionSymbol(sr, signature, {
            paramPackTypes: [],
            context: args.context,
            isMonomorphized: struct.isMonomorphized,
            parentStructOrNS: structId,
          });
          const func = sr.symbolNodes.get(funcId);
          assert(funcId && func && func.variant === Semantic.ENode.FunctionSymbol);
          struct.methods.push(funcId);
        });
      } else if (symbol.variant === Collect.ENode.TypeDefSymbol) {
        const def = sr.cc.typeDefNodes.get(symbol.typeDef);
        if (def.variant === Collect.ENode.StructTypeDef) {
          if (def.generics.length !== 0) {
            return;
          }
          // If the nested struct is not generic, instantiate it without generics for early errors
          const subStructId = instantiateAndElaborateStructWithGenerics(sr, {
            definedStructTypeId: symbol.typeDef,
            context: args.context,
            genericArgs: [],
            sourceloc: def.sourceloc,
          });
          struct.nestedStructs.push(subStructId);
        }
      } else if (symbol.variant === Collect.ENode.GenericTypeParameterSymbol) {
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
    typeId: Collect.TypeUseId;
    context: Semantic.ElaborationContext;
    isInCFuncdecl: boolean;
  }
): Semantic.TypeUseId {
  const type = sr.cc.typeUseNodes.get(args.typeId);

  switch (type.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.FunctionDatatype: {
      return makeFunctionDatatypeAvailable(sr, {
        parameters: type.parameters.map((p) =>
          lookupAndElaborateDatatype(sr, {
            typeId: p,
            context: args.context,
            isInCFuncdecl: args.isInCFuncdecl,
          })
        ),
        returnType: lookupAndElaborateDatatype(sr, {
          typeId: type.returnType,
          context: args.context,
          isInCFuncdecl: args.isInCFuncdecl,
        }),
        vararg: type.vararg,
        mutability: type.mutability,
        sourceloc: type.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.NullableReferenceDatatype: {
      return makeNullableReferenceDatatypeAvailable(
        sr,
        lookupAndElaborateDatatype(sr, {
          typeId: type.referee,
          context: args.context,
          isInCFuncdecl: args.isInCFuncdecl,
        }),
        type.mutability,
        type.sourceloc
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
          context: args.context,
          isInCFuncdecl: args.isInCFuncdecl,
        }),
        type.length,
        type.mutability,
        type.sourceloc
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
          context: args.context,
          isInCFuncdecl: args.isInCFuncdecl,
        }),
        type.mutability,
        type.sourceloc
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
          context: args.context,
          isInCFuncdecl: args.isInCFuncdecl,
        }),
        type.mutability,
        type.sourceloc
      );
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    // case Collect.ENode.TypeDefAlias: {
    //   return lookupAndElaborateDatatype(sr, {
    //     typeId: type.target,
    //     context: args.context,
    //     elaboratedVariables: args.elaboratedVariables,
    //     isInCFuncdecl: args.isInCFuncdecl,
    //   });
    // }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.NamedDatatype: {
      const primitive = stringToPrimitive(type.name);
      if (primitive) {
        if (type.genericArgs.length > 0) {
          throw new CompilerError(`Type ${type.name} is not generic`, type.sourceloc);
        }
        return makePrimitiveAvailable(sr, primitive, type.mutability, type.sourceloc);
      }

      if (type.name === "Callable") {
        if (type.genericArgs.length != 1) {
          throw new CompilerError(
            `Type Callable<> must take exactly 1 type parameter`,
            type.sourceloc
          );
        }
        const farg = sr.cc.exprNodes.get(type.genericArgs[0]);
        if (
          farg.variant !== Collect.ENode.LiteralExpr &&
          farg.variant !== Collect.ENode.TypeLiteralExpr
        ) {
          throw new CompilerError(
            `Expression '${printCollectedExpr(
              sr.cc,
              type.genericArgs[0]
            )}' cannot be used as a generic substitute`,
            type.sourceloc
          );
        }
        if (
          farg.variant !== Collect.ENode.TypeLiteralExpr ||
          sr.cc.typeUseNodes.get(farg.datatype).variant !== Collect.ENode.FunctionDatatype
        ) {
          throw new CompilerError(
            `Type Callable<> must take a function datatype as the generic argument`,
            type.sourceloc
          );
        }
        const functype = lookupAndElaborateDatatype(sr, {
          typeId: farg.datatype,
          context: args.context,
          isInCFuncdecl: args.isInCFuncdecl,
        });
        return makeTypeUse(
          sr,
          Semantic.addType(sr, {
            variant: Semantic.ENode.CallableDatatype,
            functionType: sr.typeUseNodes.get(functype).type,
            thisExprType: undefined,
            concrete: isTypeConcrete(sr, functype),
          })[1],
          type.mutability,
          type.sourceloc
        )[1];
      }

      let foundResult = Semantic.lookupSymbol(sr, type.name, {
        startLookupInScope: args.context.currentScope,
        sourceloc: type.sourceloc,
      });
      if (foundResult.type === "semantic") {
        const e = sr.exprNodes.get(foundResult.id);
        if (e.variant === Semantic.ENode.DatatypeAsValueExpr) {
          return e.type;
        }
        assert(false);
      }
      let foundId = foundResult.id;
      let found = sr.cc.symbolNodes.get(foundId);

      if (found.variant === Collect.ENode.GenericTypeParameterSymbol) {
        const mappedTo = args.context.substitute.get(foundId);
        if (mappedTo) {
          return mappedTo;
        } else {
          return makeTypeUse(
            sr,
            Semantic.addType(sr, {
              variant: Semantic.ENode.GenericParameterDatatype,
              name: found.name,
              collectedParameter: foundId,
              concrete: false,
            })[1],
            type.mutability,
            type.sourceloc
          )[1];
        }
      } else if (found.variant === Collect.ENode.TypeDefSymbol) {
        const typedef = sr.cc.typeDefNodes.get(found.typeDef);
        if (typedef.variant === Collect.ENode.TypeDefAlias) {
          const aliasedTypeId = lookupAndElaborateDatatype(sr, {
            typeId: typedef.target,
            context: args.context,
            isInCFuncdecl: false,
          });
          if (type.innerNested) {
            const aliasedType = sr.typeDefNodes.get(sr.typeUseNodes.get(aliasedTypeId).type);
            if (aliasedType.variant !== Semantic.ENode.NamespaceDatatype) {
              throw new CompilerError(
                `Type '${Semantic.serializeTypeUse(
                  sr,
                  aliasedTypeId
                )}' cannot be used as a namespace`,
                type.sourceloc
              );
            }
            const collectedNamespace = sr.cc.typeDefNodes.get(aliasedType.collectedNamespace);
            assert(collectedNamespace.variant === Collect.ENode.NamespaceTypeDef);
            return lookupAndElaborateDatatype(sr, {
              typeId: type.innerNested,
              context: Semantic.isolateElaborationContext(args.context, {
                currentScope: collectedNamespace.namespaceScope,
                genericsScope: args.context.genericsScope,
              }),
              isInCFuncdecl: args.isInCFuncdecl,
            });
          }
          return aliasedTypeId;
        } else if (typedef.variant === Collect.ENode.StructTypeDef) {
          const generics = type.genericArgs.map((g) => {
            return Semantic.expressionAsGenericArg(sr, g, {
              blockScope: args.blockScope,
              context: args.context,
            });
          });
          const structId = instantiateAndElaborateStructWithGenerics(sr, {
            definedStructTypeId: foundId,
            genericArgs: generics,
            context: args.context,
            sourceloc: type.sourceloc,
          });
          const struct = sr.typeDefNodes.get(structId);
          assert(struct.variant === Semantic.ENode.StructDatatype);
          const structScope = sr.cc.scopeNodes.get(found.structScope);
          assert(structScope.variant === Collect.ENode.StructScope);

          if (type.innerNested) {
            // Here we need to merge the context from the parent into the child
            let cachedParentSubstitutions = undefined as Semantic.ElaborationContext | undefined;
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
              typeId: type.innerNested,
              isInCFuncdecl: false,
              context: Semantic.mergeSubstitutionContext(cachedParentSubstitutions, args.context, {
                currentScope: found.structScope,
                genericsScope: args.context.genericsScope,
              }),
            });
          } else {
            return makeTypeUse(sr, structId, type.mutability, type.sourceloc)[1];
          }
        } else if (found.variant === Collect.ENode.NamespaceTypeDef) {
          if (!type.innerNested) {
            return makeTypeUse(
              sr,
              Semantic.elaborateNamespace(sr, foundId, {
                context: args.context,
              }),
              type.mutability,
              type.sourceloc
            )[1];
          }
          return lookupAndElaborateDatatype(sr, {
            typeId: type.innerNested,
            context: Semantic.isolateElaborationContext(args.context, {
              currentScope: found.namespaceScope,
              genericsScope: args.context.genericsScope,
            }),
            isInCFuncdecl: args.isInCFuncdecl,
          });
        }
      } else {
        throw new CompilerError(
          `Symbol '${type.name}' cannot be used as a datatype here`,
          type.sourceloc
        );
      }
    }

    case Collect.ENode.LiteralExpr: {
      return makeTypeUse(
        sr,
        Semantic.addType(sr, {
          variant: Semantic.ENode.LiteralValueDatatype,
          literal: type.literal,
          concrete: true,
          sourceloc: type.sourceloc,
        })[1],
        EDatatypeMutability.Const,
        type.sourceloc
      )[1];
    }

    case Collect.ENode.ParameterPack: {
      return makeTypeUse(
        sr,
        Semantic.addType(sr, {
          variant: Semantic.ENode.ParameterPackDatatype,
          parameters: null,
          concrete: true,
        })[1],
        EDatatypeMutability.Const,
        type.sourceloc
      )[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    default:
      assert(false, (type as any).variant.toString());
  }
}
