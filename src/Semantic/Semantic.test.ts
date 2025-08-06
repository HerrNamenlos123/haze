import { method, result } from "lodash";
import { Parser } from "../Parser/Parser";
import { EExternLanguage } from "../shared/AST";
import { EMethodType, EPrimitive, EVariableContext } from "../shared/common";
import { GLOBAL_NAMESPACE_NAME } from "../shared/Config";
import { assert } from "../shared/Errors";
import { Collect, type CollectionContext } from "../SymbolCollection/CollectSymbols";
import { CollectRoot } from "../SymbolCollection/SymbolCollection";
import { runStageTests, type StageTest, type StageTests } from "../Testing/Testing";
import { SemanticallyAnalyze } from "./Elaborate";
import { Semantic, type SemanticResult } from "./SemanticSymbols";

const thisTestfile = "src/Semantic/Semantic.test.ts";

function parseAndCollect(input: string) {
  const cc: CollectionContext = {
    cInjections: [],
    globalScope: new Collect.Scope(null),
  };
  CollectRoot(cc, Parser.parseTextToAST(input, thisTestfile), {
    filename: thisTestfile,
    line: 0,
    column: 0,
  });
  return cc;
}

const tests: StageTests<Collect.Scope, SemanticResult> = [
  (): StageTest<Collect.Scope, SemanticResult> => {
    const cc = parseAndCollect(`
            struct Bar {
                get(): Bar& => {
                    return this;
                }
            }
            main(): i32 => {
                const a = (Bar {}).get().get().get();
            }
            `);
    return {
      name: "Simple recursive function call",
      input: cc.globalScope,
      expectedOutput: (() => {
        const sourceloc = (line: number, column: number) => ({
          filename: thisTestfile,
          line: line,
          column: column,
        });
        const semanticResult: SemanticResult = {
          monomorphizedStructs: [],
          globalNamespace: {
            variant: "Namespace",
            concrete: true,
            name: GLOBAL_NAMESPACE_NAME,
            sourceloc: null,
            scope: new Semantic.DeclScope(null, cc.globalScope),
          },
        };
        semanticResult.globalNamespace.scope.symbolTable.defineSymbol({
          variant: "PrimitiveDatatype",
          concrete: true,
          primitive: EPrimitive.i32,
        });

        const collectedStruct = cc.globalScope.symbolTable.symbols[0];
        assert(collectedStruct.variant === "StructDefinition");

        const collectedMainFunction = cc.globalScope.symbolTable.symbols[1];
        assert(collectedMainFunction.variant === "FunctionDefinition");
        assert(collectedMainFunction.funcbody._collect.scope);

        const structType: Semantic.StructDatatypeSymbol = {
          variant: "StructDatatype",
          concrete: true,
          externLanguage: EExternLanguage.None,
          generics: [],
          members: [],
          methods: [],
          name: "Bar",
          sourceloc: sourceloc(2, 12),
          parent: semanticResult.globalNamespace,
          rawAst: collectedStruct,
          scope: (() => {
            assert(collectedStruct._collect.scope);
            const scope = new Semantic.DeclScope(
              sourceloc(2, 12),
              collectedStruct._collect.scope,
              semanticResult.globalNamespace.scope,
            );
            return scope;
          })(),
        };
        const thisReference: Semantic.ReferenceDatatypeSymbol = {
          variant: "ReferenceDatatype",
          concrete: true,
          referee: structType,
        };
        const noneType: Semantic.PrimitiveDatatypeSymbol = {
          variant: "PrimitiveDatatype",
          concrete: true,
          primitive: EPrimitive.none,
        };

        const getMethod: Semantic.FunctionDefinitionSymbol = {
          variant: "FunctionDefinition",
          type: {
            variant: "FunctionDatatype",
            concrete: true,
            parameters: [thisReference],
            returnType: structType,
            vararg: false,
          },
          concrete: true,
          export: false,
          externLanguage: EExternLanguage.None,
          methodType: EMethodType.Method,
          name: "get",
          methodOf: structType,
          parameterNames: ["this"],
          parent: structType,
          sourceloc: sourceloc(3, 16),
          scope: (() => {
            assert(collectedStruct.methods[0].funcbody._collect.scope);
            const scope = new Semantic.BlockScope(
              sourceloc(3, 16),
              collectedStruct.methods[0].funcbody._collect.scope,
            );
            scope.symbolTable.defineSymbol({
              variant: "Variable",
              name: "this",
              mutable: false,
              type: thisReference,
              concrete: true,
              export: false,
              externLanguage: EExternLanguage.None,
              sourceloc: sourceloc(3, 16),
              variableContext: EVariableContext.FunctionParameter,
            });
            scope.returnedTypes.push(thisReference);
            scope.statements.push({
              variant: "ReturnStatement",
              sourceloc: sourceloc(4, 20),
              expr: {
                variant: "SymbolValue",
                sourceloc: sourceloc(4, 27),
                symbol: {
                  variant: "Variable",
                  concrete: true,
                  export: false,
                  externLanguage: EExternLanguage.None,
                  name: "this",
                  type: thisReference,
                  mutable: false,
                  sourceloc: sourceloc(3, 16),
                  variableContext: EVariableContext.FunctionParameter,
                },
                type: structType,
              },
            });
            return scope;
          })(),
        };

        structType.methods.push(getMethod);
        structType.methods.push({
          variant: "FunctionDefinition",
          name: "drop",
          concrete: true,
          export: false,
          externLanguage: EExternLanguage.None,
          methodType: EMethodType.Drop,
          parameterNames: ["this"],
          parent: structType,
          sourceloc: sourceloc(2, 12),
          type: {
            variant: "FunctionDatatype",
            concrete: true,
            parameters: [thisReference],
            returnType: noneType,
            vararg: false,
          },
          scope: (() => {
            const scope = new Semantic.BlockScope(
              sourceloc(2, 12),
              new Collect.Scope(sourceloc(2, 12), structType.scope.collectedScope),
            );
            return scope;
          })(),
          methodOf: structType,
        });

        semanticResult.globalNamespace.scope.symbolTable.defineSymbol({
          variant: "FunctionDefinition",
          type: {
            variant: "FunctionDatatype",
            concrete: true,
            parameters: [],
            returnType: {
              variant: "PrimitiveDatatype",
              concrete: true,
              primitive: EPrimitive.i32,
            },
            vararg: false,
          },
          export: false,
          parent: semanticResult.globalNamespace,
          externLanguage: 0,
          methodType: EMethodType.NotAMethod,
          parameterNames: [],
          name: "main",
          sourceloc: sourceloc(7, 12),
          scope: (() => {
            const scope = new Semantic.BlockScope(
              sourceloc(7, 12),
              collectedMainFunction.funcbody._collect.scope,
              semanticResult.globalNamespace.scope,
            );
            const callableType: Semantic.CallableDatatypeSymbol = {
              variant: "CallableDatatype",
              concrete: true,
              functionType: {
                variant: "FunctionDatatype",
                concrete: true,
                parameters: [thisReference],
                returnType: thisReference,
                vararg: false,
              },
              thisExprType: thisReference,
            };
            scope.symbolTable.defineSymbol({
              variant: "Variable",
              concrete: true,
              export: false,
              externLanguage: EExternLanguage.None,
              mutable: false,
              name: "a",
              sourceloc: sourceloc(8, 16),
              type: thisReference,
              variableContext: EVariableContext.FunctionLocal,
            });
            scope.statements.push({
              variant: "VariableStatement",
              name: "a",
              mutable: false,
              variableSymbol: {
                variant: "Variable",
                name: "a",
                export: false,
                externLanguage: EExternLanguage.None,
                mutable: false,
                sourceloc: sourceloc(8, 16),
                concrete: true,
                variableContext: EVariableContext.FunctionLocal,
                type: thisReference,
              },
              value: {
                variant: "ExprCall",
                arguments: [],
                calledExpr: {
                  variant: "CallableExpr",
                  type: callableType,
                  functionSymbol: getMethod,
                  sourceloc: sourceloc(8, 26),
                  thisExpr: {
                    variant: "ExprCall",
                    arguments: [],
                    calledExpr: {
                      variant: "CallableExpr",
                      type: callableType,
                      functionSymbol: getMethod,
                      sourceloc: sourceloc(8, 26),
                      thisExpr: {
                        variant: "ExprCall",
                        arguments: [],
                        calledExpr: {
                          variant: "CallableExpr",
                          type: callableType,
                          functionSymbol: getMethod,
                          sourceloc: sourceloc(8, 26),
                          thisExpr: {
                            variant: "StructInstantiation",
                            type: structType,
                            assign: [],
                            sourceloc: sourceloc(8, 27),
                          },
                        },
                        sourceloc: sourceloc(8, 26),
                        type: callableType,
                      },
                    },
                    sourceloc: sourceloc(8, 26),
                    type: callableType,
                  },
                },
                sourceloc: sourceloc(8, 26),
                type: callableType,
              },
              sourceloc: sourceloc(8, 16),
            });
            return scope;
          })(),
          concrete: true,
        });

        assert(collectedStruct._collect.scope);
        semanticResult.monomorphizedStructs.push(structType);
        semanticResult.globalNamespace.scope.symbolTable.defineSymbol(noneType);
        return semanticResult;
      })(),
    };
  },
];

export async function runSemanticTests() {
  const semanticFunction = (globalScope: Collect.Scope) => {
    const result = SemanticallyAnalyze(globalScope, false);
    return result;
  };
  await runStageTests("Semantic", semanticFunction, tests);
}
