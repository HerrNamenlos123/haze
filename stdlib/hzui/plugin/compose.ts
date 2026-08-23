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

import { splitClassTokens, parseClassToken } from "./classlist";
import { splitSections, type Section } from "./sections";
import { lowerTemplate, TemplateError, type TemplateContext } from "./template";

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
      .replace(/(?<![.\w])computed\s*\(/g, "rx.computed(")
      .replace(/(?<![.\w])elementRef\s*(?=[<(])/g, "ui.elementRef")
  );
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

// @slot entries: `name: { fields };` or `name: ();` (payload-less).
type SlotDecl = { name: string; payloadBody: string | null };
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
      out.push({ name: m[1]!, payloadBody: null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// @template [w-fit grow?w-grow h-fit] -- component box sizing. Last-wins
// per axis; only sizing tokens are legal on the marker line.
// ---------------------------------------------------------------------------
function lowerComponentBox(markerArg: string, markerLine: number): string[] {
  const arg = markerArg.replace(/\/\/.*$/, "").trim();
  if (arg === "") {
    return [];
  }
  if (!arg.startsWith("[") || !arg.endsWith("]")) {
    throw new ComposeError(
      `@template argument must be a [class list]`,
      markerLine
    );
  }
  const MODES: Record<string, string> = {
    wFit: "Fit",
    wGrow: "Grow",
    hFit: "Fit",
    hGrow: "Grow",
  };
  let width = "ui_styling.SizeMode.Fit";
  let height = "ui_styling.SizeMode.Fit";
  for (const raw of splitClassTokens(arg.slice(1, -1))) {
    const tok = parseClassToken(raw);
    const mode = MODES[tok.fn];
    if (!mode || tok.args.length > 0) {
      throw new ComposeError(
        `only sizing tokens (w-fit/w-grow/h-fit/h-grow) are allowed on @template (got '${raw}')`,
        markerLine
      );
    }
    const expr = `ui_styling.SizeMode.${mode}`;
    const axisIsWidth = tok.fn.startsWith("w");
    const prev = axisIsWidth ? width : height;
    const next = tok.condition ? `${tok.condition} ? ${expr} : ${prev}` : expr;
    if (axisIsWidth) {
      width = next;
    } else {
      height = next;
    }
  }
  return [
    `ui.componentSize(${rewriteDialectAccessors(width)}, ${rewriteDialectAccessors(height)});`,
  ];
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
  const setupSec = get("setup");
  const templateSec = get("template");

  const propNames = propsSec ? parsePropNames(propsSec) : [];
  const emits = emitSec ? parseEmits(emitSec) : [];
  const slots = slotSec ? parseSlots(slotSec) : [];

  const argsName = `${comp}Args`;
  const emitsName = `${comp}Emits`;
  const slotStructName = (s: SlotDecl) =>
    s.payloadBody !== null ? `${comp}Slot${pascal(s.name)}` : null;

  const out: string[] = [];
  const push = (s: string) => out.push(s);

  const src = sourceBasename(filepath);

  push(`#source "${src}:1" {`);
  push(prelude.trimEnd());
  push(`}`);
  push("");
  push(`// ==== generated by hzui SFC transformer from ${filepath} ====`);
  push("");

  // Slot payload structs
  for (const s of slots) {
    const structName = slotStructName(s);
    if (structName) {
      push(`export struct ${structName} {`);
      for (const line of s.payloadBody!.split("\n")) {
        push(`    ${line.trim()}`);
      }
      push(`}`);
      push("");
    }
  }

  // Args struct
  push(`export struct ${argsName} {`);
  push(`    id: int;`);
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
      const structName = slotStructName(s);
      push(
        structName
          ? `    ${s.name}?: (s: ${structName}) => none;`
          : `    ${s.name}?: () => none;`
      );
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

  // Component function
  push(`export fn ${comp}(ui: ui_components.UIContext, args: ${argsName}) {`);
  push(
    `    ui.defineComponent(args.id, args, (instance: ui_components.InstanceData<${argsName}>) => {`
  );
  if (emits.length > 0) {
    push(`        let emits = ${emitsName} { instance: instance };`);
  }
  if (templateSec) {
    for (const l of lowerComponentBox(
      templateSec.markerArg,
      templateSec.markerLine
    )) {
      push(`        ${l}`);
    }
  }
  if (setupSec) {
    push("");
    push(`#source "${src}:${setupSec.bodyStartLine}" {`);
    push(rewriteDialectAccessors(setupSec.body.trimEnd()));
    push(`}`);
  }
  push("");
  push(`        return (): void => {`);
  push(`            let props = instance.props();`);
  if (templateSec) {
    const ctx: TemplateContext = {
      componentName: comp,
      sourceFile: src,
      presetNamespace: "presets",
      slots: new Map(slots.map((s) => [s.name, slotStructName(s)])),
      rewriteExpr: rewriteTemplateExpr,
    };
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
  push(`        };`);
  push(`    });`);
  push(`}`);
  push("");

  return out.join("\n");
}
