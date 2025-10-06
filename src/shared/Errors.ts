export enum ErrorType {
  Error,
  Warning,
}

export type SourceLocNotNull = {
  filename: string;
  start: {
    line: number;
    column: number;
  };
  end?: {
    line: number;
    column: number;
  };
};

export type SourceLoc = SourceLocNotNull | null;

export function formatSourceLoc(loc: SourceLocNotNull) {
  if (loc.end) {
    if (loc.end.line === loc.start.line) {
      return `${loc.filename}:${loc.start.line}:${loc.start.column + 1}-${loc.end.column + 1}`;
    } else {
      return `${loc.filename}:${loc.start.line}:${loc.start.column + 1}-${loc.end.line}:${
        loc.end.column + 1
      }`;
    }
  } else {
    return `${loc.filename}:${loc.start.line}:${loc.start.column + 1}`;
  }
}

function formatCompilerMessage(
  type: ErrorType,
  error: string,
  msg: string,
  loc?: SourceLoc
): string {
  let text = "";
  if (loc) {
    text += `${formatSourceLoc(loc)}: `;
  }
  if (type === ErrorType.Error) {
    text += `\x1b[31m${error}\x1b[0m: ${msg}`;
  } else {
    text += `\x1b[33m${error}\x1b[0m: ${msg}`;
  }
  return text;
}

function printCompilerMessage(type: ErrorType, error: string, msg: string, loc?: SourceLoc): void {
  console.log(formatCompilerMessage(type, error, msg, loc));
}

export function formatErrorMessage(msg: string, loc?: SourceLoc): string {
  return formatCompilerMessage(ErrorType.Error, "Error", msg, loc);
}

export function printErrorMessage(msg: string, loc?: SourceLoc, title?: string): void {
  printCompilerMessage(ErrorType.Error, title ?? "Error", msg, loc);
}

export function formatWarningMessage(msg: string, loc?: SourceLoc): string {
  return formatCompilerMessage(ErrorType.Warning, "Warning", msg, loc);
}

export function printWarningMessage(msg: string, loc?: SourceLoc): void {
  printCompilerMessage(ErrorType.Warning, "Warning", msg, loc);
}

export function getCallerLocation(depth = 1): SourceLoc {
  const stack = new Error().stack?.split("\n") ?? [];
  const frame = stack[depth + 1];
  const matches = frame.match(/at (?:(.+)\s+\()?(.+?):(\d+):(\d+)/);
  if (!matches) {
    return {
      start: {
        line: 0,
        column: 0,
      },
      filename: "Unknown",
    };
  }
  return {
    start: {
      line: parseInt(matches[3], 10),
      column: parseInt(matches[4], 10),
    },
    filename: matches[2],
  };
}

export class CompilerError extends Error {
  constructor(msg: string, loc: SourceLoc) {
    super(formatErrorMessage(msg, loc));
  }
}

export class InternalError extends Error {
  constructor(msg: string, loc?: SourceLoc, callFrames?: number) {
    super(formatErrorMessage(msg, loc ?? getCallerLocation(callFrames ? callFrames + 2 : 2)));
  }
}

export class ImpossibleSituation extends Error {
  constructor() {
    super(
      formatErrorMessage("Impossible situation, something fatal has happened", getCallerLocation(2))
    );
  }
}

export class UnreachableCode extends Error {
  constructor() {
    super(formatErrorMessage("Unreachable Code was reached", getCallerLocation(2)));
  }
}

export class SyntaxError extends Error {
  constructor() {
    super("Syntax Error");
  }
}

export class CmdFailed extends Error {
  constructor() {
    super("Cmd Failed");
  }
}

export class GeneralError extends Error {
  text: string;

  constructor(msg: string) {
    super(formatErrorMessage(msg));
    this.text = formatErrorMessage(msg);
  }
}

export function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) {
    throw new InternalError(message, undefined, 1);
  }
}
