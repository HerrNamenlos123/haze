// ensureAntlrParserCurrent: what the build and the installer use to keep the
// generated ANTLR parser in step with the grammar. Run against a throwaway
// repo whose `generate-parser` script is a stand-in (no Java needed): it
// writes the generated parser and counts its runs, or fails on request.

import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureAntlrParserCurrent,
  isAntlrParserCurrent,
} from "./AntlrGrammar";

const root = mkdtempSync(join(tmpdir(), "haze-antlr-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let repos = 0;

function repo(generatorFails = false) {
  const dir = join(root, `r${repos++}`);
  const grammar = join(dir, "src", "Parser", "grammar");
  mkdirSync(join(grammar, "autogen"), { recursive: true });
  writeFileSync(join(grammar, "HazeLexer.g4"), "lexer grammar HazeLexer;\n");
  writeFileSync(join(grammar, "HazeParser.g4"), "parser grammar HazeParser;\n");
  writeFileSync(
    join(dir, "generate.js"),
    [
      'const fs = require("node:fs");',
      'const runs = "runs.txt";',
      'fs.writeFileSync(runs, String(Number(fs.existsSync(runs) ? fs.readFileSync(runs, "utf8") : 0) + 1));',
      generatorFails
        ? "process.exit(1);"
        : 'fs.writeFileSync("src/Parser/grammar/autogen/HazeParser.ts", "// generated\\n");',
      "",
    ].join("\n")
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { "generate-parser": "node generate.js" } })
  );
  return dir;
}

const runs = (dir: string) =>
  existsSync(join(dir, "runs.txt"))
    ? Number(readFileSync(join(dir, "runs.txt"), "utf8"))
    : 0;
const stamp = join("src", "Parser", "grammar", "autogen", ".grammar-hash");

describe("ensureAntlrParserCurrent", () => {
  test("a generated parser without a matching stamp is regenerated and stamped", () => {
    const dir = repo();
    writeFileSync(join(dir, "src/Parser/grammar/autogen/HazeParser.ts"), "// old\n");
    writeFileSync(join(dir, stamp), "stale");
    expect(isAntlrParserCurrent(dir)).toBe(false);
    expect(ensureAntlrParserCurrent(dir)).toBe("");
    expect(runs(dir)).toBe(1);
    expect(isAntlrParserCurrent(dir)).toBe(true);
  });

  test("a current one is left alone", () => {
    const dir = repo();
    expect(ensureAntlrParserCurrent(dir)).toBe("");
    expect(ensureAntlrParserCurrent(dir)).toBe("");
    expect(runs(dir)).toBe(1);
  });

  test("force regenerates a current one, and stamps it", () => {
    const dir = repo();
    expect(ensureAntlrParserCurrent(dir)).toBe("");
    expect(ensureAntlrParserCurrent(dir, { force: true })).toBe("");
    expect(runs(dir)).toBe(2);
    expect(isAntlrParserCurrent(dir)).toBe(true);
  });

  test("a generator that fails gives its reason and no stamp", () => {
    const dir = repo(true);
    const failure = ensureAntlrParserCurrent(dir);
    expect(failure).toContain("could not be regenerated");
    expect(existsSync(join(dir, stamp))).toBe(false);
    expect(isAntlrParserCurrent(dir)).toBe(false);
  });
});
