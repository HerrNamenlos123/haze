import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

type Callee = "CompilerError" | "GenericDeductionIncompleteError" | "assertCompilerError" | "printErrorMessage" | "printWarningMessage";

type Match = {
  file: string;
  line: number;
  callee: Callee;
  code: number;
  codeStart: number;
  codeEnd: number;
  msgText: string; // best-effort static text, "" if none available
  fallback: string; // enclosing function/method name, for naming when msgText is empty
};

const files = [
  "src/Parser/Parser.ts",
  "src/SymbolCollection/SymbolCollection.ts",
  "src/Semantic/SemanticTypes.ts",
  "src/Semantic/Conversion.ts",
  "src/Semantic/CTFE.ts",
  "src/Semantic/SemanticBuilder.ts",
  "src/Semantic/Elaborate.ts",
  "src/ProjectCompiler/ProjectCompiler.ts",
  "src/Lower/Lower.ts",
];

const calleeMsgArgIndex: Record<Callee, number> = {
  CompilerError: 0,
  GenericDeductionIncompleteError: 0,
  assertCompilerError: 1,
  printErrorMessage: 0,
  printWarningMessage: 0,
};

function staticTextOf(node: ts.Expression): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    for (const span of node.templateSpans) {
      s += span.literal.text;
    }
    return s;
  }
  return "";
}

function enclosingNameOf(node: ts.Node): string {
  let cur: ts.Node | undefined = node;
  while (cur) {
    if (
      (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) &&
      cur.name
    ) {
      return cur.name.getText();
    }
    if (
      (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) &&
      ts.isVariableDeclaration(cur.parent) &&
      ts.isIdentifier(cur.parent.name)
    ) {
      return cur.parent.name.getText();
    }
    cur = cur.parent;
  }
  return "Error";
}

const allMatches: Match[] = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  function visit(node: ts.Node) {
    let callee: Callee | null = null;
    let args: readonly ts.Expression[] = [];

    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.arguments) {
      const name = node.expression.text;
      if (name === "CompilerError" || name === "GenericDeductionIncompleteError") {
        callee = name;
        args = node.arguments;
      }
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (name === "assertCompilerError" || name === "printErrorMessage" || name === "printWarningMessage") {
        callee = name;
        args = node.arguments;
      }
    }

    if (callee && args.length > 0) {
      const last = args[args.length - 1];
      if (ts.isNumericLiteral(last)) {
        const code = Number(last.text);
        const msgArg = args[calleeMsgArgIndex[callee]];
        const msgText = msgArg ? staticTextOf(msgArg) : "";
        const fallback = enclosingNameOf(node);
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        allMatches.push({
          file,
          line: line + 1,
          callee,
          code,
          codeStart: last.getStart(sourceFile),
          codeEnd: last.getEnd(),
          msgText,
          fallback,
        });
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

console.log(`Found ${allMatches.length} coded diagnostic call sites across ${files.length} files.`);

// ── Name generation ──────────────────────────────────────────────────────

function slugify(raw: string, fallback: string): string {
  let s = raw.replace(/\$\{[^}]*\}/g, " ");
  s = s.replace(/[^A-Za-z0-9]+/g, " ").trim();
  let words = s.split(/\s+/).filter(Boolean);

  // Drop leading filler words that don't carry meaning.
  const stopwords = new Set(["the", "a", "an", "is", "of", "to", "in", "on", "at", "for"]);
  words = words.filter((w) => !stopwords.has(w.toLowerCase()));

  words = words.slice(0, 8);
  let name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  name = name.replace(/[^A-Za-z0-9]/g, "");
  if (name.length > 64) {
    name = name.slice(0, 64);
  }
  if (!name) {
    name = fallback.charAt(0).toUpperCase() + fallback.slice(1);
  }
  if (/^[0-9]/.test(name)) {
    name = "_" + name;
  }
  return name;
}

const usedNames = new Map<string, number>();
function uniqueName(base: string): string {
  const count = usedNames.get(base) ?? 0;
  usedNames.set(base, count + 1);
  if (count === 0) {
    return base;
  }
  return `${base}${count + 1}`;
}

type EnumEntry = { name: string; code: number; comment: string };
const entries: EnumEntry[] = [];

for (const m of allMatches) {
  const rawText = m.msgText || m.fallback;
  const base = slugify(rawText, m.fallback);
  const name = uniqueName(base);
  const commentSource = (m.msgText || `(${m.fallback})`).replace(/\s+/g, " ").trim();
  const comment = commentSource.length > 90 ? commentSource.slice(0, 90) + "…" : commentSource;
  entries.push({ name, code: m.code, comment });
  (m as any).name = name;
}

// ── Emit src/shared/ErrorCodes.ts ───────────────────────────────────────

const byCode = [...entries].sort((a, b) => a.code - b.code);
let ts_out = "";
ts_out += "// Auto-generated once by scripts/build-error-enum.ts from the numeric codes that\n";
ts_out += "// were already at each throw site, then hand-maintained from here on: add new\n";
ts_out += "// members by hand when adding new diagnostics, following the same ranges. Do not\n";
ts_out += "// renumber an existing member — the value is the stable, load-bearing part.\n";
ts_out += "//\n";
ts_out += "// Mirrored on the Haze side in testsuite/src/error_codes.hz (same names, same\n";
ts_out += "// values) so the test suite can assert on named codes instead of magic numbers.\n";
ts_out += "// Keep both files in sync by hand when adding entries.\n";
ts_out += "export enum HazeErrorCode {\n";
for (const e of byCode) {
  ts_out += `  ${e.name} = ${e.code}, // ${e.comment}\n`;
}
ts_out += "}\n";
writeFileSync("src/shared/ErrorCodes.ts", ts_out, "utf8");

// ── Emit testsuite/src/error_codes.hz ───────────────────────────────────

let hz_out = "";
hz_out += "\n";
hz_out += "// Auto-generated once by scripts/build-error-enum.ts, mirroring\n";
hz_out += "// src/shared/ErrorCodes.ts (same names, same values) so test cases can assert on\n";
hz_out += "// named codes instead of magic numbers. Keep both files in sync by hand when\n";
hz_out += "// adding entries on the TypeScript side.\n";
hz_out += "\n";
hz_out += "namespace errorcodes {\n";
hz_out += "    export enum Code {\n";
for (const e of byCode) {
  hz_out += `        ${e.name} = ${e.code},\n`;
}
hz_out += "    }\n";
hz_out += "\n";
hz_out += "    export fn toInt(c: Code): int {\n";
hz_out += "        let n = 0;\n";
hz_out += '        __c__("n = (int)c;");\n';
hz_out += "        return n;\n";
hz_out += "    }\n";
hz_out += "}\n";
writeFileSync("testsuite/src/error_codes.hz", hz_out, "utf8");

// ── Rewrite call sites ───────────────────────────────────────────────────

const byFile = new Map<string, Match[]>();
for (const m of allMatches) {
  if (!byFile.has(m.file)) byFile.set(m.file, []);
  byFile.get(m.file)!.push(m);
}

for (const [file, matches] of byFile) {
  let text = readFileSync(file, "utf8");
  const sorted = [...matches].sort((a, b) => b.codeStart - a.codeStart);
  for (const m of sorted) {
    const replacement = `HazeErrorCode.${(m as any).name}`;
    text = text.slice(0, m.codeStart) + replacement + text.slice(m.codeEnd);
  }
  writeFileSync(file, text, "utf8");
  console.log(`${file}: rewrote ${matches.length} call site(s)`);
}

// Print the mapping for the special call sites so cases_examples.hz can be updated.
console.log("\nSpecial codes for updating testsuite/src/cases_examples.hz:");
for (const m of allMatches) {
  if ([1000, 4001, 9003].includes(m.code)) {
    console.log(`  ${m.code} -> ${(m as any).name}`);
  }
}
