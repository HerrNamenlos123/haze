// ============================================================================
// Class-token list parsing and lowering.
//
// Grammar (whitespace-separated tokens, per docs/sfc-plugin-scope.md §3.3):
//   token      := condition? class
//   condition  := ('!'? identifier | '[' expr ']') '?'   -- a SINGLE word;
//                 member access (a.b) must be bracketed: [a.b]?
//   class      := name ('-' name)* ('-[' expr ']' unit?)?
//   unit       := 'px' | 'em' | '%'          (default px; bracket holds an
//                                             EXPRESSION, unit is outside)
//
// Lowering is a pure NAMING RULE, not a table: kebab-case segments are
// camelCased into a preset function call; a trailing numeric segment or a
// bracketed expression becomes the argument. The real compiler resolves the
// call -- unknown tokens become ordinary "unknown symbol" errors, and any
// `export fn` in the preset namespace is automatically a valid token.
//
//   row                  -> row()
//   gap-0                -> gap(0)
//   cross-align-center   -> crossAlignCenter()
//   w-fit                -> wFit()
//   px-[style.paddingX]  -> px(Px { value: style.paddingX })   (explicit, unscaled)
//   w-[10]em             -> w(Em { value: 10 })     w-[2]rem -> w(Rem { value: 2 })
//   enabled?cursor-pointer   -> enabled ? cursorPointer() : noop()
//   [a > b]?w-grow           -> (a > b) ? wGrow() : noop()
//
// NOTE: existing headwind names (noWrap, p, ...) don't all match the
// mechanical rule (text-nowrap -> textNowrap). The rule stays mechanical;
// headwind/hzui grows alias presets instead. TODO(user): confirm.
//
// The runtime merges ops LAST-WINS per field (ui_styling.applyDivOp), so
// tokens are emitted in source order and shorthands compose by side.
// ============================================================================

export type ClassToken = {
  /** Lowered condition expression, or null when unconditional. */
  condition: string | null;
  /** Preset function name (camelCased). */
  fn: string;
  /** Lowered argument expressions (already unit-wrapped). */
  args: string[];
  raw: string;
};

export class ClassListError extends Error {}

// Strict value rule (template-wide): a bare value is exactly one identifier.
// Anything else -- member access, calls, operators -- must be wrapped in [ ].
const BARE_IDENT_RE = /^!?[A-Za-z_][\w]*$/;

function camelCase(segments: string[]): string {
  return segments
    .map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)))
    .join("");
}

/** Splits a class list on whitespace, keeping bracketed groups intact. */
export function splitClassTokens(text: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "[") {
      depth++;
    }
    if (ch === "]") {
      depth--;
    }
    if (depth === 0 && /\s/.test(ch)) {
      if (cur !== "") {
        tokens.push(cur);
      }
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (depth !== 0) {
    throw new ClassListError(`unbalanced brackets in class list: '${text}'`);
  }
  if (cur !== "") {
    tokens.push(cur);
  }
  return tokens;
}

// Bracketed values are EXPLICIT lengths (never scaled): default/px -> Px,
// em -> Em, rem -> Rem. The preset's Length overload receives them.
function wrapUnit(expr: string, unit: string, raw: string): string {
  switch (unit) {
    case "":
    case "px":
      return `ui_styling.Px { value: (${expr}) }`;
    case "em":
      return `ui_styling.Em { value: (${expr}) }`;
    case "rem":
      return `ui_styling.Rem { value: (${expr}) }`;
    case "%":
      throw new ClassListError(
        `'%' in token '${raw}': percent sizes are not supported yet (ui_styling.Size has no percent variant)`
      );
    default:
      throw new ClassListError(`unknown unit '${unit}' in token '${raw}'`);
  }
}

export function parseClassToken(raw: string): ClassToken {
  let rest = raw;
  let condition: string | null = null;

  // condition?class -- condition is a bare (optionally !-negated) ident path
  // or a bracketed expression. '?' inside brackets does not split.
  {
    let depth = 0;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i]!;
      if (ch === "[") {
        depth++;
      } else if (ch === "]") {
        depth--;
      } else if (ch === "?" && depth === 0) {
        const condRaw = rest.slice(0, i);
        rest = rest.slice(i + 1);
        if (condRaw.startsWith("[") && condRaw.endsWith("]")) {
          condition = `(${condRaw.slice(1, -1)})`;
        } else if (BARE_IDENT_RE.test(condRaw)) {
          condition = condRaw.startsWith("!")
            ? `!(${condRaw.slice(1)})`
            : condRaw;
        } else {
          throw new ClassListError(
            `condition '${condRaw}' in token '${raw}' must be a single identifier (optionally !-negated) or a bracketed [expression] -- member access needs brackets: [${condRaw.replace(/^!/, "")}]?`
          );
        }
        break;
      }
    }
  }

  // class := segments, optionally ending in -[expr]unit or a numeric segment
  const bracketStart = rest.indexOf("[");
  if (bracketStart >= 0) {
    if (bracketStart === 0 || rest[bracketStart - 1] !== "-") {
      throw new ClassListError(
        `malformed token '${raw}': expected 'name-[expr]'`
      );
    }
    const bracketEnd = rest.lastIndexOf("]");
    if (bracketEnd < bracketStart) {
      throw new ClassListError(`unbalanced brackets in token '${raw}'`);
    }
    const name = rest.slice(0, bracketStart - 1);
    const expr = rest.slice(bracketStart + 1, bracketEnd);
    const unit = rest.slice(bracketEnd + 1);
    if (expr.trim() === "") {
      throw new ClassListError(`empty [] in token '${raw}'`);
    }
    return {
      condition: condition,
      fn: camelCase(name.split("-")),
      args: [wrapUnit(expr, unit, raw)],
      raw: raw,
    };
  }

  const segments = rest.split("-");
  const last = segments[segments.length - 1]!;
  if (segments.length > 1 && /^\d+\/\d+$/.test(last)) {
    throw new ClassListError(
      `fraction '${last}' in token '${raw}': percent sizes (w-1/2) are not supported yet -- use a scale number (w-2.5) or an explicit [value]`
    );
  }
  // Scale number: integer or float (gap-0, p-4, w-2.5); the preset applies
  // the Tailwind spacing scale (headwind.computeSize).
  if (segments.length > 1 && /^\d+(\.\d+)?$/.test(last)) {
    return {
      condition: condition,
      fn: camelCase(segments.slice(0, -1)),
      args: [last],
      raw: raw,
    };
  }
  if (!segments.every((s) => /^[A-Za-z_][\w]*$/.test(s))) {
    throw new ClassListError(`malformed class token '${raw}'`);
  }
  return { condition: condition, fn: camelCase(segments), args: [], raw: raw };
}

/**
 * Lowers a class list to preset-call expression strings, in source order:
 * the runtime merges ops last-wins (Tailwind semantics), so
 * `p-4 px-2 pb-1` composes by side and `px-2 p-4` is overridden by p-4.
 */
export function lowerClassList(
  text: string,
  presetNamespace: string
): string[] {
  const tokens = splitClassTokens(text).map(parseClassToken);
  return tokens.map((t) => {
    const call = `${presetNamespace}.${t.fn}(${t.args.join(", ")})`;
    return t.condition
      ? `${t.condition} ? ${call} : ${presetNamespace}.noop()`
      : call;
  });
}
