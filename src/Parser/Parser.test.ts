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

/** Starts the native parser server for the enclosing describe block. */
function useBothParsers() {
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
}

describe("`type` as a name, in both parsers", () => {
  useBothParsers();

  // `type` is a keyword (`type X = ...`), and still a name wherever a member
  // or a function is named (memberNameId in the grammar, memberName() in the
  // native parser).
  const positions: [string, string][] = [
    ["method", "struct S { mut fn type(text: str) {} }"],
    ["free function", "fn type(text: str) {}"],
    ["generic free function", "fn type<T>(t: T) {}"],
    ["data member", "struct S { type: str; }"],
    ["anonymous struct member", "type A = { type: str, n: i32 };"],
    ["tagged union tag", "type U = union { type: i32, other: str };"],
    ["member access and call", 'fn f(s: S) { s.type("x"); let t = s.type; }'],
    ["struct literal key", "fn f() { let s = S { type: 1 }; }"],
  ];

  for (const [position, source] of positions) {
    test(position, async () => {
      const ast = await parseBoth(source);
      const text = JSON.stringify(ast, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
      );
      expect(text).toMatch(/"(name|tag|member|key)":"type"/);
    });
  }
});

type FunctionTypeNode = {
  variant: string;
  returnType: { variant: string };
  types: { variant: string }[];
};

describe("function types return a union, in both parsers", () => {
  useBothParsers();

  // As in TypeScript: `() => A | B` returns `A | B`; a union with a function
  // in it wraps the function, `(() => A) | B`.
  const datatype = async (source: string) =>
    ((await parseBoth(source)) as { datatype: FunctionTypeNode }[])[0]
      .datatype;

  test("`() => A | B` returns A | B", async () => {
    const type = await datatype("type T = () => A | none;");
    expect(type.variant).toBe("CallableTypeExpr");
    expect(type.returnType.variant).toBe("BinaryUnionTypeExpr");
  });

  test("`(a: i32) -> A | B` returns A | B", async () => {
    const type = await datatype("type T = (a: i32) -> A | none;");
    expect(type.variant).toBe("FunctionTypeExpr");
    expect(type.returnType.variant).toBe("BinaryUnionTypeExpr");
  });

  test("a wrapped function is a member of the union", async () => {
    const type = await datatype("type T = (() => A) | none;");
    expect(type.variant).toBe("BinaryUnionTypeExpr");
    expect(type.types[0].variant).toBe("CallableTypeExpr");
  });

  test("a function returning a function returning A | B", async () => {
    const type = (await datatype(
      "type T = () => () => A | none;"
    )) as unknown as { returnType: FunctionTypeNode };
    expect(type.returnType.variant).toBe("CallableTypeExpr");
    expect(type.returnType.returnType.variant).toBe("BinaryUnionTypeExpr");
  });

  test("a requires block after the union", async () => {
    const type = await datatype("type T = () => A | none :: pure;");
    expect(type.returnType.variant).toBe("BinaryUnionTypeExpr");
  });

  test("a struct member, as TextInput's caretBox", async () => {
    await parseBoth("struct S { caretBox: () => Box | none; }");
  });
});

describe("extern C function types, in both parsers", () => {
  useBothParsers();

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
      "type U = none | (extern C () -> void) | (extern C (a: i32) -> i32);",
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

  test("as every function type, `-> A | B` returns A | B", async () => {
    const ast = (await parseBoth("type U = extern C () -> void | none;")) as {
      datatype: FunctionTypeNode & { externLanguage: EExternLanguage };
    }[];
    expect(ast[0].datatype.variant).toBe("FunctionTypeExpr");
    expect(ast[0].datatype.externLanguage).toBe(EExternLanguage.Extern_C);
    expect(ast[0].datatype.returnType.variant).toBe("BinaryUnionTypeExpr");
  });

  test("a wrapped extern C function is a member of the union", async () => {
    const ast = (await parseBoth(
      "type U = (extern C () -> void) | none;"
    )) as { datatype: FunctionTypeNode }[];
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

/**
 * Both parsers refuse the source. ANTLR throws a bare SyntaxError for what the
 * grammar does not accept, and the native parser a message of its own, so only
 * the refusal is compared (rejectBoth compares the custom messages).
 */
async function rejectBothAny(source: string) {
  expect("error" in parseWithAntlr(source)).toBe(true);
  expect("error" in (await parseWithNative(source))).toBe(true);
}

type MemberNode = { name: string; private: boolean; mutability: number };
type MethodNode = {
  name: string;
  private: boolean;
  static: boolean;
  methodRequiredMutability: number | null;
  methodReceiverStorage: number | null;
  originalSourcecode: string;
};
type StructNode = {
  variant: "StructDefinition";
  members: MemberNode[];
  methods: MethodNode[];
  nestedStructs: unknown[];
};

describe("`private` struct members, in both parsers", () => {
  useBothParsers();

  const struct = async (body: string) =>
    ((await parseBoth(`struct S { ${body} }`)) as StructNode[])[0];

  test("private fields in every spelling", async () => {
    const s = await struct(
      "private a: int; private b: int = 3; private const c: int; private let d: int; private e = 3; f: int; const g: int;"
    );
    expect(s.members.map((m) => [m.name, m.private])).toEqual([
      ["a", true],
      ["b", true],
      ["c", true],
      ["d", true],
      ["e", true],
      ["f", false],
      ["g", false],
    ]);
    // `const` / `let` after `private` keep their meaning.
    expect(s.members[2].mutability).toBe(1);
    expect(s.members[3].mutability).toBe(2);
  });

  test("private methods in every spelling", async () => {
    const s = await struct(
      "private fn a() {} private static fn b() {} private mut fn c() {} private stackref fn d() {} private ref fn e() {} private const fn f() {} fn g() {}"
    );
    expect(s.methods.map((m) => [m.name, m.private])).toEqual([
      ["a", true],
      ["b", true],
      ["c", true],
      ["d", true],
      ["e", true],
      ["f", true],
      ["g", false],
    ]);
    expect(s.methods[1].static).toBe(true);
    expect(s.methods[2].methodRequiredMutability).toBe(2);
    expect(s.methods[3].methodReceiverStorage).toBe(3);
    // `private` is part of the method's own source text, so a re-emitted
    // generic method keeps it.
    expect(s.methods[0].originalSourcecode.startsWith("private fn a")).toBe(
      true
    );
  });

  test("private operators, constructors and generic methods", async () => {
    const s = await struct(
      "private fn operator==(o: S): bool { return true; } private fn operator[](i: int): int { return i; } private fn constructor() {} private fn g<T>(t: T) {}"
    );
    expect(s.methods.map((m) => m.private)).toEqual([true, true, true, true]);
  });

  test("a private member in a generic struct and after an annotation", async () => {
    const ast = (await parseBoth(
      "struct G<T> { [[a.b]] private x: T; private fn m(): T { return this.x; } }"
    )) as StructNode[];
    expect(ast[0].members[0].private).toBe(true);
    expect(ast[0].methods[0].private).toBe(true);
  });

  // `const` and `let` before a data member are its mutability. The native
  // parser used to read `const` as a method modifier and lose it.
  const mutabilityForms: [string, number][] = [
    ["const a: int;", 1],
    ["const a: int = 1;", 1],
    ["const a = 1;", 1],
    ["let a: int;", 2],
    ["let a: int = 1;", 2],
    ["let a = 1;", 2],
    ["a: int;", 3],
    ["a = 1;", 3],
    ["private const a: int;", 1],
    ["private const a: int = 1;", 1],
    ["private const a = 1;", 1],
    ["private let a: int = 1;", 2],
    ["private let a = 1;", 2],
    ["[[x.y]] const a: int = 1;", 1],
    ["[[x.y]] private const a = 1;", 1],
  ];
  for (const [member, mutability] of mutabilityForms) {
    test(`data member mutability: ${member}`, async () => {
      const s = await struct(member);
      expect(s.members.length).toBe(1);
      expect(s.members[0].mutability).toBe(mutability);
    });
  }

  test("`const fn` is still a method modifier", async () => {
    const s = await struct("const fn a() {} private const fn b() {} const a2: int;");
    expect(s.methods.map((m) => m.methodRequiredMutability)).toEqual([3, 3]);
    expect(s.members[0].mutability).toBe(1);
  });

  test("a nested struct's members are private on their own", async () => {
    const ast = (await parseBoth(
      "struct O { a: int; struct I { private b: int; } private c: int; }"
    )) as StructNode[];
    const inner = ast[0].nestedStructs[0] as StructNode;
    expect(ast[0].members.map((m) => m.private)).toEqual([false, true]);
    expect(inner.members.map((m) => m.private)).toEqual([true]);
  });

  test("the names of members and methods are unchanged", async () => {
    const s = await struct("private x: int; private fn f() {}");
    expect(s.members[0].name).toBe("x");
    expect(s.methods[0].name).toBe("f");
  });

  test("members without `private` are public", async () => {
    const ast = (await parseBoth(
      "struct S { a: int; fn f() {} } fn free() {} type A = { x: int };"
    )) as (StructNode & { private?: boolean })[];
    expect(ast[0].members[0].private).toBe(false);
    expect(ast[0].methods[0].private).toBe(false);
  });

  test("`private` is a reserved word", async () => {
    await rejectBothAny("fn f() { let private = 1; }");
    await rejectBothAny("struct S { fn private() {} }");
    await rejectBothAny("fn private() {}");
  });

  test("error: `private` on a nested struct or enum", async () => {
    await rejectBothAny("struct S { private struct I { a: int; } }");
    await rejectBothAny("struct S { private enum E { A, B } }");
  });

  test("error: `private` outside a struct", async () => {
    await rejectBothAny("private fn f() {}");
    await rejectBothAny("private let x = 1;");
    await rejectBothAny("type A = { private x: int };");
  });

  test("error: `private` after `static` or the method modifiers", async () => {
    await rejectBothAny("struct S { static private fn f() {} }");
    await rejectBothAny("struct S { mut private fn f() {} }");
    await rejectBothAny("struct S { let private x: int; }");
  });
});

type GlobalNode = {
  variant: "GlobalVariableDefinition";
  name: string;
  storage: string;
  mutability: number;
  comptime: boolean;
  extern: number;
  export: boolean;
  pub: boolean;
};

describe("`tasklocal` and `global`, in both parsers", () => {
  useBothParsers();

  const globals = async (source: string) =>
    (await parseBoth(source)) as GlobalNode[];

  test("every form, and `thread` when neither is written", async () => {
    const g = await globals(
      "tasklocal let a: int = 1; tasklocal const b = 2; global let c: int = 3; global const d = 4; let e: int = 5; const f = 6;"
    );
    expect(g.map((x) => [x.name, x.storage])).toEqual([
      ["a", "task"],
      ["b", "task"],
      ["c", "process"],
      ["d", "process"],
      ["e", "thread"],
      ["f", "thread"],
    ]);
    expect(g.map((x) => x.mutability)).toEqual([2, 1, 2, 1, 2, 1]);
  });

  test("after export, extern and pub, before let and comptime", async () => {
    const g = await globals(
      "export global const a = 1; export tasklocal let b: int = 2; pub global const c = 3; extern C pub global const d: int; global const comptime e = 5;"
    );
    expect(g.map((x) => x.storage)).toEqual([
      "process",
      "task",
      "process",
      "process",
      "process",
    ]);
    expect(g[0].export).toBe(true);
    expect(g[2].pub).toBe(true);
    expect(g[3].extern).toBe(2);
    expect(g[4].comptime).toBe(true);
  });

  test("in a namespace", async () => {
    const ast = (await parseBoth(
      "namespace n { global const a = 1; tasklocal let b: int = 2; }"
    )) as { declarations: GlobalNode[] }[];
    expect(ast[0].declarations.map((d) => d.storage)).toEqual([
      "process",
      "task",
    ]);
  });

  test("both are reserved words", async () => {
    await rejectBothAny("fn f() { let global = 1; }");
    await rejectBothAny("fn f() { let tasklocal = 1; }");
    await rejectBothAny("let global = 1;");
    await rejectBothAny("struct S { global: int; }");
  });

  test("error: on a local variable", async () => {
    await rejectBothAny("fn f() { tasklocal let x: int = 1; }");
    await rejectBothAny("fn f() { global let x: int = 1; }");
    await rejectBothAny("fn f() { global const x = 1; }");
    await rejectBothAny("fn f() { if true { tasklocal const x = 1; } }");
    await rejectBothAny("struct S { fn m() { global let x: int = 1; } }");
  });

  test("error: on anything but a variable", async () => {
    await rejectBothAny("global fn f() {}");
    await rejectBothAny("tasklocal struct S { a: int; }");
    await rejectBothAny("struct S { global let a: int; }");
  });

  test("error: both keywords, or the wrong order", async () => {
    await rejectBothAny("global tasklocal let x: int = 1;");
    await rejectBothAny("let global x: int = 1;");
    await rejectBothAny("global pub let x: int = 1;");
  });
});

type Stage5StructNode = {
  variant: "StructDefinition";
  name: string;
  atomic: boolean;
  crossthread: boolean;
  unsafeCrossthread: boolean;
  opaque: boolean;
  refByDefault: boolean;
  members: (MemberNode & { unsafe: boolean; type: unknown })[];
  nestedStructs: Stage5StructNode[];
};

/** The variant chain of a type expression: `atomic []int` is AtomicTypeExpr, DynamicArrayTypeExpr, SymbolValueExpr. */
function typeChain(type: unknown): string[] {
  const chain: string[] = [];
  let node = type as { variant: string; type?: unknown } | undefined;
  while (node && typeof node === "object" && "variant" in node) {
    chain.push(node.variant);
    node = node.type as typeof node;
  }
  return chain;
}

describe("`atomic`, `crossthread` and `unsafe` (stage 5), in both parsers", () => {
  useBothParsers();

  const structs = async (source: string) =>
    (await parseBoth(source)) as Stage5StructNode[];

  test("struct modifiers in any order", async () => {
    const s = await structs(
      "atomic ref struct A {} ref atomic struct B {} crossthread struct C {} unsafe crossthread struct D {} opaque unsafe crossthread ref struct E {} export atomic opaque ref crossthread struct F {} struct G {}"
    );
    expect(
      s.map((x) => [
        x.name,
        x.atomic,
        x.crossthread,
        x.unsafeCrossthread,
        x.refByDefault,
        x.opaque,
      ])
    ).toEqual([
      ["A", true, false, false, true, false],
      ["B", true, false, false, true, false],
      ["C", false, true, false, false, false],
      ["D", false, false, true, false, false],
      ["E", false, false, true, true, true],
      ["F", true, true, false, true, true],
      ["G", false, false, false, false, false],
    ]);
  });

  test("a nested struct with the modifiers, in a namespace", async () => {
    const ast = (await parseBoth(
      "namespace n { struct O { a: int; atomic ref struct I { n: atomic int; } unsafe crossthread struct U {} } }"
    )) as { declarations: Stage5StructNode[] }[];
    const o = ast[0].declarations[0];
    expect(
      o.nestedStructs.map((x) => [x.name, x.atomic, x.unsafeCrossthread])
    ).toEqual([
      ["I", true, false],
      ["U", false, true],
    ]);
  });

  test("`unsafe` on fields in every spelling", async () => {
    const s = await structs(
      "atomic opaque ref struct S { private unsafe a: int; private unsafe b: int = 3; private unsafe const c: int; private unsafe let d: int; private unsafe e = 3; unsafe f: int; private g: int; h: int; }"
    );
    expect(s[0].members.map((m) => [m.name, m.private, m.unsafe])).toEqual([
      ["a", true, true],
      ["b", true, true],
      ["c", true, true],
      ["d", true, true],
      ["e", true, true],
      ["f", false, true],
      ["g", true, false],
      ["h", false, false],
    ]);
    expect(s[0].members.map((m) => m.mutability)).toEqual([
      3, 3, 1, 2, 3, 3, 3, 3,
    ]);
  });

  test("an anonymous struct type has no unsafe members", async () => {
    const ast = await parseBoth("type T = { a: int, b = 2 };");
    const members =
      JSON.stringify(ast, (_k, v) =>
        typeof v === "bigint" ? String(v) : v
      ).match(/"unsafe":(true|false)/g) ?? [];
    expect(members).toEqual(['"unsafe":false', '"unsafe":false']);
  });

  test("atomic and crossthread type modifiers", async () => {
    const s = await structs(
      "struct S { a: atomic int; b: atomic []int; c: mut atomic []Job; d: atomic mut []int; e: crossthread (x: int) => str; f: crossthread () => none; g: []atomic int; h: atomic bool; }"
    );
    expect(s[0].members.map((m) => typeChain(m.type))).toEqual([
      ["AtomicTypeExpr", "SymbolValueExpr"],
      ["AtomicTypeExpr", "DynamicArrayTypeExpr", "SymbolValueExpr"],
      [
        "MutTypeExpr",
        "AtomicTypeExpr",
        "DynamicArrayTypeExpr",
        "SymbolValueExpr",
      ],
      [
        "AtomicTypeExpr",
        "MutTypeExpr",
        "DynamicArrayTypeExpr",
        "SymbolValueExpr",
      ],
      ["CrossthreadTypeExpr", "CallableTypeExpr"],
      ["CrossthreadTypeExpr", "CallableTypeExpr"],
      ["DynamicArrayTypeExpr", "AtomicTypeExpr", "SymbolValueExpr"],
      ["AtomicTypeExpr", "SymbolValueExpr"],
    ]);
  });

  test("crossthread on parameters, results, aliases and with immediate", async () => {
    await parseBoth(
      "type Job = crossthread () => none; alias J2 = crossthread (x: int) => int; fn g(body: crossthread () => int, b: immediate crossthread () => int): crossthread () => int { return body; } global let n: atomic int = 0; let jobs: atomic []int = [];"
    );
  });

  test("both are reserved words", async () => {
    await rejectBothAny("fn f() { let atomic = 1; }");
    await rejectBothAny("fn f() { let crossthread = 1; }");
    await rejectBothAny("let atomic = 1;");
    await rejectBothAny("struct S { crossthread: int; }");
    await rejectBothAny("fn atomic() {}");
  });

  test("error: unsafe before a method, alone on a struct, or after private's place", async () => {
    await rejectBothAny("struct S { private unsafe fn m() {} }");
    await rejectBothAny("struct S { unsafe fn m() {} }");
    await rejectBothAny("struct S { unsafe mut fn m() {} }");
    await rejectBothAny("unsafe struct S {}");
    await rejectBothAny("struct S { unsafe private a: int; }");
    await rejectBothAny("crossthread unsafe struct S {}");
    // `unsafe crossthread` is a struct modifier only, never a type's.
    await rejectBothAny("fn f(x: unsafe crossthread () => int) {}");
  });
});

describe("`:: context` on an extern C function, in both parsers", () => {
  useBothParsers();
  const requiresOf = (ast: unknown) =>
    (ast as { requires: { context: boolean; final: boolean } }[])[0].requires;

  test("a declaration that takes the context", async () => {
    const r = requiresOf(
      await parseBoth("extern C fn entry(x: i32): i32 :: context;")
    );
    expect(r.context).toBe(true);
  });

  test("next to final, in either order", async () => {
    const a = requiresOf(
      await parseBoth("extern C fn entry(): i32 :: final, context;")
    );
    const b = requiresOf(
      await parseBoth("extern C fn entry(): i32 :: context, final;")
    );
    expect([a.context, a.final, b.context, b.final]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  test("absent, it is false", async () => {
    const r = requiresOf(await parseBoth("extern C fn entry(): i32 :: final;"));
    expect(r.context).toBe(false);
  });

  test("any other word is rejected the same way", async () => {
    const error = await rejectBoth("extern C fn entry(): i32 :: frobnicate;");
    expect(error.message).toContain("'frobnicate' is not a function requirement");
  });

  // Requirements are a function's; on a struct or enum nothing would read them.
  test("a struct takes no requirements", async () => {
    const error = await rejectBoth("struct S :: context { x: i32 = 0; }");
    expect(error.message).toContain("a struct takes no requirements");
    expect([error.line, error.column]).toEqual([1, 9]);
  });

  test("a generic struct takes none either, not even final", async () => {
    const error = await rejectBoth("struct S<T> :: final {\n    x: T;\n}");
    expect(error.message).toContain("a struct takes no requirements");
    expect([error.line, error.column]).toEqual([1, 12]);
  });

  test("an enum takes no requirements", async () => {
    const error = await rejectBoth("enum E :: context { A, B }");
    expect(error.message).toContain("an enum takes no requirements");
    expect([error.line, error.column]).toEqual([1, 7]);
  });
});
