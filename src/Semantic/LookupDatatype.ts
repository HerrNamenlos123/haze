import { stringToPrimitive } from "../shared/common";
import { assert, CompilerError, ImpossibleSituation, type SourceLoc } from "../shared/Errors";
import { Collect } from "../SymbolCollection/SymbolCollection";
import {
  elaborateNamespace,
  isolateElaborationContext,
  lookupSymbol,
  type SubstitutionContext,
} from "./Elaborate";
import {
  isTypeConcrete,
  makePrimitiveAvailable,
  Semantic,
  type SemanticResult,
} from "./SemanticSymbols";

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
  const ftype = Semantic.addNode(sr, {
    variant: Semantic.ENode.FunctionDatatype,
    parameters: args.parameters,
    returnType: args.returnType,
    vararg: args.vararg,
    concrete:
      args.parameters.every((p) => isTypeConcrete(sr, p)) && isTypeConcrete(sr, args.returnType),
  });
  sr.functionTypeCache.push(ftype);
  return ftype;
}

export function makePointerDatatypeAvailable(
  sr: SemanticResult,
  pointee: Semantic.Id
): Semantic.Id {
  for (const id of sr.rawPointerTypeCache) {
    const type = sr.nodes.get(id);
    assert(type.variant === Semantic.ENode.PointerDatatype);
    if (type.pointee !== pointee) {
      continue;
    }
    return id;
  }

  // Nothing found
  const type = Semantic.addNode(sr, {
    variant: Semantic.ENode.PointerDatatype,
    pointee: pointee,
    concrete: isTypeConcrete(sr, pointee),
  });
  sr.rawPointerTypeCache.push(type);
  return type;
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
  const type = Semantic.addNode(sr, {
    variant: Semantic.ENode.ReferenceDatatype,
    referee: referee,
    concrete: isTypeConcrete(sr, referee),
  });
  sr.referenceTypeCache.push(type);
  return type;
}

export function instantiateAndElaborateStruct(
  sr: SemanticResult,
  args: {
    definedStructTypeId: Collect.Id; // The defining struct datatype to be instantiated (e.g. struct Foo<T> {})
    genericArgs: Semantic.Id[];
    sourceloc: SourceLoc;
    parentStructOrNS: Semantic.Id | null;
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

  const struct = Semantic.addNode(sr, {
    variant: Semantic.ENode.StructDatatype,
    name: definedStructType.name,
    generics: args.genericArgs,
    extern: definedStructType.extern,
    noemit: definedStructType.noemit,
    parentStructOrNS: args.parentStructOrNS,
    members: [],
    methods: new Set(),
    sourceloc: definedStructType.sourceloc,
    concrete: args.genericArgs.every((g) => isTypeConcrete(sr, g)),
    originalCollectedSymbol: args.definedStructTypeId,
  });

  // New local substitution context
  const newContext = isolateElaborationContext(args.context);
  for (let i = 0; i < definedStructType.generics.length; i++) {
    newContext.substitute.set(definedStructType.generics[i], args.genericArgs[i]);
  }

  if (isTypeConcrete(sr, struct)) {
    sr.elaboratedStructDatatypes.push({
      generics: args.genericArgs,
      originalSymbol: args.definedStructTypeId,
      resultSymbol: struct,
    });

    // struct.members = definedStructType.members.map((member) => {
    //   assert(args.definedStructType._collect.scope);
    //   const type = lookupAndElaborateDatatype(sr, {
    //     type: member.type,
    //     // Start lookup in the struct itself
    //     startLookupInScope: args.definedStructType._collect.scope,
    //     context: newContext,
    //     isInCFuncdecl: false,
    //   });
    //   return {
    //     variant: "Variable",
    //     name: member.name,
    //     export: false,
    //     externLanguage: EExternLanguage.None,
    //     mutable: true,
    //     sourceloc: member.sourceloc,
    //     type: type,
    //     variableContext: EVariableContext.MemberOfStruct,
    //     memberOf: struct,
    //     concrete: type.concrete,
    //   };
    // });

    // args.definedStructType.methods.forEach((method) => {
    //   assert(method.returnType);
    //   assert(method.funcbody?._collect.scope);
    //   if (method.generics.length !== 0 || method.operatorOverloading) {
    //     return;
    //   }

    //   const symbol = elaborate(sr, {
    //     sourceSymbol: method,
    //     usageGenerics: [],
    //     structForMethod: struct,
    //     context: newContext,
    //   });
    //   assert(symbol && symbol.variant === "FunctionDefinition");
    //   struct.methods.add(symbol);
    // });
  }

  // Now, also elaborate all nested sub structs
  // for (const d of definedStructType.nestedStructs) {
  //   if (d.generics.length === 0) {
  //     elaborate(sr, {
  //       sourceSymbol: d,
  //       usageGenerics: [],
  //       context: newContext,
  //     });
  //   }
  // }

  return struct;
}

export function lookupAndElaborateDatatype(
  sr: SemanticResult,
  args: {
    typeId: Collect.Id;
    startLookupInScope: Collect.Id;
    context: SubstitutionContext;
    parentStructOrNS: Semantic.Id | null;
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
            startLookupInScope: args.startLookupInScope,
            context: args.context,
            parentStructOrNS: args.parentStructOrNS,
            isInCFuncdecl: args.isInCFuncdecl,
          })
        ),
        returnType: lookupAndElaborateDatatype(sr, {
          typeId: type.returnType,
          startLookupInScope: args.startLookupInScope,
          context: args.context,
          parentStructOrNS: args.parentStructOrNS,
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
          startLookupInScope: args.startLookupInScope,
          context: args.context,
          parentStructOrNS: args.parentStructOrNS,
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
          startLookupInScope: args.startLookupInScope,
          context: args.context,
          parentStructOrNS: args.parentStructOrNS,
          isInCFuncdecl: args.isInCFuncdecl,
        })
      );
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
          startLookupInScope: args.startLookupInScope,
          context: args.context,
          isInCFuncdecl: args.isInCFuncdecl,
          parentStructOrNS: args.parentStructOrNS,
        });
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.CallableDatatype,
          functionType: functype,
          thisExprType: undefined,
          concrete: isTypeConcrete(sr, functype),
        });
      }

      const foundId = lookupSymbol(sr.cc, type.name, {
        startLookupInScope: args.startLookupInScope,
        sourceloc: type.sourceloc,
      });
      const found = sr.cc.nodes.get(foundId);

      if (found.variant === Collect.ENode.StructDefinitionSymbol) {
        const generics = type.genericArgs.map((g) => {
          return lookupAndElaborateDatatype(sr, {
            typeId: g,
            startLookupInScope: args.startLookupInScope,
            context: args.context,
            isInCFuncdecl: false,
            parentStructOrNS: args.parentStructOrNS,
          });
        });
        const structId = instantiateAndElaborateStruct(sr, {
          definedStructTypeId: foundId,
          genericArgs: generics,
          parentStructOrNS: args.parentStructOrNS,
          context: args.context,
          sourceloc: type.sourceloc,
        });
        const struct = sr.nodes.get(structId);
        assert(struct.variant === Semantic.ENode.StructDatatype);
        const structScope = sr.cc.nodes.get(found.structScope);
        assert(structScope.variant === Collect.ENode.StructScope);

        if (type.innerNested) {
          // Now the nesting
          return lookupAndElaborateDatatype(sr, {
            parentStructOrNS: structId,
            startLookupInScope: found.structScope,
            typeId: type.innerNested,
            isInCFuncdecl: false,
            context: args.context,
          });
        } else {
          return structId;
        }
      } else if (found.variant === Collect.ENode.NamespaceDefinitionSymbol) {
        if (!type.innerNested) {
          throw new CompilerError(`Namespace cannot be used as a datatype here`, type.sourceloc);
        }
        const nested = lookupAndElaborateDatatype(sr, {
          typeId: type.innerNested,
          startLookupInScope: found.namespaceScope,
          context: isolateElaborationContext(args.context),
          isInCFuncdecl: args.isInCFuncdecl,
          parentStructOrNS: args.parentStructOrNS,
        });
        return nested;
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
      assert(false, "Not implemented yet");
      // return Semantic.addExpr(sr, {
      //   variant: "LiteralExpr",
      //   literal: "LiteralExpr",
      //   sourceloc: args.type.sourceloc,
      // });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    default:
      throw new ImpossibleSituation();
  }
}
