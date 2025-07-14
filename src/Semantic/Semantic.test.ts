
import { Parser } from "../Parser/Parser";
import { EPrimitive } from "../shared/common";
import { GLOBAL_NAMESPACE_NAME } from "../shared/Config";
import { Collect, type CollectResult } from "../SymbolCollection/CollectSymbols";
import { CollectSymbols } from "../SymbolCollection/SymbolCollection";
import { runStageTests, type StageTest, type StageTests } from "../Testing/Testing";
import { SemanticallyAnalyze } from "./Elaborate";
import { Semantic, type SemanticResult } from "./SemanticSymbols";

const thisTestfile = "src/Semantic/Semantic.test.ts";

function parseAndCollect(input: string) {
    const cr: CollectResult = {
        cInjections: [],
        globalScope: new Collect.Scope(null),
    };
    CollectSymbols(cr, Parser.parseTextToAST(input, thisTestfile), { filename: thisTestfile, line: 0, column: 0 });
    return cr;
}

const tests: StageTests<Collect.Scope, SemanticResult> = [
    (): StageTest<Collect.Scope, SemanticResult> => {
        const cr = parseAndCollect(`
            main(): i32 => {

            }
            `);
        return {
            name: 'Simple recursive function call',
            input: cr.globalScope,
            expectedOutput: (() => {
                const sourceloc = (line: number, column: number) => ({
                    filename: thisTestfile,
                    line: line,
                    column: column,
                });
                const semanticResult: SemanticResult = {
                    monomorphizedSymbols: [],
                    globalNamespace: {
                        variant: "Namespace",
                        concrete: true,
                        name: GLOBAL_NAMESPACE_NAME,
                        sourceloc: null,
                        scope: new Semantic.DeclScope(null, cr.globalScope),
                    }
                };
                semanticResult.globalNamespace.scope.symbolTable.defineSymbol({
                    variant: "PrimitiveDatatype",
                    concrete: true,
                    primitive: EPrimitive.i32,
                })

                // semanticResult.globalNamespace.scope.symbolTable.defineSymbol({
                //     variant: "FunctionDefinition",
                //     export: false,
                //     externLanguage: 0,
                //     parameterNames: [],
                //     generics: [],
                //     name: "main",
                //     ellipsis: false,
                // });
                return semanticResult;
            })(),
        };
    },
];

export async function runSemanticTests() {
    const semanticFunction = (globalScope: Collect.Scope) => {
        return SemanticallyAnalyze(globalScope);
    };
    await runStageTests('Semantic', semanticFunction, tests);
}
