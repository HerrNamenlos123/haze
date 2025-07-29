import { isFunctionOrConstructorTypeNode } from "typescript";
import { ConstantContext } from "../Parser/grammar/autogen/HazeParser";
import { EExternLanguage, type ASTConstant, type ASTDatatype, type ASTNamedDatatype, type ASTStructDefinition } from "../shared/AST";
import {
  assertScope,
  EMethodType,
  EPrimitive,
  EVariableContext,
  stringToPrimitive,
} from "../shared/common";
import { assert, CompilerError, ImpossibleSituation } from "../shared/Errors";
import { Collect } from "../SymbolCollection/CollectSymbols";
import {
  elaborate,
  isolateElaborationContext,
  makeElaborationContext as makeRootElaborationContext,
  type ElaborationContext,
} from "./Elaborate";
import { isDatatypeSymbol, makePrimitiveAvailable, Semantic, type SemanticResult } from "./SemanticSymbols";

export function makeFunctionDatatypeAvailable(
  sr: SemanticResult,
  args: {
    parameters: Semantic.DatatypeSymbol[],
    returnType: Semantic.DatatypeSymbol,
    vararg: boolean,
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
    datatype: ASTDatatype | ASTConstant,
    startLookupInScope: Collect.Scope,
    context: ElaborationContext,
  }
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
      return makeFunctionDatatypeAvailable(
        sr,
        {
          parameters: args.datatype.params.map((p) =>
            lookupAndElaborateDatatype(sr, {
              datatype: p.datatype,
              startLookupInScope: args.startLookupInScope,
              context: args.context
            }),
          ),
          returnType: lookupAndElaborateDatatype(sr, {
            datatype: args.datatype.returnType,
            startLookupInScope: args.startLookupInScope,
            context: args.context
          }),
          vararg: args.datatype.ellipsis,
        }
      );
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
          context: args.context
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
          context: args.context
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
          throw new Error(`Type ${args.datatype.name} is not generic`);
        }
        return makePrimitiveAvailable(sr, primitive);
      }

      if (args.datatype.name === "Callable") {
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
          context: args.context
        });
        assert(functype.variant === "FunctionDatatype");
        return {
          variant: "CallableDatatype",
          functionType: functype,
          thisExprType: undefined,
          concrete: functype.concrete,
        };
      }

      const found = args.startLookupInScope.symbolTable.lookupSymbol(
        args.datatype.name,
        args.datatype.sourceloc,
      );
      if (!found) {
        throw new CompilerError(
          `${args.datatype.name} was not declared in this scope`,
          args.datatype.sourceloc,
        );
      }

      if (found.variant === "StructDefinition") {
        // Here it is important to elaborate instead of instantiate, because elaborate recursively elaborates
        // its parent, to build the tree top-down, and then in the end calls instantiate
        const struct = elaborate(sr, {
          sourceSymbol: found,
          defineInNamespace: null,
          context: isolateElaborationContext(args.context),
        });
        assert(struct?.variant === "StructDatatype");

        if (args.datatype.nested) {
          // Here it is important to elaborate instead of instantiate, because elaborate recursively elaborates
          // its parent, to build the tree top-down, and then in the end calls instantiate
          const nestedStruct = elaborate(sr,
            {
              sourceSymbol: found,
              defineInNamespace: null,
              context: args.context
            });
          assert(nestedStruct && nestedStruct.variant === "StructDatatype");
          const nested = lookupAndElaborateDatatype(
            sr,
            {
              datatype: args.datatype.nested,
              startLookupInScope: nestedStruct.scope.collectedScope,
              context: isolateElaborationContext(args.context),
            }
          );
          return nested;
        }

        return struct;
      }
      else if (found.variant === "NamespaceDefinition") {
        if (args.datatype.nested) {
          // Here it is important to elaborate instead of instantiate, because elaborate recursively elaborates
          // its parent, to build the tree top-down, and then in the end calls instantiate
          const namespace = elaborate(sr,
            {
              sourceSymbol: found,
              defineInNamespace: null,
              context: args.context
            });
          assert(namespace && namespace.variant === "Namespace");
          const nested = lookupAndElaborateDatatype(
            sr,
            {
              datatype: args.datatype.nested,
              startLookupInScope: namespace.scope.collectedScope,
              context: isolateElaborationContext(args.context),
            }
          );
          return nested;
        }
        throw new CompilerError(
          `Namespace cannot be used as a datatype here`,
          args.datatype.sourceloc,
        );
      }
      else if (found.variant === "GenericParameter") {
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
      }
      else {
        throw new CompilerError(
          `Symbol '${args.datatype.name}' cannot be used as a datatype here`,
          args.datatype.sourceloc,
        );
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    default:
      throw new ImpossibleSituation();
  }
}


export function instantiateStruct(sr: SemanticResult, args: {
  definedStructType: ASTStructDefinition, // The defining struct datatype to be instantiated (e.g. struct Foo<T> {})
  receivingType: ASTNamedDatatype, // The receiving side of the instantiation (e.g. Foo<i32> or Foo<U>)
  defineInNamespace: Semantic.NamespaceSymbol | Semantic.StructDatatypeSymbol | null,
  context: ElaborationContext
}) {

  // This is now the instantiation of the collected struct, so we resolve what the actually passed type is
  const generics = args.receivingType.generics.map((g) =>
    lookupAndElaborateDatatype(sr, {
      datatype: g,
      startLookupInScope: assertScope(args.receivingType!._collect.usedInScope),
      context: args.context
    }),
  );

  // If already existing, return cached to prevent loops
  for (const s of sr.elaboratedStructDatatypes) {
    if (
      s.generics.length === generics.length &&
      s.generics.every((g, index) => g === generics[index]) &&
      s.originalSymbol === args.definedStructType
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

  const struct: Semantic.StructDatatypeSymbol = {
    variant: "StructDatatype",
    name: args.definedStructType.name,
    generics: generics,
    externLanguage: args.definedStructType.externLanguage,
    parent: args.defineInNamespace,
    members: [],
    methods: [],
    rawAst: args.definedStructType,
    scope: new Semantic.DeclScope(
      args.definedStructType.sourceloc,
      assertScope(args.definedStructType._collect.scope),
      args.defineInNamespace?.scope,
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
      resultSymbol: struct,
    });

    struct.members = args.definedStructType.members.map((m) => {
      const type = lookupAndElaborateDatatype(
        sr,
        {
          datatype: m.type,
          // Start lookup in the struct itself
          startLookupInScope: assertScope(args.definedStructType._collect.scope),
          context: newContext,
        }
      );
      return {
        variant: "Variable",
        name: m.name,
        export: false,
        externLanguage: EExternLanguage.None,
        mutable: true,
        sourceloc: m.sourceloc,
        type: type,
        variableContext: EVariableContext.MemberOfStruct,
        memberOf: struct,
        concrete: type.concrete,
      };
    });

    struct.methods = args.definedStructType.methods.map((m) => {
      assert(m.returnType);
      assert(m.funcbody._collect.scope);
      if (m.generics.length !== 0 || m.operatorOverloading) {
        return undefined;
      }

      const symbol = elaborate(
        sr,
        {
          sourceSymbol: m,
          usageGenerics: [],
          defineInNamespace: struct,
          context: newContext,
        }
      );
      assert(symbol && symbol.variant === "FunctionDefinition");
      return symbol;
    }).filter((m) => !!m);
  }

  // Now, also elaborate all nested sub structs
  for (const d of args.definedStructType.declarations) {
    elaborate(sr, {
      sourceSymbol: d,
      defineInNamespace: struct,
      context: newContext,
    });
  }

  return struct;
}