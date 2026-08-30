// ============================================================================
// Section splitting. Line-anchored, open-only markers; the next marker ends
// the previous section. NO haze parsing happens here -- that is the whole
// point of the marker design.
// ============================================================================

export const SECTION_NAMES = [
  "props",
  "emit",
  "slot",
  "expose",
  "setup",
  "template",
] as const;
export type SectionName = (typeof SECTION_NAMES)[number];

// `@props` alone on a line (trailing head content allowed only for @template,
// e.g. `@template [w-fit ...]`).
const MARKER_RE = /^@(props|emit|slot|expose|setup|template)\b(.*)$/;

// `@export` alone on a line, at the very top of the file. Not a section: it is
// a file-level directive, so it carries no body and never ends a section.
const EXPORT_RE = /^@export\b(.*)$/;

// `@font <name> [<expr>]` -- also a file-level directive: no body, never ends a
// section, and unlike @export it may appear any number of times and anywhere.
// Anywhere, because the expression is evaluated in the RENDER body, where the
// whole file's scope (setup locals, file-scope declarations, imports) is
// visible no matter which line the directive was written on.
const FONT_RE = /^@font\b(.*)$/;

// The name, and the start of the group that must follow it.
const FONT_NAME_RE = /^([A-Za-z_][\w]*)\s+\[/;

/**
 * The one shape accepted after the marker: `name [expression]`, and nothing
 * else on the line.
 *
 * Deliberately exact. This directive is what makes a font exist under a name,
 * and every way of getting it subtly wrong -- a missing bracket, a stray token,
 * a second group -- fails far away as text silently drawn in the fallback font,
 * with nothing pointing back at this line. So a near-miss is an error here
 * rather than something quietly half-understood.
 *
 * Bracket-BALANCED rather than regex-matched, because both of these are one
 * line with two `[` and two `]` and only one of them is the shape:
 *
 *     @font a [arr[0]]     one group, a subscript inside it   -> accepted
 *     @font a [x] [y]      two groups                         -> rejected
 *
 * A greedy `\[(.+)\]$` accepts the second as an expression of `x] [y`; a lazy
 * one truncates the first to `arr[0`. Only counting tells them apart: the group
 * opened by the first `[` has to close on the LAST character of the line.
 *
 * Brackets inside a string literal are text, not structure -- same rule the
 * @template head reader uses (see readMarkerArg's depth()).
 *
 * Returns null for anything that is not the shape; the caller turns that into
 * the error.
 */
function parseFontDirective(
  rest: string
): { name: string; expr: string } | null {
  const m = FONT_NAME_RE.exec(rest);
  if (!m) {
    return null;
  }
  const open = rest.indexOf("[", m[1]!.length);
  let depth = 0;
  let inStr = false;
  for (let i = open; i < rest.length; i++) {
    const c = rest[i]!;
    if (inStr) {
      if (c === "\\") {
        i++;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
    } else if (c === "[") {
      depth++;
    } else if (c === "]") {
      depth--;
      if (depth === 0) {
        if (i !== rest.length - 1) {
          return null; // a second group, or trailing junk
        }
        const expr = rest.slice(open + 1, i).trim();
        return expr === "" ? null : { name: m[1]!, expr: expr };
      }
    }
  }
  return null; // unterminated
}

export type FontDecl = {
  /** The name the font is bound to, and the only way an element selects it. */
  name: string;
  /** The bracketed expression, verbatim. Evaluated in the RENDER body. */
  expr: string;
  /** 1-based line of the directive, for `#source`. */
  line: number;
};

export type Section = {
  name: SectionName;
  /**
   * Text after the marker (only @template uses it: the root element's head).
   * May span several lines -- see readMarkerArg.
   */
  markerArg: string;
  /** 1-based line number of the marker line in the original file. */
  markerLine: number;
  /** 1-based line number of the first body line. */
  bodyStartLine: number;
  body: string;
};

export type SplitResult = {
  /** Everything before the first marker, verbatim (imports, exported types). */
  prelude: string;
  preludeStartLine: number; // always 1
  sections: Section[];
  /**
   * `@export` was present: the component function is declared `export`, so it
   * crosses the module boundary. Off by default -- a component is module-local
   * unless it says otherwise.
   */
  exported: boolean;
  /** Every `@font` directive in the file, in source order. */
  fonts: FontDecl[];
};

export function hasMarkers(source: string): boolean {
  return source.split("\n").some((l) => MARKER_RE.test(l));
}

export class SectionError extends Error {
  constructor(
    message: string,
    public line: number
  ) {
    super(message);
  }
}

// Ordering: the declaration sections (@props/@emit/@slot/@expose) may appear
// in any order among themselves; @setup must follow them and @template must be
// last.
const SECTION_RANK: Record<SectionName, number> = {
  props: 0,
  emit: 0,
  slot: 0,
  expose: 0,
  setup: 1,
  template: 2,
};

/**
 * A @template head is an element head like any other -- the component's own
 * root element, minus the tag -- so it can be as long as one: class list, ref,
 * events, attrs. It is read with the same two rules the template lexer and
 * parser use inside the body:
 *
 *   - a `[ ]` group may span lines, so keep taking lines while one is open;
 *   - a following line continues the head only if it starts like an attr, an
 *     event or a class list (ATTRISH_RE in template.ts).
 *
 * The first line that is neither is where the body -- the root element's
 * children -- begins. A blank line therefore ends the head, which is the
 * natural way to write it.
 *
 * Returns the joined head text and the index of the first body line.
 */
const HEAD_CONTINUATION_RE = /^(@?[A-Za-z_][\w-]*=|\[)/;

function readMarkerArg(
  lines: string[],
  markerLine: number,
  first: string
): { arg: string; nextLine: number } {
  const depth = (text: string) => {
    let d = 0;
    let inStr = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (inStr) {
        if (c === "\\") {
          i++;
        } else if (c === '"') {
          inStr = false;
        }
        continue;
      }
      if (c === '"') {
        inStr = true;
      } else if (c === "/" && text[i + 1] === "/") {
        break; // line comment: the rest of this line is not head text
      } else if (c === "[") {
        d++;
      } else if (c === "]") {
        d--;
      }
    }
    return d;
  };

  let arg = first;
  let open = depth(first);
  let i = markerLine + 1;
  for (;;) {
    if (open > 0) {
      if (i >= lines.length) {
        throw new SectionError(
          `unterminated '[' in the @template head`,
          markerLine + 1
        );
      }
    } else if (
      i >= lines.length ||
      !HEAD_CONTINUATION_RE.test(lines[i]!.trim())
    ) {
      break;
    }
    arg += "\n" + lines[i]!;
    open += depth(lines[i]!);
    i++;
  }
  return { arg: arg, nextLine: i };
}

/**
 * A line that declares nothing: blank, or a line comment. `@export` has to come
 * before every real declaration, and this is what "real" means -- a file may
 * still open with its licence header.
 */
function isBlankOrComment(line: string): boolean {
  const t = line.trim();
  return t === "" || t.startsWith("//");
}

export function splitSections(source: string): SplitResult {
  const lines = source.split("\n");
  const sections: Section[] = [];
  let preludeEnd = lines.length;
  let current: Section | null = null;
  const bodyLines: string[] = [];
  let exported = false;
  const fonts: FontDecl[] = [];
  // Whether anything that is not a blank line or a comment has been seen yet.
  let sawDecl = false;

  const finish = () => {
    if (current) {
      current.body = bodyLines.join("\n");
      sections.push(current);
      bodyLines.length = 0;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const ex = EXPORT_RE.exec(lines[i]!);
    if (ex) {
      if ((ex[1] ?? "").trim() !== "") {
        throw new SectionError(
          `@export takes no arguments on the marker line`,
          i + 1
        );
      }
      if (exported) {
        throw new SectionError(`duplicate @export`, i + 1);
      }
      if (sawDecl) {
        throw new SectionError(
          `@export must come first, before every other declaration in the file`,
          i + 1
        );
      }
      exported = true;
      // Blanked rather than dropped: the prelude is spliced verbatim under a
      // `#source "file:1"` directive, so every line after this one has to keep
      // the line number it had in the original file.
      lines[i] = "";
      continue;
    }
    const fo = FONT_RE.exec(lines[i]!);
    if (fo) {
      const decl = parseFontDirective((fo[1] ?? "").trim());
      if (!decl) {
        throw new SectionError(
          `@font takes exactly a name and a bracketed expression, ` +
            `e.g. '@font codicons [codicon_ttf]'`,
          i + 1
        );
      }
      fonts.push({ name: decl.name, expr: decl.expr, line: i + 1 });
      sawDecl = true;
      // Blanked IN PLACE and then allowed to fall through, rather than
      // `continue`d past like @export. @export can only ever sit in the
      // prelude, which is sliced out of `lines` and therefore keeps the blank
      // on its own; a @font may sit inside a section body, which is collected
      // line by line into `bodyLines` -- skipping the push there would shift
      // every following line of that body up by one and put its `#source`
      // mapping out by one for the rest of the section.
      lines[i] = "";
    }

    if (!isBlankOrComment(lines[i]!)) {
      sawDecl = true;
    }

    const m = MARKER_RE.exec(lines[i]!);
    if (m) {
      const name = m[1] as SectionName;
      const markerIdx = i; // `i` moves below when a @template head wraps
      let markerArg = (m[2] ?? "").trim();
      let bodyStart = markerIdx + 2;
      if (name === "template" && markerArg !== "") {
        const read = readMarkerArg(lines, markerIdx, markerArg);
        markerArg = read.arg;
        bodyStart = read.nextLine + 1;
        i = read.nextLine - 1; // the for-loop's i++ lands on the first body line
      } else if (markerArg !== "") {
        throw new SectionError(
          `@${name} takes no arguments on the marker line`,
          markerIdx + 1
        );
      }
      finish();
      if (current === null) {
        preludeEnd = markerIdx;
      }
      const prevRank = current ? SECTION_RANK[current.name] : -1;
      const thisRank = SECTION_RANK[name];
      if (sections.some((s) => s.name === name)) {
        throw new SectionError(`duplicate section @${name}`, markerIdx + 1);
      }
      if (thisRank < prevRank) {
        throw new SectionError(
          `section @${name} must come before @${current!.name} (order: @props/@emit/@slot/@expose in any order, then @setup, then @template)`,
          markerIdx + 1
        );
      }
      current = {
        name: name,
        markerArg: markerArg,
        markerLine: markerIdx + 1,
        bodyStartLine: bodyStart,
        body: "",
      };
    } else if (current) {
      bodyLines.push(lines[i]!);
    }
  }
  finish();

  return {
    prelude: lines.slice(0, preludeEnd).join("\n"),
    preludeStartLine: 1,
    sections: sections,
    exported: exported,
    fonts: fonts,
  };
}
