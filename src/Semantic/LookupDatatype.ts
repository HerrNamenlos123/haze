import { ScopeContext } from "../Parser/grammar/autogen/HazeParser";
import { EExternLanguage } from "../shared/AST";
import { EVariableContext, stringToPrimitive } from "../shared/common";
import { assert, CompilerError, ImpossibleSituation } from "../shared/Errors";
import { Collect } from "../SymbolCollection/SymbolCollection";
import {
  elaborate,
  elaborateStructOrNamespace,
  isolateElaborationContext,
  lookupSymbol,
  type SubstitutionContext,
} from "./Elaborate";
import {
  isDatatypeSymbol,
  makePrimitiveAvailable,
  Semantic,
  type SemanticResult,
} from "./SemanticSymbols";

export function makeFunctionDatatypeAvailable(
  sr: SemanticResult,
  args: {
    parameters: Semantic.DatatypeSymbol[];
    returnType: Semantic.DatatypeSymbol;
    vararg: boolean;
  }
): Semantic.FunctionDatatypeSymbol {
  for (const type of sr.functionTypeCache) {
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
    return type;
  }

  // Nothing found
  const ftype: Semantic.FunctionDatatypeSymbol = {
    variant: "FunctionDatatype",
    parameters: args.parameters,
    returnType: args.returnType,
    vararg: args.vararg,
    concrete: args.parameters.every((p) => p.concrete) && args.returnType.concrete,
  };
  sr.functionTypeCache.push(ftype);
  return ftype;
}

export function makeRawPointerDatatypeAvailable(
  sr: SemanticResult,
  pointee: Semantic.DatatypeSymbol
): Semantic.PointerDatatypeSymbol {
  for (const type of sr.rawPointerTypeCache) {
    if (type.pointee !== pointee) {
      continue;
    }
    return type;
  }

  // Nothing found
  const type: Semantic.PointerDatatypeSymbol = {
    variant: "RawPointerDatatype",
    pointee: pointee,
    concrete: pointee.concrete,
  };
  sr.rawPointerTypeCache.push(type);
  return type;
}

export function makeReferenceDatatypeAvailable(
  sr: SemanticResult,
  referee: Semantic.DatatypeSymbol
): Semantic.ReferenceDatatypeSymbol {
  for (const type of sr.referenceTypeCache) {
    if (type.referee !== referee) {
      continue;
    }
    return type;
  }

  // Nothing found
  const type: Semantic.ReferenceDatatypeSymbol = {
    variant: "ReferenceDatatype",
    referee: referee,
    concrete: referee.concrete,
  };
  sr.referenceTypeCache.push(type);
  return type;
}

export function lookupAndElaborateDatatype(
  sr: SemanticResult,
  args: {
    typeId: Collect.Id;
    startLookupInScope: Collect.Id;
    context: SubstitutionContext;
    isInCFuncdecl: boolean;
  }
): Semantic.DatatypeSymbol {
  const type = sr.cc.nodes.get(args.typeId);

  switch (type.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.FunctionDatatype: {
      return makeFunctionDatatypeAvailable(sr, {
        parameters: type.parameters.map((p) =>
          lookupAndElaborateDatatype(sr, {
            type: p.datatype,
            startLookupInScope: args.startLookupInScope,
            context: args.context,
            isInCFuncdecl: args.isInCFuncdecl,
          })
        ),
        returnType: lookupAndElaborateDatatype(sr, {
          type: args.type.returnType,
          startLookupInScope: args.startLookupInScope,
          context: args.context,
          isInCFuncdecl: args.isInCFuncdecl,
        }),
        vararg: args.type.ellipsis,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "RawPointerDatatype": {
      return makeRawPointerDatatypeAvailable(
        sr,
        lookupAndElaborateDatatype(sr, {
          type: args.type.pointee,
          startLookupInScope: args.startLookupInScope,
          context: args.context,
          isInCFuncdecl: args.isInCFuncdecl,
        })
      );
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ReferenceDatatype": {
      return makeReferenceDatatypeAvailable(
        sr,
        lookupAndElaborateDatatype(sr, {
          type: args.type.referee,
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
        assert(functype.variant === "FunctionDatatype");
        return {
          variant: "CallableDatatype",
          functionType: functype,
          thisExprType: undefined,
          concrete: functype.concrete,
        };
      }

      const foundId = lookupSymbol(sr.cc, type.name, {
        startLookupInScope: args.startLookupInScope,
        sourceloc: type.sourceloc,
      });
      const found = sr.cc.nodes.get(foundId);

      if (found.variant === Collect.ENode.StructDefinitionSymbol) {
        const struct = instantiateStruct(sr, {
          definedStructTypeId: foundId,
          receivingTypeId: args.typeId,
          instantiateInScope: args.startLookupInScope,
          context: isolateElaborationContext(args.context),
        });
        assert(struct?.variant === "StructDatatype");

        if (type.innerNested) {
          const nestedStruct = instantiateStruct(sr, {
            definedStructTypeId: foundId,
            receivingTypeId: type.innerNested,
            instantiateInScope: args.startLookupInScope,
            context: isolateElaborationContext(args.context),
          });
          assert(nestedStruct && nestedStruct.variant === "StructDatatype");
          const nested = lookupAndElaborateDatatype(sr, {
            type: args.type.nested,
            startLookupInScope: nestedStruct.scope.collectedScope.id,
            context: isolateElaborationContext(args.context),
            isInCFuncdecl: args.isInCFuncdecl,
          });
          return nested;
        }

        return struct;
      } else if (found.variant === Collect.ENode.NamespaceDefinitionSymbol) {
        if (type.innerNested) {
          // Here it is important to elaborate instead of instantiate, because elaborate recursively elaborates
          // its parent, to build the tree top-down, and then in the end calls instantiate
          const namespace = elaborate(sr, {
            sourceSymbol: found,
            context: args.context,
          });
          assert(namespace && namespace.variant === "NamespaceDatatype");
          const nested = lookupAndElaborateDatatype(sr, {
            type: args.type.nested,
            startLookupInScope: namespace.scope.collectedScope.id,
            context: isolateElaborationContext(args.context),
            isInCFuncdecl: args.isInCFuncdecl,
          });
          return nested;
        }
        throw new CompilerError(`Namespace cannot be used as a datatype here`, args.type.sourceloc);
      } else if (found.variant === Collect.ENode.GenericTypeParameter) {
        const mappedTo = args.context.substitute.get(foundId);
        if (mappedTo) {
          assert(isDatatypeSymbol(mappedTo));
          return mappedTo;
        } else {
          return {
            variant: "GenericParameterDatatype",
            name: found.name,
            concrete: false,
          };
        }
      } else {
        throw new CompilerError(
          `Symbol '${type.name}' cannot be used as a datatype here`,
          type.sourceloc
        );
      }
    }

    case "StringConstant": {
      return {
        variant: "ConstantDatatype",
        kind: "string",
        sourceloc: args.type.sourceloc,
        value: args.type.value,
        concrete: true,
      };
    }

    case "BooleanConstant": {
      return {
        variant: "ConstantDatatype",
        kind: "boolean",
        sourceloc: args.type.sourceloc,
        value: args.type.value,
        concrete: true,
      };
    }

    case "NumberConstant": {
      assert(!args.type.unit);
      return {
        variant: "ConstantDatatype",
        kind: "number",
        sourceloc: args.type.sourceloc,
        value: args.type.value,
        concrete: true,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    default:
      throw new ImpossibleSituation();
  }
}

export function instantiateStruct(
  sr: SemanticResult,
  args: {
    definedStructTypeId: Collect.Id; // The defining struct datatype to be instantiated (e.g. struct Foo<T> {})
    receivingTypeId: Collect.Id; // The receiving side of the instantiation (e.g. Foo<i32> or Foo<U>)
    instantiateInScope: Collect.Id;
    context: SubstitutionContext;
  }
) {
  const definedStructType = sr.cc.nodes.get(args.definedStructTypeId);
  assert(definedStructType.variant === Collect.ENode.StructDefinitionSymbol);
  const receivingType = sr.cc.nodes.get(args.receivingTypeId);
  assert(receivingType.variant === Collect.ENode.NamedDatatype);

  // This is now the instantiation of the collected struct, so we resolve what the actually passed type is
  const generics = receivingType.genericArgs.map((g) => {
    return lookupAndElaborateDatatype(sr, {
      typeId: g,
      startLookupInScope: args.instantiateInScope,
      context: args.context,
      isInCFuncdecl: false,
    });
  });

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
      `Type ${definedStructType.name} expects ${definedStructType.generics.length} type parameters but got ${receivingType.genericArgs.length}`,
      receivingType.sourceloc
    );
  }

  let parentSymbol: Semantic.TypeId | null = null;
  const parentScopeId = definedStructType.parentScope;
  const parentScope = sr.cc.nodes.get(parentScopeId);
  if (
    parentScope.variant === Collect.ENode.NamespaceScope ||
    parentScope.variant === Collect.ENode.StructScope
  ) {
    console.log("Generics are TODO Here");
    parentSymbol = elaborateStructOrNamespace(sr, parentScopeId, {
      generics: [],
      context: isolateElaborationContext(args.context),
    });
  }

  const struct: Semantic.StructDatatypeSymbol = {
    variant: "StructDatatype",
    name: definedStructType.name,
    generics: generics,
    extern: definedStructType.extern,
    noemit: definedStructType.noemit,
    parentSymbol: parentSymbol,
    members: [],
    methods: new Set(),
    // rawAst: definedStructType,
    scope: new Semantic.DeclScope(
      definedStructType.sourceloc,
      getScope(sr.cc, args.definedStructType._collect.scope),
      parentNamespace?.scope
    ),
    sourceloc: args.definedStructType.sourceloc,
    concrete: generics.every((g) => g.concrete),
    originalCollectedSymbol: args.definedStructType,
  };

  // New local substitution context
  const newContext = isolateElaborationContext(args.context);
  for (let i = 0; i < args.definedStructType.generics.length; i++) {
    newContext.substitute.set(args.definedStructType.generics[i], generics[i]);
  }

  if (struct.concrete) {
    sr.elaboratedStructDatatypes.push({
      generics: generics,
      originalSymbol: args.definedStructType,
      cstruct: args.cstruct,
      resultSymbol: struct,
    });

    struct.members = args.definedStructType.members.map((member) => {
      assert(args.definedStructType._collect.scope);
      const type = lookupAndElaborateDatatype(sr, {
        type: member.type,
        // Start lookup in the struct itself
        startLookupInScope: args.definedStructType._collect.scope,
        context: newContext,
        isInCFuncdecl: false,
      });
      return {
        variant: "Variable",
        name: member.name,
        export: false,
        externLanguage: EExternLanguage.None,
        mutable: true,
        sourceloc: member.sourceloc,
        type: type,
        variableContext: EVariableContext.MemberOfStruct,
        memberOf: struct,
        concrete: type.concrete,
      };
    });

    args.definedStructType.methods.forEach((method) => {
      assert(method.returnType);
      assert(method.funcbody?._collect.scope);
      if (method.generics.length !== 0 || method.operatorOverloading) {
        return;
      }

      const symbol = elaborate(sr, {
        sourceSymbol: method,
        usageGenerics: [],
        structForMethod: struct,
        context: newContext,
      });
      assert(symbol && symbol.variant === "FunctionDefinition");
      struct.methods.add(symbol);
    });
  }

  // Now, also elaborate all nested sub structs
  for (const d of args.definedStructType.nestedStructs) {
    if (d.generics.length === 0) {
      elaborate(sr, {
        sourceSymbol: d,
        usageGenerics: [],
        context: newContext,
      });
    }
  }

  return struct;
}
