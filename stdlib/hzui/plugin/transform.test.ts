// Golden + unit tests for the hzui SFC transformer.
//
//   bun test stdlib/hzui/plugin/transform.test.ts
//   UPDATE_GOLDEN=1 bun test ...   -- regenerate the .expected.hz files
//
// The golden files lock the exact generated output; review the diff whenever
// the transformer changes. docs/sfc-button-lowered.hz is the (hand-written)
// spec the button golden should converge toward.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import plugin from "./index";
import { splitSections } from "./sections";
import { lowerClassList, parseClassToken } from "./classlist";

const FIXTURES = join(import.meta.dir, "fixtures");

function golden(name: string) {
  const input = readFileSync(join(FIXTURES, `${name}.hzui`), "utf-8");
  const result = plugin.transform(`${name}.hzui`, input);
  expect(result).not.toBeNull();
  const expectedPath = join(FIXTURES, `${name}.expected.hz`);
  if (process.env["UPDATE_GOLDEN"] || !existsSync(expectedPath)) {
    writeFileSync(expectedPath, result!.code);
  }
  expect(result!.code).toBe(readFileSync(expectedPath, "utf-8"));
  // Every golden must be brace-balanced (ignoring strings/comments would be
  // overkill here -- fixtures contain no braces in literals).
  const opens = (result!.code.match(/\{/g) ?? []).length;
  const closes = (result!.code.match(/\}/g) ?? []).length;
  expect(opens).toBe(closes);
}

describe("sfc transform", () => {
  test("declines plain .hz files", () => {
    expect(plugin.transform("plain.hz", "fn main() {}\n")).toBeNull();
    expect(plugin.transform("plain.hz", "@props\n")).toBeNull();
  });

  test("rejects .hzui files without markers", () => {
    expect(() => plugin.transform("x.hzui", "fn main() {}\n")).toThrow(
      /section marker/
    );
  });

  test("button golden", () => golden("button"));
  test("usage golden", () => golden("usage"));
  // Compiled end-to-end against the real runtime (dev compiler, both parser
  // modes) on 2026-08-23 -- keep it minimal enough to stay compilable.
  test("widget golden", () => golden("widget"));
});

describe("sections", () => {
  test("splits and preserves line numbers", () => {
    const r = splitSections("import x\n@props\na: int;\n@setup\nlet y = 1;\n");
    expect(r.prelude).toBe("import x");
    expect(r.sections.map((s) => s.name)).toEqual(["props", "setup"]);
    expect(r.sections[0]!.bodyStartLine).toBe(3);
    expect(r.sections[1]!.body).toBe("let y = 1;\n");
  });

  test("rejects out-of-order sections", () => {
    expect(() => splitSections("@setup\n@props\n")).toThrow(/before/);
    expect(() => splitSections("@template\n@setup\n")).toThrow(/before/);
  });

  test("declaration sections may appear in any order", () => {
    const r = splitSections("@slot\n@emit\n@props\n@setup\n@template\n");
    expect(r.sections.map((s) => s.name)).toEqual([
      "slot",
      "emit",
      "props",
      "setup",
      "template",
    ]);
  });

  test("rejects duplicates", () => {
    expect(() => splitSections("@props\n@props\n")).toThrow(/duplicate/);
  });
});

describe("class tokens", () => {
  test("static tokens camelCase mechanically", () => {
    expect(parseClassToken("cross-align-center").fn).toBe("crossAlignCenter");
    expect(parseClassToken("row").fn).toBe("row");
  });

  test("numeric suffix becomes the argument", () => {
    expect(parseClassToken("gap-0")).toMatchObject({ fn: "gap", args: ["0"] });
    expect(parseClassToken("w-4")).toMatchObject({ fn: "w", args: ["4"] });
  });

  test("bracket holds an expression, unit outside, px default", () => {
    expect(parseClassToken("bg-[backgroundColor]").args).toEqual([
      "backgroundColor",
    ]);
    expect(parseClassToken("px-[props.style.paddingX]px").args).toEqual([
      "ui_styling.Px { value: (props.style.paddingX) }",
    ]);
    expect(parseClassToken("w-[10]em").args).toEqual([
      "ui_styling.Em { value: (10) }",
    ]);
  });

  test("conditions: single identifier or [expr]; member access must be bracketed", () => {
    expect(parseClassToken("[props.grow]?w-grow").condition).toBe(
      "(props.grow)"
    );
    expect(() => parseClassToken("props.grow?w-grow")).toThrow(
      /single identifier/
    );
    expect(parseClassToken("!enabled?cursor-default").condition).toBe(
      "!(enabled)"
    );
    expect(parseClassToken("[a > b]?w-grow").condition).toBe("(a > b)");
  });

  test("lowering keeps source order (runtime is last-wins)", () => {
    const lowered = lowerClassList("w-fit grow?w-grow", "presets");
    expect(lowered[0]).toBe("presets.wFit()");
    expect(lowered[1]).toBe("grow ? presets.wGrow() : presets.noop()");
  });

  test("explicit values are unscaled Px/Em/Rem; scale numbers stay plain", () => {
    expect(parseClassToken("p-[8]").args).toEqual([
      "ui_styling.Px { value: (8) }",
    ]);
    expect(parseClassToken("p-[8]px").args).toEqual([
      "ui_styling.Px { value: (8) }",
    ]);
    expect(parseClassToken("w-[1.5]em").args).toEqual([
      "ui_styling.Em { value: (1.5) }",
    ]);
    expect(parseClassToken("w-[2]rem").args).toEqual([
      "ui_styling.Rem { value: (2) }",
    ]);
    expect(parseClassToken("gap-1.5").args).toEqual(["1.5"]);
    expect(() => parseClassToken("w-1/2")).toThrow(/percent/);
  });
});
