import { stringToPrimitive } from "../shared/common";
import { assert, CompilerError, ImpossibleSituation, type SourceLoc } from "../shared/Errors";
import { Collect } from "../SymbolCollection/SymbolCollection";
import { isolateElaborationContext, lookupSymbol, type SubstitutionContext } from "./Elaborate";
import { makePrimitiveAvailable, Semantic, type SemanticResult } from "./SemanticSymbols";

export function makeFunctionDatatypeAvailable(
  sr: SemanticResult,
  args: {
    parameters: Semantic.TypeId[];
    returnType: Semantic.TypeId;
    vararg: boolean;
  }
): Semantic.TypeId {
  for (const id of sr.functionTypeCache) {
    const type = sr.typeNodes.get(id);
    assert(type.variant === "FunctionDatatype");
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
  const ftype = Semantic.addType(sr, {
    variant: "FunctionDatatype",
    parameters: args.parameters,
    returnType: args.returnType,
    vararg: args.vararg,
    concrete:
      args.parameters.every((p) => sr.typeNodes.get(p).concrete) &&
      sr.typeNodes.get(args.returnType).concrete,
  });
  sr.functionTypeCache.push(ftype);
  return ftype;
}

export function makePointerDatatypeAvailable(
  sr: SemanticResult,
  pointee: Semantic.TypeId
): Semantic.TypeId {
  for (const id of sr.rawPointerTypeCache) {
    const type = sr.typeNodes.get(id);
    assert(type.variant === "PointerDatatype");
    if (type.pointee !== pointee) {
      continue;
    }
    return id;
  }

  // Nothing found
  const type = Semantic.addType(sr, {
    variant: "PointerDatatype",
    pointee: pointee,
    concrete: sr.typeNodes.get(pointee).concrete,
  });
  sr.rawPointerTypeCache.push(type);
  return type;
}

export function makeReferenceDatatypeAvailable(
  sr: SemanticResult,
  referee: Semantic.TypeId
): Semantic.TypeId {
  for (const id of sr.referenceTypeCache) {
    const type = sr.typeNodes.get(id);
    assert(type.variant === "ReferenceDatatype");
    if (type.referee !== referee) {
      continue;
    }
    return id;
  }

  // Nothing found
  const type = Semantic.addType(sr, {
    variant: "ReferenceDatatype",
    referee: referee,
    concrete: sr.typeNodes.get(referee).concrete,
  });
  sr.referenceTypeCache.push(type);
  return type;
}

export function instantiateStruct(
  sr: SemanticResult,
  args: {
    definedStructTypeId: Collect.Id; // The defining struct datatype to be instantiated (e.g. struct Foo<T> {})
    genericArgs: Semantic.TypeId[];
    sourceloc: SourceLoc;
    parentStruct: Semantic.TypeId | null;
    context: SubstitutionContext;
  }
) {
  const definedStructType = sr.cc.nodes.get(args.definedStructTypeId);
  assert(definedStructType.variant === Collect.ENode.StructDefinitionSymbol);

  // If already existing, return cached to prevent loops
  for (const s of sr.elaboratedStructDatatypes) {
    if (
      s.generics.length === generics.length &&
      s.generics.every((g, index) => g === generics[index]) &&
      s.originalSymbol === args.definedStructTypeId
    ) {
      return s.resultSymbol;
    }
  }

  if (definedStructType.generics.length !== generics.length) {
    throw new CompilerError(
      `Type ${definedStructType.name} expects ${definedStructType.generics.length} type parameters but got ${args.genericArgs.length}`,
      args.sourceloc
    );
  }

  // The parent needs to also be substituted. Example: struct A<T=i32> { struct B {} } and B is instantiated
  let parentSymbol: Semantic.TypeId | null = null;
  const parentScopeId = definedStructType.parentScope;
  const parentScope = sr.cc.nodes.get(parentScopeId);
  if (parentScope.variant === Collect.ENode.StructScope) {
    const parentStructSymbol = sr.cc.nodes.get(parentScope.owningSymbol);
    assert(parentStructSymbol.variant === Collect.ENode.StructDefinitionSymbol);
    // Get the instantiated parent symbol
    for (const s of sr.elaboratedStructDatatypes) {
      if (
        s.generics.every(
          (g, index) => g === args.context.substitute.get(parentStructSymbol.generics[index])
        ) &&
        s.originalSymbol === parentScope.owningSymbol
      ) {
        parentSymbol = s.resultSymbol;
      }
    }
    if (!parentSymbol) {
      assert(false, "Instantiated Parent Struct has not been found, but this should never fail");
    }
  } else if (parentScope.variant === Collect.ENode.NamespaceScope) {
    parentSymbol = elaborateNamespace(sr, parentScopeId, {
      context: args.context,
    });
  }

  const struct = Semantic.addType(sr, {
    variant: "StructDatatype",
    name: definedStructType.name,
    generics: generics,
    extern: definedStructType.extern,
    noemit: definedStructType.noemit,
    parentSymbol: parentSymbol,
    members: [],
    methods: new Set(),
    sourceloc: definedStructType.sourceloc,
    concrete: generics.every((g) => sr.typeNodes.get(g).concrete),
    originalCollectedSymbol: args.definedStructTypeId,
  });

  // New local substitution context
  const newContext = isolateElaborationContext(args.context);
  for (let i = 0; i < definedStructType.generics.length; i++) {
    newContext.substitute.set(definedStructType.generics[i], generics[i]);
  }

  if (sr.typeNodes.get(struct).concrete) {
    sr.elaboratedStructDatatypes.push({
      generics: generics,
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

function extractPathParts(
  sr: SemanticResult,
  node: Collect.NamedDatatype
): Collect.NamedDatatype[] {
  const parts: Collect.NamedDatatype[] = [];
  let current: Collect.NamedDatatype | null = node;

  while (current) {
    parts.push(current);
    current =
      (current.innerNested && (sr.cc.nodes.get(current.innerNested) as Collect.NamedDatatype)) ||
      null;
  }

  return parts;
}

function lookupAndElaborateStruct(
  sr: SemanticResult,
  namedTypeId: Collect.Id, // e.g. A<i32>.B<u8>.C or B<u8>.C in a method of A<i32>
  initialScope: Collect.Id,
  context: SubstitutionContext,
  currentParent?: Semantic.TypeId
): Semantic.TypeId {
  const namedType = sr.cc.nodes.get(namedTypeId);
  assert(namedType.variant === Collect.ENode.NamedDatatype);

  // Split the nested path left to right
  const pathParts = extractPathParts(sr, namedType); // e.g. [A<i32>, B<u8>, C]
  let currentScope: Collect.Id = initialScope;
  let parent = currentParent ?? null;

  for (const part of pathParts) {
    const symbol = lookupSymbol(sr.cc, part.name, {
      startLookupInScope: currentScope,
      sourceloc: part.sourceloc,
    });

    const generics = part.genericArgs.map((g) => {
      return lookupAndElaborateDatatype(sr, {
        typeId: g,
        startLookupInScope: currentScope,
        context: context,
        isInCFuncdecl: false,
      });
    });

    const instanceId = instantiateStruct(sr, {
      definedStructTypeId: symbol,
      genericArgs: generics,
      parentStruct: parent,
      context: context,
      sourceloc: part.sourceloc,
    });
    const instance = sr.typeNodes.get(instanceId);
    assert(instance.variant === "StructDatatype");
    // elaborateStruct(instance);
    parent = instanceId;
    currentScope = (
      sr.cc.nodes.get(instance.originalCollectedSymbol) as Collect.StructDefinitionSymbol
    ).structScope;
  }

  assert(parent);
  return parent;
}

export function lookupAndElaborateDatatype(
  sr: SemanticResult,
  args: {
    typeId: Collect.Id;
    startLookupInScope: Collect.Id;
    context: SubstitutionContext;
    isInCFuncdecl: boolean;
  }
): Semantic.TypeId {
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
            isInCFuncdecl: args.isInCFuncdecl,
          })
        ),
        returnType: lookupAndElaborateDatatype(sr, {
          typeId: type.returnType,
          startLookupInScope: args.startLookupInScope,
          context: args.context,
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
        });
        return Semantic.addType(sr, {
          variant: "CallableDatatype",
          functionType: functype,
          thisExprType: undefined,
          concrete: sr.typeNodes.get(functype).concrete,
        });
      }

      const foundId = lookupSymbol(sr.cc, type.name, {
        startLookupInScope: args.startLookupInScope,
        sourceloc: type.sourceloc,
      });
      const found = sr.cc.nodes.get(foundId);

      if (found.variant === Collect.ENode.StructDefinitionSymbol) {
        return lookupAndElaborateStruct();
      } else if (found.variant === Collect.ENode.NamespaceDefinitionSymbol) {
        if (!type.innerNested) {
          throw new CompilerError(`Namespace cannot be used as a datatype here`, type.sourceloc);
        }
        const nested = lookupAndElaborateDatatype(sr, {
          typeId: type.innerNested,
          startLookupInScope: found.namespaceScope,
          context: isolateElaborationContext(args.context),
          isInCFuncdecl: args.isInCFuncdecl,
        });
        return nested;
      } else if (found.variant === Collect.ENode.GenericTypeParameter) {
        const mappedTo = args.context.substitute.get(foundId);
        if (mappedTo) {
          return mappedTo;
        } else {
          // This type is returned any time something cannot be substituted, with concrete=false
          // TODO: This may be solved cleaner
          return Semantic.addType(sr, {
            variant: "GenericParameterDatatype",
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
