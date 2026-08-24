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

export function splitSections(source: string): SplitResult {
  const lines = source.split("\n");
  const sections: Section[] = [];
  let preludeEnd = lines.length;
  let current: Section | null = null;
  const bodyLines: string[] = [];

  const finish = () => {
    if (current) {
      current.body = bodyLines.join("\n");
      sections.push(current);
      bodyLines.length = 0;
    }
  };

  for (let i = 0; i < lines.length; i++) {
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
  };
}
