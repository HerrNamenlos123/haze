// ============================================================================
// Composer: assembles the final haze file from the split sections.
// Verbatim sections are spliced untouched (modulo dialect-accessor rewrites);
// everything else is fixed boilerplate. docs/sfc-button-lowered.hz is the
// output contract this aims at.
//
// Source mapping: `#source` directives are emitted around every spliced
// region. Verbatim sections use OFFSET mode (`#source "file:line" { ... }`
// -- line-by-line mapping, columns preserved because verbatim lines are
// spliced at their original indentation); lowered template statements use
// PIN mode (`#source "file:line:col" { stmt }`) pointing at the element
// head. Paths are relative (basename), resolved by the parsers against the
// directory of the file being parsed -- which IS the original file, since
// the transform result is parsed under the original filepath.
// ============================================================================

import { splitSections, type Section } from "./sections";
import {
  lowerRootProps,
  lowerTemplate,
  parseRootHead,
  TemplateError,
  type ElementNode,
  type TemplateContext,
} from "./template";

export class ComposeError extends Error {
  constructor(
    message: string,
    public line: number
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Dialect accessors. DESIGN(v0): placeholder names -- `props.`, `slots.` and
// `emits.` are reserved words of the SFC dialect (users cannot declare them).
// `props.x`/`slots.x` are rewritten textually; `emits` is a real generated
// local, so it needs no rewrite. TODO(user): final naming.
// ---------------------------------------------------------------------------
// Template expressions: the render closure binds `let props = instance.props();`
// once per render (a per-frame snapshot is exactly right in immediate mode),
// so `props.x` stays a field path on a local -- which the compiler can
// narrow (`[props.style.fontSize]?font-size-[props.style.fontSize]`), unlike
// two separate `instance.props()` calls.
export function rewriteTemplateExpr(code: string): string {
  return code
    .replace(/\bslots\./g, "props.")
    .replace(/(?<![.\w])elementRef\s*(?=[<(])/g, "ui.elementRef");
}

// Setup code: every read must be LIVE (closures capture `instance`, not a
// snapshot), so `props.x` becomes `instance.props().x` at the use site.
export function rewriteDialectAccessors(code: string): string {
  return (
    code
      .replace(/\bprops\./g, "instance.props().")
      .replace(/\bslots\./g, "instance.props().")
      // `elementRef` is the one dialect function that is not a free symbol:
      // it is a method on the UIContext, so it cannot be imported and has to
      // be routed to the `ui` the component function was handed. `<` as well
      // as `(`, because `elementRef<DivElement>()` is just as ordinary as the
      // bare call. Everything else the dialect offers by bare name --
      // `computed`, `reactive`, `shallowReactive`, every type -- is a real
      // symbol imported from hzui, so it needs no rewrite at all.
      .replace(/(?<![.\w])elementRef\s*(?=[<(])/g, "ui.elementRef")
  );
}

// ---------------------------------------------------------------------------
// The dialect surface: one import, from hzui.
//
// A component names these constantly -- `(e: PointerEvent)`,
// `elementRef<DivElement>()`, `text: Reactive<str>`, `width: SizeMode.Grow` --
// and the code this transformer generates around it names more of them still
// (InstanceData, DivProps, mergeDivStyle, Px). None of that should oblige an
// .hzui file, or its haze.toml, to know which of half a dozen modules a given
// name lives in. So the generated file opens with a single
//
//   from hzui import PointerEvent, DivElement, computed, presets, ...
//
// and hzui re-exports the lot. A component's module depends on hzui, and on
// nothing else the framework happens to be built out of.
//
// IMPORTED, not re-declared per file. `type PointerEvent =
// ui_components.PointerEvent;` at the top of every .hzui was the obvious
// alternative, and it puts a file-local name in two places where only the real
// symbol will do:
//
//   1. As a GENERIC ARGUMENT: `elementRef<DivElement>()` has to yield the same
//      ElementRef instantiation a hand-written .hz file would get, or the two
//      do not convert.
//   2. In an EXPORTED declaration: `@props` becomes an exported struct, so
//      `text: Reactive<str>` mirrors into the module's import.hz -- a name from
//      inside one file escaping into a public API, which no consumer can
//      resolve.
//
// A `from` import introduces no new name of its own: what the file holds IS
// hzui's symbol, so both positions behave exactly as hand-written haze does.
// That is also why the list is emitted whole rather than filtered down to the
// names a given component happens to use -- an unused import costs nothing,
// and "happens to use" is not a question a textual pass can answer.
//
// These names are RESERVED inside an .hzui file: a local or type of your own
// called `Key` or `Element` would collide with the import.
// ---------------------------------------------------------------------------
export const DIALECT_IMPORTS: string[] = [
  // Reactivity: the handle types and the three constructors. The constructors
  // are imported rather than rewritten to `rx.computed` because haze has no
  // generic function values -- `let computed = rx.computed;` is rejected -- so
  // an import is the only way to give them a bare name.
  "Reactive",
  "ShallowReactive",
  "Computed",
  "UnwrapReactive",
  "reactive",
  "shallowReactive",
  "computed",

  // Components: events, refs, the props structs, the context, and the
  // per-instance data the generated component function is handed.
  "PointerEvent",
  "WheelEvent",
  "KeyboardEvent",
  "TextInputEvent",
  "FocusEvent",
  "PointerEdge",
  "KeyEdge",
  "Key",
  "PointerButton",
  "PointerButtons",
  "PointerEventKind",
  "KeyEdgeKind",
  "FocusEventKind",
  "ElementRef",
  "ComponentRef",
  "ElementWrapper",
  "DivProps",
  "TextProps",
  "CanvasProps",
  "UIContext",
  "InstanceData",

  // Elements: what an `ElementRef<...>` is taken over.
  "Element",
  "DivElement",
  "TextElement",
  "CanvasElement",

  // Styling: the enums a prop declares, plus what a lowered class list builds
  // -- `mergeDivStyle` and the three length units.
  "Size",
  "SizeMode",
  "Direction",
  "CrossAlign",
  "Packing",
  "Overflow",
  "Position",
  "Display",
  "Cursor",
  "DivStyle",
  "TextStyle",
  "Length",
  "Px",
  "Em",
  "Rem",
  "mergeDivStyle",

  // The class-list presets, as a namespace: a lowered class token is a
  // `presets.wFit()` call, and which ones appear depends on the template.
  "presets",

  // hzui's own runtime helpers, named by generated code.
  "keyId",
];

/** The single import line every generated file opens with. */
export function dialectImportLine(): string {
  return `from hzui import ${DIALECT_IMPORTS.join(", ")}`;
}

function sourceBasename(filepath: string): string {
  return filepath.replace(/\\/g, "/").split("/").pop()!;
}

function pascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function componentNameFromFile(filepath: string): string {
  const base = filepath.replace(/\\/g, "/").split("/").pop()!;
  const stem = base.replace(/\.[^.]*$/, "");
  // button -> Button, tab_bar / tab-bar -> TabBar
  return stem
    .split(/[-_]/)
    .map((s) => pascal(s))
    .join("");
}

// ---------------------------------------------------------------------------
// @props parsing. The body itself is spliced verbatim; what is extracted here
// is what the generated operator!= needs: each field's name, its own line (so
// a comparison that fails to compile points at the prop that caused it), and
// whether it is OPTIONAL -- which changes how it can be compared at all.
// Line-based: `name: type = default;` / `name?: type;`.
// DESIGN(v0): multi-line defaults are not supported yet.
// ---------------------------------------------------------------------------
type PropDecl = {
  name: string;
  line: number;
  optional: boolean;
  /** A reactive handle: stable for the prop's life, so never worth comparing. */
  stable: boolean;
};

function parsePropNames(section: Section): PropDecl[] {
  const props: PropDecl[] = [];

  let nextUntracked = false;
  section.body.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t === "" || t.startsWith("//")) {
      return;
    }
    if (t === "[[hzui.untracked]]") {
      nextUntracked = true;
      return;
    }
    const m = /^([A-Za-z_][\w]*)\s*(\??)\s*:(.*)$/.exec(t);
    if (!m) {
      throw new ComposeError(
        `cannot parse @props line: '${t}'`,
        section.bodyStartLine + i
      );
    }
    // Optional either way it can be written: `x?: T` or `x: T | none`. The
    // second form is checked only for a top-level `none` member, because
    // treating a NON-optional field as optional is the dangerous direction --
    // `x is none` on a non-union is itself a compile error.
    const typeText = m[3]!.split("=")[0]!;
    const optional =
      m[2] === "?" || /(^|\|)\s*none\s*(\||$)/.test(typeText.trim());
    // A Reactive/ShallowReactive/Computed prop is a HANDLE. The handle is
    // stable for as long as the parent passes the same one, and the value
    // inside it is tracked by the reactive system itself -- a template that
    // reads it re-runs on its own. So comparing it decides nothing, and `!=`
    // on an opaque builtin handle very likely does not compile anyway.
    const stable = /(^|[^\w.])(rx\.)?(Shallow)?(Reactive|Computed)\s*</.test(
      typeText
    );
    props.push({
      name: m[1]!,
      line: section.bodyStartLine + i,
      optional: optional,
      stable: stable || nextUntracked,
    });
    nextUntracked = false;
  });
  return props;
}

// @emit entries: `name: (Type, Type,);`
type EmitDecl = { name: string; argTypes: string[] };
function parseEmits(section: Section): EmitDecl[] {
  const out: EmitDecl[] = [];
  section.body.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t === "" || t.startsWith("//")) {
      return;
    }
    const m = /^([A-Za-z_][\w]*)\s*:\s*\(([^)]*)\)\s*;$/.exec(t);
    if (!m) {
      throw new ComposeError(
        `cannot parse @emit line: '${t}' (expected 'name: (ArgType,);')`,
        section.bodyStartLine + i
      );
    }
    out.push({
      name: m[1]!,
      argTypes: m[2]!
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
    });
  });
  return out;
}

// @expose entries: `name: Type;` -- one line per published member. Only the
// NAMES are needed here (to bind each one to the setup local of the same
// name); the body itself is spliced verbatim into the generated struct.
function parseExposeNames(section: Section): string[] {
  const names: string[] = [];
  section.body.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t === "" || t.startsWith("//")) {
      return;
    }
    const m = /^([A-Za-z_][\w]*)\s*[:?]/.exec(t);
    if (!m) {
      throw new ComposeError(
        `cannot parse @expose line: '${t}' (expected 'name: Type;')`,
        section.bodyStartLine + i
      );
    }
    names.push(m[1]!);
  });
  return names;
}

// @slot entries: `name: { fields };` or `name: ();` (no fields).
//
// EVERY slot gets a payload struct, even an empty one, so every slot closure
// has exactly ONE parameter. Arity is the one thing about a slot a use site
// cannot see -- the component is in another file -- so a provider that omits
// the payload name (`#body { ... }`, which the syntax allows) would otherwise
// have to guess it, and guessing wrong is a type error pointing at the call
// rather than at the omission. One shape means there is nothing to guess.
type SlotDecl = { name: string; payloadBody: string };
function parseSlots(section: Section): SlotDecl[] {
  const out: SlotDecl[] = [];
  const src = section.body;
  const re = /([A-Za-z_][\w]*)\s*:\s*(\(\s*\)|\{)/g;
  for (;;) {
    const m = re.exec(src);
    if (m === null) {
      break;
    }
    if (m[2] === "{") {
      // brace-count to the matching close (struct-body only, bounded)
      let depth = 1;
      let i = re.lastIndex;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") {
          depth++;
        }
        if (src[i] === "}") {
          depth--;
        }
        i++;
      }
      out.push({
        name: m[1]!,
        payloadBody: src.slice(re.lastIndex, i - 1).trim(),
      });
      re.lastIndex = i;
    } else {
      // `name: ();` -- a payload struct with no fields, not the absence of one.
      out.push({ name: m[1]!, payloadBody: "" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main composition
// ---------------------------------------------------------------------------

export function compose(filepath: string, source: string): string {
  const { prelude, sections, exported, fonts } = splitSections(source);
  const get = (name: string) => sections.find((s) => s.name === name);

  const comp = componentNameFromFile(filepath);
  const propsSec = get("props");
  const emitSec = get("emit");
  const slotSec = get("slot");
  const exposeSec = get("expose");
  const setupSec = get("setup");
  const templateSec = get("template");

  const propNames = propsSec ? parsePropNames(propsSec) : [];
  const emits = emitSec ? parseEmits(emitSec) : [];
  const slots = slotSec ? parseSlots(slotSec) : [];
  const exposeNames = exposeSec ? parseExposeNames(exposeSec) : [];

  const argsName = `${comp}Args`;
  const emitsName = `${comp}Emits`;
  const slotStructName = (s: SlotDecl) => `${comp}Slot${pascal(s.name)}`;
  // The EXPOSED struct gets the component's bare name, and the component
  // function is suffixed instead. The type is the one a parent writes by hand
  // (`ui.componentRef<Dialog>()`); the function is only ever written by the
  // transformer, or by a hand-written parent mounting the component. The good
  // name goes to the thing humans type.
  const exposeName = comp;
  const fnName = `${comp}Component`;

  const out: string[] = [];
  const push = (s: string) => out.push(s);

  const src = sourceBasename(filepath);

  // The dialect, in one line, before anything that could name it. Outside a
  // `#source` block on purpose: it corresponds to no line of the .hzui file,
  // so an error on it has nowhere honest to point.
  push(dialectImportLine());
  push("");

  push(`#source "${src}:1" {`);
  push(prelude.trimEnd());
  push(`}`);
  push("");
  push(`// ==== generated by hzui SFC transformer from ${filepath} ====`);
  push("");

  // Slot payload structs -- one per slot, empty if the slot declares no
  // fields. See SlotDecl for why there is no payload-less shape.
  for (const s of slots) {
    push(`export struct ${slotStructName(s)} {`);
    for (const line of s.payloadBody.split("\n")) {
      if (line.trim() !== "") {
        push(`    ${line.trim()}`);
      }
    }
    push(`}`);
    push("");
  }

  // Exposed API struct -- what a parent gets from a `ref=` on this component.
  if (exposeSec) {
    push(`// This component's public API: what a parent reaches through`);
    push(
      `// 'ui.componentRef<${exposeName}>()' + 'ref=' on the tag. A ref struct`
    );
    push(`// because a ComponentRef holds it as '${exposeName} | null'.`);
    push(`export ref struct ${exposeName} {`);
    push(`#source "${src}:${exposeSec.bodyStartLine}" {`);
    push(exposeSec.body.trimEnd());
    push(`}`);
    push(`}`);
    push("");
  }

  // Args struct
  push(`export struct ${argsName} {`);
  push(`    id: int;`);
  if (exposeSec) {
    push("");
    push(`    // generated: where this component publishes its API. Excluded`);
    push(`    // from operator!= below -- it is written once, during setup,`);
    push(`    // and never participates in whether the template re-runs.`);
    push(`    exposeRef?: ComponentRef<${exposeName}>;`);
  }
  if (propsSec) {
    push("");
    push(`#source "${src}:${propsSec.bodyStartLine}" {`);
    push(propsSec.body.trimEnd());
    push(`}`);
  }
  if (emits.length > 0) {
    push("");
    for (const e of emits) {
      const params = e.argTypes.map((t, i) => `e${i}: ${t}`).join(", ");
      push(`    on${pascal(e.name)}?: (${params}) => none;`);
    }
  }
  if (slots.length > 0) {
    push("");
    for (const s of slots) {
      push(`    ${s.name}?: (s: ${slotStructName(s)}) => none;`);
    }
  }
  push("");
  push(`    // generated: compares exactly the @props fields. Emits and`);
  push(`    // slots (closures) are excluded by construction.`);
  push(`    //`);
  push(
    `    // Statements rather than one boolean chain so that each field can`
  );
  push(`    // carry its own #source: a field whose type turns out not to be`);
  push(`    // comparable then reports at ITS line in the @props section,`);
  push(`    // instead of at a line number in generated code that does not`);
  push(`    // exist in the .hzui file at all.`);
  push(`    fn operator!=(other: ${argsName}) {`);
  const propsAnchor = propsSec ? propsSec.markerLine : 1;
  push(`#source "${src}:${propsAnchor}:1" {`);
  push(`        if this.id != other.id { return true; }`);
  push(`}`);
  for (const p of propNames) {
    if (p.stable) {
      push(
        `        // ${p.name}: a reactive handle -- see PropDecl.stable. The`
      );
      push(
        `        // handle does not change, and what is inside it is tracked`
      );
      push(
        `        // by the reactive system, so there is nothing here to compare.`
      );
      continue;
    }
    push(`#source "${src}:${p.line}:1" {`);
    if (p.optional) {
      // `!=` on an `T | none` has no conversion to the bare T, so an optional
      // field is compared in two steps: presence, then value only when both
      // sides actually have one. Bound to locals first because the narrowing
      // from `is not none` does not travel across two separate field reads.
      const a = `__a_${p.name}`;
      const b = `__b_${p.name}`;
      push(`        let ${a} = this.${p.name};`);
      push(`        let ${b} = other.${p.name};`);
      push(`        if (${a} is none) != (${b} is none) { return true; }`);
      push(`        if ${a} is not none {`);
      push(`            if ${b} is not none {`);
      push(`                if ${a} != ${b} { return true; }`);
      push(`            }`);
      push(`        }`);
    } else {
      push(`        if this.${p.name} != other.${p.name} { return true; }`);
    }
    push(`}`);
  }
  push(`        return false;`);
  push(`    }`);
  push(`}`);
  push("");

  // Emits struct
  if (emits.length > 0) {
    push(`struct ${emitsName} {`);
    push(`    instance: InstanceData<${argsName}>;`);
    for (const e of emits) {
      const params = e.argTypes.map((t, i) => `e${i}: ${t}`).join(", ");
      const fwd = e.argTypes.map((_, i) => `e${i}`).join(", ");
      push(`    fn ${e.name}(${params}) {`);
      push(`        let p = this.instance.props();`);
      push(
        `        if p.on${pascal(e.name)} { p.on${pascal(e.name)}(${fwd}); }`
      );
      push(`    }`);
    }
    push(`}`);
    push("");
  }

  // The component's own root element, declared on the @template marker line.
  let rootHead: ElementNode | null = null;
  if (templateSec && templateSec.markerArg.trim() !== "") {
    try {
      rootHead = parseRootHead(templateSec.markerArg, templateSec.markerLine);
    } catch (e) {
      if (e instanceof TemplateError) {
        throw new ComposeError(
          e.message,
          e.line >= 0 ? e.line : templateSec.markerLine
        );
      }
      throw e;
    }
  }

  // Component function. `export` only when the file opens with `@export`: a
  // component is module-local by default, and crosses the module boundary only
  // when it says so. The generated types around it (the Args struct, the slot
  // payloads, the exposed struct) stay exported unconditionally -- they are
  // names a caller in ANOTHER file of the same module already has to write.
  push(
    `${exported ? "export " : ""}fn ${fnName}(ui: UIContext, args: ${argsName}) {`
  );
  push(
    `    ui.defineComponent(args.id, args, (instance: InstanceData<${argsName}>) => {`
  );
  if (emits.length > 0) {
    push(`        let emits = ${emitsName} { instance: instance };`);
  }
  if (setupSec) {
    push("");
    push(`#source "${src}:${setupSec.bodyStartLine}" {`);
    push(rewriteDialectAccessors(setupSec.body.trimEnd()));
    push(`}`);
  }
  if (exposeSec) {
    // Published ONCE, here at the end of setup: setup runs once per instance
    // and the members it built are stable for the instance's whole life, so
    // there is nothing to refresh on later renders. Each field binds to the
    // setup local of the same name -- a missing or wrongly-typed one is an
    // ordinary type error, pointed back at the @expose line.
    //
    // Bound to an explicitly-typed local first: the narrowing from `is not
    // none` does not travel into the onUnmount closure below, and a closure
    // assigned into an optional field is exactly the case that needs a
    // pre-bound local anyway.
    push("");
    push(`#source "${src}:${exposeSec.bodyStartLine}:1" {`);
    push(`            let __exposeOpt = instance.props().exposeRef;`);
    push(`            if __exposeOpt is not none {`);
    push(
      `                let __expose: ComponentRef<${exposeName}> = __exposeOpt;`
    );
    push(
      `                __expose := ${exposeName} { ${exposeNames
        .map((n) => `${n}: ${n}`)
        .join(", ")} };`
    );
    push(
      `                // A destroyed component's API must not stay callable.`
    );
    push(`                ui.onUnmount(() => { __expose := null; });`);
    push(`            }`);
    push(`}`);
  }
  let componentIds = 0;
  const ctx: TemplateContext = {
    componentName: comp,
    sourceFile: src,
    presetNamespace: "presets",
    slots: new Map(slots.map((s) => [s.name, slotStructName(s)])),
    rewriteExpr: rewriteTemplateExpr,
    nextComponentId: () => ++componentIds,
  };

  push("");
  // The template closure returns the root element's props -- see
  // ui_components.ComponentInstance.currentTemplate.
  push(`        return (): DivProps => {`);
  push(`            let props = instance.props();`);
  // `@font name [expr]`: bind a font to a name, right here at the top of the
  // RENDER body rather than in setup.
  //
  // The body, because that is where a reactive read is tracked. The expression
  // is evaluated on every run of the template computed, so a font held in a
  // `computed`/`reactive` makes THIS component's template a subscriber: change
  // the computed and the template re-runs, this line rebinds the name, and
  // every element already selecting that name renders with the new font. A
  // font can therefore be chosen dynamically -- theme, user setting, whatever
  // -- with no separate registration step and nothing to keep in sync. Put
  // this in setup and the binding would be whatever the font happened to be
  // on the frame the component mounted, forever.
  //
  // The TOP of the body, because elements are declared below it: the name has
  // to mean something before anything this frame selects it.
  //
  // Costing nothing when nothing changed is the runtime's job, in two layers --
  // see ui_components.UIContext.provideFont.
  for (const f of fonts) {
    push(`#source "${src}:${f.line}:1" {`);
    push(
      `            ui.provideFont("${f.name}", ${rewriteTemplateExpr(f.expr)});`
    );
    push(`}`);
  }
  if (templateSec) {
    try {
      push(lowerTemplate(templateSec.body, templateSec.bodyStartLine, ctx, 3));
    } catch (e) {
      if (e instanceof TemplateError) {
        throw new ComposeError(
          e.message,
          e.line >= 0 ? e.line : templateSec.bodyStartLine
        );
      }
      throw e;
    }
  }
  push(
    lowerRootProps(rootHead, templateSec ? templateSec.markerLine : 1, ctx, 3)
  );
  push(`        };`);
  push(`    });`);
  push(`}`);
  push("");

  return out.join("\n");
}
