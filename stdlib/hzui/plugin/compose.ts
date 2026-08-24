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
    .replace(/(?<![.\w])shallowReactive\s*(?=[<(])/g, "rx.shallowReactive")
    .replace(/(?<![.\w])reactive\s*(?=[<(])/g, "rx.reactive")
    .replace(/(?<![.\w])computed\s*\(/g, "rx.computed(")
    .replace(/(?<![.\w])elementRef\s*(?=[<(])/g, "ui.elementRef");
}

// Setup code: every read must be LIVE (closures capture `instance`, not a
// snapshot), so `props.x` becomes `instance.props().x` at the use site.
export function rewriteDialectAccessors(code: string): string {
  return (
    code
      .replace(/\bprops\./g, "instance.props().")
      .replace(/\bslots\./g, "instance.props().")
      // Forwarded dialect functions. Textual on purpose: haze has no generic
      // function values (`let computed = rx.computed;` is rejected), so these
      // cannot be forwarded by assigning them to variables.
      // `reactive` before nothing in particular -- the lookbehind already
      // stops `shallowReactive(` from matching the `reactive(` rule, since the
      // character in front of it is a word character.
      .replace(/(?<![.\w])shallowReactive\s*(?=[<(])/g, "rx.shallowReactive")
      .replace(/(?<![.\w])reactive\s*(?=[<(])/g, "rx.reactive")
      .replace(/(?<![.\w])computed\s*\(/g, "rx.computed(")
      .replace(/(?<![.\w])elementRef\s*(?=[<(])/g, "ui.elementRef")
  );
}

// ---------------------------------------------------------------------------
// Dialect type aliases.
//
// The types a component names constantly, aliased into every generated file so
// an .hzui never has to spell a namespace: `(e: PointerEvent)`,
// `elementRef<DivElement>()`, `style: { width: SizeMode.Grow }`.
//
// Emitted per file, which is safe because a top-level `type` lands in that
// file's own FileScope (two files in one module can both declare `type presets
// = headwind.presets;` today, and do). The flip side is that these names are
// RESERVED inside an .hzui file: declaring your own type with one of them is a
// redeclaration error. Same deal as the rest of the dialect vocabulary.
//
// The consuming module must therefore depend on ui_components, ui_elements and
// ui_styling -- which every module using this plugin already does, since the
// generated component signature and the class tokens need the first and last
// of those regardless.
// ---------------------------------------------------------------------------
const DIALECT_ALIASES: Record<string, string[]> = {
  ui_components: [
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
    "DivProps",
    "TextProps",
    "CanvasProps",
    "UIContext",
  ],
  ui_elements: ["Element", "DivElement", "TextElement", "CanvasElement"],
  ui_styling: [
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
  ],
};

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
// @props parsing: field names only (for operator!=); the body itself is
// spliced verbatim. Line-based: `name: type = default;` / `name: type;`.
// DESIGN(v0): multi-line defaults are not supported yet.
// ---------------------------------------------------------------------------
function parsePropNames(section: Section): string[] {
  const names: string[] = [];
  section.body.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t === "" || t.startsWith("//")) {
      return;
    }
    const m = /^([A-Za-z_][\w]*)\s*[:?]/.exec(t);
    if (!m) {
      throw new ComposeError(
        `cannot parse @props line: '${t}'`,
        section.bodyStartLine + i
      );
    }
    names.push(m[1]!);
  });
  return names;
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
  const { prelude, sections } = splitSections(source);
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

  push(`#source "${src}:1" {`);
  push(prelude.trimEnd());
  push(`}`);
  push("");
  push(`// ==== generated by hzui SFC transformer from ${filepath} ====`);
  push("");
  push(`// generated: dialect type aliases -- see DIALECT_ALIASES. These names`);
  push(`// are reserved inside an .hzui file.`);
  for (const ns of Object.keys(DIALECT_ALIASES)) {
    for (const name of DIALECT_ALIASES[ns]!) {
      push(`type ${name} = ${ns}.${name};`);
    }
  }
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
    push(`// 'ui.componentRef<${exposeName}>()' + 'ref=' on the tag. A ref struct`);
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
    push(`    exposeRef?: ui_components.ComponentRef<${exposeName}>;`);
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
  push(`    fn operator!=(other: ${argsName}) {`);
  push(`        return this.id != other.id`);
  for (const p of propNames) {
    push(`            || this.${p} != other.${p}`);
  }
  push(`            ;`);
  push(`    }`);
  push(`}`);
  push("");

  // Emits struct
  if (emits.length > 0) {
    push(`struct ${emitsName} {`);
    push(`    instance: ui_components.InstanceData<${argsName}>;`);
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

  // Component function
  push(`export fn ${fnName}(ui: ui_components.UIContext, args: ${argsName}) {`);
  push(
    `    ui.defineComponent(args.id, args, (instance: ui_components.InstanceData<${argsName}>) => {`
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
      `                let __expose: ui_components.ComponentRef<${exposeName}> = __exposeOpt;`
    );
    push(
      `                __expose := ${exposeName} { ${exposeNames
        .map((n) => `${n}: ${n}`)
        .join(", ")} };`
    );
    push(`                // A destroyed component's API must not stay callable.`);
    push(`                ui.onUnmount(() => { __expose := null; });`);
    push(`            }`);
    push(`}`);
  }
  const ctx: TemplateContext = {
    componentName: comp,
    sourceFile: src,
    presetNamespace: "presets",
    slots: new Map(slots.map((s) => [s.name, slotStructName(s)])),
    rewriteExpr: rewriteTemplateExpr,
  };

  push("");
  // The template closure returns the root element's props -- see
  // ui_components.ComponentInstance.currentTemplate.
  push(`        return (): ui_components.DivProps => {`);
  push(`            let props = instance.props();`);
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
  push(lowerRootProps(rootHead, templateSec ? templateSec.markerLine : 1, ctx, 3));
  push(`        };`);
  push(`    });`);
  push(`}`);
  push("");

  return out.join("\n");
}
