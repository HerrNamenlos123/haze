import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type ASTFunctionTypeExpr, EExternLanguage } from "../shared/AST";
import type { ModuleConfig } from "../shared/Config";
import { HazeErrorCode } from "../shared/ErrorCodes";
import { CompilerError, setDiagnosticSink } from "../shared/Errors";
import {
  runStageTests,
  type StageTest,
  type StageTests,
} from "../Testing/Testing";
import { diffAST } from "./ASTDiff";
import {
  ensureNativeParser,
  NativeParserServer,
  nativeParserBuildFailure,
} from "./NativeParser";
import { Parser } from "./Parser";
import { setParserMode } from "./ParserMode";

const tests: StageTests<string, any> = [
  (): StageTest<string, any> => ({
    name: "Simple recursive function call",
    input: `
            foo(): i32 => {
                return foo();
            }
            `,
    expectedOutput: (() => [
      {
        variant: "FunctionDefinition",
        export: false,
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
            },
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
      },
    ])(),
  }),
  (): StageTest<string, any> => ({
    name: "Simple generic function",
    input: `
            foo<T>(): T => {}
            `,
    expectedOutput: (() => [
      {
        variant: "FunctionDefinition",
        export: false,
        externLanguage: 0,
        params: [],
        generics: [
          {
            variant: "GenericParameter",
            name: "T",
          },
        ],
        name: "foo",
        ellipsis: false,
        funcbody: {
          variant: "Scope",
          sourceloc: {
            filename: "src/Parser/Parser.test.ts",
            line: 2,
            column: 27,
          },
          statements: [],
          _collect: {},
        },
        returnType: {
          variant: "NamedDatatype",
          name: "T",
          sourceloc: {
            filename: "src/Parser/Parser.test.ts",
            line: 2,
            column: 22,
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
      },
    ])(),
  }),
];

export async function runParseTests() {
  const config: ModuleConfig = {} as any;
  const parseFunction = (input: string) =>
    Parser.parseTextToAST(config, input, "src/Parser/Parser.test.ts");
  await runStageTests("Parser", parseFunction, tests);
}

// ---------------------------------------------------------------------------
// Both parsers, side by side
//
// The native parser (compiler/haze-parser) is what every build uses; ANTLR is
// the specification it is checked against, as scripts/parser-equivalence.ts
// does over every file in the repository. Syntax that no file uses yet is
// only covered here: each case must come out of both parsers identical, or be
// rejected by both with the same H1000 at the same place.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILENAME = "parser-test.hz";

let nativeServer: NativeParserServer | null = null;

type Outcome = { ast: unknown } | { error: unknown };

function parseWithAntlr(source: string): Outcome {
  // A syntax error is printed before it is thrown; the thrown error is what
  // these tests compare.
  setDiagnosticSink(() => {});
  try {
    return {
      ast: Parser.parseTextToAST({} as ModuleConfig, source, FILENAME),
    };
  } catch (e) {
    return { error: e };
  } finally {
    setDiagnosticSink(null);
  }
}

async function parseWithNative(source: string): Promise<Outcome> {
  if (!nativeServer) {
    throw new Error("the native parser server was not started");
  }
  try {
    return { ast: await nativeServer.parseText(source, FILENAME) };
  } catch (e) {
    return { error: e };
  }
}

/** Parses with both, requires identical ASTs, and returns the AST. */
async function parseBoth(source: string): Promise<unknown> {
  const antlr = parseWithAntlr(source);
  const native = await parseWithNative(source);
  if ("error" in antlr) {
    throw antlr.error;
  }
  if ("error" in native) {
    throw native.error;
  }
  expect(diffAST(antlr.ast, native.ast)).toEqual([]);
  return antlr.ast;
}

/** Both reject with the same syntax error; returns it. */
async function rejectBoth(source: string) {
  const describeError = (outcome: Outcome) => {
    expect("error" in outcome).toBe(true);
    const error = (outcome as { error: unknown }).error;
    expect(error).toBeInstanceOf(CompilerError);
    const e = error as CompilerError;
    return {
      code: e.code,
      message: e.rawMessage,
      line: e.loc?.start.line,
      column: e.loc?.start.column,
    };
  };
  const antlr = describeError(parseWithAntlr(source));
  const native = describeError(await parseWithNative(source));
  expect(native).toEqual(antlr);
  expect(antlr.code).toBe(HazeErrorCode.SyntaxError);
  return antlr;
}

/** Every FunctionTypeExpr in an AST, in no particular order. */
function functionTypes(ast: unknown): ASTFunctionTypeExpr[] {
  const found: ASTFunctionTypeExpr[] = [];
  const stack: unknown[] = [ast];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") {
      continue;
    }
    if ((node as { variant?: unknown }).variant === "FunctionTypeExpr") {
      found.push(node as ASTFunctionTypeExpr);
    }
    stack.push(...Object.values(node as Record<string, unknown>));
  }
  return found;
}

function countMarked(ast: unknown) {
  const types = functionTypes(ast);
  return {
    externC: types.filter((t) => t.externLanguage === EExternLanguage.Extern_C)
      .length,
    haze: types.filter((t) => t.externLanguage === undefined).length,
  };
}

describe("extern C function types, in both parsers", () => {
  beforeAll(() => {
    // Rebuilds the native parser only when its sources changed.
    if (!ensureNativeParser(REPO_ROOT)) {
      throw new Error(nativeParserBuildFailure());
    }
    setParserMode("antlr", REPO_ROOT);
    nativeServer = new NativeParserServer(REPO_ROOT);
    nativeServer.start();
  }, 600_000);

  afterAll(() => {
    nativeServer?.stop();
    nativeServer = null;
  });

  // [position, source, extern C function types, Haze function types]
  const positions: [string, string, number, number][] = [
    ["type alias", "type F = extern C (a: i32) -> i32;", 1, 0],
    [
      "extern C type alias",
      "extern C type F = extern C (a: i32, b: cptr) -> void;",
      1,
      0,
    ],
    [
      "extern C declaration: parameter and return type",
      "extern C fn f(cb: extern C (x: i32) -> i32): extern C () -> void;",
      2,
      0,
    ],
    [
      "extern C function with a body",
      "extern C fn f(cb: extern C (x: i32) -> i32): i32 { return cb(1); }",
      1,
      0,
    ],
    [
      "Haze function: parameter and return type",
      "fn f(cb: extern C (x: i32) -> i32): extern C () -> i32 { return g; }",
      2,
      0,
    ],
    [
      "struct fields",
      "struct S { cb: extern C (ud: cptr) -> void; maybe: (extern C () -> void) | none = none }",
      2,
      0,
    ],
    [
      "extern C struct field",
      "extern C struct T { fn_: extern C (a: i32) -> i32; }",
      1,
      0,
    ],
    [
      "methods",
      "struct M { fn set(cb: extern C () -> void): extern C () -> void { return cb; } static fn s(x: extern C (a: i32) -> i32) {} }",
      3,
      0,
    ],
    [
      "generic arguments",
      "fn h() { let a: Array<extern C () -> void> = []; let b = foo<extern C () -> void>(x); }",
      2,
      0,
    ],
    [
      "generic function",
      "fn gen<T>(cb: extern C (x: T) -> T): T { return cb(x); }",
      1,
      0,
    ],
    [
      "variables",
      "let g: extern C () -> void = h; fn v() { let l: extern C () -> void = h; }",
      2,
      0,
    ],
    [
      "lambda parameters",
      "fn l() { let a = (cb: extern C () -> void) => cb(); let b = (cb: extern C () -> void) -> { cb(); }; }",
      2,
      0,
    ],
    [
      "casts and type tests",
      "fn c() { let p = x as extern C () -> void; let q = y is extern C () -> void; }",
      2,
      0,
    ],
    [
      "unions",
      "type U = none | extern C () -> void | (extern C (a: i32) -> i32);",
      2,
      0,
    ],
    [
      "tagged union member",
      "fn tu(a: union { x: extern C () -> void, y: i32 }) {}",
      1,
      0,
    ],
    [
      "arrays",
      "type A = []extern C () -> void; type B = [4]extern C () -> void;",
      2,
      0,
    ],
    [
      "nested",
      "type N = extern C (cb: extern C () -> void) -> extern C () -> i32;",
      3,
      0,
    ],
    [
      "inside Haze function types",
      "type H = () -> extern C () -> void; type K = (cb: extern C () -> void) => extern C () -> void;",
      3,
      1,
    ],
    [
      "immediate parameter",
      "type I = (cb: immediate extern C () -> void) -> void;",
      1,
      1,
    ],
    [
      "statement alias and type value",
      "fn st() { type L = extern C () -> void; let t = type extern C () -> void; }",
      2,
      0,
    ],
    [
      "namespace and #source",
      'namespace ns { export type CB = extern C (ud: cptr) -> void; } #source "f.hz:3:1" { type S = extern C () -> void; }',
      2,
      0,
    ],
  ];

  for (const [position, source, externC, haze] of positions) {
    test(position, async () => {
      expect(countMarked(await parseBoth(source))).toEqual({
        externC: externC,
        haze: haze,
      });
    });
  }

  test("the node: parameters, variadic, requires block, span from `extern`", async () => {
    const ast = (await parseBoth(
      "type X = extern C (fmt: ccstr, ...) -> i32 :: pure;"
    )) as { datatype: ASTFunctionTypeExpr }[];
    const type = ast[0].datatype;
    expect(type.variant).toBe("FunctionTypeExpr");
    expect(type.externLanguage).toBe(EExternLanguage.Extern_C);
    expect(type.params.length).toBe(1);
    expect(type.ellipsis).toBe(true);
    expect(type.requires.pure).toBe(true);
    expect(type.sourceloc.start).toEqual({ line: 1, column: 9 });
  });

  test("the return type is a single type: `-> A | B` is a union of the function and B", async () => {
    const ast = (await parseBoth("type U = extern C () -> void | none;")) as {
      datatype: { variant: string; types: { variant: string }[] };
    }[];
    expect(ast[0].datatype.variant).toBe("BinaryUnionTypeExpr");
    expect(ast[0].datatype.types[0].variant).toBe("FunctionTypeExpr");
  });

  test("Haze function types carry no marker", async () => {
    const ast = await parseBoth(
      "type H = (a: i32) -> i32; type C = (a: i32) => i32;"
    );
    expect(countMarked(ast)).toEqual({ externC: 0, haze: 1 });
  });

  test("error: `=>` after `extern C`", async () => {
    const error = await rejectBoth("type X = extern C (a: i32) => i32;");
    expect(error.message).toContain("'->', not '=>'");
    expect([error.line, error.column]).toEqual([1, 27]);
  });

  test("error: `=>` after `extern C`, on a later line", async () => {
    const error = await rejectBoth(
      "struct S {\n    cb: extern C () => void;\n}"
    );
    expect(error.message).toContain("'->', not '=>'");
    expect([error.line, error.column]).toEqual([2, 20]);
  });

  test("error: a language other than C", async () => {
    const error = await rejectBoth("fn q(cb: extern Rust (a: i32) -> i32) {}");
    expect(error.message).toContain("unknown language 'Rust'");
    expect([error.line, error.column]).toEqual([1, 16]);
  });

  test("error: no language", async () => {
    const error = await rejectBoth("type X = extern (a: i32) -> i32;");
    expect(error.message).toContain("expected 'C' after 'extern'");
    expect([error.line, error.column]).toEqual([1, 16]);
  });
});
