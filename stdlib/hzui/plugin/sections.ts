// ============================================================================
// Section splitting. Line-anchored, open-only markers; the next marker ends
// the previous section. NO haze parsing happens here -- that is the whole
// point of the marker design.
// ============================================================================

export const SECTION_NAMES = [
  "props",
  "emit",
  "slot",
  "setup",
  "template",
] as const;
export type SectionName = (typeof SECTION_NAMES)[number];

// `@props` alone on a line (trailing head content allowed only for @template,
// e.g. `@template [w-fit ...]`).
const MARKER_RE = /^@(props|emit|slot|setup|template)\b(.*)$/;

export type Section = {
  name: SectionName;
  /** Text after the marker on the marker line itself (only @template uses it). */
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

// Ordering: the declaration sections (@props/@emit/@slot) may appear in any
// order among themselves; @setup must follow them and @template must be last.
const SECTION_RANK: Record<SectionName, number> = {
  props: 0,
  emit: 0,
  slot: 0,
  setup: 1,
  template: 2,
};

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
      const markerArg = (m[2] ?? "").trim();
      if (markerArg !== "" && name !== "template") {
        throw new SectionError(
          `@${name} takes no arguments on the marker line`,
          i + 1
        );
      }
      finish();
      if (current === null) {
        preludeEnd = i;
      }
      const prevRank = current ? SECTION_RANK[current.name] : -1;
      const thisRank = SECTION_RANK[name];
      if (sections.some((s) => s.name === name)) {
        throw new SectionError(`duplicate section @${name}`, i + 1);
      }
      if (thisRank < prevRank) {
        throw new SectionError(
          `section @${name} must come before @${current!.name} (order: @props/@emit/@slot in any order, then @setup, then @template)`,
          i + 1
        );
      }
      current = {
        name: name,
        markerArg: markerArg,
        markerLine: i + 1,
        bodyStartLine: i + 2,
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
