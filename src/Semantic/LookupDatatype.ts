import {
  EExternLanguage,
  type ASTConstant,
  type ASTDatatype,
  type ASTNamedDatatype,
  type ASTStructDefinition,
} from "../shared/AST";
import {
  assertScope,
  EVariableContext,
  primitiveToString,
  stringToPrimitive,
} from "../shared/common";
import { assert, CompilerError, ImpossibleSituation } from "../shared/Errors";
import { Collect } from "../SymbolCollection/CollectSymbols";
import { getScope, getSymbol } from "../SymbolCollection/SymbolCollection";
import { elaborate, isolateElaborationContext, type SubstitutionContext } from "./Elaborate";
import {
  isDatatypeSymbol,
  makePrimitiveAvailable,
  Semantic,
  type SemanticResult,
} from "./SemanticSymbols";
import { serializeDatatype } from "./Serialize";

export function makeFunctionDatatypeAvailable(
  sr: SemanticResult,
  args: {
    parameters: Semantic.DatatypeSymbol[];
    returnType: Semantic.DatatypeSymbol;
    vararg: boolean;
  },
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
  pointee: Semantic.DatatypeSymbol,
): Semantic.RawPointerDatatypeSymbol {
  for (const type of sr.rawPointerTypeCache) {
    if (type.pointee !== pointee) {
      continue;
    }
    return type;
  }

  // Nothing found
  const type: Semantic.RawPointerDatatypeSymbol = {
    variant: "RawPointerDatatype",
    pointee: pointee,
    concrete: pointee.concrete,
  };
  sr.rawPointerTypeCache.push(type);
  return type;
}

export function makeReferenceDatatypeAvailable(
  sr: SemanticResult,
  referee: Semantic.DatatypeSymbol,
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
    datatype: ASTDatatype | ASTConstant;
    startLookupInScope: string;
    context: SubstitutionContext;
    isInCFuncdecl: boolean;
  },
): Semantic.DatatypeSymbol {
  switch (args.datatype.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "Deferred": {
      return {
        variant: "DeferredDatatype",
        concrete: false,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "FunctionDatatype": {
      return makeFunctionDatatypeAvailable(sr, {
        parameters: args.datatype.params.map((p) =>
          lookupAndElaborateDatatype(sr, {
            datatype: p.datatype,
            startLookupInScope: args.startLookupInScope,
            context: args.context,
            isInCFuncdecl: args.isInCFuncdecl,
          }),
        ),
        returnType: lookupAndElaborateDatatype(sr, {
          datatype: args.datatype.returnType,
          startLookupInScope: args.startLookupInScope,
          context: args.context,
          isInCFuncdecl: args.isInCFuncdecl,
        }),
        vararg: args.datatype.ellipsis,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "RawPointerDatatype": {
      return makeRawPointerDatatypeAvailable(
        sr,
        lookupAndElaborateDatatype(sr, {
          datatype: args.datatype.pointee,
          startLookupInScope: args.startLookupInScope,
          context: args.context,
          isInCFuncdecl: args.isInCFuncdecl,
        }),
      );
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "ReferenceDatatype": {
      return makeReferenceDatatypeAvailable(
        sr,
        lookupAndElaborateDatatype(sr, {
          datatype: args.datatype.referee,
          startLookupInScope: args.startLookupInScope,
          context: args.context,
          isInCFuncdecl: args.isInCFuncdecl,
        }),
      );
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case "NamedDatatype": {
      const primitive = stringToPrimitive(args.datatype.name);
      if (primitive) {
        if (args.datatype.generics.length > 0) {
          throw new CompilerError(
            `Type ${args.datatype.name} is not generic`,
            args.datatype.sourceloc,
          );
        }
        if (args.datatype.cstruct) {
          throw new CompilerError(
            `Primitive ${primitiveToString(primitive)} cannot be annotated as a 'cstruct'`,
            args.datatype.sourceloc,
          );
        }
        return makePrimitiveAvailable(sr, primitive);
      }

      if (args.datatype.name === "Callable") {
        if (args.datatype.cstruct) {
          throw new CompilerError(
            `A Callable cannot be annotated as a 'cstruct'`,
            args.datatype.sourceloc,
          );
        }
        if (args.datatype.generics.length != 1) {
          throw new CompilerError(
            `Type Callable<> must take exactly 1 type parameter`,
            args.datatype.sourceloc,
          );
        }
        if (args.datatype.generics[0].variant !== "FunctionDatatype") {
          throw new CompilerError(
            `Type Callable<> must take a function datatype as the generic argument`,
            args.datatype.sourceloc,
          );
        }
        const functype = lookupAndElaborateDatatype(sr, {
          datatype: args.datatype.generics[0],
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

      const found = getScope(sr.cc, args.startLookupInScope).lookupSymbol(
        sr.cc,
        args.datatype.name,
        args.datatype.sourceloc,
      );

      if (found.variant === "StructDefinition") {
        if (args.isInCFuncdecl && !args.datatype.cstruct) {
          throw new CompilerError(
            `'${args.datatype.name}' is an ordinary, high-level struct reference type and cannot be used in a C function declaration. Did you mean to annotate it as 'cstruct ${args.datatype.name}'?`,
            args.datatype.sourceloc,
          );
        }
        const struct = instantiateStruct(sr, {
          definedStructType: found,
          receivingType: args.datatype,
          cstruct: args.datatype.cstruct,
          context: isolateElaborationContext(args.context),
        });
        assert(struct?.variant === "StructDatatype");

        if (args.datatype.nested) {
          const nestedStruct = instantiateStruct(sr, {
            definedStructType: found,
            receivingType: args.datatype.nested,
            cstruct: args.datatype.cstruct,
            context: isolateElaborationContext(args.context),
          });
          assert(nestedStruct && nestedStruct.variant === "StructDatatype");
          const nested = lookupAndElaborateDatatype(sr, {
            datatype: args.datatype.nested,
            startLookupInScope: nestedStruct.scope.collectedScope.id,
            context: isolateElaborationContext(args.context),
            isInCFuncdecl: args.isInCFuncdecl,
          });
          return nested;
        }

        return struct;
      } else if (found.variant === "NamespaceDefinition") {
        if (args.datatype.cstruct) {
          throw new CompilerError(
            `A Namespace cannot be annotated as a 'cstruct'`,
            args.datatype.sourceloc,
          );
        }
        if (args.datatype.nested) {
          // Here it is important to elaborate instead of instantiate, because elaborate recursively elaborates
          // its parent, to build the tree top-down, and then in the end calls instantiate
          const namespace = elaborate(sr, {
            sourceSymbol: found,
            context: args.context,
          });
          assert(namespace && namespace.variant === "NamespaceDatatype");
          const nested = lookupAndElaborateDatatype(sr, {
            datatype: args.datatype.nested,
            startLookupInScope: namespace.scope.collectedScope.id,
            context: isolateElaborationContext(args.context),
            isInCFuncdecl: args.isInCFuncdecl,
          });
          return nested;
        }
        throw new CompilerError(
          `Namespace cannot be used as a datatype here`,
          args.datatype.sourceloc,
        );
      } else if (found.variant === "GenericParameter") {
        if (args.datatype.cstruct) {
          throw new CompilerError(
            `A generic parameter cannot be annotated as a 'cstruct'`,
            args.datatype.sourceloc,
          );
        }
        const mappedTo = args.context.substitute.get(found);
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
          `Symbol '${args.datatype.name}' cannot be used as a datatype here`,
          args.datatype.sourceloc,
        );
      }
    }

    case "StringConstant": {
      return {
        variant: "ConstantDatatype",
        kind: "string",
        sourceloc: args.datatype.sourceloc,
        value: args.datatype.value,
        concrete: true,
      };
    }

    case "BooleanConstant": {
      return {
        variant: "ConstantDatatype",
        kind: "boolean",
        sourceloc: args.datatype.sourceloc,
        value: args.datatype.value,
        concrete: true,
      };
    }

    case "NumberConstant": {
      assert(!args.datatype.unit);
      return {
        variant: "ConstantDatatype",
        kind: "number",
        sourceloc: args.datatype.sourceloc,
        value: args.datatype.value,
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
    definedStructType: ASTStructDefinition; // The defining struct datatype to be instantiated (e.g. struct Foo<T> {})
    receivingType: ASTNamedDatatype; // The receiving side of the instantiation (e.g. Foo<i32> or Foo<U>)
    cstruct: boolean;
    context: SubstitutionContext;
  },
) {
  // This is now the instantiation of the collected struct, so we resolve what the actually passed type is
  const generics = args.receivingType.generics.map((g) => {
    assert(args.receivingType!._collect.usedInScope)
    return lookupAndElaborateDatatype(sr, {
      datatype: g,
      startLookupInScope: args.receivingType!._collect.usedInScope,
      context: args.context,
      isInCFuncdecl: false,
    });
  }
  );

  // If already existing, return cached to prevent loops
  for (const s of sr.elaboratedStructDatatypes) {
    if (
      s.generics.length === generics.length &&
      s.generics.every((g, index) => g === generics[index]) &&
      s.originalSymbol === args.definedStructType &&
      s.cstruct === args.cstruct
    ) {
      return s.resultSymbol;
    }
  }

  if (args.definedStructType.generics.length !== generics.length) {
    throw new CompilerError(
      `Type ${args.definedStructType.name} expects ${args.definedStructType.generics.length} type parameters but got ${args.receivingType.generics.length}`,
      args.receivingType.sourceloc,
    );
  }

  const parentNamespace =
    (args.definedStructType._collect.definedInNamespaceOrStruct &&
      elaborate(sr, {
        sourceSymbol: args.definedStructType._collect.definedInNamespaceOrStruct,
        usageGenerics: [], // We can pass an empty array to silence the assert, because if we have gotten so far
        // that the child of a generic struct is being elaborated, the parent must certainly be cached already
        context: isolateElaborationContext(args.context),
      })) ||
    null;
  assert(
    !parentNamespace ||
    parentNamespace.variant === "StructDatatype" ||
    parentNamespace.variant === "NamespaceDatatype",
  );

  assert(args.definedStructType._collect.scope);
  const struct: Semantic.StructDatatypeSymbol = {
    variant: "StructDatatype",
    name: args.definedStructType.name,
    generics: generics,
    cstruct: args.cstruct,
    externLanguage: args.definedStructType.externLanguage,
    noemit: args.definedStructType.noemit,
    parent: parentNamespace,
    members: [],
    methods: new Set(),
    rawAst: args.definedStructType,
    scope: new Semantic.DeclScope(
      args.definedStructType.sourceloc,
      getScope(sr.cc, args.definedStructType._collect.scope),
      parentNamespace?.scope,
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
        datatype: member.type,
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
  for (const d of args.definedStructType.declarations) {
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
