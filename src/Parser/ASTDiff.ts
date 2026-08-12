// Structural comparison of two ASTs, reporting the exact path of the first
// differences rather than just "not equal".
//
// Used by the --assert-parsers flag: both parsers run on every file and their
// output must be identical. When it is not, the path is what makes the failure
// actionable, e.g.
//   [3].funcbody.statements[1].expr.literal.value: 5n !== 6n
//
// Key ORDER is intentionally not compared: the native parser streams JSON in
// parse order while the reference builds objects field by field, and the
// consumer only ever reads by key.

export type ASTDifference = {
  path: string;
  message: string;
};

const MAX_DIFFERENCES = 25;

export function diffAST(reference: unknown, candidate: unknown): ASTDifference[] {
  const differences: ASTDifference[] = [];
  walk(reference, candidate, "", differences);
  return differences;
}

function walk(
  a: unknown,
  b: unknown,
  path: string,
  out: ASTDifference[]
): void {
  if (out.length >= MAX_DIFFERENCES) {
    return;
  }

  if (a === b) {
    return;
  }

  // undefined and an absent key are the same thing for the consumer, and the
  // reference AST uses optional fields liberally.
  if (a === undefined && b === undefined) {
    return;
  }

  if (typeof a !== typeof b) {
    out.push({
      path: path || "<root>",
      message: `type ${describeType(a)} !== ${describeType(b)}`,
    });
    return;
  }

  if (typeof a === "bigint" || typeof b === "bigint") {
    if (a !== b) {
      out.push({ path: path, message: `${format(a)} !== ${format(b)}` });
    }
    return;
  }

  if (a === null || b === null) {
    if (a !== b) {
      out.push({ path: path, message: `${format(a)} !== ${format(b)}` });
    }
    return;
  }

  if (typeof a !== "object") {
    if (a !== b) {
      out.push({ path: path, message: `${format(a)} !== ${format(b)}` });
    }
    return;
  }

  if (a instanceof Set || b instanceof Set) {
    const sa = a instanceof Set ? [...a].sort() : null;
    const sb = b instanceof Set ? [...b].sort() : null;
    if (!(sa && sb) || sa.join(",") !== sb.join(",")) {
      out.push({ path: path, message: `set ${format(sa)} !== ${format(sb)}` });
    }
    return;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!(Array.isArray(a) && Array.isArray(b))) {
      out.push({
        path: path,
        message: `array vs non-array: ${describeType(a)} !== ${describeType(b)}`,
      });
      return;
    }
    if (a.length !== b.length) {
      out.push({
        path: path,
        message: `array length ${a.length} !== ${b.length}`,
      });
    }
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) {
      walk(a[i], b[i], `${path}[${i}]`, out);
      if (out.length >= MAX_DIFFERENCES) {
        return;
      }
    }
    return;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;

  // Treat an explicitly-undefined field and a missing field as equivalent.
  const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
  for (const key of [...keys].sort()) {
    const va = objA[key];
    const vb = objB[key];
    if (va === undefined && vb === undefined) {
      continue;
    }
    walk(va, vb, path ? `${path}.${key}` : key, out);
    if (out.length >= MAX_DIFFERENCES) {
      return;
    }
  }
}

function describeType(v: unknown): string {
  if (v === null) {
    return "null";
  }
  if (v === undefined) {
    return "undefined";
  }
  if (Array.isArray(v)) {
    return "array";
  }
  return typeof v;
}

function format(v: unknown): string {
  if (typeof v === "bigint") {
    return `${v.toString()}n`;
  }
  if (typeof v === "string") {
    return JSON.stringify(v);
  }
  if (v === undefined) {
    return "undefined";
  }
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export function formatDifferences(
  filename: string,
  differences: ASTDifference[]
): string {
  const lines = [
    `AST mismatch between the reference and native parser in ${filename}:`,
  ];
  for (const d of differences) {
    lines.push(`  at ${d.path}: ${d.message}`);
  }
  if (differences.length >= MAX_DIFFERENCES) {
    lines.push(`  ... (truncated at ${MAX_DIFFERENCES} differences)`);
  }
  return lines.join("\n");
}
