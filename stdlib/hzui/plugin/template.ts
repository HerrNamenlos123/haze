// ============================================================================
// Template parser + lowerer.
//
// Element head grammar (docs/sfc-plugin-scope.md §3.2), fixed order:
//     tag  if=/else-if=/else/for=/key=  [classes]  attrs  content  { children }
//
// - A head token is one whitespace-delimited word; `[ ]` groups may contain
//   whitespace (attr values, class expressions, conditions).
// - The head ends at `{` (children block) or at a newline whose next token
//   does not look like a head continuation (`name=`, `@event=`, `[`).
//   DESIGN(v0): content expressions must therefore sit on the head's last
//   line. TODO(user): confirm this termination rule.
// - Capitalized tag = component, lowercase = builtin element.
// - Plain haze `if`/`for` statements in templates are NOT supported in v0 --
//   use `if=` / `for=` (keeps templates declarative; revisit later).
//
// Auto ids: sequential per enclosing children scope. Inside `for=`, `key=`
// is REQUIRED on all direct children; id becomes hzui.keyId(staticId, key).
// ============================================================================

import { lowerClassList } from "./classlist";

export class TemplateError extends Error {
  constructor(
    message: string,
    public line: number
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

type Tok = { text: string; line: number; endLine: number };

function lex(body: string, startLine: number): Tok[] {
  const toks: Tok[] = [];
  let line = startLine;
  let i = 0;
  const n = body.length;
  while (i < n) {
    const ch = body[i]!;
    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "{" || ch === "}") {
      toks.push({ text: ch, line: line, endLine: line });
      i++;
      continue;
    }
    if (ch === "/" && body[i + 1] === "/") {
      while (i < n && body[i] !== "\n") {
        i++;
      }
      continue;
    }
    // A word: runs until whitespace/{/} at bracket depth 0. Brackets may
    // contain anything (strings, spaces, nested brackets); strings may
    // contain anything except newlines.
    const startLineOfTok = line;
    let depth = 0;
    let out = "";
    while (i < n) {
      const c = body[i]!;
      if (c === "\n") {
        // Bracket groups (class lists, [expr] values) may span lines.
        if (depth === 0) {
          break;
        }
        line++;
        out += c;
        i++;
        continue;
      }
      if (c === "/" && body[i + 1] === "/" && depth > 0) {
        // line comments inside multi-line bracket groups
        while (i < n && body[i] !== "\n") {
          i++;
        }
        continue;
      }
      if (c === '"') {
        out += c;
        i++;
        while (i < n && body[i] !== '"') {
          if (body[i] === "\\") {
            out += body[i]!;
            i++;
          }
          if (i < n) {
            out += body[i]!;
            i++;
          }
        }
        if (i < n) {
          out += '"';
          i++;
        }
        continue;
      }
      if (c === "[") {
        depth++;
      }
      if (c === "]") {
        depth--;
      }
      if (depth === 0 && (/\s/.test(c) || c === "{" || c === "}")) {
        break;
      }
      out += c;
      i++;
    }
    toks.push({ text: out, line: startLineOfTok, endLine: line });
  }
  return toks;
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type ControlKind = "if" | "else-if" | "else" | null;

type ElementNode = {
  kind: "element";
  tag: string; // lowercase builtin or Capitalized component
  line: number;
  control: ControlKind;
  controlExpr: string | null;
  forExpr: string | null; // "item in items"
  keyExpr: string | null;
  classList: string | null;
  attrs: { name: string; value: string }[];
  events: { name: string; value: string }[];
  content: string | null; // trailing expression (e.g. text content)
  children: Node[] | null; // null = no block
  slotProvides: { name: string; params: string[]; children: Node[] }[];
};

type SlotRenderNode = {
  kind: "slot";
  name: string;
  line: number;
  payload: { name: string; value: string }[];
  fallback: Node[] | null;
};

type Node = ElementNode | SlotRenderNode;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const ATTRISH_RE = /^(@?[A-Za-z_][\w-]*=|\[)/;
const CONTROL_ATTRS = new Set(["if", "else-if", "for", "key"]);

class Parser {
  private pos = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | null {
    return this.toks[this.pos] ?? null;
  }
  private next(): Tok {
    const t = this.toks[this.pos];
    if (!t) {
      throw new TemplateError("unexpected end of template", -1);
    }
    this.pos++;
    return t;
  }

  parseNodes(terminated: boolean): Node[] {
    const nodes: Node[] = [];
    for (;;) {
      const t = this.peek();
      if (t === null) {
        if (terminated) {
          throw new TemplateError("missing '}'", this.toks.at(-1)?.line ?? -1);
        }
        return nodes;
      }
      if (t.text === "}") {
        if (!terminated) {
          throw new TemplateError("unexpected '}'", t.line);
        }
        this.next();
        return nodes;
      }
      nodes.push(this.parseNode());
    }
  }

  private parseNode(): Node {
    const t = this.peek()!;
    if (t.text === "slot") {
      return this.parseSlotRender();
    }
    if (/^[A-Za-z_]/.test(t.text)) {
      return this.parseElement();
    }
    throw new TemplateError(`unexpected token '${t.text}'`, t.line);
  }

  private parseBlockIfPresent(): Node[] | null {
    if (this.peek()?.text === "{") {
      this.next();
      return this.parseNodes(true);
    }
    return null;
  }

  private parseSlotRender(): SlotRenderNode {
    const kw = this.next(); // 'slot'
    const nameTok = this.next();
    const node: SlotRenderNode = {
      kind: "slot",
      name: nameTok.text,
      line: kw.line,
      payload: [],
      fallback: null,
    };
    // payload attrs: name=expr, until block/head end
    while (this.peek() && /^[A-Za-z_][\w]*=/.test(this.peek()!.text)) {
      const a = this.next().text;
      const eq = a.indexOf("=");
      node.payload.push({
        name: a.slice(0, eq),
        value: parseValue(
          a.slice(eq + 1),
          this.peek()?.line ?? kw.line,
          `slot payload '${a.slice(0, eq)}'`
        ),
      });
    }
    node.fallback = this.parseBlockIfPresent();
    return node;
  }

  private parseElement(): ElementNode {
    const tagTok = this.next();
    if (!/^[A-Za-z_][\w]*$/.test(tagTok.text)) {
      throw new TemplateError(
        `expected an element or component name, got '${tagTok.text}'`,
        tagTok.line
      );
    }
    const node: ElementNode = {
      kind: "element",
      tag: tagTok.text,
      line: tagTok.line,
      control: null,
      controlExpr: null,
      forExpr: null,
      keyExpr: null,
      classList: null,
      attrs: [],
      events: [],
      content: null,
      children: null,
      slotProvides: [],
    };

    let lastLine = tagTok.line;
    for (;;) {
      const t = this.peek();
      if (t === null || t.text === "}") {
        break;
      }
      if (t.text === "{") {
        this.next();
        this.parseChildren(node);
        break;
      }
      // head-continuation rule: a token on a NEW line only continues the
      // head if it looks like an attr / event / class list.
      if (t.line > lastLine && !ATTRISH_RE.test(t.text)) {
        break;
      }
      lastLine = t.endLine;
      this.next();
      this.consumeHeadToken(node, t);
    }
    return node;
  }

  private parseChildren(node: ElementNode) {
    const isComponent = /^[A-Z]/.test(node.tag);
    if (!isComponent) {
      node.children = this.parseNodes(true);
      return;
    }
    // Component block: `#name params { ... }` provides named slots; bare
    // nodes form the default slot ("content" by convention -- TODO(user)).
    node.children = [];
    for (;;) {
      const t = this.peek();
      if (t === null) {
        throw new TemplateError("missing '}'", node.line);
      }
      if (t.text === "}") {
        this.next();
        break;
      }
      if (t.text.startsWith("#")) {
        const nameTok = this.next();
        const params: string[] = [];
        while (this.peek() && /^[A-Za-z_][\w]*$/.test(this.peek()!.text)) {
          params.push(this.next().text);
        }
        const blockOpen = this.next();
        if (blockOpen.text !== "{") {
          throw new TemplateError(
            `expected '{' after #${nameTok.text.slice(1)}`,
            blockOpen.line
          );
        }
        node.slotProvides.push({
          name: nameTok.text.slice(1),
          params: params,
          children: this.parseNodes(true),
        });
      } else {
        node.children.push(this.parseNode());
      }
    }
  }

  private consumeHeadToken(node: ElementNode, t: Tok) {
    const text = t.text;
    if (text === "else") {
      node.control = "else";
      return;
    }
    if (text.startsWith("[")) {
      const headIsFresh =
        node.classList === null &&
        node.attrs.length === 0 &&
        node.events.length === 0 &&
        node.content === null;
      if (headIsFresh) {
        // First bracket group right after the tag/control attrs = class list.
        // (`text [expr]` is therefore a class list; write `text [] [expr]`
        // for bracketed content without classes.)
        node.classList = text.slice(1, -1);
        return;
      }
      // A later bracket group is the content expression.
      if (node.content !== null) {
        throw new TemplateError(
          `element already has content; unexpected '${text}'`,
          t.line
        );
      }
      node.content = text.slice(1, -1);
      return;
    }
    if (text.startsWith("@")) {
      const eq = text.indexOf("=");
      if (eq < 0) {
        throw new TemplateError(`event '${text}' needs a value`, t.line);
      }
      node.events.push({
        name: text.slice(1, eq),
        value: parseValue(
          text.slice(eq + 1),
          t.line,
          `event '${text.slice(0, eq)}'`
        ),
      });
      return;
    }
    const eq = text.indexOf("=");
    if (eq > 0 && /^[A-Za-z_][\w-]*$/.test(text.slice(0, eq))) {
      const name = text.slice(0, eq);
      const value = parseValue(
        text.slice(eq + 1),
        t.line,
        `attribute '${name}'`
      );
      if (name === "if" || name === "else-if") {
        node.control = name as ControlKind;
        node.controlExpr = value;
      } else if (name === "for") {
        node.forExpr = value;
      } else if (name === "key") {
        node.keyExpr = value;
      } else if (CONTROL_ATTRS.has(name)) {
        throw new TemplateError(`'${name}=' not supported here`, t.line);
      } else {
        node.attrs.push({ name: name, value: value });
      }
      return;
    }
    // Anything else on the head is the content expression (e.g. text label).
    if (node.content !== null) {
      throw new TemplateError(
        `element already has content; unexpected '${text}'`,
        t.line
      );
    }
    node.content = parseValue(text, t.line, "content");
  }
}

// Strict value rule (template-wide, docs §3.2): a value is a single
// identifier, a string literal, a number, or a bracketed [expression].
// Member access, calls and operators MUST be bracketed -- this keeps the
// head tokenizable without an expression parser and makes the rule visible
// in the editor (the grammar flags `a.b` outside brackets as illegal).
function parseValue(raw: string, line: number, what: string): string {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw.slice(1, -1);
  }
  if (/^"(?:[^"\\]|\\.)*"$/.test(raw)) {
    return raw;
  }
  if (/^!?[A-Za-z_]\w*$/.test(raw) || /^-?\d+(\.\d+)?$/.test(raw)) {
    return raw;
  }
  throw new TemplateError(
    `${what} '${raw}' must be a single identifier, a string, or a bracketed [expression] -- member access needs brackets: [${raw}]`,
    line
  );
}

// ---------------------------------------------------------------------------
// Lowering
// ---------------------------------------------------------------------------

export type TemplateContext = {
  componentName: string;
  /** Relative source path emitted into #source directives (basename). */
  sourceFile: string;
  /** e.g. "presets" -- namespace the class tokens lower into. */
  presetNamespace: string;
  /** name -> payload struct name, or null for payload-less slots. */
  slots: Map<string, string | null>;
  /** Rewrites dialect accessors in an expression (props./slots./emits.). */
  rewriteExpr: (expr: string) => string;
};

// TODO(user): the event-name map is UI-plugin policy, extend as needed.
const EVENT_MAP: Record<string, string> = {
  pointerdown: "onPointerDown",
  pointerup: "onPointerUp",
  pointermove: "onPointerMove",
  click: "onClick",
  wheel: "onWheel",
};

function eventProp(name: string, line: number): string {
  const mapped = EVENT_MAP[name.toLowerCase()];
  if (!mapped) {
    throw new TemplateError(`unknown event '@${name}'`, line);
  }
  return mapped;
}

class Emitter {
  lines: string[] = [];
  constructor(public indentLevel: number) {}
  emit(line: string) {
    this.lines.push("    ".repeat(this.indentLevel) + line);
  }
  indented(fn: () => void) {
    this.indentLevel++;
    fn();
    this.indentLevel--;
  }
}

export function parseTemplate(body: string, startLine: number): unknown {
  return new Parser(lex(body, startLine)).parseNodes(false);
}

export function lowerTemplate(
  body: string,
  startLine: number,
  ctx: TemplateContext,
  baseIndent: number
): string {
  const nodes = new Parser(lex(body, startLine)).parseNodes(false);
  const em = new Emitter(baseIndent);
  lowerNodes(nodes, em, ctx, { counter: 0, inLoop: false });
  return em.lines.join("\n");
}

type Scope = { counter: number; inLoop: boolean };

function lowerNodes(
  nodes: Node[],
  em: Emitter,
  ctx: TemplateContext,
  scope: Scope
) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    // Pin-mode #source wrapper. An if=/else-if=/else chain shares a single
    // wrapper (the else lowering re-opens the previous statement's brace,
    // which must stay inside the same directive block).
    const chainContinues = (idx: number) => {
      const nx = nodes[idx + 1];
      return (
        nx !== undefined &&
        nx.kind === "element" &&
        (nx.control === "else-if" || nx.control === "else")
      );
    };
    const continuesChain =
      node.kind === "element" &&
      (node.control === "else-if" || node.control === "else");
    if (!continuesChain) {
      em.emit(`#source "${ctx.sourceFile}:${node.line}:1" {`);
      em.indentLevel++;
    }
    if (node.kind === "slot") {
      // NOTE: no `continue` -- the #source wrapper opened above must be
      // closed at the bottom of this iteration like for every other node.
      lowerSlotRender(node, em, ctx, scope);
    } else if (node.control === "if") {
      // if=/else-if=/else chain over siblings
      em.emit(`if ${ctx.rewriteExpr(node.controlExpr!)} {`);
      em.indented(() => lowerElement(node, em, ctx, scope));
      em.emit("}");
    } else if (node.control === "else-if" || node.control === "else") {
      const prev = nodes[i - 1];
      const prevChained =
        prev && prev.kind === "element" && prev.control !== null;
      if (!prevChained) {
        throw new TemplateError(
          `'${node.control}' without preceding 'if='`,
          node.line
        );
      }
      // Re-open the previous brace as an else-branch.
      const last = em.lines.pop()!;
      const cond =
        node.control === "else-if"
          ? ` if ${ctx.rewriteExpr(node.controlExpr!)}`
          : "";
      em.emit(
        `${last.trimStart() === "}" ? last.trimEnd() : last} else${cond} {`
      );
      em.indented(() => lowerElement(node, em, ctx, scope));
      em.emit("}");
    } else {
      lowerElement(node, em, ctx, scope);
    }
    if (!chainContinues(i)) {
      em.indentLevel--;
      em.emit(`}`);
    }
  }
}

function lowerSlotRender(
  node: SlotRenderNode,
  em: Emitter,
  ctx: TemplateContext,
  scope: Scope
) {
  if (!ctx.slots.has(node.name)) {
    throw new TemplateError(`unknown slot '${node.name}'`, node.line);
  }
  const payloadStruct = ctx.slots.get(node.name)!;
  const access = `instance.props().${node.name}`;
  em.emit(`if ${access} {`);
  em.indented(() => {
    if (payloadStruct) {
      const fields = node.payload
        .map((p) => `${p.name}: ${ctx.rewriteExpr(p.value)}`)
        .join(", ");
      em.emit(`${access}(${payloadStruct} { ${fields} });`);
    } else {
      em.emit(`${access}();`);
    }
  });
  if (node.fallback && node.fallback.length > 0) {
    em.emit(`} else {`);
    em.indented(() => lowerNodes(node.fallback!, em, ctx, scope));
  }
  em.emit(`}`);
}

function lowerElement(
  node: ElementNode,
  em: Emitter,
  ctx: TemplateContext,
  scope: Scope
) {
  if (node.forExpr !== null) {
    em.emit(`for ${ctx.rewriteExpr(node.forExpr)} {`);
    em.indented(() =>
      lowerElementInner(node, em, ctx, { counter: scope.counter, inLoop: true })
    );
    em.emit(`}`);
    scope.counter++; // the for-element consumes one static id slot
    return;
  }
  lowerElementInner(node, em, ctx, scope);
}

function lowerElementInner(
  node: ElementNode,
  em: Emitter,
  ctx: TemplateContext,
  scope: Scope
) {
  const staticId = ++scope.counter;
  let idExpr = `${staticId}`;
  if (scope.inLoop || node.forExpr !== null) {
    if (node.keyExpr === null) {
      throw new TemplateError(
        `'key=' is required on all direct children of a loop`,
        node.line
      );
    }
    idExpr = `hzui.keyId(${staticId}, ${ctx.rewriteExpr(node.keyExpr)})`;
  }

  const rw = ctx.rewriteExpr;
  const isComponent = /^[A-Z]/.test(node.tag);

  if (isComponent) {
    // DESIGN(v0): class lists on components need `class` passthrough -- out
    // of the v0 subset.
    if (node.classList !== null) {
      throw new TemplateError(
        `class lists on components are not supported yet (needs 'class' passthrough)`,
        node.line
      );
    }
    const args: string[] = [`id: ${idExpr}`];
    for (const a of node.attrs) {
      args.push(`${a.name}: ${rw(a.value)}`);
    }
    for (const e of node.events) {
      args.push(`${eventProp(e.name, node.line)}: ${rw(e.value)}`);
    }
    const closures: string[] = [];
    for (const sp of node.slotProvides) {
      // Closure params are intentionally untyped -- bound by inference from
      // the component's slot prop signature ("bet and verify").
      closures.push(`${sp.name}: (${sp.params.join(", ")}) => {`);
    }
    if (node.children && node.children.length > 0 && closures.length === 0) {
      // TODO(user): default-slot convention for bare component children.
      throw new TemplateError(
        `bare children on a component need the default-slot convention (TODO)`,
        node.line
      );
    }
    if (closures.length === 0) {
      em.emit(`${node.tag}(ui, { ${args.join(", ")} });`);
    } else {
      em.emit(`${node.tag}(ui, {`);
      em.indented(() => {
        for (const a of args) {
          em.emit(`${a},`);
        }
        for (const sp of node.slotProvides) {
          em.emit(`${sp.name}: (${sp.params.join(", ")}) => {`);
          em.indented(() =>
            lowerNodes(sp.children, em, ctx, { counter: 0, inLoop: false })
          );
          em.emit(`},`);
        }
      });
      em.emit(`});`);
    }
    return;
  }

  // Builtin element. `text` is leaf-shaped (content, no children); every
  // other tag is div-shaped (children closure). TODO(user): real element
  // registry -- plugin policy, still nothing the compiler knows about.
  const props: string[] = [`id: ${idExpr}`];
  for (const a of node.attrs) {
    if (a.name === "ref") {
      props.push(`elementRef: ${rw(a.value)}`);
    } else {
      props.push(`${a.name}: ${rw(a.value)}`);
    }
  }
  for (const e of node.events) {
    props.push(`${eventProp(e.name, node.line)}: ${rw(e.value)}`);
  }

  const presetCalls = node.classList
    ? lowerClassList(node.classList, ctx.presetNamespace).map(rw)
    : [];

  if (node.tag === "text") {
    if (node.content !== null) {
      props.push(`text: ${rw(node.content)}`);
    }
    if (presetCalls.length === 0) {
      em.emit(`ui.text({ ${props.join(", ")} });`);
    } else {
      em.emit(`ui.text({ ${props.join(", ")} },`);
      em.indented(() => {
        presetCalls.forEach((pc, idx) => {
          em.emit(pc + (idx < presetCalls.length - 1 ? "," : ""));
        });
      });
      em.emit(`);`);
    }
    return;
  }

  em.emit(`ui.${node.tag}({ ${props.join(", ")} }, (): void => {`);
  em.indented(() => {
    if (node.children) {
      lowerNodes(node.children, em, ctx, { counter: 0, inLoop: false });
    }
  });
  if (presetCalls.length === 0) {
    em.emit(`});`);
  } else {
    em.emit(`},`);
    em.indented(() => {
      presetCalls.forEach((p, i) =>
        em.emit(p + (i < presetCalls.length - 1 ? "," : ""))
      );
    });
    em.emit(`);`);
  }
}
