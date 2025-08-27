import { assign } from "lodash";
import { HAZE_STDLIB_NAME } from "../Module";
import { EBinaryOperation, EExternLanguage, EVariableMutability } from "../shared/AST";
import {
  BrandedArray,
  EMethodType,
  EPrimitive,
  EVariableContext,
  primitiveToString,
  stringToPrimitive,
} from "../shared/common";
import { getModuleGlobalNamespaceName } from "../shared/Config";
import { assert, CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import {
  Collect,
  defineVariableSymbol,
  funcSymHasParameterPack,
  type CollectionContext,
} from "../SymbolCollection/SymbolCollection";
import { Conversion } from "./Conversion";
import { EvalCTFE, EvalCTFEBoolean } from "./CTFE";
import {
  makeFunctionDatatypeAvailable,
  lookupAndElaborateDatatype,
  instantiateAndElaborateStruct,
  makePointerDatatypeAvailable,
  makeReferenceDatatypeAvailable,
  elaborateParentSymbolFromCache,
  makeArrayDatatypeAvailable,
} from "./LookupDatatype";
import {
  asExpression,
  asType,
  getExprType,
  IsExprDecisiveForOverloadResolution,
  isExpression,
  isType,
  isTypeConcrete,
  makePrimitiveAvailable,
  Semantic,
  type SemanticResult,
} from "./SemanticSymbols";
import { getParentNames, serializeDatatype, serializeExpr, serializeNestedName } from "./Serialize";

export function tryLookupSymbol(
  sr: SemanticResult,
  name: string,
  args: { startLookupInScope: Collect.Id; sourceloc: SourceLoc; pubRequired?: boolean }
): { type: "semantic"; id: Semantic.Id } | { type: "collect"; id: Collect.Id } | undefined {
  const cc = sr.cc;
  const scope = cc.nodes.get(args.startLookupInScope);

  if (sr.syntheticScopeToVariableMap.has(args.startLookupInScope)) {
    const map = sr.syntheticScopeToVariableMap.get(args.startLookupInScope)!;
    if (map.has(name)) {
      const symbolId = map.get(name)!;
      const symbol = sr.nodes.get(symbolId);
      assert(symbol.variant === Semantic.ENode.VariableSymbol);
      assert(symbol.type);
      return {
        id: Semantic.addNode(sr, {
          variant: Semantic.ENode.SymbolValueExpr,
          symbol: symbolId,
          type: symbol.type,
          sourceloc: args.sourceloc,
        })[1],
        type: "semantic",
      };
    }
  }

  const lookupDirect = (symbols: Set<Collect.Id>) => {
    for (const id of symbols) {
      const s = cc.nodes.get(id);
      if (s.variant === Collect.ENode.FunctionOverloadGroup && s.name === name) {
        if (
          [...s.overloads].some((o) => {
            const func = cc.nodes.get(o);
            assert(func.variant === Collect.ENode.FunctionSymbol);
            return !args.pubRequired || func.pub;
          })
        ) {
          return id;
        }
      } else if (s.variant === Collect.ENode.StructDefinitionSymbol && s.name === name) {
        if (!args.pubRequired || s.pub) {
          return id;
        }
      } else if (s.variant === Collect.ENode.NamespaceDefinitionSymbol && s.name === name) {
        if (!args.pubRequired || s.pub) {
          // Caution: This lookup needs to return the actual namespace definition and NOT the shared instance.
          // Because the lookup must also resolve generics and to do that, it needs to know the correct scopes
          // and the parent scope stack must be valid, which is not the case with the shared instance as it has multiple.
          return id;
        }
      } else if (s.variant === Collect.ENode.GenericTypeParameter && s.name === name) {
        return id;
      } else if (s.variant === Collect.ENode.AliasTypeSymbol && s.name === name) {
        return id;
      } else if (s.variant === Collect.ENode.VariableSymbol && s.name === name) {
        if (!args.pubRequired) {
          return id;
        }
      }
    }
  };

  switch (scope.variant) {
    case Collect.ENode.NamespaceScope: {
      const ns = cc.nodes.get(scope.owningSymbol);
      assert(ns.variant === Collect.ENode.NamespaceDefinitionSymbol);
      const instance = cc.nodes.get(ns.sharedInstance);
      assert(instance.variant === Collect.ENode.NamespaceSharedInstance);
      for (const nsScope of instance.namespaceScopes) {
        const sc = cc.nodes.get(nsScope);
        assert(sc.variant === Collect.ENode.NamespaceScope);
        const found = lookupDirect(sc.symbols);
        if (found) {
          return {
            id: found,
            type: "collect",
          };
        }
      }
      return tryLookupSymbol(sr, name, {
        startLookupInScope: scope.parentScope,
        sourceloc: args.sourceloc,
      });
    }

    case Collect.ENode.ModuleScope:
    case Collect.ENode.UnitScope:
    case Collect.ENode.FileScope:
    case Collect.ENode.BlockScope:
    case Collect.ENode.StructScope:
    case Collect.ENode.FunctionScope: {
      const found = lookupDirect(scope.symbols);
      if (found) {
        return {
          id: found,
          type: "collect",
        };
      }

      if (scope.variant === Collect.ENode.ModuleScope) {
        return undefined;
      }

      if (scope.variant === Collect.ENode.FileScope) {
        // File Scope -> Don't go higher but look in adjacent files in the same unit, then go higher
        const unitScope = cc.nodes.get(scope.parentScope);
        assert(unitScope.variant === Collect.ENode.UnitScope);

        for (const file of unitScope.symbols) {
          if (file === args.startLookupInScope) continue; // Prevent infinite recursion with itself

          const fileScope = cc.nodes.get(file);
          assert(fileScope.variant === Collect.ENode.FileScope);

          const found = lookupDirect(fileScope.symbols);
          if (found) {
            return {
              id: found,
              type: "collect",
            };
          }
        }

        return tryLookupSymbol(sr, name, {
          startLookupInScope: scope.parentScope,
          sourceloc: args.sourceloc,
        });
      } else {
        // Not a file scope -> Can go higher
        return tryLookupSymbol(sr, name, {
          startLookupInScope: scope.parentScope,
          sourceloc: args.sourceloc,
        });
      }
    }

    default:
      assert(false, "Unknown scope type: " + scope.variant);
  }
}

export function lookupSymbol(
  sr: SemanticResult,
  name: string,
  args: { startLookupInScope: Collect.Id; sourceloc: SourceLoc }
) {
  const found = tryLookupSymbol(sr, name, args);
  if (found) return found;
  throw new CompilerError(`Symbol '${name}' was not declared in this scope`, args.sourceloc);
}

// export function recursivelyExportCollectedSymbols(
//   sr: SemanticResult,
//   symbol: Collect.Node | Collect.Scope
// ) {
//   if (sr.exportedCollectedSymbols.has(symbol)) {
//     return; // Prevent recursion
//   }

//   if (symbol instanceof Collect.Scope) {
//     sr.exportedCollectedSymbols.add(symbol);
//     if (symbol.parentScope) {
//       recursivelyExportCollectedSymbols(sr, getScope(sr.cc, symbol.parentScope));
//     }
//     for (const s of symbol.symbols) {
//       recursivelyExportCollectedSymbols(sr, getSymbol(sr.cc, s));
//     }
//   } else {
//     switch (symbol.variant) {
//       case "FunctionDeclaration":
//         if (!symbol.export) return;
//         sr.exportedCollectedSymbols.add(symbol);
//         if (symbol._collect.definedInScope) {
//           recursivelyExportCollectedSymbols(sr, getScope(sr.cc, symbol._collect.definedInScope));
//         }
//         break;

//       case "FunctionDefinition":
//         if (!symbol.export) return;
//         sr.exportedCollectedSymbols.add(symbol);
//         if (symbol._collect.definedInScope) {
//           recursivelyExportCollectedSymbols(sr, getScope(sr.cc, symbol._collect.definedInScope));
//         }
//         break;

//       case "NamespaceDefinition":
//         for (const d of symbol.declarations) {
//           recursivelyExportCollectedSymbols(sr, d);
//         }
//         break;

//       case "GenericParameter":
//       case "StructMethod":
//       case "VariableDefinitionStatement":
//         assert(false, "TBD");

//       case "GlobalVariableDefinition":
//       case "StructDefinition":
//         if (!symbol.export) return;
//         sr.exportedCollectedSymbols.add(symbol);
//         if (symbol._collect.definedInScope) {
//           recursivelyExportCollectedSymbols(sr, getScope(sr.cc, symbol._collect.definedInScope));
//         }
//         break;
//     }
//   }
// }

export type ElaborationContext = {
  substitute: Map<Collect.Id, Semantic.Id>;
  currentScope: Collect.Id; // This is the scope in which we are elaborating and it changes (e.g. A<i32> when elaborating A<i32>.B)
  genericsScope: Collect.Id; // This is the scope for generics which does not change (e.g. A<i32>.B<u8> => i32 and u8 are elaborated in the same scope)
};

export function makeElaborationContext(args: {
  currentScope: Collect.Id;
  genericsScope: Collect.Id;
}): ElaborationContext {
  return {
    substitute: new Map(),
    currentScope: args.currentScope,
    genericsScope: args.genericsScope,
  };
}

export function isolateSubstitutionContext(
  parent: ElaborationContext,
  args: {
    currentScope: Collect.Id;
    genericsScope: Collect.Id;
  }
): ElaborationContext {
  return {
    substitute: new Map(parent.substitute),
    currentScope: args.currentScope,
    genericsScope: args.genericsScope,
  };
}

export function mergeSubstitutionContext(
  a: ElaborationContext,
  b: ElaborationContext,
  args: {
    currentScope: Collect.Id;
    genericsScope: Collect.Id;
  }
): ElaborationContext {
  return {
    substitute: new Map([...a.substitute, ...b.substitute]),
    currentScope: args.currentScope,
    genericsScope: args.genericsScope,
  };
}

function prepareParameterPackTypes(
  sr: SemanticResult,
  args: {
    functionName: string;
    requiredParameters: Collect.ParameterValue[];
    givenArguments?: {
      index: number;
      exprId: Semantic.Id;
    }[];
    sourceloc: SourceLoc;
  }
) {
  const parameterPackTypes: Semantic.Id[] = [];

  const hasParameterPack = args.requiredParameters.some((p) => {
    const t = sr.cc.nodes.get(p.type);
    return t.variant === Collect.ENode.ParameterPack;
  });
  if (hasParameterPack) {
    const numParametersWithoutPack = args.requiredParameters.length - 1;

    if (args.givenArguments === undefined) {
      throw new CompilerError(
        `Function ${args.functionName} uses a Parameter Pack, but there is not enough context around the function access to determine the types it is going to be called with`,
        args.sourceloc
      );
    }

    if (args.givenArguments.length < numParametersWithoutPack) {
      throw new CompilerError(
        `Function ${args.functionName} requires at least ${numParametersWithoutPack} parameters, but ${args.givenArguments.length} are given`,
        args.sourceloc
      );
    }

    for (let i = numParametersWithoutPack; i < args.givenArguments.length; i++) {
      const exprId = args.givenArguments[i].exprId;
      const expr = sr.nodes.get(exprId);
      assert(isExpression(expr));
      parameterPackTypes.push(expr.type);
    }
  }
  return parameterPackTypes;
}

function lookupSymbolInNamespaceOrStructScope(
  sr: SemanticResult,
  symbolId: Collect.Id,
  args: {
    name: string;
    expr: Collect.MemberAccessExpr;
    context: ElaborationContext;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    gonnaCallFunctionWithParameters?: {
      index: number;
      exprId: Semantic.Id;
    }[];
    isMonomorphized: boolean;
  }
) {
  const symbol = sr.cc.nodes.get(symbolId);
  if (symbol.variant === Collect.ENode.StructDefinitionSymbol && symbol.name === args.name) {
    const instantiated = instantiateAndElaborateStruct(sr, {
      definedStructTypeId: symbolId,
      elaboratedVariables: args.elaboratedVariables,
      genericArgs: args.expr.genericArgs.map((g) => {
        return lookupAndElaborateDatatype(sr, {
          typeId: g,
          elaboratedVariables: args.elaboratedVariables,
          context: isolateSubstitutionContext(args.context, {
            currentScope: args.context.currentScope,
            genericsScope: args.context.currentScope,
          }),
          isInCFuncdecl: false,
        });
      }),
      context: args.context,
      sourceloc: args.expr.sourceloc,
    });
    return Semantic.addNode(sr, {
      variant: Semantic.ENode.SymbolValueExpr,
      symbol: instantiated,
      type: instantiated,
      sourceloc: args.expr.sourceloc,
    });
  } else if (symbol.variant === Collect.ENode.FunctionOverloadGroup && symbol.name === args.name) {
    console.info("TODO: Do overload discrimination here");
    const overloadId = [...symbol.overloads][0];
    const funcsym = sr.cc.nodes.get(overloadId);
    assert(funcsym.variant === Collect.ENode.FunctionSymbol);

    const paramPackTypes = prepareParameterPackTypes(sr, {
      functionName: args.name,
      requiredParameters: funcsym.parameters,
      givenArguments: args.gonnaCallFunctionWithParameters,
      sourceloc: args.expr.sourceloc,
    });

    const functionSymbolId = elaborateFunctionSymbolWithGenerics(sr, overloadId, {
      elaboratedVariables: args.elaboratedVariables,
      paramPackTypes: paramPackTypes,
      genericArgs: args.expr.genericArgs.map((g) => {
        return lookupAndElaborateDatatype(sr, {
          typeId: g,
          elaboratedVariables: args.elaboratedVariables,
          context: isolateSubstitutionContext(args.context, {
            currentScope: args.context.currentScope,
            genericsScope: args.context.currentScope,
          }),
          isInCFuncdecl: false,
        });
      }),
      context: args.context,
      isMonomorphized: args.isMonomorphized,
      parentStructOrNS: elaborateParentSymbolFromCache(sr, {
        context: args.context,
        parentScope: symbol.parentScope,
      }),
      usageSourceLocation: args.expr.sourceloc,
    });
    const functionSymbol = sr.nodes.get(functionSymbolId);
    assert(functionSymbol.variant === Semantic.ENode.FunctionSymbol);
    return Semantic.addNode(sr, {
      variant: Semantic.ENode.SymbolValueExpr,
      symbol: functionSymbolId,
      type: functionSymbol.type,
      sourceloc: args.expr.sourceloc,
    });
  } else {
    console.info("Warning: Item skipped in namespace access");
    return undefined;
  }
}

function lookupAndElaborateNamespaceMemberAccess(
  sr: SemanticResult,
  namespaceValueId: Semantic.Id,
  args: {
    name: string;
    expr: Collect.MemberAccessExpr;
    context: ElaborationContext;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    gonnaCallFunctionWithParameters?: {
      index: number;
      exprId: Semantic.Id;
    }[];
    isMonomorphized: boolean;
  }
) {
  const namespace = sr.nodes.get(namespaceValueId);
  assert(namespace.variant === Semantic.ENode.DatatypeAsValueExpr);
  const semanticNamespace = sr.nodes.get(namespace.type);
  assert(semanticNamespace.variant === Semantic.ENode.NamespaceDatatype);
  const collectedNamespace = sr.cc.nodes.get(semanticNamespace.collectedNamespace);
  assert(collectedNamespace.variant === Collect.ENode.NamespaceDefinitionSymbol);
  const collectedNSSharedInstance = sr.cc.nodes.get(collectedNamespace.sharedInstance);
  assert(collectedNSSharedInstance.variant === Collect.ENode.NamespaceSharedInstance);

  for (const scopeId of collectedNSSharedInstance.namespaceScopes) {
    const scope = sr.cc.nodes.get(scopeId);
    assert(scope.variant === Collect.ENode.NamespaceScope);
    for (const symbolId of scope.symbols) {
      const s = lookupSymbolInNamespaceOrStructScope(sr, symbolId, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        expr: args.expr,
        name: args.name,
        gonnaCallFunctionWithParameters: args.gonnaCallFunctionWithParameters,
        isMonomorphized: args.isMonomorphized,
      });
      if (s) {
        return s;
      }
    }
  }
  throw new CompilerError(
    `Namespace '${collectedNamespace.name}' does not define any declarations named '${args.expr.memberName}'`,
    args.expr.sourceloc
  );
}

function lookupAndElaborateStaticStructAccess(
  sr: SemanticResult,
  namespaceOrStructValueId: Semantic.Id,
  args: {
    name: string;
    expr: Collect.MemberAccessExpr;
    context: ElaborationContext;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    gonnaCallFunctionWithParameters?: {
      index: number;
      exprId: Semantic.Id;
    }[];
    isMonomorphized: boolean;
  }
) {
  const namespaceOrStructValue = sr.nodes.get(namespaceOrStructValueId);
  assert(namespaceOrStructValue.variant === Semantic.ENode.DatatypeAsValueExpr);
  const semanticStruct = sr.nodes.get(namespaceOrStructValue.type);
  assert(semanticStruct.variant === Semantic.ENode.StructDatatype);
  const collectedStruct = sr.cc.nodes.get(semanticStruct.collectedSymbol);
  assert(collectedStruct.variant === Collect.ENode.StructDefinitionSymbol);
  const structScope = sr.cc.nodes.get(collectedStruct.structScope);
  assert(structScope.variant === Collect.ENode.StructScope);

  const elaboratedStructCache = sr.elaboratedStructDatatypes.find((d) => {
    return d.resultSymbol === namespaceOrStructValue.type;
  });
  assert(elaboratedStructCache);

  for (const symbolId of structScope.symbols) {
    const s = lookupSymbolInNamespaceOrStructScope(sr, symbolId, {
      context: mergeSubstitutionContext(elaboratedStructCache.substitutionContext, args.context, {
        currentScope: args.context.currentScope,
        genericsScope: args.context.currentScope,
      }),
      elaboratedVariables: args.elaboratedVariables,
      expr: args.expr,
      name: args.name,
      isMonomorphized: args.isMonomorphized,
      gonnaCallFunctionWithParameters: args.gonnaCallFunctionWithParameters,
    });
    if (s) {
      const symbol = sr.nodes.get(s[1]);
      if (symbol.variant === Semantic.ENode.FunctionSymbol) {
        if (!symbol.staticMethod) {
          throw new CompilerError(
            `Method ${serializeNestedName(sr, s[1])} is not static but is used in a static context`,
            args.expr.sourceloc
          );
        }
      }
      return s;
    }
  }
  throw new CompilerError(
    `Struct '${collectedStruct.name}' does not define any declarations named '${args.expr.memberName}'`,
    args.expr.sourceloc
  );
}

export function elaborateFunctionSignature(sr: SemanticResult, functionSymbolId: Collect.Id) {
  if (sr.elaboratedFunctionSignatures.has(functionSymbolId)) {
    return sr.elaboratedFunctionSignatures.get(functionSymbolId)!;
  }

  const functionSymbol = sr.cc.nodes.get(functionSymbolId);
  assert(functionSymbol.variant === Collect.ENode.FunctionSymbol);
  assert(functionSymbol.functionScope);

  // const signature = Semantic.addNode(sr, {
  //   variant: Semantic.ENode.FunctionSignature,
  //   genericPlaceholders: functionSymbol.generics.map((gId) => {
  //     const g = sr.cc.nodes.get(gId);
  //     assert(g.variant === Collect.ENode.GenericTypeParameter);
  //     return Semantic.addNode(sr, {
  //       variant: Semantic.ENode.GenericParameterDatatype,
  //       name: g.name,
  //       collectedParameter: gId,
  //       concrete: false,
  //     })[1];
  //   }),
  //   originalFunction: functionSymbolId,
  //   parameters: functionSymbol.parameters.map((p) => {}),
  //   returnType: lookupAndElaborateDatatype(sr, {
  //     typeId: functionSymbol.returnType,
  //     context: makeElaborationContext(),
  //     currentScope: functionSymbol.functionScope,
  //     elaboratedVariables: new Map(),
  //     isInCFuncdecl: functionSymbol.extern === EExternLanguage.Extern_C,
  //     startLookupInScopeForGenerics: functionSymbol.functionScope,
  //     startLookupInScopeForSymbol: functionSymbol.functionScope,
  //   }),
  // })[1];
}

export function ChooseFunctionOverload(
  sr: SemanticResult,
  overloadGroupId: Collect.Id,
  calledWithArgs: { index: number; exprId: Semantic.Id }[],
  args: {
    context: ElaborationContext;
  }
) {
  const overloadGroup = sr.cc.nodes.get(overloadGroupId);
  assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroup);

  assert(
    false,
    "TODO FOR NEXT TIME: This elaboration system needs to be improved. For choosing an overload, i must elaborate the function parameters, but i can't really elaborate the entire function symbol since elaborating the function symbols requires things like generics and parameter packs, that i only know after i have chosen the overload and i can't do it in advance. But to elaborate the datatypes i need to duplicate a lot of elaboration here. So i need proper convenience functions that abstract the elaboration for functions and types in a way that i can simply use them and avoid all this code duplication. I need simple elaboration functions for functions and types, that don't require 12 parameters"
  );

  // // First find exact matches
  // const exactMatches = [] as Semantic.FunctionSymbol[];
  // for (const overloadId of overloadGroup.overloads) {
  //   const overload = sr.cc.nodes.get(overloadId);
  //   assert(overload.variant === Collect.ENode.FunctionSymbol);

  //   if (
  //     overload.parameters.length !== calledWithArgs.length ||
  //     funcSymHasParameterPack(sr.cc, overloadId)
  //   )
  //     continue;

  //   let matches = true;
  //   overload.parameters.forEach((p, i) => {
  //     const requiredType = lookupAndElaborateDatatype(sr, {
  //       typeId: p.type,
  //       context: args.context,
  //       currentScope: 0,
  //     });
  //     const passed = calledWithArgs.find((a) => a.index === i);
  //     if (!passed) {
  //       matches = false;
  //       return;
  //     }
  //     const expression = sr.nodes.get(passed.exprId);
  //     assert(isExpression(expression));
  //     const type = sr.nodes.get(expression.type);
  //     assert(isType(expression));
  //     if (type !== p.type) {
  //     }
  //   });
  // }
}

export function elaborateExpr(
  sr: SemanticResult,
  exprId: Collect.Id,
  args: {
    context: ElaborationContext;
    scope: Collect.Id;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    gonnaCallFunctionWithParameterValues?: {
      index: number;
      exprId: Semantic.Id;
    }[];
    gonnaInstantiateStructWithType?: Semantic.Id;
    isMonomorphized: boolean;
  }
): [Semantic.Expression, Semantic.Id] {
  const expr = sr.cc.nodes.get(exprId);

  args.context = isolateSubstitutionContext(args.context, {
    currentScope: args.scope,
    genericsScope: args.scope,
  });

  switch (expr.variant) {
    case Collect.ENode.BinaryExpr: {
      let [left, leftId] = elaborateExpr(sr, expr.left, {
        context: args.context,
        scope: args.context.currentScope,
        elaboratedVariables: args.elaboratedVariables,
        isMonomorphized: args.isMonomorphized,
      });
      let [right, rightId] = elaborateExpr(sr, expr.right, {
        context: args.context,
        scope: args.context.currentScope,
        elaboratedVariables: args.elaboratedVariables,
        isMonomorphized: args.isMonomorphized,
      });

      if (
        (expr.operation === EBinaryOperation.Equal ||
          expr.operation === EBinaryOperation.Unequal) &&
        left.variant === Semantic.ENode.DatatypeAsValueExpr &&
        right.variant === Semantic.ENode.DatatypeAsValueExpr
      ) {
        const value = expr.operation === EBinaryOperation.Equal && left.type === right.type;
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.LiteralExpr,
          literal: {
            type: EPrimitive.bool,
            value: value,
          },
          sourceloc: expr.sourceloc,
          type: makePrimitiveAvailable(sr, EPrimitive.bool),
        });
      }

      let resultType = undefined as Semantic.Id | undefined;
      if (
        expr.operation === EBinaryOperation.BoolAnd ||
        expr.operation === EBinaryOperation.BoolOr
      ) {
        const boolType = makePrimitiveAvailable(sr, EPrimitive.bool);
        leftId = Conversion.MakeImplicitConversion(sr, leftId, boolType, left.sourceloc);
        rightId = Conversion.MakeImplicitConversion(sr, rightId, boolType, right.sourceloc);
        resultType = boolType;
      } else {
        resultType = Conversion.makeBinaryResultType(
          sr,
          leftId,
          rightId,
          expr.operation,
          expr.sourceloc
        );
      }

      return Semantic.addNode(sr, {
        variant: Semantic.ENode.BinaryExpr,
        left: leftId,
        operation: expr.operation,
        right: rightId,
        type: resultType,
        sourceloc: expr.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================
    case Collect.ENode.UnaryExpr: {
      const [e, eId] = elaborateExpr(sr, expr.expr, {
        context: args.context,
        scope: args.context.currentScope,
        elaboratedVariables: args.elaboratedVariables,
        isMonomorphized: args.isMonomorphized,
      });

      const type = getExprType(sr, eId);
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.UnaryExpr,
        expr: eId,
        operation: expr.operation,
        type: Conversion.makeUnaryResultType(sr, type, expr.operation, expr.sourceloc),
        sourceloc: expr.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.LiteralExpr: {
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.LiteralExpr,
        literal: expr.literal,
        sourceloc: expr.sourceloc,
        type: makePrimitiveAvailable(sr, expr.literal.type),
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ParenthesisExpr: {
      return elaborateExpr(sr, expr.expr, {
        elaboratedVariables: args.elaboratedVariables,
        context: args.context,
        scope: args.context.currentScope,
        gonnaCallFunctionWithParameterValues: args.gonnaCallFunctionWithParameterValues,
        gonnaInstantiateStructWithType: args.gonnaInstantiateStructWithType,
        isMonomorphized: args.isMonomorphized,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ExprCallExpr: {
      const collectedExpr = sr.cc.nodes.get(expr.calledExpr);
      if (collectedExpr.variant === Collect.ENode.SymbolValueExpr) {
        if (collectedExpr.name === "typeof") {
          const callingArguments = expr.arguments.map(
            (a, i) =>
              elaborateExpr(sr, a, {
                elaboratedVariables: args.elaboratedVariables,
                context: args.context,
                scope: args.context.currentScope,
                isMonomorphized: args.isMonomorphized,
              })[1]
          );
          if (collectedExpr.genericArgs.length !== 0) {
            throw new CompilerError(
              "The typeof function cannot take any type parameters",
              collectedExpr.sourceloc
            );
          }
          if (callingArguments.length !== 1) {
            throw new CompilerError(
              "The typeof function can only take exactly one parameter",
              collectedExpr.sourceloc
            );
          }
          const value = sr.nodes.get(callingArguments[0]);
          assert(isExpression(value));
          return Semantic.addNode(sr, {
            variant: Semantic.ENode.DatatypeAsValueExpr,
            elaboratedType: value.type,
            collectedType: null,
            sourceloc: collectedExpr.sourceloc,
            type: value.type,
          });
        }
        if (collectedExpr.name === "static_assert") {
          const callingArguments = expr.arguments.map(
            (a, i) =>
              elaborateExpr(sr, a, {
                elaboratedVariables: args.elaboratedVariables,
                context: args.context,
                scope: args.context.currentScope,
                isMonomorphized: args.isMonomorphized,
              })[1]
          );
          if (collectedExpr.genericArgs.length !== 0) {
            throw new CompilerError(
              "The static_assert function cannot take any type parameters",
              collectedExpr.sourceloc
            );
          }
          if (callingArguments.length < 1 || callingArguments.length > 2) {
            throw new CompilerError(
              "The static_assert function can only take one or two parameters",
              collectedExpr.sourceloc
            );
          }
          let second = undefined as Semantic.LiteralExpr | undefined;
          if (callingArguments.length > 1) {
            const s = sr.nodes.get(callingArguments[1]);
            if (s.variant !== Semantic.ENode.LiteralExpr || s.literal.type !== EPrimitive.str) {
              throw new CompilerError(
                "The static_assert function requires the second parameter to be a string, or omitted",
                collectedExpr.sourceloc
              );
            } else {
              second = s;
            }
          }
          const value = EvalCTFEBoolean(sr, callingArguments[0]);
          if (value) {
            return Semantic.addNode(sr, {
              variant: Semantic.ENode.LiteralExpr,
              sourceloc: collectedExpr.sourceloc,
              type: makePrimitiveAvailable(sr, EPrimitive.bool),
              literal: {
                type: EPrimitive.bool,
                value: true,
              },
            });
          } else {
            const stringValue = second?.literal.value;
            throw new CompilerError(
              `static_assert evaluated to false${stringValue ? ": " + stringValue : ""}`,
              expr.sourceloc
            );
          }
        }
      }

      let decisiveArguments = [] as {
        index: number;
        exprId: Semantic.Id;
      }[];
      expr.arguments.forEach((p, i) => {
        if (IsExprDecisiveForOverloadResolution(sr, p)) {
          decisiveArguments.push({
            index: i,
            exprId: elaborateExpr(sr, p, {
              elaboratedVariables: args.elaboratedVariables,
              context: args.context,
              scope: args.context.currentScope,
              isMonomorphized: args.isMonomorphized,
            })[1],
          });
        }
      });

      // Choose all arguments that can contribute to disambiguating an overloaded function call
      const [calledExpr, calledExprId] = elaborateExpr(sr, expr.calledExpr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        gonnaCallFunctionWithParameterValues: decisiveArguments,
        scope: args.context.currentScope,
        isMonomorphized: args.isMonomorphized,
      });
      const calledExprType = asType(sr.nodes.get(calledExpr.type));

      const convertArgs = (
        givenArgs: Semantic.Id[],
        requiredTypes: Semantic.Id[],
        vararg: boolean
      ) => {
        const newRequiredTypes = requiredTypes.filter((t) => {
          const tt = sr.nodes.get(t);
          assert(isType(tt));
          return tt.variant !== Semantic.ENode.ParameterPackDatatypeSymbol;
        });
        if (vararg || requiredTypes.length !== newRequiredTypes.length) {
          if (givenArgs.length < newRequiredTypes.length) {
            throw new CompilerError(
              `This call requires at least ${newRequiredTypes.length} arguments but only ${givenArgs.length} were given`,
              calledExpr.sourceloc
            );
          }
        } else {
          if (givenArgs.length !== newRequiredTypes.length) {
            throw new CompilerError(
              `This call requires ${newRequiredTypes.length} arguments but ${givenArgs.length} were given`,
              calledExpr.sourceloc
            );
          }
        }
        return givenArgs.map((a, index) => {
          if (index < newRequiredTypes.length) {
            return Conversion.MakeImplicitConversion(
              sr,
              a,
              newRequiredTypes[index],
              expr.sourceloc
            );
          } else {
            return a;
          }
        });
      };

      const getActualCallingArguments = (expectedParameterTypes: Semantic.Id[]): Semantic.Id[] => {
        return expr.arguments.map((a, i) => {
          const alreadyKnown = decisiveArguments.find((d) => d.index === i);
          if (alreadyKnown) {
            return alreadyKnown.exprId;
          } else {
            let structType = undefined as Semantic.Id | undefined;
            if (i < expectedParameterTypes.length) {
              structType = expectedParameterTypes[i];
            }
            assert(structType && isType(sr.nodes.get(structType)));
            return elaborateExpr(sr, a, {
              elaboratedVariables: args.elaboratedVariables,
              context: args.context,
              scope: args.context.currentScope,
              gonnaInstantiateStructWithType: structType,
              isMonomorphized: args.isMonomorphized,
            })[1];
          }
        });
      };

      if (calledExprType.variant === Semantic.ENode.CallableDatatype) {
        const ftype = sr.nodes.get(calledExprType.functionType);
        assert(ftype.variant === Semantic.ENode.FunctionDatatype);
        let parametersWithoutThis = ftype.parameters;
        if (calledExprType.thisExprType) {
          parametersWithoutThis = parametersWithoutThis.slice(1);
        }
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.ExprCallExpr,
          calledExpr: calledExprId,
          arguments: convertArgs(
            getActualCallingArguments(parametersWithoutThis),
            parametersWithoutThis,
            ftype.vararg
          ),
          type: ftype.returnType,
          sourceloc: expr.sourceloc,
        });
      }

      if (calledExprType.variant === Semantic.ENode.FunctionDatatype) {
        const args = convertArgs(
          getActualCallingArguments(calledExprType.parameters),
          calledExprType.parameters,
          calledExprType.vararg
        );
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.ExprCallExpr,
          calledExpr: calledExprId,
          arguments: args,
          type: calledExprType.returnType,
          sourceloc: expr.sourceloc,
        });
      } else if (calledExprType.variant === Semantic.ENode.StructDatatype) {
        assert(
          sr.cc.nodes.get(calledExprType.originalCollectedSymbol).variant ===
            Collect.ENode.StructDefinitionSymbol
        );
        const constructorId = [...calledExprType.methods].find((methodId) => {
          const method = sr.nodes.get(methodId);
          assert(method.variant === Semantic.ENode.FunctionSymbol);
          return method.name === "constructor";
        });
        if (!constructorId) {
          throw new CompilerError(
            `Struct ${calledExprType.name} is called, but it does not provide a constructor`,
            expr.sourceloc
          );
        }
        const constructor = sr.nodes.get(constructorId);
        assert(constructor.variant === Semantic.ENode.FunctionSymbol);

        const constructorFunctype = asType(sr.nodes.get(constructor.type));
        assert(constructorFunctype.variant === Semantic.ENode.FunctionDatatype);
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.ExprCallExpr,
          calledExpr: Semantic.addNode(sr, {
            variant: Semantic.ENode.SymbolValueExpr,
            symbol: constructorId,
            type: constructor.type,
            sourceloc: expr.sourceloc,
          })[1],
          arguments: convertArgs(
            getActualCallingArguments(constructorFunctype.parameters),
            constructorFunctype.parameters,
            constructorFunctype.vararg
          ),
          type: constructorFunctype.returnType,
          sourceloc: expr.sourceloc,
        });
      } else if (calledExprType.variant === Semantic.ENode.PrimitiveDatatype) {
        throw new CompilerError(
          `Expression of type ${primitiveToString(calledExprType.primitive)} is not callable`,
          expr.sourceloc
        );
      } else if (calledExprType.variant === Semantic.ENode.PointerDatatype) {
        throw new CompilerError(`Expression of type Pointer is not callable`, expr.sourceloc);
      }
      assert(false && "All cases handled");
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.SymbolValueExpr: {
      if (expr.name === "sizeof") {
        assert(false, "Not implemented");
        // if (expr.generics.length !== 1) {
        //   throw new CompilerError(
        //     `The sizeof<> Operator needs exactly 1 type argument`,
        //     expr.sourceloc
        //   );
        // }
        // return Semantic.addNode(sr, {
        //   variant: Semantic.ENode.SizeofExpr,
        //   datatype: lookupAndElaborateDatatype(sr, {
        //     type: expr.generics[0],
        //     startLookupInScope: args.scope.id,
        //     isInCFuncdecl: false,
        //     context: args.context,
        //   }),
        //   type: makePrimitiveAvailable(sr, EPrimitive.u64),
        //   sourceloc: expr.sourceloc,
        // });
      }

      const primitive = stringToPrimitive(expr.name);
      if (primitive) {
        if (expr.genericArgs.length > 0) {
          throw new CompilerError(`Type ${expr.name} is not generic`, expr.sourceloc);
        }
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.DatatypeAsValueExpr,
          type: makePrimitiveAvailable(sr, primitive),
          sourceloc: expr.sourceloc,
        });
      }

      // assert(false);
      let foundResult = lookupSymbol(sr, expr.name, {
        startLookupInScope: args.context.currentScope,
        sourceloc: expr.sourceloc,
      });

      if (foundResult.type === "semantic") {
        return [asExpression(sr.nodes.get(foundResult.id)), foundResult.id];
      }

      let symbolId = foundResult.id;
      let symbol = sr.cc.nodes.get(symbolId);

      if (symbol.variant === Collect.ENode.AliasTypeSymbol) {
        const aliasScope = symbol.inScope;
        symbolId = symbol.target;
        symbol = sr.cc.nodes.get(symbolId);

        if (symbol.variant === Collect.ENode.NamedDatatype) {
          let foundResult = lookupSymbol(sr, symbol.name, {
            startLookupInScope: aliasScope,
            sourceloc: symbol.sourceloc,
          });
          if (foundResult.type === "semantic") {
            return [asExpression(sr.nodes.get(foundResult.id)), foundResult.id];
          }
          symbolId = foundResult.id;
          symbol = sr.cc.nodes.get(symbolId);
        }
      }

      if (symbol.variant === Collect.ENode.VariableSymbol) {
        if (expr.genericArgs.length !== 0) {
          throw new CompilerError(
            `A variable access cannot have a type parameter list`,
            expr.sourceloc
          );
        }
        let elaboratedSymbolId = undefined as Semantic.Id | undefined;
        if (symbol.variableContext === EVariableContext.Global) {
          // In case it's not elaborated yet, may happen
          elaborateTopLevelSymbol(sr, symbolId, {
            context: args.context,
          });
          elaboratedSymbolId = sr.elaboratedGlobalVariableSymbols.get(symbolId);
        } else {
          elaboratedSymbolId = args.elaboratedVariables.get(symbolId);
        }
        assert(elaboratedSymbolId, "Variable was not elaborated here: " + symbol.name);
        const elaboratedSymbol = sr.nodes.get(elaboratedSymbolId);
        if (elaboratedSymbol.variant === Semantic.ENode.VariableSymbol) {
          assert(elaboratedSymbol.type);
          return Semantic.addNode(sr, {
            variant: Semantic.ENode.SymbolValueExpr,
            symbol: elaboratedSymbolId,
            type: elaboratedSymbol.type,
            sourceloc: expr.sourceloc,
          });
        } else if (elaboratedSymbol.variant === Semantic.ENode.ParameterPackDatatypeSymbol) {
          return Semantic.addNode(sr, {
            variant: Semantic.ENode.SymbolValueExpr,
            symbol: elaboratedSymbolId,
            type: elaboratedSymbolId,
            sourceloc: expr.sourceloc,
          });
        } else {
          assert(false);
        }
      } else if (symbol.variant === Collect.ENode.GlobalVariableDefinition) {
        const [elaboratedSymbolId] = elaborateTopLevelSymbol(sr, symbolId, {
          context: args.context,
        });
        assert(elaboratedSymbolId);
        const elaboratedSymbol = sr.nodes.get(elaboratedSymbolId);
        assert(elaboratedSymbol.variant === Semantic.ENode.GlobalVariableDefinitionSymbol);
        const variableSymbol = sr.nodes.get(elaboratedSymbol.variableSymbol);
        assert(variableSymbol.variant === Semantic.ENode.VariableSymbol && variableSymbol.type);
        if (expr.genericArgs.length !== 0) {
          throw new CompilerError(
            `A variable access cannot have a type parameter list`,
            expr.sourceloc
          );
        }
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.SymbolValueExpr,
          symbol: elaboratedSymbolId,
          type: variableSymbol.type,
          sourceloc: expr.sourceloc,
        });
      } else if (symbol.variant === Collect.ENode.FunctionOverloadGroup) {
        console.info("TODO: Implement function overload resolution here");

        // console.log("Choose: ", symbol.name, args.gonnaCallFunctionWithParameterValues);
        // const ov = ChooseFunctionOverload(sr, symbolId, args.gonnaCallFunctionWithParameterValues);

        const chosenOverloadId = [...symbol.overloads][0];
        const chosenOverload = sr.cc.nodes.get(chosenOverloadId);
        assert(chosenOverload.variant === Collect.ENode.FunctionSymbol);

        const parameterPackTypes = prepareParameterPackTypes(sr, {
          functionName: symbol.name,
          requiredParameters: chosenOverload.parameters,
          givenArguments: args.gonnaCallFunctionWithParameterValues,
          sourceloc: expr.sourceloc,
        });

        const elaboratedSymbolId = elaborateFunctionSymbolWithGenerics(sr, chosenOverloadId, {
          elaboratedVariables: args.elaboratedVariables,
          paramPackTypes: parameterPackTypes,
          genericArgs: expr.genericArgs.map((g) => {
            return lookupAndElaborateDatatype(sr, {
              typeId: g,
              context: args.context,
              elaboratedVariables: args.elaboratedVariables,
              isInCFuncdecl: false,
            });
          }),
          usageSourceLocation: expr.sourceloc,
          context: args.context,
          parentStructOrNS: elaborateParentSymbolFromCache(sr, {
            context: args.context,
            parentScope: symbol.parentScope,
          }),
          isMonomorphized: args.isMonomorphized,
        });
        assert(elaboratedSymbolId);
        const elaboratedSymbol = sr.nodes.get(elaboratedSymbolId);
        assert(elaboratedSymbol.variant === Semantic.ENode.FunctionSymbol);
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.SymbolValueExpr,
          symbol: elaboratedSymbolId,
          type: elaboratedSymbol.type,
          sourceloc: expr.sourceloc,
        });
      } else if (
        symbol.variant === Collect.ENode.StructDefinitionSymbol ||
        symbol.variant === Collect.ENode.NamespaceDefinitionSymbol
      ) {
        // This is for static function calls like Arena.create(); -> "Arena" is now a NamespaceValue
        const [elaboratedSymbolId] = elaborateTopLevelSymbol(sr, symbolId, {
          context: args.context,
        });
        assert(elaboratedSymbolId);
        const elaboratedSymbol = sr.nodes.get(elaboratedSymbolId);
        assert(
          elaboratedSymbol.variant === Semantic.ENode.NamespaceDatatype ||
            elaboratedSymbol.variant === Semantic.ENode.StructDatatype
        );
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.DatatypeAsValueExpr,
          type: elaboratedSymbolId,
          sourceloc: expr.sourceloc,
        });
      } else {
        throw new CompilerError(
          `Symbol cannot be used as a value: Code ${symbol.variant}`,
          expr.sourceloc
        );
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.PointerAddressOfExpr: {
      const [_expr, exprId] = elaborateExpr(sr, expr.expr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.context.currentScope,
        isMonomorphized: args.isMonomorphized,
      });
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.PointerAddressOfExpr,
        type: makePointerDatatypeAvailable(sr, _expr.type),
        expr: exprId,
        sourceloc: expr.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.PointerDereferenceExpr: {
      const [_expr, _exprId] = elaborateExpr(sr, expr.expr, {
        elaboratedVariables: args.elaboratedVariables,
        context: args.context,
        scope: args.context.currentScope,
        isMonomorphized: args.isMonomorphized,
      });
      const exprType = asType(sr.nodes.get(_expr.type));
      if (exprType.variant !== Semantic.ENode.PointerDatatype) {
        throw new CompilerError(
          `This expression is not a pointer and cannot be dereferenced`,
          expr.sourceloc
        );
      }
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.PointerDereferenceExpr,
        type: exprType.pointee,
        expr: _exprId,
        sourceloc: expr.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ExplicitCastExpr: {
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ExplicitCastExpr,
        type: lookupAndElaborateDatatype(sr, {
          typeId: expr.targetType,
          elaboratedVariables: args.elaboratedVariables,
          isInCFuncdecl: false,
          context: args.context,
        }),
        expr: elaborateExpr(sr, expr.expr, {
          context: args.context,
          scope: args.context.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
        })[1],
        sourceloc: expr.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.PostIncrExpr: {
      const [e, eId] = elaborateExpr(sr, expr.expr, {
        elaboratedVariables: args.elaboratedVariables,
        scope: args.context.currentScope,
        context: args.context,
        isMonomorphized: args.isMonomorphized,
      });
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.PostIncrExpr,
        type: e.type,
        expr: eId,
        operation: expr.operation,
        sourceloc: expr.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.PreIncrExpr: {
      const [e, eId] = elaborateExpr(sr, expr.expr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.context.currentScope,
        isMonomorphized: args.isMonomorphized,
      });
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.PreIncrExpr,
        type: e.type,
        expr: eId,
        operation: expr.operation,
        sourceloc: expr.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.MemberAccessExpr: {
      const [object, objectId] = elaborateExpr(sr, expr.expr, {
        scope: args.context.currentScope,
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        isMonomorphized: args.isMonomorphized,
      });
      let objectType = asType(sr.nodes.get(object.type));

      if (objectType.variant === Semantic.ENode.ReferenceDatatype) {
        objectType = asType(sr.nodes.get(objectType.referee));
      }

      if (object.variant === Semantic.ENode.DatatypeAsValueExpr) {
        const namespaceOrStruct = sr.nodes.get(object.type);
        if (namespaceOrStruct.variant === Semantic.ENode.NamespaceDatatype) {
          return lookupAndElaborateNamespaceMemberAccess(sr, objectId, {
            expr: expr,
            context: args.context,
            elaboratedVariables: args.elaboratedVariables,
            isMonomorphized: args.isMonomorphized,
            name: expr.memberName,
            gonnaCallFunctionWithParameters: args.gonnaCallFunctionWithParameterValues,
          });
        } else {
          return lookupAndElaborateStaticStructAccess(sr, objectId, {
            expr: expr,
            context: args.context,
            elaboratedVariables: args.elaboratedVariables,
            isMonomorphized: args.isMonomorphized,
            name: expr.memberName,
            gonnaCallFunctionWithParameters: args.gonnaCallFunctionWithParameterValues,
          });
        }
      }

      if (objectType.variant !== Semantic.ENode.StructDatatype) {
        throw new CompilerError(
          "Cannot access member of non-structural type " + serializeDatatype(sr, object.type),
          expr.sourceloc
        );
      }

      const memberId = objectType.members.find((mId) => {
        const m = sr.nodes.get(mId);
        assert(m.variant === Semantic.ENode.VariableSymbol);
        return m.name === expr.memberName;
      });

      if (memberId) {
        if (expr.genericArgs.length > 0) {
          throw new CompilerError(
            `Member '${expr.memberName}' does not expect any type arguments, but ${expr.genericArgs.length} are given`,
            expr.sourceloc
          );
        }
        const member = sr.nodes.get(memberId);
        assert(member.variant === Semantic.ENode.VariableSymbol && member.type);
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.MemberAccessExpr,
          expr: objectId,
          memberName: expr.memberName,
          type: member.type,
          sourceloc: expr.sourceloc,
        });
      }

      const collectedStruct = sr.cc.nodes.get(objectType.originalCollectedSymbol);
      assert(collectedStruct.variant === Collect.ENode.StructDefinitionSymbol);
      const structScope = sr.cc.nodes.get(collectedStruct.structScope);
      assert(structScope.variant === Collect.ENode.StructScope);
      const overloadGroupId = [...structScope.symbols].find((mId) => {
        const m = sr.cc.nodes.get(mId);
        return m.variant === Collect.ENode.FunctionOverloadGroup && m.name === expr.memberName;
      });

      if (overloadGroupId) {
        console.info("TODO: Fix overload resolution here ");
        const overloadGroup = sr.cc.nodes.get(overloadGroupId);
        assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroup);
        const collectedMethodId = [...overloadGroup.overloads][0];
        const collectedMethod = sr.cc.nodes.get(collectedMethodId);
        assert(collectedMethod.variant === Collect.ENode.FunctionSymbol);

        const elaboratedStructCache = sr.elaboratedStructDatatypes.find(
          (d) => d.resultSymbol === object.type
        );
        assert(elaboratedStructCache);

        const parameterPackTypes = prepareParameterPackTypes(sr, {
          functionName: overloadGroup.name,
          requiredParameters: collectedMethod.parameters,
          givenArguments: args.gonnaCallFunctionWithParameterValues,
          sourceloc: expr.sourceloc,
        });

        const elaboratedMethodId = elaborateFunctionSymbolWithGenerics(sr, collectedMethodId, {
          context: mergeSubstitutionContext(
            elaboratedStructCache.substitutionContext,
            args.context,
            {
              currentScope: args.context.currentScope,
              genericsScope: args.context.currentScope,
            }
          ),
          paramPackTypes: parameterPackTypes,
          genericArgs: expr.genericArgs.map((g) => {
            return lookupAndElaborateDatatype(sr, {
              typeId: g,
              context: isolateSubstitutionContext(elaboratedStructCache.substitutionContext, {
                currentScope: args.context.currentScope,
                genericsScope: args.context.currentScope,
              }),
              elaboratedVariables: args.elaboratedVariables,
              isInCFuncdecl: false,
            });
          }),
          usageSourceLocation: expr.sourceloc,
          elaboratedVariables: args.elaboratedVariables,
          parentStructOrNS: object.type,
          isMonomorphized: args.isMonomorphized,
        });
        assert(elaboratedMethodId);
        const elaboratedMethod = sr.nodes.get(elaboratedMethodId);
        assert(elaboratedMethod.variant === Semantic.ENode.FunctionSymbol);

        if (elaboratedMethod.staticMethod) {
          throw new CompilerError(
            `Method ${serializeNestedName(
              sr,
              elaboratedMethodId
            )} is static but is called through an object`,
            expr.sourceloc
          );
        }

        return Semantic.addNode(sr, {
          variant: Semantic.ENode.CallableExpr,
          thisExpr: objectId,
          functionSymbol: elaboratedMethodId,
          type: Semantic.addNode(sr, {
            variant: Semantic.ENode.CallableDatatype,
            thisExprType: makeReferenceDatatypeAvailable(sr, object.type),
            functionType: elaboratedMethod.type,
            concrete: isTypeConcrete(sr, elaboratedMethod.type),
          })[1],
          sourceloc: expr.sourceloc,
        });
      }

      throw new CompilerError(
        `No attribute named '${expr.memberName}' in struct ${objectType.name}`,
        expr.sourceloc
      );
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ExprAssignmentExpr: {
      const [value, valueId] = elaborateExpr(sr, expr.value, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.context.currentScope,
        isMonomorphized: args.isMonomorphized,
      });
      const [target, targetId] = elaborateExpr(sr, expr.expr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.context.currentScope,
        isMonomorphized: args.isMonomorphized,
      });
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ExprAssignmentExpr,
        value: Conversion.MakeImplicitConversion(sr, valueId, target.type, expr.sourceloc),
        target: targetId,
        type: target.type,
        sourceloc: expr.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ArrayLiteralExpr: {
      const values = expr.values.map((v) =>
        elaborateExpr(sr, v, {
          context: args.context,
          scope: args.context.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
        })
      );
      let type = null as Semantic.Id | null;
      for (let i = 0; i < values.length; i++) {
        const [value, valueId] = values[i];
        assert(isExpression(value));
        if (type === null) {
          type = value.type;
        }
        if (type !== value.type) {
          throw new CompilerError(
            `Array type mismatch: Value #${i + 1} has type ${serializeDatatype(
              sr,
              value.type
            )}, but ${serializeDatatype(
              sr,
              type
            )} was expected. Cannot deduce array type from multiple different value types.`,
            expr.sourceloc
          );
        }
      }
      if (values.length === 0) {
        throw new CompilerError(`Array literal must contain at least one value`, expr.sourceloc);
      }
      assert(type);
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ArrayLiteralExpr,
        values: values.map((v) => v[1]),
        type: makeArrayDatatypeAvailable(sr, type, values.length),
        sourceloc: expr.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ArraySubscriptExpr: {
      if (expr.indices.length > 1) {
        throw new CompilerError(
          `Multidimensional array subscripting is not implemented yet`,
          expr.sourceloc
        );
      }
      const [value, valueId] = elaborateExpr(sr, expr.expr, {
        context: args.context,
        scope: args.context.currentScope,
        elaboratedVariables: args.elaboratedVariables,
        isMonomorphized: args.isMonomorphized,
      });
      const [index, indexId] = elaborateExpr(sr, expr.indices[0], {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.context.currentScope,
        isMonomorphized: args.isMonomorphized,
      });

      const valueType = sr.nodes.get(value.type);
      if (
        valueType.variant !== Semantic.ENode.ArrayDatatype &&
        valueType.variant !== Semantic.ENode.SliceDatatype
      ) {
        throw new CompilerError(
          `Expression of type ${serializeExpr(sr, value.type)} cannot be subscripted`,
          expr.sourceloc
        );
      }

      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ArraySubscriptExpr,
        expr: valueId,
        indices: [indexId],
        type: valueType.datatype,
        sourceloc: expr.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.StructInstantiationExpr: {
      let structId = undefined as Semantic.Id | undefined;
      if (expr.structType) {
        structId = lookupAndElaborateDatatype(sr, {
          typeId: expr.structType,
          elaboratedVariables: args.elaboratedVariables,
          isInCFuncdecl: false,
          context: isolateSubstitutionContext(args.context, {
            currentScope: args.context.currentScope,
            genericsScope: args.context.currentScope,
          }),
        });
      } else if (args.gonnaInstantiateStructWithType) {
        structId = args.gonnaInstantiateStructWithType;
      }

      if (!structId) {
        throw new CompilerError(
          `This struct is anonymous and must be type-inferred, but there is not enough context to infer it. Either it is not directly passed to something that expects a specific type, or it is being passed to an overloaded function.`,
          expr.sourceloc
        );
      }

      const struct = sr.nodes.get(structId);
      if (struct.variant !== Semantic.ENode.StructDatatype) {
        throw new CompilerError(
          `Non-structural type '${serializeDatatype(
            sr,
            structId
          )}' cannot be instantiated as a struct`,
          expr.sourceloc
        );
      }

      let remainingMembers = struct.members.map((mId) => {
        const m = sr.nodes.get(mId);
        assert(m.variant === Semantic.ENode.VariableSymbol);
        return m.name;
      });
      const assignedMembers: string[] = [];
      const assign: {
        name: string;
        value: Semantic.Id;
      }[] = [];
      for (const m of expr.members) {
        const variableId = struct.members.find((mmId) => {
          const mm = sr.nodes.get(mmId);
          assert(mm.variant === Semantic.ENode.VariableSymbol);
          return mm.name === m.name;
        });

        if (!variableId) {
          throw new CompilerError(
            `${serializeDatatype(sr, structId)} does not have a member named '${m.name}'`,
            expr.sourceloc
          );
        }
        const variable = sr.nodes.get(variableId);
        assert(variable.variant === Semantic.ENode.VariableSymbol);

        if (assignedMembers.includes(m.name)) {
          throw new CompilerError(`Cannot assign member ${m.name} twice`, expr.sourceloc);
        }

        const [e, eId] = elaborateExpr(sr, m.value, {
          context: args.context,
          scope: args.context.currentScope,
          elaboratedVariables: args.elaboratedVariables,
          gonnaInstantiateStructWithType: variable.type || undefined,
          isMonomorphized: args.isMonomorphized,
        });

        if (e.type !== variable.type) {
          assert(variable.type);
          throw new CompilerError(
            `Member assignment ${m.name} has mismatching types: Cannot assign ${serializeDatatype(
              sr,
              e.type
            )} to ${serializeDatatype(sr, variable.type)}`,
            expr.sourceloc
          );
        }

        remainingMembers = remainingMembers.filter((mm) => mm !== m.name);
        assign.push({
          value: eId,
          name: m.name,
        });
        assignedMembers.push(m.name);
      }

      if (struct.name === "Result") {
        // Special exception for standard library Result<> Type, until unions are implemented properly
        remainingMembers = remainingMembers.filter(
          (mm) => !["successValue", "errorValue"].includes(mm)
        );
      }

      for (const m of remainingMembers) {
        const defaultValue = struct.memberDefaultValues.find((v) => v.memberName === m);
        if (defaultValue) {
          remainingMembers = remainingMembers.filter((mm) => mm !== m);
          assign.push({
            name: m,
            value: defaultValue.value,
          });
          assignedMembers.push(m);
        }
      }

      if (remainingMembers.length > 0) {
        throw new CompilerError(
          `Members ${remainingMembers.join(", ")} were not assigned and no default value is known`,
          expr.sourceloc
        );
      }

      return Semantic.addNode(sr, {
        variant: Semantic.ENode.StructInstantiationExpr,
        assign: assign,
        type: structId,
        sourceloc: expr.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    default:
      throw new InternalError("Unhandled variant: " + expr.variant);
  }
}

export function elaborateStatement(
  sr: SemanticResult,
  statementId: Collect.Id,
  args: {
    expectedReturnType: Semantic.Id;
    context: ElaborationContext;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    isMonomorphized: boolean;
  }
): Semantic.Id {
  const s = sr.cc.nodes.get(statementId);

  switch (s.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.InlineCStatement:
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.InlineCStatement,
        value: s.value,
        sourceloc: s.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.BlockScopeStatement: {
      const [scope, scopeId] = Semantic.addNode(sr, {
        variant: Semantic.ENode.BlockScope,
        statements: [],
      });
      elaborateBlockScope(sr, {
        targetScopeId: scopeId,
        sourceScopeId: s.blockscope,
        expectedReturnType: args.expectedReturnType,
        elaboratedVariables: args.elaboratedVariables,
        isMonomorphized: args.isMonomorphized,
        context: isolateSubstitutionContext(args.context, {
          currentScope: s.owningScope,
          genericsScope: s.owningScope,
        }),
      });
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.BlockScopeStatement,
        block: scopeId,
        sourceloc: s.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.IfStatement: {
      const [condition, conditionId] = elaborateExpr(sr, s.condition, {
        context: args.context,
        scope: s.owningScope,
        elaboratedVariables: args.elaboratedVariables,
        isMonomorphized: args.isMonomorphized,
      });
      if (s.comptime) {
        const conditionValue = EvalCTFEBoolean(sr, conditionId);
        if (conditionValue) {
          const [thenScope, thenScopeId] = Semantic.addNode(sr, {
            variant: Semantic.ENode.BlockScope,
            statements: [],
          });
          elaborateBlockScope(sr, {
            targetScopeId: thenScopeId,
            sourceScopeId: s.thenBlock,
            expectedReturnType: args.expectedReturnType,
            elaboratedVariables: args.elaboratedVariables,
            isMonomorphized: args.isMonomorphized,
            context: args.context,
          });
          return Semantic.addNode(sr, {
            variant: Semantic.ENode.BlockScopeStatement,
            block: thenScopeId,
            sourceloc: s.sourceloc,
          })[1];
        }

        for (const elif of s.elseif) {
          const [condition, conditionId] = elaborateExpr(sr, elif.condition, {
            context: args.context,
            scope: s.owningScope,
            elaboratedVariables: args.elaboratedVariables,
            isMonomorphized: args.isMonomorphized,
          });
          if (EvalCTFEBoolean(sr, conditionId)) {
            const [thenScope, thenScopeId] = Semantic.addNode(sr, {
              variant: Semantic.ENode.BlockScope,
              statements: [],
            });
            elaborateBlockScope(sr, {
              targetScopeId: thenScopeId,
              sourceScopeId: elif.thenBlock,
              expectedReturnType: args.expectedReturnType,
              elaboratedVariables: args.elaboratedVariables,
              context: args.context,
              isMonomorphized: args.isMonomorphized,
            });
            return Semantic.addNode(sr, {
              variant: Semantic.ENode.BlockScopeStatement,
              block: thenScopeId,
              sourceloc: s.sourceloc,
            })[1];
          }
        }

        if (s.elseBlock) {
          const [thenScope, thenScopeId] = Semantic.addNode(sr, {
            variant: Semantic.ENode.BlockScope,
            statements: [],
          });
          elaborateBlockScope(sr, {
            targetScopeId: thenScopeId,
            sourceScopeId: s.elseBlock,
            expectedReturnType: args.expectedReturnType,
            elaboratedVariables: args.elaboratedVariables,
            isMonomorphized: args.isMonomorphized,
            context: args.context,
          });
          return Semantic.addNode(sr, {
            variant: Semantic.ENode.BlockScopeStatement,
            block: thenScopeId,
            sourceloc: s.sourceloc,
          })[1];
        }

        // Nothing was true, emit empty scope statement
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.BlockScopeStatement,
          block: Semantic.addNode(sr, {
            variant: Semantic.ENode.BlockScope,
            statements: [],
          })[1],
          sourceloc: s.sourceloc,
        })[1];
      } else {
        const [thenScope, thenScopeId] = Semantic.addNode(sr, {
          variant: Semantic.ENode.BlockScope,
          statements: [],
        });
        elaborateBlockScope(sr, {
          targetScopeId: thenScopeId,
          sourceScopeId: s.thenBlock,
          expectedReturnType: args.expectedReturnType,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
          context: args.context,
        });
        const elseIfs = s.elseif.map((e) => {
          const [innerThenScope, innerThenScopeId] = Semantic.addNode(sr, {
            variant: Semantic.ENode.BlockScope,
            statements: [],
          });
          elaborateBlockScope(sr, {
            targetScopeId: innerThenScopeId,
            sourceScopeId: e.thenBlock,
            isMonomorphized: args.isMonomorphized,
            expectedReturnType: args.expectedReturnType,
            elaboratedVariables: args.elaboratedVariables,
            context: args.context,
          });
          return {
            condition: elaborateExpr(sr, e.condition, {
              context: args.context,
              scope: s.owningScope,
              elaboratedVariables: args.elaboratedVariables,
              isMonomorphized: args.isMonomorphized,
            })[1],
            then: innerThenScopeId,
          };
        });

        let [elseScope, elseScopeId] = [
          undefined as undefined | Semantic.BlockScope,
          undefined as Semantic.Id | undefined,
        ];
        if (s.elseBlock) {
          [elseScope, elseScopeId] = Semantic.addNode(sr, {
            variant: Semantic.ENode.BlockScope,
            statements: [],
          });
          elaborateBlockScope(sr, {
            targetScopeId: elseScopeId,
            sourceScopeId: s.elseBlock,
            expectedReturnType: args.expectedReturnType,
            isMonomorphized: args.isMonomorphized,
            elaboratedVariables: args.elaboratedVariables,
            context: args.context,
          });
        }
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.IfStatement,
          condition: conditionId,
          then: thenScopeId,
          elseIfs: elseIfs,
          else: elseScopeId,
          sourceloc: s.sourceloc,
        })[1];
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.WhileStatement: {
      const [condition, conditionId] = elaborateExpr(sr, s.condition, {
        context: args.context,
        scope: s.owningScope,
        elaboratedVariables: args.elaboratedVariables,
        isMonomorphized: args.isMonomorphized,
      });
      const [thenScope, thenScopeId] = Semantic.addNode(sr, {
        variant: Semantic.ENode.BlockScope,
        statements: [],
      });
      elaborateBlockScope(sr, {
        targetScopeId: thenScopeId,
        sourceScopeId: s.block,
        elaboratedVariables: args.elaboratedVariables,
        isMonomorphized: args.isMonomorphized,
        expectedReturnType: args.expectedReturnType,
        context: args.context,
      });
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.WhileStatement,
        condition: conditionId,
        then: thenScopeId,
        sourceloc: s.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ReturnStatement: {
      if (s.expr) {
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.ReturnStatement,
          expr: Conversion.MakeImplicitConversion(
            sr,
            elaborateExpr(sr, s.expr, {
              context: args.context,
              scope: s.owningScope,
              elaboratedVariables: args.elaboratedVariables,
              isMonomorphized: args.isMonomorphized,
            })[1],
            args.expectedReturnType,
            s.sourceloc
          ),
          sourceloc: s.sourceloc,
        })[1];
      } else {
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.ReturnStatement,
          sourceloc: s.sourceloc,
        })[1];
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.VariableDefinitionStatement: {
      const valueId =
        s.value &&
        elaborateExpr(sr, s.value, {
          context: args.context,
          scope: s.owningScope,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
        })[1];
      const value = valueId && asExpression(sr.nodes.get(valueId));

      if (value?.variant === Semantic.ENode.DatatypeAsValueExpr) {
        throw new CompilerError(
          `A struct/namespace datatype cannot be written into a variable`,
          value.sourceloc
        );
      }

      const collectedVariableSymbol = sr.cc.nodes.get(s.variableSymbol);
      assert(collectedVariableSymbol.variant === Collect.ENode.VariableSymbol);
      const variableSymbolId = args.elaboratedVariables.get(s.variableSymbol);
      assert(variableSymbolId);
      const variableSymbol = sr.nodes.get(variableSymbolId);
      assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);

      if (collectedVariableSymbol.type) {
        variableSymbol.type = lookupAndElaborateDatatype(sr, {
          typeId: collectedVariableSymbol.type,
          elaboratedVariables: args.elaboratedVariables,
          isInCFuncdecl: false,
          context: isolateSubstitutionContext(args.context, {
            currentScope: s.owningScope,
            genericsScope: s.owningScope,
          }),
        });
        assert(variableSymbol.type);
      } else {
        variableSymbol.type = value?.type || null;
      }
      assert(variableSymbol.type);
      variableSymbol.concrete = isTypeConcrete(sr, variableSymbol.type);

      if (variableSymbol.comptime) {
        assert(valueId);
        variableSymbol.comptimeValue = EvalCTFE(sr, valueId)[1];
      }

      return Semantic.addNode(sr, {
        variant: Semantic.ENode.VariableStatement,
        mutability: variableSymbol.mutability,
        comptime: collectedVariableSymbol.comptime,
        name: variableSymbol.name,
        variableSymbol: variableSymbolId,
        value:
          valueId &&
          Conversion.MakeImplicitConversion(sr, valueId, variableSymbol.type, s.sourceloc),
        sourceloc: s.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ExprStatement:
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.ExprStatement,
        expr: elaborateExpr(sr, s.expr, {
          context: args.context,
          scope: s.owningScope,
          isMonomorphized: args.isMonomorphized,
          elaboratedVariables: args.elaboratedVariables,
        })[1],
        sourceloc: s.sourceloc,
      })[1];

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ForEachStatement: {
      if (s.comptime) {
        const [value, valueId] = elaborateExpr(sr, s.value, {
          context: args.context,
          scope: s.owningScope,
          elaboratedVariables: args.elaboratedVariables,
          isMonomorphized: args.isMonomorphized,
        });
        const [comptimeValue, comptimeValueId] = EvalCTFE(sr, valueId);
        if (comptimeValue.variant !== Semantic.ENode.SymbolValueExpr) {
          throw new CompilerError(
            `For each loop over something other than a parameter pack is not implemented yet`,
            s.sourceloc
          );
        }
        const comptimeExpr = sr.nodes.get(comptimeValue.type);
        if (comptimeExpr.variant !== Semantic.ENode.ParameterPackDatatypeSymbol) {
          throw new CompilerError(
            `For each loop over something other than a parameter pack is not implemented yet`,
            s.sourceloc
          );
        }

        if (!sr.syntheticScopeToVariableMap.has(s.body)) {
          sr.syntheticScopeToVariableMap.set(s.body, new Map());
        }
        const syntheticMap = sr.syntheticScopeToVariableMap.get(s.body)!;

        const allScopes: Semantic.Id[] = [];
        for (let i = 0; i < comptimeExpr.parameters.length; i++) {
          const [thenScope, thenScopeId] = Semantic.addNode(sr, {
            variant: Semantic.ENode.BlockScope,
            statements: [],
          });

          const semanticParamId = comptimeExpr.parameters[i];
          const paramValue = sr.nodes.get(semanticParamId);
          assert(paramValue.variant === Semantic.ENode.VariableSymbol);
          assert(paramValue.type);

          syntheticMap.set(s.variable, semanticParamId);
          elaborateBlockScope(sr, {
            targetScopeId: thenScopeId,
            sourceScopeId: s.body,
            expectedReturnType: args.expectedReturnType,
            isMonomorphized: args.isMonomorphized,
            elaboratedVariables: args.elaboratedVariables,
            context: args.context,
          });
          syntheticMap.delete(s.variable);

          allScopes.push(
            Semantic.addNode(sr, {
              variant: Semantic.ENode.BlockScopeStatement,
              block: thenScopeId,
              sourceloc: s.sourceloc,
            })[1]
          );
        }

        return Semantic.addNode(sr, {
          variant: Semantic.ENode.BlockScopeStatement,
          block: Semantic.addNode(sr, {
            variant: Semantic.ENode.BlockScope,
            statements: allScopes,
          })[1],
          sourceloc: s.sourceloc,
        })[1];
      } else {
        assert(false, "Non-comptime for each not implemented yet");
      }
    }

    default:
      assert(false);
  }
}

function elaborateVariableSymbolInScope(
  sr: SemanticResult,
  variableSymbolId: Collect.Id,
  args: {
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    isMonomorphized: boolean;
    context: ElaborationContext;
  }
) {
  const symbol = sr.cc.nodes.get(variableSymbolId);
  switch (symbol.variant) {
    case Collect.ENode.VariableSymbol: {
      let variableContext = EVariableContext.FunctionLocal;
      let type: Semantic.Id | null = null;
      if (symbol.variableContext === EVariableContext.FunctionParameter) {
        variableContext = EVariableContext.FunctionParameter;
        if (!symbol.type) {
          throw new InternalError("Parameter needs datatype");
        }
        const symbolType = sr.cc.nodes.get(symbol.type);
        if (symbolType.variant === Collect.ENode.ParameterPack) {
          // Is elaborated directly in function
          break;
        }
        type = lookupAndElaborateDatatype(sr, {
          typeId: symbol.type,
          isInCFuncdecl: false,
          elaboratedVariables: args.elaboratedVariables,
          context: isolateSubstitutionContext(args.context, {
            genericsScope: symbol.inScope,
            currentScope: symbol.inScope,
          }),
        });
      } else if (symbol.variableContext === EVariableContext.ThisReference) {
        if (args.elaboratedVariables.has(variableSymbolId)) {
          break;
        } else {
          assert(
            false,
            "Variable definition statement for This-Reference was encountered, but it's not yet in the variableMap. It should already be elaborated by the parent."
          );
        }
      }
      const [variable, variableId] = Semantic.addNode(sr, {
        variant: Semantic.ENode.VariableSymbol,
        export: false,
        extern: EExternLanguage.None,
        mutability: symbol.mutability,
        name: symbol.name,
        sourceloc: symbol.sourceloc,
        memberOfStruct: null,
        parentStructOrNS: elaborateParentSymbolFromCache(sr, {
          context: args.context,
          parentScope: symbol.inScope,
        }),
        comptime: symbol.comptime,
        comptimeValue: null,
        variableContext: variableContext,
        type: type,
        concrete: false,
      });
      args.elaboratedVariables.set(variableSymbolId, variableId);
      break;
    }

    default:
      assert(false, symbol.variant.toString());
  }
}

export function elaborateBlockScope(
  sr: SemanticResult,
  args: {
    sourceScopeId: Collect.Id;
    targetScopeId: Semantic.Id;
    expectedReturnType: Semantic.Id;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    isMonomorphized: boolean;
    context: ElaborationContext;
  }
) {
  const scope = sr.cc.nodes.get(args.sourceScopeId);
  assert(scope.variant === Collect.ENode.BlockScope);

  const newElaboratedVariables = new Map<Collect.Id, Semantic.Id>(args.elaboratedVariables);

  for (const sId of scope.symbols) {
    elaborateVariableSymbolInScope(sr, sId, {
      elaboratedVariables: newElaboratedVariables,
      isMonomorphized: args.isMonomorphized,
      context: args.context,
    });
  }

  for (const sId of scope.statements) {
    const statement = elaborateStatement(sr, sId, {
      expectedReturnType: args.expectedReturnType,
      elaboratedVariables: newElaboratedVariables,
      context: args.context,
      isMonomorphized: args.isMonomorphized,
    });
    const blockScope = sr.nodes.get(args.targetScopeId);
    assert(blockScope.variant === Semantic.ENode.BlockScope);
    blockScope.statements.push(statement);
  }
}

export function elaborateFunctionSymbolWithGenerics(
  sr: SemanticResult,
  collectedFunctionSymbolId: Collect.Id,
  args: {
    genericArgs: Semantic.Id[];
    usageSourceLocation: SourceLoc;
    parentStructOrNS: Semantic.Id | null;
    paramPackTypes: Semantic.Id[];
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    isMonomorphized: boolean;
    context: ElaborationContext;
  }
) {
  const func = sr.cc.nodes.get(collectedFunctionSymbolId);
  assert(func.variant === Collect.ENode.FunctionSymbol);

  if (func.generics.length !== args.genericArgs.length) {
    throw new CompilerError(
      `Function ${func.name} expects ${func.generics.length} type parameters but got ${args.genericArgs.length}`,
      args.usageSourceLocation
    );
  }

  if (
    !func.functionScope &&
    (func.generics.length !== 0 || funcSymHasParameterPack(sr.cc, collectedFunctionSymbolId))
  ) {
    throw new CompilerError(
      `Non-Extern function '${func.name}' is generic or uses a parameter pack, but does not define a body. (Generic functions cannot be forward declared)`,
      func.sourceloc
    );
  }

  if (func.generics.length !== 0 || funcSymHasParameterPack(sr.cc, collectedFunctionSymbolId)) {
    assert(func.functionScope);
    args.context = isolateSubstitutionContext(args.context, {
      currentScope: args.context.currentScope,
      genericsScope: args.context.currentScope,
    });
    for (let i = 0; i < func.generics.length; i++) {
      args.context.substitute.set(func.generics[i], args.genericArgs[i]);
    }
  }

  return elaborateFunctionSymbol(sr, collectedFunctionSymbolId, {
    context: args.context,
    elaboratedVariables: args.elaboratedVariables,
    isMonomorphized: args.isMonomorphized,
    paramPackTypes: args.paramPackTypes,
    parentStructOrNS: args.parentStructOrNS,
  });
}

export function elaborateFunctionSymbol(
  sr: SemanticResult,
  collectedFunctionSymbolId: Collect.Id,
  args: {
    parentStructOrNS: Semantic.Id | null;
    paramPackTypes: Semantic.Id[];
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    isMonomorphized: boolean;
    context: ElaborationContext;
  }
): Semantic.Id {
  const func = sr.cc.nodes.get(collectedFunctionSymbolId);
  assert(func.variant === Collect.ENode.FunctionSymbol);

  // The way this works is that first we define all generic substitutions outside of the function in the context,
  // and then we elaborate the function symbol here. For that, we get the raw generics and retrieve substitutions
  // for all of them. All substitutions must be available. This means that the system works very well, because
  // if we elaborate a generic function from itself recursively, we automatically get the correct substitution.
  const genericArgs = func.generics.map((g) => {
    const substitute = args.context.substitute.get(g);
    assert(substitute);
    return substitute;
  });

  for (const s of sr.elaboratedFuncdefSymbols) {
    if (
      s.generics.length === genericArgs.length &&
      s.generics.every((g, index) => g === genericArgs[index]) &&
      s.paramPackTypes.length === args.paramPackTypes.length &&
      s.paramPackTypes.every((g, index) => g === args.paramPackTypes[index]) &&
      s.originalSymbol === collectedFunctionSymbolId
    ) {
      return s.resultSymbol;
    }
  }

  const expectedReturnType = lookupAndElaborateDatatype(sr, {
    typeId: func.returnType,
    context: isolateSubstitutionContext(args.context, {
      genericsScope: func.functionScope || func.parentScope,
      currentScope: func.functionScope || func.parentScope,
    }),
    elaboratedVariables: args.elaboratedVariables,
    isInCFuncdecl: false,
  });

  if (func.vararg && func.extern !== EExternLanguage.Extern_C) {
    throw new CompilerError(
      `A C-Style Vararg parameter pack may only be used on extern "C" functions`,
      func.sourceloc
    );
  }

  let parameterPack = false;
  const parameterNames = func.parameters.map((p) => p.name);
  const parameters = func.parameters
    .map((p, i) => {
      const paramType = sr.cc.nodes.get(p.type);
      if (paramType.variant === Collect.ENode.ParameterPack) {
        if (i !== func.parameters.length - 1) {
          throw new CompilerError(
            `A Parameter Pack may only appear at the very end of the parameter list`,
            func.sourceloc
          );
        }
        if (func.extern !== EExternLanguage.None) {
          throw new CompilerError(
            `A Parameter Pack may not be used on an exported function`,
            func.sourceloc
          );
        }
        parameterPack = true;
        const [paramPack, paramPackId] = Semantic.addNode(sr, {
          variant: Semantic.ENode.ParameterPackDatatypeSymbol,
          parameters: args.paramPackTypes.map((t, i) => {
            const [variable, variableId] = Semantic.addNode(sr, {
              variant: Semantic.ENode.VariableSymbol,
              comptime: true,
              comptimeValue: null,
              concrete: true,
              name: `__param_pack_${i}`,
              export: false,
              extern: EExternLanguage.None,
              memberOfStruct: null,
              mutability: EVariableMutability.Immutable,
              parentStructOrNS: null,
              type: t,
              variableContext: EVariableContext.FunctionParameter,
              sourceloc: func.sourceloc,
            });
            return variableId;
          }),
          concrete: true,
        });
        assert(func.functionScope);
        const functionScope = sr.cc.nodes.get(func.functionScope);
        assert(functionScope.variant === Collect.ENode.FunctionScope);
        const packVariable = [...functionScope.symbols].find((s) => {
          const sym = sr.cc.nodes.get(s);
          return sym.variant === Collect.ENode.VariableSymbol && sym.name === p.name;
        });
        assert(packVariable);
        args.elaboratedVariables.set(packVariable, paramPackId);
        return paramPackId;
      }
      return lookupAndElaborateDatatype(sr, {
        typeId: p.type,
        context: isolateSubstitutionContext(args.context, {
          genericsScope: func.functionScope || func.parentScope,
          currentScope: func.functionScope || func.parentScope,
        }),
        elaboratedVariables: args.elaboratedVariables,
        isInCFuncdecl: false,
      });
    })
    .filter((p) => Boolean(p))
    .map((p) => p!);

  if (func.methodType === EMethodType.Method) {
    parameterNames.unshift("this");
    assert(args.parentStructOrNS);
    const thisReference = makeReferenceDatatypeAvailable(sr, args.parentStructOrNS);
    parameters.unshift(thisReference);
  }

  const ftype = makeFunctionDatatypeAvailable(sr, {
    parameters: parameters,
    returnType: expectedReturnType,
    vararg: func.vararg,
  });

  let [symbol, symbolId] = Semantic.addNode<Semantic.FunctionSymbol>(sr, {
    variant: Semantic.ENode.FunctionSymbol,
    type: ftype,
    export: func.export,
    generics: genericArgs,
    staticMethod: false,
    parameterPack: parameterPack,
    methodOf: args.parentStructOrNS,
    methodType: func.methodType,
    parentStructOrNS: args.parentStructOrNS,
    noemit: func.noemit,
    isMonomorphized: parameterPack || func.generics.length > 0 || args.isMonomorphized,
    extern: func.extern,
    parameterNames: parameterNames,
    name: func.name,
    sourceloc: func.sourceloc,
    scope: null,
    concrete: isTypeConcrete(sr, ftype),
  });

  if (isTypeConcrete(sr, ftype)) {
    sr.elaboratedFuncdefSymbols.push({
      generics: genericArgs,
      originalSymbol: collectedFunctionSymbolId,
      substitutionContext: args.context,
      paramPackTypes: args.paramPackTypes,
      resultSymbol: symbolId,
    });

    if (func.functionScope) {
      const [bodyScope, bodyScopeId] = Semantic.addNode(sr, {
        variant: Semantic.ENode.BlockScope,
        statements: [],
      });

      const functionScope = sr.cc.nodes.get(func.functionScope);
      assert(functionScope.variant === Collect.ENode.FunctionScope);

      const newElaboratedVariables = new Map<Collect.Id, Semantic.Id>(args.elaboratedVariables);

      if (symbol.methodType === EMethodType.Method) {
        const collectedThisRefId = [...functionScope.symbols].find((sId) => {
          const sym = sr.cc.nodes.get(sId);
          return sym.variant === Collect.ENode.VariableSymbol && sym.name === "this";
        });
        assert(collectedThisRefId);
        const collectedThisRef = sr.cc.nodes.get(collectedThisRefId);
        assert(collectedThisRef.variant === Collect.ENode.VariableSymbol);

        assert(symbol.methodOf);
        const thisRef = makeReferenceDatatypeAvailable(sr, symbol.methodOf);
        const [variable, variableId] = Semantic.addNode(sr, {
          variant: Semantic.ENode.VariableSymbol,
          memberOfStruct: symbol.methodOf,
          mutability: collectedThisRef.mutability,
          name: collectedThisRef.name,
          type: thisRef,
          comptime: false,
          comptimeValue: null,
          concrete: isTypeConcrete(sr, thisRef),
          export: false,
          extern: EExternLanguage.None,
          parentStructOrNS: symbol.parentStructOrNS,
          sourceloc: symbol.sourceloc,
          variableContext: EVariableContext.FunctionParameter,
        });
        newElaboratedVariables.set(collectedThisRefId, variableId);
      }

      for (const sId of functionScope.symbols) {
        const symbol = sr.cc.nodes.get(sId);
        if (symbol.variant === Collect.ENode.VariableSymbol) {
          elaborateVariableSymbolInScope(sr, sId, {
            elaboratedVariables: newElaboratedVariables,
            context: args.context,
            isMonomorphized: args.isMonomorphized,
          });
        }
      }

      symbol.scope = bodyScopeId;
      elaborateBlockScope(sr, {
        targetScopeId: bodyScopeId,
        sourceScopeId: functionScope.blockScope,
        expectedReturnType: expectedReturnType,
        elaboratedVariables: newElaboratedVariables,
        isMonomorphized: symbol.isMonomorphized,
        context: args.context,
      });
    }
  }

  return symbolId;
}

export function elaborateNamespace(
  sr: SemanticResult,
  namespaceId: Collect.Id,
  args: {
    context: ElaborationContext;
  }
): Semantic.Id {
  const namespace = sr.cc.nodes.get(namespaceId);
  assert(namespace.variant === Collect.ENode.NamespaceDefinitionSymbol);
  const sharedInstance = sr.cc.nodes.get(namespace.sharedInstance);
  assert(sharedInstance.variant === Collect.ENode.NamespaceSharedInstance);

  for (const s of sr.elaboratedNamespaceSymbols) {
    if (s.originalSharedInstance === namespace.sharedInstance) {
      return s.resultSymbol;
    }
  }

  // const elaborateNestedNamespace = (namespaceId: Collect.Id): Semantic.Id => {
  //   const namespace = sr.cc.nodes.get(namespaceId);
  //   assert(namespace.variant === Collect.ENode.NamespaceDefinitionSymbol);

  //   let parentNamespace = -1 as Semantic.Id;
  //   const parentScope = sr.cc.nodes.get(namespace.parentScope);
  //   if (parentScope.variant === Collect.ENode.NamespaceScope) {
  //     parentNamespace = elaborateNestedNamespace(parentScope.owningSymbol);
  //   }

  // };

  let parentNamespace = null as Semantic.Id | null;
  const parentScope = sr.cc.nodes.get(namespace.parentScope);
  if (parentScope.variant === Collect.ENode.NamespaceScope) {
    parentNamespace = elaborateNamespace(sr, parentScope.owningSymbol, {
      context: args.context,
    });
  }

  const [ns, nsId] = Semantic.addNode<Semantic.NamespaceDatatypeSymbol>(sr, {
    variant: Semantic.ENode.NamespaceDatatype,
    name: namespace.name,
    parentStructOrNS: parentNamespace,
    symbols: [],
    concrete: true,
    collectedNamespace: namespaceId,
  });
  sr.elaboratedNamespaceSymbols.push({
    originalSharedInstance: namespace.sharedInstance,
    resultSymbol: nsId,
  });

  for (const scopeId of sharedInstance.namespaceScopes) {
    const nsScope = sr.cc.nodes.get(scopeId);
    assert(nsScope.variant === Collect.ENode.NamespaceScope);
    for (const symbolId of nsScope.symbols) {
      const sym = elaborateTopLevelSymbol(sr, symbolId, {
        context: makeElaborationContext({
          currentScope: scopeId,
          genericsScope: scopeId,
        }),
      });
      for (const s of sym) {
        ns.symbols.push(s);
      }
    }
  }
  return nsId;
}

export function elaborateTopLevelSymbol(
  sr: SemanticResult,
  nodeId: Collect.Id,
  args: {
    context: ElaborationContext;
  }
): Semantic.Id[] {
  const node = sr.cc.nodes.get(nodeId);
  // const elaborateParentSymbol = (
  //   symbol:
  //     | ASTFunctionDefinition
  //     | ASTNamespaceDefinition
  //     | ASTGlobalVariableDefinition
  //     | ASTStructDefinition
  // ) => {
  //   const parent =
  //     (symbol._collect.definedInNamespaceOrStruct &&
  //       elaborate(sr, {
  //         sourceSymbol: getSymbol(sr.cc, symbol._collect.definedInNamespaceOrStruct),
  //         context: args.context,
  //       })) ||
  //     null;
  //   assert(
  //     !parent || parent.variant === "StructDatatype" || parent.variant === "NamespaceDatatype"
  //   );
  //   return parent;
  // };

  switch (node.variant) {
    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.NamespaceDefinitionSymbol: {
      return [
        elaborateNamespace(sr, nodeId, {
          context: args.context,
        }),
      ];
    }

    case Collect.ENode.FunctionOverloadGroup: {
      const functionSymbols: Semantic.Id[] = [];
      for (const id of node.overloads) {
        const func = sr.cc.nodes.get(id);
        assert(func.variant === Collect.ENode.FunctionSymbol);
        if (func.generics.length === 0 && !funcSymHasParameterPack(sr.cc, id)) {
          const sId = elaborateFunctionSymbol(sr, id, {
            paramPackTypes: [],
            parentStructOrNS: elaborateParentSymbolFromCache(sr, {
              parentScope: func.parentScope,
              context: args.context,
            }),
            isMonomorphized: false,
            elaboratedVariables: new Map(),
            context: args.context,
          });
          functionSymbols.push(sId);
        }
      }
      return functionSymbols;
    }

    case Collect.ENode.StructDefinitionSymbol: {
      // If it's concrete, act as if we tried to use it to elaborate it. If generic, skip
      if (node.generics.length !== 0) {
        return [];
      }
      return [
        instantiateAndElaborateStruct(sr, {
          definedStructTypeId: nodeId,
          context: args.context,
          genericArgs: [],
          elaboratedVariables: new Map(),
          sourceloc: node.sourceloc,
        }),
      ];
    }

    case Collect.ENode.VariableSymbol: {
      assert(node.variableContext === EVariableContext.Global);
      if (sr.elaboratedGlobalVariableSymbols.has(nodeId)) {
        return [sr.elaboratedGlobalVariableSymbols.get(nodeId)!];
      }

      const type =
        (node.type &&
          lookupAndElaborateDatatype(sr, {
            typeId: node.type,
            elaboratedVariables: new Map(),
            isInCFuncdecl: false,
            context: args.context,
          })) ||
        null;

      const variableId = Semantic.addNode(sr, {
        variant: Semantic.ENode.VariableSymbol,
        type: type,
        export: false,
        extern: EExternLanguage.None,
        comptime: node.comptime,
        comptimeValue: null,
        name: node.name,
        memberOfStruct: null,
        mutability: node.mutability,
        variableContext: EVariableContext.Global,
        parentStructOrNS: elaborateParentSymbolFromCache(sr, {
          parentScope: node.inScope,
          context: args.context,
        }),
        sourceloc: node.sourceloc,
        concrete: true,
      })[1];
      sr.elaboratedGlobalVariableSymbols.set(nodeId, variableId);
      return [variableId];
    }

    case Collect.ENode.GlobalVariableDefinition: {
      for (const s of sr.elaboratedGlobalVariableStatements) {
        if (s.originalSymbol === nodeId) {
          return [s.resultSymbol];
        }
      }
      let [elaboratedValue, elaboratedValueId] = [
        undefined as Semantic.Expression | undefined,
        null as Semantic.Id | null,
      ];
      if (node.value) {
        [elaboratedValue, elaboratedValueId] = elaborateExpr(sr, node.value, {
          scope: args.context.currentScope,
          elaboratedVariables: new Map(),
          context: args.context,
          isMonomorphized: false,
        });
      }

      const [variableSymbolId] = elaborateTopLevelSymbol(sr, node.variableSymbol, {
        context: args.context,
      });
      assert(variableSymbolId);
      const variableSymbol = sr.nodes.get(variableSymbolId);
      assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);

      if (!variableSymbol.type && elaboratedValue) {
        variableSymbol.type = elaboratedValue.type;
      }
      assert(variableSymbol.type);
      assert(isTypeConcrete(sr, variableSymbol.type));

      if (variableSymbol.comptime) {
        assert(elaboratedValueId);
        variableSymbol.comptimeValue = EvalCTFE(sr, elaboratedValueId)[1];
      }

      const [s, sId] = Semantic.addNode(sr, {
        variant: Semantic.ENode.GlobalVariableDefinitionSymbol,
        export: variableSymbol.export,
        extern: variableSymbol.extern,
        name: variableSymbol.name,
        comptime: variableSymbol.comptime,
        value: elaboratedValueId,
        sourceloc: node.sourceloc,
        variableSymbol: variableSymbolId,
        parentStructOrNS: variableSymbol.parentStructOrNS,
        concrete: true,
      });
      sr.elaboratedGlobalVariableStatements.push({
        originalSymbol: nodeId,
        resultSymbol: sId,
      });
      return [sId];
    }

    case Collect.ENode.CInjectDirective: {
      const [directive, directiveId] = Semantic.addNode(sr, {
        variant: Semantic.ENode.CInjectDirective,
        value: node.value,
        sourceloc: node.sourceloc,
      });
      sr.cInjections.push(directiveId);
      return [directiveId];
    }

    case Collect.ENode.UnitScope: {
      for (const symbolId of node.symbols) {
        elaborateTopLevelSymbol(sr, symbolId, {
          context: makeElaborationContext({
            currentScope: nodeId,
            genericsScope: nodeId,
          }),
        });
      }
      return [];
    }

    case Collect.ENode.FileScope: {
      for (const symbolId of node.symbols) {
        elaborateTopLevelSymbol(sr, symbolId, {
          context: makeElaborationContext({
            currentScope: nodeId,
            genericsScope: nodeId,
          }),
        });
      }
      return [];
    }

    case Collect.ENode.AliasTypeSymbol:
    case Collect.ENode.TypedefStatement:
    case Collect.ENode.ModuleImport:
    case Collect.ENode.SymbolImport: {
      return [];
    }

    default:
      assert(false, "Global Symbol " + node.variant);
  }
}

export function SemanticallyAnalyze(
  cc: CollectionContext,
  isLibrary: boolean,
  moduleName: string,
  moduleVersion: string
) {
  const sr: SemanticResult = {
    overloadedOperators: [],
    cc: cc,

    elaboratedFunctionSignatures: new Map(),

    elaboratedStructDatatypes: [],
    elaboratedFuncdefSymbols: [],
    elaboratedPrimitiveTypes: [],
    elaboratedNamespaceSymbols: [],
    elaboratedGlobalVariableStatements: [],
    functionTypeCache: [],
    pointerTypeCache: [],
    referenceTypeCache: [],
    arrayTypeCache: [],
    sliceTypeCache: [],

    nodes: new BrandedArray<Semantic.Id, Semantic.Node>([]),

    syntheticScopeToVariableMap: new Map(),

    exportedCollectedSymbols: new Set(),
    elaboratedGlobalVariableSymbols: new Map(),

    cInjections: [],
  };

  const moduleScope = cc.nodes.get(0 as Collect.Id);
  assert(moduleScope.variant === Collect.ENode.ModuleScope);
  for (const symbolId of moduleScope.symbols) {
    elaborateTopLevelSymbol(sr, symbolId, {
      context: makeElaborationContext({
        currentScope: 0 as Collect.Id,
        genericsScope: 0 as Collect.Id,
      }),
    });
  }

  if (moduleName !== HAZE_STDLIB_NAME) {
    const mainGlobalScope = sr.elaboratedNamespaceSymbols.find((s) => {
      const symbol = sr.nodes.get(s.resultSymbol) as Semantic.NamespaceDatatypeSymbol;
      return symbol.name === getModuleGlobalNamespaceName(moduleName, moduleVersion);
    });
    console.info("TODO: Narrow this down so it's not just the name, because it might be nested");
    assert(mainGlobalScope);
    const mainNamespace = sr.nodes.get(mainGlobalScope.resultSymbol);
    assert(mainNamespace.variant === Semantic.ENode.NamespaceDatatype);
    const mainFunction = sr.elaboratedFuncdefSymbols.find((s) => {
      const symbol = sr.nodes.get(s.resultSymbol) as Semantic.FunctionSymbol;
      return symbol.name === "main" && symbol.parentStructOrNS === mainGlobalScope.resultSymbol;
    });
    if (!isLibrary) {
      if (!mainFunction) {
        throw new CompilerError("No main function is defined in global scope", null);
      }

      const mainFunctionSymbol = sr.nodes.get(mainFunction.resultSymbol);
      assert(mainFunctionSymbol.variant === Semantic.ENode.FunctionSymbol);
      const mainFunctionType = sr.nodes.get(mainFunctionSymbol.type);
      assert(mainFunctionType.variant === Semantic.ENode.FunctionDatatype);
      const returnType = sr.nodes.get(mainFunctionType.returnType);
      assert(isType(returnType));
      if (
        returnType.variant !== Semantic.ENode.PrimitiveDatatype ||
        returnType.primitive !== EPrimitive.int
      ) {
        throw new CompilerError("Main function must return int", mainFunctionSymbol.sourceloc);
      }
    } else {
      if (mainFunction) {
        throw new CompilerError(
          "main function is defined, but not allowed because module is built as library",
          null
        );
      }
    }
  }

  return sr;
}

const gray = "\x1b[90m";
const reset = "\x1b[0m";

const print = (str: string, indent = 0, color = reset) => {
  console.info(color + " ".repeat(indent) + str + reset);
};

function printSymbol(sr: SemanticResult, symbolId: Semantic.Id, indent: number) {
  const symbol = sr.nodes.get(symbolId);

  switch (symbol.variant) {
    case Semantic.ENode.NamespaceDatatype:
      print(`Namespace ${symbol.name} {`, indent);
      for (const s of symbol.symbols) {
        printSymbol(sr, s, indent + 2);
      }
      print(`}`, indent);
      break;

    case Semantic.ENode.VariableSymbol:
      print(`Variable Symbol ${symbol.name};`, indent);
      break;

    case Semantic.ENode.FunctionSymbol:
      if (symbol.scope) {
        print(
          `Function ${getParentNames(sr, symbolId)}: ${serializeDatatype(sr, symbol.type)} {`,
          indent
        );
        printSymbol(sr, symbol.scope, indent + 2);
        print(`}`, indent);
      } else {
        print(
          `Function ${getParentNames(sr, symbolId)}: ${serializeDatatype(sr, symbol.type)};`,
          indent
        );
      }
      break;

    case Semantic.ENode.PrimitiveDatatype:
      print(`${serializeDatatype(sr, symbolId)}`, indent);
      break;

    case Semantic.ENode.StructDatatype: {
      print(`Struct ${serializeDatatype(sr, symbolId)} {`, indent);
      for (const memberId of symbol.members) {
        const member = sr.nodes.get(memberId);
        assert(member.variant === Semantic.ENode.VariableSymbol);
        assert(member.type);
        print(`${member.name}: ${serializeDatatype(sr, member.type)}`, indent + 2);
      }
      for (const method of symbol.methods) {
        printSymbol(sr, method, indent + 2);
      }
      print(`}`, indent);
      break;
    }

    case Semantic.ENode.InlineCStatement:
      print(`InlineC "${symbol.value}"`, indent);
      break;

    case Semantic.ENode.ReturnStatement:
      print(`Return ${symbol.expr ? serializeExpr(sr, symbol.expr) : ""}`, indent);
      break;

    case Semantic.ENode.VariableStatement: {
      const variableSymbol = sr.nodes.get(symbol.variableSymbol);
      assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);
      assert(variableSymbol.type);
      print(
        `var ${symbol.name}: ${serializeDatatype(sr, variableSymbol.type)} ${
          symbol.value ? "= " + serializeExpr(sr, symbol.value) : ""
        }`,
        indent
      );
      break;
    }

    case Semantic.ENode.IfStatement:
      print(`If ${serializeExpr(sr, symbol.condition)}`, indent);
      printSymbol(sr, symbol.then, indent + 2);
      for (const elseif of symbol.elseIfs) {
        print(`else if ${serializeExpr(sr, elseif.condition)}`, indent);
        printSymbol(sr, elseif.then, indent + 2);
      }
      if (symbol.else) {
        print(`else`, indent);
        printSymbol(sr, symbol.else, indent + 2);
      }
      break;

    case Semantic.ENode.WhileStatement:
      print(`While ${serializeExpr(sr, symbol.condition)}`, indent);
      printSymbol(sr, symbol.then, indent + 2);
      break;

    case Semantic.ENode.ExprStatement:
      print(`Expr ${serializeExpr(sr, symbol.expr)};`, indent);
      break;

    case Semantic.ENode.BlockScope:
      print("Block {", indent);
      for (const sId of symbol.statements) {
        printSymbol(sr, sId, indent + 2);
      }
      print("}", indent);
      break;

    case Semantic.ENode.BlockScopeStatement:
      printSymbol(sr, symbol.block, indent + 2);
      break;

    default:
      assert(false, "Unhandled case " + symbol.variant);
  }
}

export function PrettyPrintAnalyzed(sr: SemanticResult) {
  // printSymbol(sr.globalNamespace, 0);

  print("");
  print("Elaborated Structs:");
  for (const symbol of sr.elaboratedStructDatatypes) {
    print("");
    printSymbol(sr, symbol.resultSymbol, 0);
  }

  print("Elaborated Functions:");
  for (const symbol of sr.elaboratedFuncdefSymbols) {
    print("");
    printSymbol(sr, symbol.resultSymbol, 0);
  }
  print("\n");
}
