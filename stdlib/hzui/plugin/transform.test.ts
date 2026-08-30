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
import { DIALECT_IMPORTS, dialectImportLine } from "./compose";
import { lowerClassList, parseClassToken } from "./classlist";

/** Transforms a whole SFC and returns the generated haze. */
function gen(source: string): string {
  return plugin.transform("x.hzui", source)!.code;
}

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
  test("fonts golden", () => golden("fonts"));
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

describe("@export", () => {
  test("a component is module-local by default", () => {
    const code = gen("@template\n");
    expect(code).toContain("fn XComponent(");
    expect(code).not.toContain("export fn XComponent(");
  });

  test("@export declares the component function export", () => {
    expect(gen("@export\n@template\n")).toContain("export fn XComponent(");
  });

  test("may be preceded by comments and blank lines only", () => {
    expect(splitSections("// licence\n\n@export\n@template\n").exported).toBe(
      true
    );
    expect(() => splitSections("import x\n@export\n@template\n")).toThrow(
      /must come first/
    );
    expect(() => splitSections("@props\n@export\n")).toThrow(/must come first/);
  });

  test("exactly one, with no arguments", () => {
    expect(() => splitSections("@export\n@export\n@template\n")).toThrow(
      /duplicate @export/
    );
    expect(() => splitSections("@export Button\n@template\n")).toThrow(
      /takes no arguments/
    );
  });

  test("keeps the prelude's line numbers", () => {
    // The blanked marker line must not shift what follows it: `import x` is
    // still line 2, so the prelude's `#source "x.hzui:1"` stays honest.
    const r = splitSections("@export\nimport x\n@props\na: int;\n");
    expect(r.prelude).toBe("\nimport x");
    expect(r.sections[0]!.bodyStartLine).toBe(4);
  });
});

describe("@font", () => {
  test("binds a name to an expression, in the render body", () => {
    const code = gen("@setup\nlet b = f();\n@font icons [b]\n@template\n");
    expect(code).toContain('ui.provideFont("icons", b);');
    // In the render closure, after `props` is bound and before anything that
    // could select the font -- not in setup, which runs once.
    const body = code.indexOf("return (): DivProps => {");
    const call = code.indexOf('ui.provideFont("icons"');
    expect(body).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(body);
  });

  test("may appear any number of times", () => {
    const code = gen("@font a [x]\n@font b [y]\n@template\n");
    expect(code).toContain('ui.provideFont("a", x);');
    expect(code).toContain('ui.provideFont("b", y);');
    expect(
      splitSections("@font a [x]\n@font b [y]\n@template\n").fonts
    ).toEqual([
      { name: "a", expr: "x", line: 1 },
      { name: "b", expr: "y", line: 2 },
    ]);
  });

  test("the expression is arbitrary, and dialect-rewritten like a template one", () => {
    // A prop, a call, a subscript: whatever produces Bytes. The `]` inside
    // `arr[0]` must close on the LAST bracket, not the first.
    const code = gen(
      "@font a [props.face]\n@font b [pick(1)]\n@font c [arr[0]]\n@template\n"
    );
    expect(code).toContain('ui.provideFont("a", props.face);');
    expect(code).toContain('ui.provideFont("b", pick(1));');
    expect(code).toContain('ui.provideFont("c", arr[0]);');
    // `slots.` is rewritten to `props.` in the render body, same as a template
    // expression -- the directive is evaluated there, so it gets that scope.
    expect(gen("@font a [slots.face]\n@template\n")).toContain(
      'ui.provideFont("a", props.face);'
    );
  });

  test("carries its own #source, so an error points at the directive", () => {
    const code = gen("@template\n\n\n@font icons [nope]\n");
    expect(code).toContain('#source "x.hzui:4:1" {');
  });

  test("rejects anything that is not exactly 'name [expression]'", () => {
    const bad = [
      "@font\n", // nothing at all
      "@font icons\n", // no expression
      "@font [b]\n", // no name
      "@font icons b\n", // unbracketed expression
      "@font icons [b\n", // unterminated
      "@font icons b]\n", // unopened
      "@font icons []\n", // empty expression
      "@font icons [b] extra\n", // trailing junk
      "@font icons [a] [b]\n", // two expressions
      "@font 1icons [b]\n", // not an identifier
      "@font icons[b]\n", // no space: not the documented shape
    ];
    for (const src of bad) {
      expect(() => splitSections(src + "@template\n")).toThrow(
        /@font takes exactly/
      );
    }
  });

  test("may sit anywhere, without shifting a section body's line numbers", () => {
    // Inside @setup: the directive line is blanked in place, so `let y = 2;`
    // is still line 4 and the body's #source mapping stays honest.
    const r = splitSections("@setup\nlet x = 1;\n@font a [x]\nlet y = 2;\n");
    expect(r.fonts).toEqual([{ name: "a", expr: "x", line: 3 }]);
    expect(r.sections[0]!.body).toBe("let x = 1;\n\nlet y = 2;\n");
    expect(r.sections[0]!.bodyStartLine).toBe(2);
  });

  test("@export still has to come before it", () => {
    expect(splitSections("@export\n@font a [x]\n@template\n").exported).toBe(
      true
    );
    expect(() => splitSections("@font a [x]\n@export\n@template\n")).toThrow(
      /must come first/
    );
  });

  test("a file with no @font emits no font call", () => {
    expect(gen("@template\n")).not.toContain("provideFont");
    expect(splitSections("@template\n").fonts).toEqual([]);
  });
});

describe("the template root element", () => {
  const withHead = (head: string, body = "") =>
    gen(`import ui_components\n@template ${head}\n${body}`);

  test("a bare @template still returns root props", () => {
    expect(gen("import ui_components\n@template\n")).toContain(
      "return { id: 0 };"
    );
  });

  test("class tokens become the root's own style", () => {
    const out = withHead("[row gap-2]");
    expect(out).toContain("style: mergeDivStyle({},");
    expect(out).toContain("presets.row()");
    expect(out).toContain("presets.gap(2)");
  });

  test("refs, attrs and events all reach the root DivProps", () => {
    const out = withHead("[row] ref=r focusable=true @click=onTap");
    expect(out).toContain("elementRef: r,");
    expect(out).toContain("focusable: true,");
    expect(out).toContain("onClick: onTap,");
  });

  test("the head may wrap across lines like any element head", () => {
    const out = gen(
      [
        "import ui_components",
        "@template [",
        "        row",
        "        gap-2",
        "    ]",
        "    ref=r",
        "",
        "text [] [props.title]",
      ].join("\n")
    );
    expect(out).toContain("elementRef: r,");
    expect(out).toContain("presets.gap(2)");
    // The blank line ended the head: the text is a child, not head junk.
    expect(out).toContain("ui.text({ id: 1, text: props.title });");
  });

  test("the head takes no control flow, content or block", () => {
    expect(() => withHead("[row] if=enabled")).toThrow(/cannot be conditional/);
    expect(() => withHead("[row] { }")).toThrow(/takes no block/);
    expect(() => withHead('[row] "hello"')).toThrow(/unexpected content/);
  });

  test("nothing from outside reaches the root", () => {
    // No class prop, no passthrough of any kind: the root element belongs to
    // the template that declares it.
    const out = withHead("[row]");
    expect(out).not.toContain("class");
  });
});

describe("events", () => {
  test("every DivProps callback is reachable on a builtin element", () => {
    const out = gen(
      "import ui_components\n@template\ndiv [] @hover-enter=a @text-input-capture=b @wheel=c"
    );
    expect(out).toContain("onHoverEnter: a");
    expect(out).toContain("onTextInputCapture: b");
    expect(out).toContain("onWheel: c");
  });

  test("separators and case in an event name do not matter", () => {
    const out = gen(
      "import ui_components\n@template\ndiv [] @pointerdown=a @pointer-up=b @pointerMove=c"
    );
    expect(out).toContain("onPointerDown: a");
    expect(out).toContain("onPointerUp: b");
    expect(out).toContain("onPointerMove: c");
  });

  test("the non-primary button events are ordinary builtin events", () => {
    const out = gen(
      "import ui_components\n@template\ndiv [] @auxclick=a @context-menu=b @contextMenuCapture=c"
    );
    expect(out).toContain("onAuxClick: a");
    expect(out).toContain("onContextMenu: b");
    expect(out).toContain("onContextMenuCapture: c");
  });

  test("dblclick and double-click are the same event", () => {
    const out = gen("import ui_components\n@template\ndiv [] @dblclick=a");
    expect(out).toContain("onDoubleClick: a");
    const alt = gen(
      "import ui_components\n@template\ndiv [] @double-click=a @dblclick-capture=b"
    );
    expect(alt).toContain("onDoubleClick: a");
    expect(alt).toContain("onDoubleClickCapture: b");
  });

  test("an unknown event on a builtin element is an error", () => {
    expect(() =>
      gen("import ui_components\n@template\ndiv [] @submit=a")
    ).toThrow(/unknown event/);
  });

  test("on a component, @event binds that component's emit, not an element", () => {
    // No EVENT_MAP lookup at all: the name is the emit's, whatever it is.
    const out = gen(
      "import ui_components\n@template\nBtn [] @click=a @value-changed=b"
    );
    expect(out).toContain("onClick: a");
    expect(out).toContain("onValueChanged: b");
  });

  test("a component's class list is reserved: required, and empty", () => {
    expect(gen("import ui_components\n@template\nBtn []")).toContain(
      "BtnComponent(ui, { id: -2 });"
    );
    expect(() => gen("import ui_components\n@template\nBtn label=x")).toThrow(
      /needs its \(reserved, currently empty\) class list/
    );
    expect(() => gen("import ui_components\n@template\nBtn [w-grow]")).toThrow(
      /styling a component from outside is not supported yet/
    );
  });
});

describe("slots", () => {
  const declare = (decl: string, provide: string) =>
    gen(
      `import ui_components\n@slot\n${decl}\n@template\nBtn [] {\n  ${provide} {\n    text [] ["x"]\n  }\n}`
    );

  test("every slot gets a payload struct, even a field-less one", () => {
    expect(declare("body: {};", "#body s")).toContain(
      "export struct XSlotBody {"
    );
    // `name: ();` is a payload struct with no fields, not the absence of one.
    expect(declare("body: ();", "#body s")).toContain(
      "body?: (s: XSlotBody) => none;"
    );
  });

  test("a slot closure's payload param is named by convention and typed", () => {
    // The use site can see neither the slot's arity nor its payload type --
    // the component is in another file -- and a closure passed into an
    // optional function-typed field gets no inference (H7170). So both are
    // written out: arity is always one, and the type is BtnSlotBody by the
    // same naming rule compose.ts generates the struct with.
    expect(declare("body: {};", "#body")).toContain(
      "body: (__slot: BtnSlotBody) => {"
    );
    expect(declare("body: {};", "#body s")).toContain(
      "body: (s: BtnSlotBody) => {"
    );
  });

  test("a provider binds the whole payload as one name", () => {
    expect(() => declare("body: {};", "#body a b")).toThrow(
      /binds the whole payload as ONE name/
    );
  });

  test("rendering a slot always passes its payload struct", () => {
    const out = gen(
      'import ui_components\n@slot\nbody: {};\n@template\nslot body {\n  text [] ["fallback"]\n}'
    );
    expect(out).toContain("slot_body(XSlotBody {  });");
  });
});

describe("the dialect import", () => {
  const setup = (body: string) => gen(`@setup\n${body}\n@template\n`);

  test("every generated file opens with one import, from hzui", () => {
    const out = gen("@template\n");
    expect(dialectImportLine()).toStartWith("from hzui import ");
    expect(out.split("\n")[0]).toBe(dialectImportLine());
    // ...and it is the ONLY import the transformer emits: a component's module
    // depends on hzui, not on the modules hzui is built out of.
    expect(out.match(/^(?:from \S+ )?import\b/gm)).toHaveLength(1);
  });

  test("bare type names stay bare -- the import is what resolves them", () => {
    expect(setup("let f = (e: PointerEvent) => {};")).toContain(
      "(e: PointerEvent)"
    );
    expect(setup("let r = elementRef<DivElement>();")).toContain(
      "ui.elementRef<DivElement>()"
    );
    expect(setup("let w = SizeMode.Grow;")).toContain("SizeMode.Grow");
  });

  test("an exported @props field names the imported symbol", () => {
    // This is the position an alias could never serve: the args struct is
    // exported, so a file-local name would escape into the module's import.hz.
    // A `from` import introduces no new name -- it IS hzui's symbol.
    expect(gen("@props\nvalue: Reactive<str>;\n@template\n")).toContain(
      "value: Reactive<str>;"
    );
  });

  test("@emit argument types come through unchanged", () => {
    expect(gen("@emit\ntap: (PointerEvent,);\n@template\n")).toContain(
      "onTap?: (e0: PointerEvent) => none;"
    );
  });

  test("the generated boilerplate names imported symbols too", () => {
    const out = gen("@template [row]\n");
    expect(out).toContain("fn XComponent(ui: UIContext, args: XArgs)");
    expect(out).toContain("(instance: InstanceData<XArgs>)");
    expect(out).toContain("return (): DivProps => {");
    expect(out).toContain("style: mergeDivStyle({},");
    // Every namespace the transformer used to spell out is gone from the
    // output; `ui.` (a method on the context) is the only prefix left.
    expect(out).not.toMatch(/\b(?:ui_components|ui_elements|ui_styling|rx)\./);
  });

  test("the import covers every symbol the transformer emits", () => {
    for (const name of [
      "UIContext",
      "InstanceData",
      "DivProps",
      "ComponentRef",
      "mergeDivStyle",
      "Px",
      "Em",
      "Rem",
      "presets",
      "keyId",
      "computed",
      "reactive",
      "shallowReactive",
    ]) {
      expect(DIALECT_IMPORTS).toContain(name);
    }
  });
});

describe("dialect rewrites", () => {
  const setup = (body: string) => gen(`@setup\n${body}\n@template\n`);

  test("rx functions are called by their bare, imported names", () => {
    expect(setup("let a = computed(() => 1);")).toContain("computed(() => 1)");
    expect(setup("let b = reactive<int>(0);")).toContain("reactive<int>(0)");
    expect(setup("let c = shallowReactive<[]int>([]);")).toContain(
      "shallowReactive<[]int>([])"
    );
  });

  test("elementRef is the one that is rewritten -- it is a method on ui", () => {
    // Not a free symbol, so it cannot be imported; it has to reach the
    // UIContext the component function was handed. `<` counts as a call too.
    expect(setup("let r = elementRef();")).toContain("ui.elementRef()");
    expect(setup("let r = elementRef<DivElement>();")).toContain(
      "ui.elementRef<DivElement>()"
    );
  });

  test("a longer name that merely ends in a dialect name is left alone", () => {
    expect(setup("let s = myElementRef<int>(0);")).toContain(
      "let s = myElementRef<int>(0);"
    );
  });

  test("props reads become live reads of the instance", () => {
    expect(setup("let a = props.label;")).toContain(
      "let a = instance.props().label;"
    );
  });
});

describe("generated operator!=", () => {
  const args = (props: string) =>
    gen(`import ui_components\n@props\n${props}\n@template\n`);

  test("a required field is compared directly", () => {
    expect(args('label: str = "";')).toContain(
      "if this.label != other.label { return true; }"
    );
  });

  test("an optional field compares presence first, then value", () => {
    // `!=` on a `T | none` has no conversion to the bare T, so comparing an
    // optional field directly does not compile at all.
    const out = args("color?: Color;");
    expect(out).toContain("let __a_color = this.color;");
    expect(out).toContain(
      "if (__a_color is none) != (__b_color is none) { return true; }"
    );
    expect(out).not.toContain("if this.color != other.color");
  });

  test("`T | none` counts as optional too, `?:` is not the only spelling", () => {
    expect(args("size: real | none = none;")).toContain(
      "let __a_size = this.size;"
    );
  });

  test("a non-optional field is never treated as optional", () => {
    // The dangerous direction: `x is none` on a non-union is itself an error.
    const out = args("nonsense: NoneSuch = {};");
    expect(out).toContain(
      "if this.nonsense != other.nonsense { return true; }"
    );
    expect(out).not.toContain("__a_nonsense");
  });

  test("a reactive handle prop is not compared at all", () => {
    // The handle is stable and its contents are tracked reactively, so
    // comparing it decides nothing -- and `!=` on an opaque builtin handle
    // does not compile.
    for (const decl of [
      "value: Reactive<str>;",
      "value: rx.Reactive<str>;",
      "value: ShallowReactive<[]int>;",
      "value: Computed<bool>;",
    ]) {
      expect(args(decl)).not.toContain("this.value != other.value");
    }
    // ...but a plain prop whose name merely mentions one still is.
    expect(args('reactiveLabel: str = "";')).toContain(
      "if this.reactiveLabel != other.reactiveLabel { return true; }"
    );
  });

  test("each comparison carries its own @props line", () => {
    // Generated code with no #source reports at a line number that does not
    // exist in the .hzui at all -- which is exactly how an uncomparable prop
    // used to surface.
    const out = args("a: int = 0;\nb: int = 0;");
    expect(out).toContain('#source "x.hzui:3:1" {');
    expect(out).toContain('#source "x.hzui:4:1" {');
  });
});

describe("expose", () => {
  const child = (expose: string, setup: string) =>
    gen(
      `import ui_components\n@expose\n${expose}\n@setup\n${setup}\n@template\n`
    );

  test("the exposed struct takes the component's bare name", () => {
    // ...and the component function is suffixed instead, so the good name
    // belongs to the type a parent writes by hand.
    const out = child("focus: () => none;", "let focus = () => {};");
    expect(out).toContain("export ref struct X {");
    expect(out).toContain("fn XComponent(ui: UIContext");
  });

  test("the API is published once, at the end of setup, and cleared on unmount", () => {
    const out = child(
      "focus: () => none;\nreset: () => none;",
      "let focus = () => {};\nlet reset = () => {};"
    );
    expect(out).toContain("exposeRef?: ComponentRef<X>;");
    expect(out).toContain("__expose := X { focus: focus, reset: reset };");
    expect(out).toContain("ui.onUnmount(() => { __expose := null; });");
    // Written once during setup, so it must not affect template memoization.
    expect(out).not.toContain("|| this.exposeRef");
  });

  test("a component with no @expose gets neither the struct nor the prop", () => {
    const out = gen("import ui_components\n@template\n");
    expect(out).not.toContain("exposeRef");
    expect(out).not.toContain("export ref struct X {");
  });

  test("'ref=' on a component binds its exposed API, not an element", () => {
    const out = gen("import ui_components\n@template\nDialog [] ref=d");
    expect(out).toContain("DialogComponent(ui, { id: -2, exposeRef: d });");
    expect(out).not.toContain("elementRef: d");
  });

  test("'ref=' on a builtin element still binds the element", () => {
    expect(gen("import ui_components\n@template\ndiv [] ref=r")).toContain(
      "elementRef: r"
    );
  });
});

describe("class tokens", () => {
  test("static tokens camelCase mechanically", () => {
    expect(parseClassToken("justify-between").fn).toBe("justifyBetween");
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
      "Px { value: (props.style.paddingX) }",
    ]);
    expect(parseClassToken("w-[10]em").args).toEqual(["Em { value: (10) }"]);
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

  test("outline tokens lower by the same mechanical rule", () => {
    expect(parseClassToken("outline-2")).toMatchObject({
      fn: "outline",
      args: ["2"],
    });
    expect(parseClassToken("outline-none")).toMatchObject({
      fn: "outlineNone",
      args: [],
    });
    expect(parseClassToken("outline-color-[c]")).toMatchObject({
      fn: "outlineColor",
      args: ["c"],
    });
    expect(parseClassToken("outline-offset-2")).toMatchObject({
      fn: "outlineOffset",
      args: ["2"],
    });
  });

  test("margin tokens lower like padding, by the same mechanical rule", () => {
    expect(parseClassToken("m-4")).toMatchObject({ fn: "m", args: ["4"] });
    expect(parseClassToken("mx-2")).toMatchObject({ fn: "mx", args: ["2"] });
    expect(parseClassToken("mt-[8]px").args).toEqual(["Px { value: (8) }"]);
    expect(lowerClassList("m-4 mb-1", "presets")).toEqual([
      "presets.m(4)",
      "presets.mb(1)",
    ]);
  });

  test("explicit values are unscaled Px/Em/Rem; scale numbers stay plain", () => {
    expect(parseClassToken("p-[8]").args).toEqual(["Px { value: (8) }"]);
    expect(parseClassToken("p-[8]px").args).toEqual(["Px { value: (8) }"]);
    expect(parseClassToken("w-[1.5]em").args).toEqual(["Em { value: (1.5) }"]);
    expect(parseClassToken("w-[2]rem").args).toEqual(["Rem { value: (2) }"]);
    expect(parseClassToken("gap-1.5").args).toEqual(["1.5"]);
    expect(() => parseClassToken("w-1/2")).toThrow(/percent/);
  });
});
