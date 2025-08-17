import { EExternLanguage } from "../shared/AST";
import {
  BrandedArray,
  EMethodType,
  EPrimitive,
  EVariableContext,
  primitiveToString,
} from "../shared/common";
import { assert, CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import { Collect, type CollectionContext } from "../SymbolCollection/SymbolCollection";
import { Conversion } from "./Conversion";
import {
  makeFunctionDatatypeAvailable,
  lookupAndElaborateDatatype,
  instantiateAndElaborateStruct,
  makePointerDatatypeAvailable,
  makeReferenceDatatypeAvailable,
  elaborateParentSymbolFromCache,
} from "./LookupDatatype";
import {
  asExpression,
  asType,
  getExprType,
  isType,
  isTypeConcrete,
  makePrimitiveAvailable,
  Semantic,
  type SemanticResult,
} from "./SemanticSymbols";
import { serializeDatatype, serializeExpr, serializeNestedName } from "./Serialize";

export function tryLookupSymbol(
  cc: CollectionContext,
  name: string,
  args: { startLookupInScope: Collect.Id; sourceloc: SourceLoc; pubRequired?: boolean }
): Collect.Id | undefined {
  const scope = cc.nodes.get(args.startLookupInScope);

  const lookupDirect = (symbols: Collect.Id[]) => {
    for (const id of symbols) {
      const s = cc.nodes.get(id);
      if (s.variant === Collect.ENode.FunctionOverloadGroup && s.name === name) {
        if (
          s.overloads.some((o) => {
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
      } else if (s.variant === Collect.ENode.VariableSymbol && s.name === name) {
        if (!args.pubRequired) {
          return id;
        }
      }
    }
  };

  switch (scope.variant) {
    case Collect.ENode.ModuleScope:
    case Collect.ENode.UnitScope:
      assert(false, "Unreachable");

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
          return found;
        }
      }
      return tryLookupSymbol(cc, name, {
        startLookupInScope: scope.parentScope,
        sourceloc: args.sourceloc,
      });
    }

    case Collect.ENode.FileScope:
    case Collect.ENode.BlockScope:
    case Collect.ENode.StructScope:
    case Collect.ENode.FunctionScope: {
      const found = lookupDirect(scope.symbols);
      if (found) {
        return found;
      }

      if (scope.variant === Collect.ENode.FileScope) {
        // File Scope -> Don't go higher but look in adjacent files in the same unit
        const unitScope = cc.nodes.get(scope.parentScope);
        assert(unitScope.variant === Collect.ENode.UnitScope);

        for (const file of unitScope.files) {
          if (file === args.startLookupInScope) continue; // Prevent infinite recursion with itself

          const fileScope = cc.nodes.get(file);
          assert(fileScope.variant === Collect.ENode.FileScope);

          const found = lookupDirect(fileScope.symbols);
          if (found) {
            return found;
          }
        }

        return undefined;
      } else {
        // Not a file scope -> Can go higher
        return tryLookupSymbol(cc, name, {
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
  cc: CollectionContext,
  name: string,
  args: { startLookupInScope: Collect.Id; sourceloc: SourceLoc }
): Collect.Id {
  const found = tryLookupSymbol(cc, name, args);
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

export type SubstitutionContext = {
  substitute: Map<Collect.Id, Semantic.Id>;
};

export function makeSubstitutionContext(): SubstitutionContext {
  return {
    substitute: new Map(),
  };
}

export function isolateSubstitutionContext(parent: SubstitutionContext): SubstitutionContext {
  return {
    substitute: new Map(parent.substitute),
  };
}

export function mergeSubstitutionContext(
  a: SubstitutionContext,
  b: SubstitutionContext
): SubstitutionContext {
  return {
    substitute: new Map([...a.substitute, ...b.substitute]),
  };
}

function lookupSymbolInNamespaceOrStructScope(
  sr: SemanticResult,
  symbolId: Collect.Id,
  args: {
    name: string;
    expr: Collect.MemberAccessExpr;
    currentFileScope: Collect.Id;
    context: SubstitutionContext;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    scope: Collect.Id;
  }
) {
  const symbol = sr.cc.nodes.get(symbolId);
  if (symbol.variant === Collect.ENode.StructDefinitionSymbol && symbol.name === args.name) {
    const instantiated = instantiateAndElaborateStruct(sr, {
      currentFileScope: args.currentFileScope,
      definedStructTypeId: symbolId,
      elaboratedVariables: args.elaboratedVariables,
      genericArgs: args.expr.genericArgs.map((g) => {
        return lookupAndElaborateDatatype(sr, {
          typeId: g,
          currentFileScope: args.currentFileScope,
          elaboratedVariables: args.elaboratedVariables,
          context: args.context,
          isInCFuncdecl: false,
          startLookupInScopeForGenerics: args.scope,
          startLookupInScopeForSymbol: args.scope,
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
    console.log("TODO: Do overload discrimination here");
    const overloadId = symbol.overloads[0];
    const functionSymbolId = elaborateFunctionSymbol(sr, overloadId, {
      currentFileScope: args.currentFileScope,
      elaboratedVariables: args.elaboratedVariables,
      genericArgs: args.expr.genericArgs.map((g) => {
        return lookupAndElaborateDatatype(sr, {
          typeId: g,
          currentFileScope: args.currentFileScope,
          elaboratedVariables: args.elaboratedVariables,
          context: args.context,
          isInCFuncdecl: false,
          startLookupInScopeForGenerics: args.scope,
          startLookupInScopeForSymbol: args.scope,
        });
      }),
      context: args.context,
      parentStructOrNS: elaborateParentSymbolFromCache(sr, {
        context: args.context,
        currentFileScope: args.currentFileScope,
        parentScope: symbol.parentScope,
      }),
      usageSite: args.expr.sourceloc,
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
    console.log("Warning: Item skipped in namespace access");
    return undefined;
  }
}

function lookupAndElaborateNamespaceMemberAccess(
  sr: SemanticResult,
  namespaceValueId: Semantic.Id,
  args: {
    name: string;
    expr: Collect.MemberAccessExpr;
    currentFileScope: Collect.Id;
    context: SubstitutionContext;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    scope: Collect.Id;
  }
) {
  const namespace = sr.nodes.get(namespaceValueId);
  assert(namespace.variant === Semantic.ENode.NamespaceOrStructValueExpr);
  const collectedNamespace = sr.cc.nodes.get(namespace.collectedNamespaceOrStruct);
  assert(collectedNamespace.variant === Collect.ENode.NamespaceDefinitionSymbol);
  const collectedNSSharedInstance = sr.cc.nodes.get(collectedNamespace.sharedInstance);
  assert(collectedNSSharedInstance.variant === Collect.ENode.NamespaceSharedInstance);

  for (const scopeId of collectedNSSharedInstance.namespaceScopes) {
    const scope = sr.cc.nodes.get(scopeId);
    assert(scope.variant === Collect.ENode.NamespaceScope);
    for (const symbolId of scope.symbols) {
      const s = lookupSymbolInNamespaceOrStructScope(sr, symbolId, {
        context: args.context,
        currentFileScope: args.currentFileScope,
        elaboratedVariables: args.elaboratedVariables,
        expr: args.expr,
        name: args.name,
        scope: args.scope,
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
    currentFileScope: Collect.Id;
    context: SubstitutionContext;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    scope: Collect.Id;
  }
) {
  const namespaceOrStructValue = sr.nodes.get(namespaceOrStructValueId);
  assert(namespaceOrStructValue.variant === Semantic.ENode.NamespaceOrStructValueExpr);
  const collectedStruct = sr.cc.nodes.get(namespaceOrStructValue.collectedNamespaceOrStruct);
  assert(collectedStruct.variant === Collect.ENode.StructDefinitionSymbol);
  const structScope = sr.cc.nodes.get(collectedStruct.structScope);
  assert(structScope.variant === Collect.ENode.StructScope);

  const elaboratedStructCache = sr.elaboratedStructDatatypes.find((d) => {
    return d.resultSymbol === namespaceOrStructValue.elaboratedNamespaceOrStruct;
  });
  assert(elaboratedStructCache);

  for (const symbolId of structScope.symbols) {
    const s = lookupSymbolInNamespaceOrStructScope(sr, symbolId, {
      context: mergeSubstitutionContext(elaboratedStructCache.substitutionContext, args.context),
      currentFileScope: args.currentFileScope,
      elaboratedVariables: args.elaboratedVariables,
      expr: args.expr,
      name: args.name,
      scope: args.scope,
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

export function elaborateExpr(
  sr: SemanticResult,
  exprId: Collect.Id,
  args: {
    scope: Collect.Id;
    context: SubstitutionContext;
    currentFileScope: Collect.Id;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
  }
): [Semantic.Expression, Semantic.Id] {
  const expr = sr.cc.nodes.get(exprId);

  switch (expr.variant) {
    case Collect.ENode.BinaryExpr: {
      const [left, leftId] = elaborateExpr(sr, expr.left, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        scope: args.scope,
      });
      const [right, rightId] = elaborateExpr(sr, expr.right, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        scope: args.scope,
      });
      const leftType = getExprType(sr, leftId);
      const rightType = getExprType(sr, rightId);
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.BinaryExpr,
        left: leftId,
        operation: expr.operation,
        right: rightId,
        type: Conversion.makeBinaryResultType(
          sr,
          leftType,
          rightType,
          expr.operation,
          expr.sourceloc
        ),
        sourceloc: expr.sourceloc,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================
    case Collect.ENode.UnaryExpr: {
      const [e, eId] = elaborateExpr(sr, expr.expr, {
        context: args.context,
        currentFileScope: args.currentFileScope,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
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
        scope: args.scope,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        context: args.context,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ExprCallExpr: {
      const [calledExpr, calledExprId] = elaborateExpr(sr, expr.calledExpr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        scope: args.scope,
      });
      const calledExprType = asType(sr.nodes.get(calledExpr.type));

      const callingArgs = expr.arguments.map(
        (a) =>
          elaborateExpr(sr, a, {
            scope: args.scope,
            currentFileScope: args.currentFileScope,
            elaboratedVariables: args.elaboratedVariables,
            context: args.context,
          })[1]
      );

      const convertArgs = (
        givenArgs: Semantic.Id[],
        requiredTypes: Semantic.Id[],
        vararg: boolean
      ) => {
        if (vararg) {
          if (givenArgs.length < requiredTypes.length) {
            throw new CompilerError(
              `This call requires at least ${requiredTypes.length} arguments but only ${callingArgs.length} were given`,
              calledExpr.sourceloc
            );
          }
        } else {
          if (givenArgs.length !== requiredTypes.length) {
            throw new CompilerError(
              `This call requires ${requiredTypes.length} arguments but ${callingArgs.length} were given`,
              calledExpr.sourceloc
            );
          }
        }
        return givenArgs.map((a, index) => {
          if (index < requiredTypes.length) {
            // console.log(
            //   `Conversion: ${serializeDatatype(a.type)} -> ${serializeDatatype(requiredTypes[index])}`,
            // );
            return Conversion.MakeImplicitConversion(sr, a, requiredTypes[index], expr.sourceloc);
          } else {
            return a;
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
          arguments: convertArgs(callingArgs, parametersWithoutThis, ftype.vararg),
          type: ftype.returnType,
          sourceloc: expr.sourceloc,
        });
      }

      if (calledExprType.variant === Semantic.ENode.FunctionDatatype) {
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.ExprCallExpr,
          calledExpr: calledExprId,
          arguments: convertArgs(callingArgs, calledExprType.parameters, calledExprType.vararg),
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
            callingArgs,
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

      const symbolId = lookupSymbol(sr.cc, expr.name, {
        startLookupInScope: args.scope,
        sourceloc: expr.sourceloc,
      });
      const symbol = sr.cc.nodes.get(symbolId);
      if (symbol.variant === Collect.ENode.VariableSymbol) {
        let elaboratedSymbolId = undefined as Semantic.Id | undefined;
        if (symbol.variableContext === EVariableContext.Global) {
          // In case it's not elaborated yet, may happen
          elaborateGlobalSymbol(sr, symbolId, {
            currentFileScope: args.currentFileScope,
          });
          elaboratedSymbolId = sr.elaboratedGlobalVariableSymbols.get(symbolId);
        } else {
          elaboratedSymbolId = args.elaboratedVariables.get(symbolId);
        }
        assert(elaboratedSymbolId, "Variable was not elaborated here: " + symbol.name);
        const elaboratedSymbol = sr.nodes.get(elaboratedSymbolId);
        assert(elaboratedSymbol.variant === Semantic.ENode.VariableSymbol);
        assert(elaboratedSymbol.type);
        if (expr.genericArgs.length !== 0) {
          throw new CompilerError(
            `A variable access cannot have a type parameter list`,
            expr.sourceloc
          );
        }
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.SymbolValueExpr,
          symbol: elaboratedSymbolId,
          type: elaboratedSymbol.type,
          sourceloc: expr.sourceloc,
        });
      } else if (symbol.variant === Collect.ENode.GlobalVariableDefinition) {
        const [elaboratedSymbolId] = elaborateGlobalSymbol(sr, symbolId, {
          currentFileScope: args.currentFileScope,
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
        console.log("TODO: Implement function overload resolution here");
        const chosenOverload = symbol.overloads[0];
        const elaboratedSymbolId = elaborateFunctionSymbol(sr, chosenOverload, {
          elaboratedVariables: args.elaboratedVariables,
          genericArgs: expr.genericArgs.map((g) => {
            return lookupAndElaborateDatatype(sr, {
              typeId: g,
              context: args.context,
              currentFileScope: args.currentFileScope,
              elaboratedVariables: args.elaboratedVariables,
              isInCFuncdecl: false,
              startLookupInScopeForGenerics: args.scope,
              startLookupInScopeForSymbol: args.scope,
            });
          }),
          usageSite: expr.sourceloc,
          context: args.context,
          currentFileScope: args.currentFileScope,
          parentStructOrNS: elaborateParentSymbolFromCache(sr, {
            context: args.context,
            currentFileScope: args.currentFileScope,
            parentScope: symbol.parentScope,
          }),
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
        const [elaboratedSymbolId] = elaborateGlobalSymbol(sr, symbolId, {
          currentFileScope: args.currentFileScope,
        });
        assert(elaboratedSymbolId);
        const elaboratedSymbol = sr.nodes.get(elaboratedSymbolId);
        assert(
          elaboratedSymbol.variant === Semantic.ENode.NamespaceDatatype ||
            elaboratedSymbol.variant === Semantic.ENode.StructDatatype
        );
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.NamespaceOrStructValueExpr,
          elaboratedNamespaceOrStruct: elaboratedSymbolId,
          collectedNamespaceOrStruct: symbolId,
          type: elaboratedSymbolId,
          sourceloc: expr.sourceloc,
        });
      } else {
        throw new CompilerError(`Symbol cannot be used as a value`, expr.sourceloc);
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.PointerAddressOfExpr: {
      const [_expr, exprId] = elaborateExpr(sr, expr.expr, {
        context: args.context,
        currentFileScope: args.currentFileScope,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
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
        scope: args.scope,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        context: args.context,
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
          startLookupInScopeForGenerics: args.scope,
          startLookupInScopeForSymbol: args.scope,
          currentFileScope: args.currentFileScope,
          elaboratedVariables: args.elaboratedVariables,
          isInCFuncdecl: false,
          context: args.context,
        }),
        expr: elaborateExpr(sr, expr.expr, {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          currentFileScope: args.currentFileScope,
          scope: args.scope,
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
        scope: args.scope,
        currentFileScope: args.currentFileScope,
        context: args.context,
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
        currentFileScope: args.currentFileScope,
        scope: args.scope,
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
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        scope: args.scope,
      });
      let objectType = asType(sr.nodes.get(object.type));

      if (objectType.variant === Semantic.ENode.ReferenceDatatype) {
        objectType = asType(sr.nodes.get(objectType.referee));
      }

      if (object.variant === Semantic.ENode.NamespaceOrStructValueExpr) {
        const namespaceOrStruct = sr.cc.nodes.get(object.collectedNamespaceOrStruct);
        if (namespaceOrStruct.variant === Collect.ENode.NamespaceDefinitionSymbol) {
          return lookupAndElaborateNamespaceMemberAccess(sr, objectId, {
            expr: expr,
            context: args.context,
            currentFileScope: args.currentFileScope,
            elaboratedVariables: args.elaboratedVariables,
            scope: args.scope,
            name: expr.memberName,
          });
        } else {
          return lookupAndElaborateStaticStructAccess(sr, objectId, {
            expr: expr,
            context: args.context,
            currentFileScope: args.currentFileScope,
            elaboratedVariables: args.elaboratedVariables,
            scope: args.scope,
            name: expr.memberName,
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
      const overloadGroupId = structScope.symbols.find((mId) => {
        const m = sr.cc.nodes.get(mId);
        return m.variant === Collect.ENode.FunctionOverloadGroup && m.name === expr.memberName;
      });

      if (overloadGroupId) {
        console.log("TODO: Fix overload resolution here ");
        const overloadGroup = sr.cc.nodes.get(overloadGroupId);
        assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroup);
        const collectedMethodId = overloadGroup.overloads[0];

        const elaboratedStructCache = sr.elaboratedStructDatatypes.find(
          (d) => d.resultSymbol === object.type
        );
        assert(elaboratedStructCache);

        console.log("Member access", expr.memberName);
        const elaboratedMethodId = elaborateFunctionSymbol(sr, collectedMethodId, {
          context: mergeSubstitutionContext(
            elaboratedStructCache.substitutionContext,
            args.context
          ),
          genericArgs: expr.genericArgs.map((g) => {
            return lookupAndElaborateDatatype(sr, {
              typeId: g,
              context: elaboratedStructCache.substitutionContext,
              currentFileScope: args.currentFileScope,
              elaboratedVariables: args.elaboratedVariables,
              isInCFuncdecl: false,
              startLookupInScopeForGenerics: args.scope,
              startLookupInScopeForSymbol: args.scope,
            });
          }),
          usageSite: expr.sourceloc,
          currentFileScope: args.currentFileScope,
          elaboratedVariables: args.elaboratedVariables,
          parentStructOrNS: object.type,
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
        scope: args.scope,
        currentFileScope: args.currentFileScope,
      });
      const [target, targetId] = elaborateExpr(sr, expr.expr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        scope: args.scope,
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

    case Collect.ENode.StructInstantiationExpr: {
      const structId = lookupAndElaborateDatatype(sr, {
        typeId: expr.structType,
        currentFileScope: args.currentFileScope,
        elaboratedVariables: args.elaboratedVariables,
        startLookupInScopeForGenerics: args.scope,
        startLookupInScopeForSymbol: args.scope,
        isInCFuncdecl: false,
        context: args.context,
      });
      const struct = sr.nodes.get(structId);
      assert(struct.variant === Semantic.ENode.StructDatatype);

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
        const [e, eId] = elaborateExpr(sr, m.value, {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          currentFileScope: args.currentFileScope,
          scope: args.scope,
        });

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

      if (remainingMembers.length > 0) {
        throw new CompilerError(
          `Members ${remainingMembers.join(", ")} were not assigned`,
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
    context: SubstitutionContext;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    currentFileScope: Collect.Id;
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

    case Collect.ENode.IfStatement: {
      const [condition, conditionId] = elaborateExpr(sr, s.condition, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        scope: s.owningScope,
      });
      const [thenScope, thenScopeId] = Semantic.addNode(sr, {
        variant: Semantic.ENode.BlockScope,
        statements: [],
      });
      elaborateBlockScope(sr, {
        targetScopeId: thenScopeId,
        sourceScopeId: s.thenBlock,
        expectedReturnType: args.expectedReturnType,
        currentFileScope: args.currentFileScope,
        elaboratedVariables: args.elaboratedVariables,
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
          currentFileScope: args.currentFileScope,
          expectedReturnType: args.expectedReturnType,
          elaboratedVariables: args.elaboratedVariables,
          context: args.context,
        });
        return {
          condition: elaborateExpr(sr, e.condition, {
            context: args.context,
            elaboratedVariables: args.elaboratedVariables,
            scope: s.owningScope,
            currentFileScope: args.currentFileScope,
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
          currentFileScope: args.currentFileScope,
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

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.WhileStatement: {
      const [condition, conditionId] = elaborateExpr(sr, s.condition, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: s.owningScope,
        currentFileScope: args.currentFileScope,
      });
      const [thenScope, thenScopeId] = Semantic.addNode(sr, {
        variant: Semantic.ENode.BlockScope,
        statements: [],
      });
      elaborateBlockScope(sr, {
        targetScopeId: thenScopeId,
        sourceScopeId: s.block,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
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
              elaboratedVariables: args.elaboratedVariables,
              scope: s.owningScope,
              currentFileScope: args.currentFileScope,
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
          elaboratedVariables: args.elaboratedVariables,
          scope: s.owningScope,
          currentFileScope: args.currentFileScope,
        })[1];
      const value = valueId && asExpression(sr.nodes.get(valueId));

      if (value?.variant === Semantic.ENode.NamespaceOrStructValueExpr) {
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
          currentFileScope: args.currentFileScope,
          elaboratedVariables: args.elaboratedVariables,
          startLookupInScopeForGenerics: s.owningScope,
          startLookupInScopeForSymbol: s.owningScope,
          isInCFuncdecl: false,
          context: args.context,
        });
        assert(variableSymbol.type);
      } else {
        variableSymbol.type = value?.type || null;
      }
      assert(variableSymbol.type);
      variableSymbol.concrete = isTypeConcrete(sr, variableSymbol.type);

      return Semantic.addNode(sr, {
        variant: Semantic.ENode.VariableStatement,
        mutability: variableSymbol.mutability,
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
          scope: s.owningScope,
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          currentFileScope: args.currentFileScope,
        })[1],
        sourceloc: s.sourceloc,
      })[1];

    default:
      assert(false);
  }
}

function elaborateVariableSymbolInScope(
  sr: SemanticResult,
  variableSymbolId: Collect.Id,
  args: {
    currentFileScope: Collect.Id;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    context: SubstitutionContext;
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
        type = lookupAndElaborateDatatype(sr, {
          typeId: symbol.type,
          startLookupInScopeForGenerics: symbol.inScope,
          startLookupInScopeForSymbol: symbol.inScope,
          isInCFuncdecl: false,
          currentFileScope: args.currentFileScope,
          elaboratedVariables: args.elaboratedVariables,
          context: args.context,
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
          currentFileScope: args.currentFileScope,
          parentScope: symbol.inScope,
        }),
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
    currentFileScope: Collect.Id;
    expectedReturnType: Semantic.Id;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    context: SubstitutionContext;
  }
) {
  const scope = sr.cc.nodes.get(args.sourceScopeId);
  assert(scope.variant === Collect.ENode.BlockScope);

  const newElaboratedVariables = new Map<Collect.Id, Semantic.Id>(args.elaboratedVariables);

  for (const sId of scope.symbols) {
    elaborateVariableSymbolInScope(sr, sId, {
      elaboratedVariables: newElaboratedVariables,
      currentFileScope: args.currentFileScope,
      context: args.context,
    });
  }

  for (const sId of scope.statements) {
    const statement = elaborateStatement(sr, sId, {
      expectedReturnType: args.expectedReturnType,
      elaboratedVariables: newElaboratedVariables,
      currentFileScope: args.currentFileScope,
      context: args.context,
    });
    const blockScope = sr.nodes.get(args.targetScopeId);
    assert(blockScope.variant === Semantic.ENode.BlockScope);
    blockScope.statements.push(statement);
  }
}

export function elaborateFunctionSymbol(
  sr: SemanticResult,
  collectedFunctionSymbolId: Collect.Id,
  args: {
    genericArgs: Semantic.Id[];
    usageSite: SourceLoc;
    currentFileScope: Collect.Id;
    parentStructOrNS: Semantic.Id | null;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    context: SubstitutionContext;
  }
): Semantic.Id {
  for (const s of sr.elaboratedFuncdefSymbols) {
    if (
      s.generics.length === args.genericArgs.length &&
      s.generics.every((g, index) => g === args.genericArgs[index]) &&
      s.originalSymbol === collectedFunctionSymbolId
    ) {
      return s.resultSymbol;
    }
  }

  const func = sr.cc.nodes.get(collectedFunctionSymbolId);
  assert(func.variant === Collect.ENode.FunctionSymbol);

  const overloadGroup = sr.cc.nodes.get(func.overloadGroup);
  assert(overloadGroup.variant === Collect.ENode.FunctionOverloadGroup);

  if (func.generics.length !== args.genericArgs.length) {
    throw new CompilerError(
      `Function ${overloadGroup.name} expects ${func.generics.length} type parameters but got ${args.genericArgs.length}`,
      args.usageSite
    );
  }

  // New local substitution context
  const substitutionContext = isolateSubstitutionContext(args.context);
  for (let i = 0; i < func.generics.length; i++) {
    substitutionContext.substitute.set(func.generics[i], args.genericArgs[i]);
  }

  const expectedReturnType = lookupAndElaborateDatatype(sr, {
    typeId: func.returnType,
    context: substitutionContext,
    currentFileScope: args.currentFileScope,
    elaboratedVariables: args.elaboratedVariables,
    isInCFuncdecl: false,
    startLookupInScopeForGenerics: func.functionScope || func.parentScope,
    startLookupInScopeForSymbol: func.functionScope || func.parentScope,
  });

  const parameterNames = func.parameters.map((p) => p.name);
  const parameters = func.parameters.map((p) =>
    lookupAndElaborateDatatype(sr, {
      typeId: p.type,
      context: substitutionContext,
      currentFileScope: args.currentFileScope,
      elaboratedVariables: args.elaboratedVariables,
      isInCFuncdecl: false,
      startLookupInScopeForGenerics: func.functionScope || func.parentScope,
      startLookupInScopeForSymbol: func.functionScope || func.parentScope,
    })
  );

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
    generics: args.genericArgs,
    staticMethod: false,
    methodOf: args.parentStructOrNS,
    methodType: func.methodType,
    parentStructOrNS: args.parentStructOrNS,
    noemit: func.noemit,
    extern: func.extern,
    // operatorOverloading: func.operatorOverloading && {
    //   asTarget: lookupAndElaborateDatatype(
    //     sr,
    //     (() => {
    //       assert(args.usageInScope);
    //       return {
    //         type: args.sourceSymbol.operatorOverloading.asTarget,
    //         startLookupInScope: args.usageInScope,
    //         isInCFuncdecl: false,
    //         context: substitutionContext,
    //       };
    //     })()
    //   ),
    //   operator: args.sourceSymbol.operatorOverloading.operator,
    // },
    parameterNames: parameterNames,
    name: overloadGroup.name,
    sourceloc: func.sourceloc,
    scope: null,
    concrete: isTypeConcrete(sr, ftype),
  });

  if (isTypeConcrete(sr, ftype)) {
    sr.elaboratedFuncdefSymbols.push({
      generics: args.genericArgs,
      originalSymbol: collectedFunctionSymbolId,
      substitutionContext: substitutionContext,
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
        const collectedThisRefId = functionScope.symbols.find((sId) => {
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
            currentFileScope: args.currentFileScope,
            context: substitutionContext,
          });
        }
      }

      symbol.scope = bodyScopeId;
      elaborateBlockScope(sr, {
        targetScopeId: bodyScopeId,
        sourceScopeId: functionScope.blockScope,
        expectedReturnType: expectedReturnType,
        elaboratedVariables: newElaboratedVariables,
        currentFileScope: args.currentFileScope,
        context: substitutionContext,
      });
    }
  }

  return symbolId;
}

export function elaborateNamespace(
  sr: SemanticResult,
  namespaceId: Collect.Id,
  args: {
    currentFileScope: Collect.Id;
    context: SubstitutionContext;
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
      currentFileScope: args.currentFileScope,
    });
  }

  const [ns, nsId] = Semantic.addNode<Semantic.NamespaceDatatypeSymbol>(sr, {
    variant: Semantic.ENode.NamespaceDatatype,
    name: namespace.name,
    parentStructOrNS: parentNamespace,
    symbols: [],
    concrete: true,
  });
  sr.elaboratedNamespaceSymbols.push({
    originalSharedInstance: namespace.sharedInstance,
    resultSymbol: nsId,
  });

  for (const scopeId of sharedInstance.namespaceScopes) {
    const nsScope = sr.cc.nodes.get(scopeId);
    assert(nsScope.variant === Collect.ENode.NamespaceScope);
    for (const symbolId of nsScope.symbols) {
      const sym = elaborateGlobalSymbol(sr, symbolId, {
        currentFileScope: args.currentFileScope,
      });
      for (const s of sym) {
        ns.symbols.push(s);
      }
    }
  }
  return nsId;
}

export function elaborateGlobalSymbol(
  sr: SemanticResult,
  nodeId: Collect.Id,
  args: {
    currentFileScope: Collect.Id;
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
          currentFileScope: args.currentFileScope,
          context: makeSubstitutionContext(),
        }),
      ];
    }

    case Collect.ENode.FunctionOverloadGroup: {
      const functionSymbols: Semantic.Id[] = [];
      for (const id of node.overloads) {
        const func = sr.cc.nodes.get(id);
        assert(func.variant === Collect.ENode.FunctionSymbol);
        if (func.generics.length === 0) {
          const sId = elaborateFunctionSymbol(sr, id, {
            genericArgs: [],
            parentStructOrNS: elaborateParentSymbolFromCache(sr, {
              parentScope: func.parentScope,
              context: makeSubstitutionContext(),
              currentFileScope: args.currentFileScope,
            }),
            usageSite: func.sourceloc,
            currentFileScope: args.currentFileScope,
            elaboratedVariables: new Map(),
            context: makeSubstitutionContext(),
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
          context: makeSubstitutionContext(),
          genericArgs: [],
          elaboratedVariables: new Map(),
          currentFileScope: args.currentFileScope,
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
            startLookupInScopeForGenerics: args.currentFileScope,
            startLookupInScopeForSymbol: args.currentFileScope,
            elaboratedVariables: new Map(),
            currentFileScope: args.currentFileScope,
            isInCFuncdecl: false,
            context: makeSubstitutionContext(),
          })) ||
        null;

      const variableId = Semantic.addNode(sr, {
        variant: Semantic.ENode.VariableSymbol,
        type: type,
        export: false,
        extern: EExternLanguage.None,
        name: node.name,
        memberOfStruct: null,
        mutability: node.mutability,
        variableContext: EVariableContext.Global,
        parentStructOrNS: elaborateParentSymbolFromCache(sr, {
          currentFileScope: args.currentFileScope,
          parentScope: node.inScope,
          context: makeSubstitutionContext(),
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
          scope: args.currentFileScope,
          elaboratedVariables: new Map(),
          context: makeSubstitutionContext(),
          currentFileScope: args.currentFileScope,
        });
      }

      const [variableSymbolId] = elaborateGlobalSymbol(sr, node.variableSymbol, {
        currentFileScope: args.currentFileScope,
      });
      assert(variableSymbolId);
      const variableSymbol = sr.nodes.get(variableSymbolId);
      assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);

      if (!variableSymbol.type && elaboratedValue) {
        variableSymbol.type = elaboratedValue.type;
      }
      assert(variableSymbol.type);
      assert(isTypeConcrete(sr, variableSymbol.type));

      const [s, sId] = Semantic.addNode(sr, {
        variant: Semantic.ENode.GlobalVariableDefinitionSymbol,
        export: variableSymbol.export,
        extern: variableSymbol.extern,
        name: variableSymbol.name,
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
      return [
        Semantic.addNode(sr, {
          variant: Semantic.ENode.InlineCStatement,
          value: node.value,
          sourceloc: node.sourceloc,
        })[1],
      ];
    }

    default:
      assert(false, "Global Symbol " + node.variant);
  }
}

export function SemanticallyAnalyze(cc: CollectionContext, isLibrary: boolean) {
  const sr: SemanticResult = {
    overloadedOperators: [],
    cc: cc,

    elaboratedStructDatatypes: [],
    elaboratedFuncdefSymbols: [],
    elaboratedPrimitiveTypes: [],
    elaboratedNamespaceSymbols: [],
    elaboratedGlobalVariableStatements: [],
    functionTypeCache: [],
    rawPointerTypeCache: [],
    referenceTypeCache: [],

    nodes: new BrandedArray<Semantic.Id, Semantic.Node>([]),

    exportedCollectedSymbols: new Set(),
    elaboratedGlobalVariableSymbols: new Map(),

    cInjections: new Set(),
  };

  const moduleScope = cc.nodes.get(0 as Collect.Id);
  assert(moduleScope.variant === Collect.ENode.ModuleScope);
  for (const unitId of moduleScope.units) {
    const unit = cc.nodes.get(unitId);
    assert(unit.variant === Collect.ENode.UnitScope);
    for (const fileId of unit.files) {
      const fileScope = cc.nodes.get(fileId);
      assert(fileScope.variant === Collect.ENode.FileScope);
      for (const symbolId of fileScope.symbols) {
        elaborateGlobalSymbol(sr, symbolId, {
          currentFileScope: fileId,
        });
      }
    }
  }

  const mainFunction = sr.elaboratedFuncdefSymbols.find((s) => {
    const symbol = sr.nodes.get(s.resultSymbol) as Semantic.FunctionSymbol;
    return symbol.name === "main" && symbol.parentStructOrNS === null;
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

  return sr;
}

const gray = "\x1b[90m";
const reset = "\x1b[0m";

const print = (str: string, indent = 0, color = reset) => {
  console.log(color + " ".repeat(indent) + str + reset);
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
        print(`Function ${symbol.name}: ${serializeDatatype(sr, symbol.type)} {`, indent);
        printSymbol(sr, symbol.scope, indent + 2);
        print(`}`, indent);
      } else {
        print(`Function ${symbol.name}: ${serializeDatatype(sr, symbol.type)};`, indent);
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
      print(`If ${serializeExpr(sr, symbol.condition)} {`, indent);
      printSymbol(sr, symbol.then, indent + 2);
      for (const elseif of symbol.elseIfs) {
        print(`} else if ${serializeExpr(sr, elseif.condition)} {`, indent);
        printSymbol(sr, elseif.then, indent + 2);
      }
      if (symbol.else) {
        print(`} else {`, indent);
        printSymbol(sr, symbol.else, indent + 2);
      }
      print(`}`, indent);
      break;

    case Semantic.ENode.WhileStatement:
      print(`While ${serializeExpr(sr, symbol.condition)} {`, indent);
      printSymbol(sr, symbol.then, indent + 2);
      print(`}`, indent);
      break;

    case Semantic.ENode.ExprStatement:
      print(`Expr ${serializeExpr(sr, symbol.expr)};`, indent);
      break;

    case Semantic.ENode.BlockScope:
      for (const sId of symbol.statements) {
        printSymbol(sr, sId, indent + 2);
      }
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
