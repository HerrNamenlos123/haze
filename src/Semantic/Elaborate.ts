import { EExternLanguage } from "../shared/AST";
import { BrandedArray, EVariableContext, primitiveToString } from "../shared/common";
import { assert, CompilerError, InternalError, type SourceLoc } from "../shared/Errors";
import { Collect, type CollectionContext } from "../SymbolCollection/SymbolCollection";
import { Conversion } from "./Conversion";
import {
  makeFunctionDatatypeAvailable,
  lookupAndElaborateDatatype,
  instantiateAndElaborateStruct,
  makePointerDatatypeAvailable,
} from "./LookupDatatype";
import {
  asExpression,
  asType,
  getExprType,
  isExpression,
  isTypeConcrete,
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
          return s.sharedInstance;
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

export function isolateElaborationContext(parent: SubstitutionContext): SubstitutionContext {
  return {
    substitute: new Map(parent.substitute),
  };
}

export function elaborateExpr(
  sr: SemanticResult,
  exprId: Collect.Id,
  args: {
    scope: Collect.Id;
    context: SubstitutionContext;
    currentFileScope: Collect.Id;
    parentStructOrNS: Semantic.Id | null;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
  }
): Semantic.Id {
  const expr = sr.cc.nodes.get(exprId);

  switch (expr.variant) {
    case Collect.ENode.BinaryExpr: {
      const left = elaborateExpr(sr, expr.left, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        parentStructOrNS: args.parentStructOrNS,
        scope: args.scope,
      });
      const right = elaborateExpr(sr, expr.right, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        parentStructOrNS: args.parentStructOrNS,
        scope: args.scope,
      });
      const leftType = getExprType(sr, left);
      const rightType = getExprType(sr, right);
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.BinaryExpr,
        left: left,
        operation: expr.operation,
        right: right,
        type: Conversion.makeBinaryResultType(
          sr,
          leftType,
          rightType,
          expr.operation,
          expr.sourceloc
        ),
        sourceloc: expr.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================
    case Collect.ENode.UnaryExpr: {
      const e = elaborateExpr(sr, expr.expr, {
        context: args.context,
        currentFileScope: args.currentFileScope,
        parentStructOrNS: args.parentStructOrNS,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });

      const type = getExprType(sr, e);
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.UnaryExpr,
        expr: e,
        operation: expr.operation,
        type: Conversion.makeUnaryResultType(sr, type, expr.operation, expr.sourceloc),
        sourceloc: expr.sourceloc,
      })[1];
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.LiteralExpr: {
      assert(false);
      // if (expr.literal.variant === "BooleanConstant") {
      //   return {
      //     variant: "Constant",
      //     type: makePrimitiveAvailable(sr, EPrimitive.boolean),
      //     value: expr.literal.value,
      //     sourceloc: expr.sourceloc,
      //   };
      // } else if (expr.literal.variant === "NumberConstant") {
      //   function isFloat(n: number): boolean {
      //     return Number(n) === n && n % 1 !== 0;
      //   }
      //   if (isFloat(expr.literal.value)) {
      //     return {
      //       variant: "Constant",
      //       type: makePrimitiveAvailable(sr, EPrimitive.f64),
      //       value: expr.literal.value,
      //       sourceloc: expr.sourceloc,
      //     };
      //   } else {
      //     let type = EPrimitive.i8;
      //     if (expr.literal.value >= -Math.pow(2, 7) && expr.literal.value <= Math.pow(2, 7) - 1) {
      //       type = EPrimitive.i8;
      //     } else if (
      //       expr.literal.value >= -Math.pow(2, 15) &&
      //       expr.literal.value <= Math.pow(2, 15) - 1
      //     ) {
      //       type = EPrimitive.i16;
      //     } else if (
      //       expr.literal.value >= -Math.pow(2, 31) &&
      //       expr.literal.value <= Math.pow(2, 31) - 1
      //     ) {
      //       type = EPrimitive.i32;
      //     } else if (
      //       expr.literal.value >= -Math.pow(2, 63) &&
      //       expr.literal.value <= Math.pow(2, 63) - 1
      //     ) {
      //       type = EPrimitive.i64;
      //     } else {
      //       throw new CompilerError(
      //         `The numeral constant ${expr.literal.value} is outside of any workable integer range`,
      //         expr.sourceloc
      //       );
      //     }
      //     return {
      //       variant: "Constant",
      //       type: makePrimitiveAvailable(sr, type),
      //       value: expr.literal.value,
      //       sourceloc: expr.sourceloc,
      //     };
      //   }
      // } else {
      //   return {
      //     variant: "Constant",
      //     type: makePrimitiveAvailable(sr, EPrimitive.str),
      //     value: expr.literal.value,
      //     sourceloc: expr.sourceloc,
      //   };
      // }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ParenthesisExpr: {
      return elaborateExpr(sr, expr.expr, {
        scope: args.scope,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        parentStructOrNS: args.parentStructOrNS,
        context: args.context,
      });
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ExprCallExpr: {
      const calledExprId = elaborateExpr(sr, expr.calledExpr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        parentStructOrNS: args.parentStructOrNS,
        scope: args.scope,
      });
      const calledExpr = asExpression(sr.nodes.get(calledExprId));
      const calledExprType = asType(sr.nodes.get(calledExpr.type));

      const callingArgs = expr.arguments.map((a) =>
        elaborateExpr(sr, a, {
          scope: args.scope,
          currentFileScope: args.currentFileScope,
          parentStructOrNS: args.parentStructOrNS,
          elaboratedVariables: args.elaboratedVariables,
          context: args.context,
        })
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
        })[1];
      }

      if (calledExprType.variant === Semantic.ENode.FunctionDatatype) {
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.ExprCallExpr,
          calledExpr: calledExprId,
          arguments: convertArgs(callingArgs, calledExprType.parameters, calledExprType.vararg),
          type: calledExprType.returnType,
          sourceloc: expr.sourceloc,
        })[1];
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
        })[1];
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
      if (symbol.variant === Collect.ENode.VariableDefinitionStatement) {
        const elaboratedSymbolId = args.elaboratedVariables.get(symbolId);
        assert(elaboratedSymbolId);
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
        })[1];
      } else if (symbol.variant === Collect.ENode.GlobalVariableDefinition) {
        const [elaboratedSymbolId] = elaborateGlobalSymbol(sr, symbolId, {
          currentFileScope: args.currentFileScope,
          parentStructOrNS: args.parentStructOrNS,
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
        })[1];
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
              parentStructOrNS: args.parentStructOrNS,
              startLookupInScope: args.scope,
            });
          }),
          usageSite: expr.sourceloc,
          context: args.context,
          currentFileScope: args.currentFileScope,
          parentStructOrNS: args.parentStructOrNS,
        });
        assert(elaboratedSymbolId);
        const elaboratedSymbol = sr.nodes.get(elaboratedSymbolId);
        assert(elaboratedSymbol.variant === Semantic.ENode.FunctionSymbol);
        return Semantic.addNode(sr, {
          variant: Semantic.ENode.SymbolValueExpr,
          symbol: elaboratedSymbolId,
          type: elaboratedSymbol.type,
          sourceloc: expr.sourceloc,
        })[1];
      } else if (
        symbol.variant === Collect.ENode.StructDefinitionSymbol ||
        symbol.variant === Collect.ENode.NamespaceDefinitionSymbol
      ) {
        // This is for static function calls like Arena.create(); -> "Arena" is now a NamespaceValue
        assert(false, "Not implemented");
        const elaboratedSymbol = elaborateGlobalSymbol(sr, {
          sourceSymbol: symbol,
          usageGenerics: expr.generics,
          usageInScope: args.scope.id,
          usedAt: expr.sourceloc,
          context: makeSubstitutionContext(),
        });
        assert(
          elaboratedSymbol?.variant === "NamespaceDatatype" ||
            elaboratedSymbol?.variant === "StructDatatype"
        );
        return {
          variant: "NamespaceValue",
          symbol: elaboratedSymbol,
          type: elaboratedSymbol,
          sourceloc: expr.sourceloc,
        };
      } else {
        throw new CompilerError(`Symbol cannot be used as a value`, expr.sourceloc);
      }
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.PointerAddressOfExpr: {
      const _expr = elaborateExpr(sr, expr.expr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });
      return {
        variant: "RawPointerAddressOf",
        type: makePointerDatatypeAvailable(sr, _expr.type),
        expr: _expr,
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.PointerDereferenceExpr: {
      const _expr = elaborateExpr(sr, expr.expr, {
        scope: args.scope,
        elaboratedVariables: args.elaboratedVariables,
        context: args.context,
      });
      if (_expr.type.variant !== "RawPointerDatatype") {
        throw new CompilerError(
          `This expression is not a pointer and cannot be dereferenced`,
          expr.expr.sourceloc
        );
      }
      return {
        variant: "RawPointerDereference",
        type: _expr.type.pointee,
        expr: _expr,
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ExplicitCastExpr: {
      return {
        variant: "ExplicitCast",
        type: lookupAndElaborateDatatype(sr, {
          type: expr.castedTo,
          startLookupInScope: args.scope.id,
          isInCFuncdecl: false,
          context: args.context,
        }),
        expr: elaborateExpr(sr, expr.expr, {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          scope: args.scope,
        }),
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.PostIncrExpr: {
      const e = elaborateExpr(sr, expr.expr, {
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
        context: args.context,
      });
      return {
        variant: "PostIncrExpr",
        type: e.type,
        expr: e,
        operation: expr.operation,
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.PreIncrExpr: {
      const e = elaborateExpr(sr, expr.expr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });
      return {
        variant: "PreIncrExpr",
        type: e.type,
        expr: e,
        operation: expr.operation,
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.MemberAccessExpr: {
      const object = elaborateExpr(sr, expr.expr, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });
      let type = object.type;

      if (type.variant === "RawPointerDatatype") {
        type = type.pointee;
      }

      if (object.variant === "NamespaceValue" && object.type.variant === "NamespaceDatatype") {
        const found = object.type.scope.collectedScope.tryLookupSymbol(
          sr.cc,
          expr.member,
          expr.sourceloc
        );
        if (!found) {
          throw new CompilerError(
            `Namespace '${object.type.name}' does not define any declarations called '${expr.member}'`,
            expr.sourceloc
          );
        }
        const elaborated = elaborateGlobalSymbol(sr, {
          sourceSymbol: found,
          usageGenerics: expr.generics,
          usageInScope: args.scope.id,
          usedAt: expr.sourceloc,
          context: args.context,
        });
        assert(elaborated);
        if (
          elaborated.variant === "FunctionDefinition" ||
          elaborated.variant === "FunctionDeclaration"
        ) {
          return {
            variant: "SymbolValue",
            symbol: elaborated,
            type: elaborated.type,
            sourceloc: expr.sourceloc,
          };
        } else {
          assert(false);
        }
      }

      if (type.variant !== "StructDatatype") {
        throw new CompilerError(
          "Cannot access member of non-structural type " + serializeDatatype(type),
          expr.sourceloc
        );
      }

      const member = type.members.find((m) => {
        return m.name === expr.member;
      });

      if (member) {
        if (expr.generics.length > 0) {
          throw new CompilerError(
            `Member '${expr.member}' does not expect any type arguments, but ${expr.generics.length} are given`,
            expr.sourceloc
          );
        }
        if (object.variant === "NamespaceValue") {
          assert(false, "Static members not implemented yet");
        }
        return {
          variant: "ExprMemberAccess",
          expr: object,
          memberName: expr.member,
          type: member.type,
          sourceloc: expr.sourceloc,
        };
      }

      assert(type.originalCollectedSymbol.variant === "StructDefinition");
      const collectedMethod = type.originalCollectedSymbol.methods.find((m) => {
        return m.name === expr.member;
      });

      if (collectedMethod) {
        const elaboratedMethod = elaborateGlobalSymbol(sr, {
          structForMethod: type,
          context: args.context,
          usageGenerics: expr.generics,
          usageInScope: args.scope.id,
          usedAt: expr.sourceloc,
          sourceSymbol: collectedMethod,
        });
        assert(elaboratedMethod?.variant === "FunctionDefinition");

        if (object.variant === "NamespaceValue" && collectedMethod.static) {
          return {
            variant: "SymbolValue",
            symbol: elaboratedMethod,
            type: elaboratedMethod.type,
            sourceloc: expr.sourceloc,
          };
        } else if (object.variant !== "NamespaceValue" && !collectedMethod.static) {
          let thisPointer = object;
          if (
            thisPointer.type.variant !== "RawPointerDatatype" &&
            !(thisPointer.type.variant === "StructDatatype" && !thisPointer.type.cstruct)
          ) {
            thisPointer = {
              variant: "RawPointerAddressOf",
              expr: thisPointer,
              sourceloc: expr.sourceloc,
              type: makePointerDatatypeAvailable(sr, thisPointer.type),
            };
          }

          let thisPointerType = thisPointer.type;
          if (thisPointer.type.variant === "StructDatatype" && !thisPointer.type.cstruct) {
            thisPointerType = makePointerDatatypeAvailable(sr, thisPointer.type);
          }

          return {
            variant: "CallableExpr",
            thisExpr: thisPointer,
            functionSymbol: elaboratedMethod,
            type: {
              variant: "CallableDatatype",
              thisExprType: thisPointerType,
              functionType: elaboratedMethod.type,
              concrete: elaboratedMethod.type.concrete,
            },
            sourceloc: expr.sourceloc,
          };
        } else if (object.variant === "NamespaceValue") {
          throw new CompilerError(
            `Method ${serializeNestedName(
              elaboratedMethod
            )} is used in a static context but is not static`,
            expr.sourceloc
          );
        } else {
          throw new CompilerError(
            `Method ${serializeNestedName(
              elaboratedMethod
            )} is static but is used in a non-static context`,
            expr.sourceloc
          );
        }
      }

      throw new CompilerError(
        `No attribute named '${expr.member}' in struct ${type.name}`,
        expr.sourceloc
      );
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.ExprAssignmentExpr: {
      const value = elaborateExpr(sr, expr.value, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });
      const target = elaborateExpr(sr, expr.target, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: args.scope,
      });
      return {
        variant: "ExprAssignmentExpr",
        value: Conversion.MakeImplicitConversion(value, target.type, expr.sourceloc),
        target: target,
        type: target.type,
        sourceloc: expr.sourceloc,
      };
    }

    // =================================================================================================================
    // =================================================================================================================
    // =================================================================================================================

    case Collect.ENode.StructInstantiationExpr: {
      const struct = lookupAndElaborateDatatype(sr, {
        type: expr.datatype,
        startLookupInScope: args.scope.id,
        isInCFuncdecl: false,
        context: args.context,
      });
      assert(struct.variant === "StructDatatype");

      let remainingMembers = struct.members.map((m) => m.name);
      const assignedMembers: string[] = [];
      const assign: {
        name: string;
        value: Semantic.Expression;
      }[] = [];
      for (const m of expr.members) {
        const e = elaborateExpr(sr, m.value, {
          context: args.context,
          elaboratedVariables: args.elaboratedVariables,
          scope: args.scope,
        });

        const variable = struct.members.find((mm) => {
          assert(mm.variant === "Variable");
          return mm.name === m.name;
        });

        if (!variable) {
          throw new CompilerError(
            `${serializeDatatype(struct)} does not have a member named '${m.name}'`,
            expr.sourceloc
          );
        }
        assert(variable.variant === "Variable");

        if (assignedMembers.includes(m.name)) {
          throw new CompilerError(`Cannot assign member ${m.name} twice`, expr.sourceloc);
        }

        if (e.type !== variable.type) {
          throw new CompilerError(
            `Member assignment ${m.name} has mismatching types: Cannot assign ${serializeDatatype(
              e.type
            )} to ${serializeDatatype(variable.type)}`,
            expr.sourceloc
          );
        }

        remainingMembers = remainingMembers.filter((mm) => mm !== m.name);
        assign.push({
          value: e,
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

      return {
        variant: "StructInstantiation",
        assign: assign,
        type: struct,
        sourceloc: expr.sourceloc,
      };
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
    parentStructOrNS: Semantic.Id | null;
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
      const condition = elaborateExpr(sr, s.condition, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        parentStructOrNS: args.parentStructOrNS,
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
        parentStructOrNS: args.parentStructOrNS,
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
          parentStructOrNS: args.parentStructOrNS,
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
            parentStructOrNS: args.parentStructOrNS,
          }),
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
          parentStructOrNS: args.parentStructOrNS,
          expectedReturnType: args.expectedReturnType,
          currentFileScope: args.currentFileScope,
          elaboratedVariables: args.elaboratedVariables,
          context: args.context,
        });
      }
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.IfStatement,
        condition: condition,
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
      const condition = elaborateExpr(sr, s.condition, {
        context: args.context,
        elaboratedVariables: args.elaboratedVariables,
        scope: s.owningScope,
        currentFileScope: args.currentFileScope,
        parentStructOrNS: args.parentStructOrNS,
      });
      const [thenScope, thenScopeId] = Semantic.addNode(sr, {
        variant: Semantic.ENode.BlockScope,
        statements: [],
      });
      elaborateBlockScope(sr, {
        targetScopeId: thenScopeId,
        sourceScopeId: s.block,
        parentStructOrNS: args.parentStructOrNS,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
        expectedReturnType: args.expectedReturnType,
        context: args.context,
      });
      return Semantic.addNode(sr, {
        variant: Semantic.ENode.WhileStatement,
        condition: condition,
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
              parentStructOrNS: args.parentStructOrNS,
            }),
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
          parentStructOrNS: args.parentStructOrNS,
        });
      const value = valueId && asExpression(sr.nodes.get(valueId));

      if (value?.variant === Semantic.ENode.NamespaceValueExpr) {
        throw new CompilerError(
          `A struct/namespace datatype cannot be written into a variable`,
          value.sourceloc
        );
      }

      const variableSymbolId = args.elaboratedVariables.get(s.variableSymbol);
      assert(variableSymbolId);
      const variableSymbol = sr.nodes.get(variableSymbolId);
      assert(variableSymbol.variant === Semantic.ENode.VariableSymbol);

      // if (s.) {
      //   symbol.type = lookupAndElaborateDatatype(sr, {
      //     type: s.datatype,
      //     startLookupInScope: args.parentCollectedScope.collectedScope.id,
      //     isInCFuncdecl: false,
      //     context: args.context,
      //   });
      // } else {
      //   assert(value);
      //   symbol.type = value.type;
      // }
      // assert(symbol.type);
      // symbol.concrete = symbol.type.concrete;
      assert(false as any, "TODO");

      assert(variableSymbol.type);
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
          parentStructOrNS: args.parentStructOrNS,
        }),
        sourceloc: s.sourceloc,
      })[1];

    default:
      assert(false);
  }
}

export function elaborateBlockScope(
  sr: SemanticResult,
  args: {
    sourceScopeId: Collect.Id;
    targetScopeId: Semantic.Id;
    parentStructOrNS: Semantic.Id | null;
    currentFileScope: Collect.Id;
    expectedReturnType: Semantic.Id;
    elaboratedVariables: Map<Collect.Id, Semantic.Id>;
    context: SubstitutionContext;
  }
) {
  const scope = sr.cc.nodes.get(args.sourceScopeId);
  assert(scope.variant === Collect.ENode.BlockScope);

  const variableMap = new Map<Collect.Id, Semantic.Id>(args.elaboratedVariables);

  for (const sId of scope.symbols) {
    const symbol = sr.cc.nodes.get(sId);
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
            parentStructOrNS: args.parentStructOrNS,
            startLookupInScope: symbol.inScope,
            isInCFuncdecl: false,
            currentFileScope: args.currentFileScope,
            elaboratedVariables: args.elaboratedVariables,
            context: args.context,
          });
        } else if (symbol.variableContext === EVariableContext.ThisReference) {
          if (variableMap.has(sId)) {
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
          parentStructOrNS: args.parentStructOrNS,
          variableContext: variableContext,
          type: type,
          concrete: false,
        });
        variableMap.set(sId, variableId);
        break;
      }

      default:
        assert(false, symbol.variant.toString());
    }
  }

  for (const sId of scope.statements) {
    const statement = elaborateStatement(sr, sId, {
      parentStructOrNS: args.parentStructOrNS,
      expectedReturnType: args.expectedReturnType,
      elaboratedVariables: variableMap,
      currentFileScope: args.currentFileScope,
      context: args.context,
    });
    const blockScope = sr.nodes.get(args.targetScopeId);
    assert(blockScope.variant === Semantic.ENode.BlockScope);
    blockScope.statements.push(statement);

    // if (statement.variant === "ReturnStatement") {
    //   args.scopeId.returnedTypes.push(statement.expr?.type);
    // }
  }
}

export function defineThisPointer(
  sr: SemanticResult,
  args: {
    // scope: Semantic.Id;
    parentStruct: Semantic.Id;
    context: SubstitutionContext;
    elaboratedVariables: Map<Collect.Node, Semantic.VariableSymbol>;
  }
) {
  const thisPointer = makePointerDatatypeAvailable(sr, args.parentStruct);

  // const vardef: Semantic.Symbol = {
  //   variant: "Variable",
  //   memberOfStruct: args.parentStruct,
  //   mutability: EVariableMutability.Mutable,
  //   name: "this",
  //   type: thisPointer,
  //   concrete: isTypeConcrete(sr, thisPointer),
  //   export: false,
  //   extern: EExternLanguage.None,
  //   // sourceloc: args.scope.sourceloc,
  //   sourceloc: null,
  //   variableContext: EVariableContext.FunctionParameter,
  // };
  console.log("TODO: Fix this pointer + sourceloc");
  // args.scope.symbolTable.defineSymbol(vardef);

  // const thisRefVarDef = args.scope.collectedScope.tryLookupSymbolHere(sr.cc, "this");
  // assert(thisRefVarDef);
  // args.elaboratedVariables.set(thisRefVarDef, vardef);
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
  const substitutionContext = isolateElaborationContext(args.context);
  for (let i = 0; i < func.generics.length; i++) {
    substitutionContext.substitute.set(func.generics[i], args.genericArgs[i]);
  }

  const expectedReturnType = lookupAndElaborateDatatype(sr, {
    typeId: func.returnType,
    context: substitutionContext,
    currentFileScope: args.currentFileScope,
    parentStructOrNS: args.parentStructOrNS,
    elaboratedVariables: args.elaboratedVariables,
    isInCFuncdecl: false,
    startLookupInScope: func.functionScope || func.parentScope,
  });

  const ftype = makeFunctionDatatypeAvailable(sr, {
    parameters: func.parameters.map((p) =>
      lookupAndElaborateDatatype(sr, {
        typeId: func.returnType,
        context: substitutionContext,
        currentFileScope: args.currentFileScope,
        parentStructOrNS: args.parentStructOrNS,
        elaboratedVariables: args.elaboratedVariables,
        isInCFuncdecl: false,
        startLookupInScope: func.functionScope || func.parentScope,
      })
    ),
    returnType: expectedReturnType,
    vararg: func.vararg,
  });

  let [symbol, symbolId] = Semantic.addNode<Semantic.FunctionSymbol>(sr, {
    variant: Semantic.ENode.FunctionSymbol,
    type: ftype,
    export: func.export,
    generics: args.genericArgs,
    staticMethod: false,
    parentStructOrNS: args.parentStructOrNS,
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
    parameterNames: func.parameters.map((p) => p.name),
    name: overloadGroup.name,
    sourceloc: func.sourceloc,
    scope: null,
    concrete: isTypeConcrete(sr, ftype),
  });

  if (isTypeConcrete(sr, ftype)) {
    sr.elaboratedFuncdefSymbols.push({
      generics: args.genericArgs,
      originalSymbol: collectedFunctionSymbolId,
      resultSymbol: symbolId,
    });

    if (func.functionScope) {
      const [bodyScope, bodyScopeId] = Semantic.addNode(sr, {
        variant: Semantic.ENode.BlockScope,
        statements: [],
      });

      const functionScope = sr.cc.nodes.get(func.functionScope);
      assert(functionScope.variant === Collect.ENode.FunctionScope);

      symbol.scope = bodyScopeId;
      elaborateBlockScope(sr, {
        targetScopeId: bodyScopeId,
        sourceScopeId: functionScope.blockScope,
        expectedReturnType: expectedReturnType,
        parentStructOrNS: args.parentStructOrNS,
        elaboratedVariables: args.elaboratedVariables,
        currentFileScope: args.currentFileScope,
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
    currentParent: Semantic.Id | null;
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

  const [ns, nsId] = Semantic.addNode<Semantic.NamespaceDatatypeSymbol>(sr, {
    variant: Semantic.ENode.NamespaceDatatype,
    name: namespace.name,
    parentStructOrNS: args.currentParent,
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
        parentStructOrNS: nsId,
        currentFileScope: args.currentFileScope,
      });
      for (const s of sym) {
        ns.symbols.push(s);
      }
    }
    // if (d.variant === "FunctionDeclaration") {
    //   const sig = elaborate(sr, {
    //     sourceSymbol: d,
    //     context: isolateElaborationContext(args.context),
    //   });
    //   if (sig) {
    //     namespace.scope.symbolTable.defineSymbol(sig);
    //   }
    // } else if (d.variant === "FunctionDefinition") {
    //   if (d.generics.length === 0 && !d.operatorOverloading) {
    //     const sig = elaborate(sr, {
    //       sourceSymbol: d,
    //       usageGenerics: [],
    //       context: isolateElaborationContext(args.context),
    //     });
    //     if (sig) {
    //       namespace.scope.symbolTable.defineSymbol(sig);
    //     }
    //   }
    // } else if (
    //   d.variant === "GlobalVariableDefinition" ||
    //   d.variant === "NamespaceDefinition" ||
    //   d.variant === "StructDefinition"
    // ) {
    //   const sig = elaborate(sr, {
    //     sourceSymbol: d,
    //     usageGenerics: [],
    //     context: isolateElaborationContext(args.context),
    //   });
    //   if (sig) {
    //     namespace.scope.symbolTable.defineSymbol(sig);
    //   }
    // }
  }
  return nsId;
}

export function elaborateGlobalSymbol(
  sr: SemanticResult,
  nodeId: Collect.Id,
  args: {
    parentStructOrNS: Semantic.Id | null;
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
          currentParent: args.parentStructOrNS,
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
            parentStructOrNS: args.parentStructOrNS,
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
          parentStructOrNS: args.parentStructOrNS,
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
            parentStructOrNS: args.parentStructOrNS,
            startLookupInScope: args.currentFileScope,
            elaboratedVariables: new Map(),
            currentFileScope: args.currentFileScope,
            isInCFuncdecl: false,
            context: makeSubstitutionContext(),
          })) ||
        null;

      return [
        Semantic.addNode(sr, {
          variant: Semantic.ENode.VariableSymbol,
          parentStructOrNS: args.parentStructOrNS,
          type: type,
          export: false,
          extern: EExternLanguage.None,
          name: node.name,
          memberOfStruct: null,
          mutability: node.mutability,
          variableContext: EVariableContext.Global,
          sourceloc: node.sourceloc,
          concrete: true,
        })[1],
      ];
    }

    case Collect.ENode.GlobalVariableDefinition: {
      for (const s of sr.elaboratedGlobalVariableStatements) {
        if (s.originalSymbol === nodeId) {
          return [s.resultSymbol];
        }
      }
      let elaboratedValueId: Semantic.Id | null = null;
      if (node.value) {
        elaboratedValueId = elaborateExpr(sr, node.value, {
          scope: args.currentFileScope,
          elaboratedVariables: new Map(),
          context: makeSubstitutionContext(),
        });
      }
      const elaboratedValue = (elaboratedValueId && sr.nodes.get(elaboratedValueId)) || null;
      assert(elaboratedValue === null || isExpression(elaboratedValue));

      const [variableSymbolId] = elaborateGlobalSymbol(sr, node.variableSymbol, {
        currentFileScope: args.currentFileScope,
        parentStructOrNS: args.parentStructOrNS,
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
        parentStructOrNS: args.parentStructOrNS,
        export: variableSymbol.export,
        extern: variableSymbol.extern,
        name: variableSymbol.name,
        value: elaboratedValueId,
        sourceloc: node.sourceloc,
        variableSymbol: variableSymbolId,
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
          parentStructOrNS: null,
          currentFileScope: fileId,
        });
      }
    }
  }

  // recursivelyExportCollectedSymbols(sr, globalScope);

  // const mainFunction = sr.elaboratedFuncdefSymbols.find((s) => s.resultSymbol.name === "main");
  // if (!isLibrary) {
  //   if (!mainFunction) {
  //     throw new CompilerError("No main function is defined in global scope", null);
  //   }

  //   if (
  //     mainFunction.resultSymbol.type.returnType.variant !== "PrimitiveDatatype" ||
  //     mainFunction.resultSymbol.type.returnType.primitive !== EPrimitive.i32
  //   ) {
  //     throw new CompilerError("Main function must return i32", mainFunction.resultSymbol.sourceloc);
  //   }
  // } else {
  //   if (mainFunction) {
  //     throw new CompilerError(
  //       "main function is defined, but not allowed because module is built as library",
  //       null
  //     );
  //   }
  // }

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

  // for (const symbol of sr.globalScope.symbols) {
  //   switch (symbol.variant) {
  //     case "FunctionDatatype":
  //       print(
  //         ` - FunctionType [${symbol.functionParameters.map((p) => `${p.name}: ${p.type}`).join(", ")}] => ${symbol.functionReturnValue} vararg=${symbol.vararg}`,
  //         symbol.concrete ? reset : gray,
  //       );
  //       break;

  //     case "PrimitiveDatatype":
  //       print(
  //         ` - PrimitiveType ${primitiveToString(symbol.primitive)}`,
  //         symbol.concrete ? reset : gray,
  //       );
  //       break;

  //     case "StructDatatype":
  //       let s = "(" + symbol.fullNamespacedName.join(".");
  //       if (symbol.generics.length > 0) {
  //         s += " generics=[" + symbol.generics.join(", ") + "]";
  //       }
  //       s += ")";
  //       print(
  //         ` - StructType ${s} members=${symbol.members.map((id) => id).join(", ")}`,
  //         symbol.concrete ? reset : gray,
  //       );
  //       break;

  //     case "DeferredDatatype":
  //       print(` - Deferred`, symbol.concrete ? reset : gray);
  //       break;

  //     case "RawPointerDatatype":
  //       print(` - RawPointer pointee=${symbol.pointee}`, symbol.concrete ? reset : gray);
  //       break;

  //     case "ReferenceDatatype":
  //       print(` - Reference referee=${symbol.referee}`, symbol.concrete ? reset : gray);
  //       break;

  //     case "CallableDatatype":
  //       print(
  //         ` - Callable functionType=${symbol.functionType} thisExprType=${symbol.thisExprType}`,
  //         symbol.concrete ? reset : gray,
  //       );
  //       break;

  //     case "FunctionDeclaration":
  //       print(` - FuncDecl ${symbol.name}() type=${symbol.type}`, symbol.concrete ? reset : gray);
  //       break;

  //     case "FunctionDefinition":
  //       print(
  //         ` - FuncDef ${symbol.name}() type=${symbol.type} methodOf=${symbol.methodOfSymbol} parent=${symbol.parent}`,
  //         symbol.concrete ? reset : gray,
  //       );
  //       break;

  //     case "GenericParameter":
  //       print(` - GenericParameter ${symbol.name}`, symbol.concrete ? reset : gray);
  //       break;

  //     case "Variable":
  //       print(
  //         ` - Variable ${symbol.name} typeSymbol=${symbol.type} memberOf=${symbol.memberOf}`,
  //         symbol.concrete ? reset : gray,
  //       );
  //       break;
  //   }
  // }
  print("\n");
}
