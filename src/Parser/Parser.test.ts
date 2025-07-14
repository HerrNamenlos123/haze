import { InternalError } from "../shared/Errors";
import { runStageTests, type StageTest, type StageTests } from "../Testing/Testing";
import { Parser } from "./Parser";

const tests: StageTests<string, any> = [
    (): StageTest<string, any> => {
        return {
            name: 'Simple recursive function call',
            input: `
            foo(): i32 => {
                return foo();
            }
            `,
            expectedOutput: (() => [{
                variant: "FunctionDefinition",
                "export": false,
                externLanguage: 0,
                params: [],
                generics: [],
                name: "foo",
                ellipsis: false,
                funcbody: {
                    variant: "Scope",
                    sourceloc: {
                        filename: "src/Parser/Parser.test.ts",
                        line: 2,
                        column: 26,
                    },
                    statements: [
                        {
                            variant: "ReturnStatement",
                            expr: {
                                variant: "ExprCallExpr",
                                calledExpr: {
                                    variant: "SymbolValueExpr",
                                    generics: [],
                                    name: "foo",
                                    sourceloc: {
                                        filename: "src/Parser/Parser.test.ts",
                                        line: 3,
                                        column: 23,
                                    },
                                    _semantic: {},
                                },
                                arguments: [],
                                sourceloc: {
                                    filename: "src/Parser/Parser.test.ts",
                                    line: 3,
                                    column: 23,
                                },
                                _semantic: {},
                            },
                            sourceloc: {
                                filename: "src/Parser/Parser.test.ts",
                                line: 3,
                                column: 16,
                            },
                        }
                    ],
                    _collect: {},
                },
                returnType: {
                    variant: "NamedDatatype",
                    name: "i32",
                    sourceloc: {
                        filename: "src/Parser/Parser.test.ts",
                        line: 2,
                        column: 19,
                    },
                    generics: [],
                    nested: undefined,
                    _collect: {},
                },
                sourceloc: {
                    filename: "src/Parser/Parser.test.ts",
                    line: 2,
                    column: 12,
                },
                _collect: {},
                _semantic: {},
            }]),
        }
    }];

export async function runParseTests() {
    const parseFunction = (input: string) => {
        return Parser.parseTextToAST(input, "src/Parser/Parser.test.ts");
    };
    await runStageTests('Parser', parseFunction, tests);
}
