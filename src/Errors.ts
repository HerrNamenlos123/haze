import type { ParserRuleContext } from "antlr4ng";

export enum ErrorType {
  Error,
  Warning,
}

export class Location {
  constructor(
    public filename: string,
    public line: number,
    public column: number,
  ) { }

  public toString(): string {
    return `${this.filename}:${this.line}:${this.column}`;
  }
}

function formatCompilerMessage(
  type: ErrorType,
  error: string,
  msg: string,
  loc?: Location,
): string {
  let text = "";
  if (loc) {
    text += `[${loc.filename}:${loc.line}:${loc.column}]: `;
  }
  if (type === ErrorType.Error) {
    text += `\x1b[31m${error}\x1b[0m: ${msg}`;
  } else {
    text += `\x1b[33m${error}\x1b[0m: ${msg}`;
  }
  return text;
}

function printCompilerMessage(
  type: ErrorType,
  error: string,
  msg: string,
  loc?: Location,
): void {
  console.log(formatCompilerMessage(type, error, msg, loc));
}

export function formatErrorMessage(msg: string, loc?: Location): string {
  return formatCompilerMessage(ErrorType.Error, "Error", msg, loc);
}

export function printErrorMessage(
  msg: string,
  loc?: Location,
  title?: string,
): void {
  printCompilerMessage(ErrorType.Error, title ?? "Error", msg, loc);
}

export function formatWarningMessage(msg: string, loc?: Location): string {
  return formatCompilerMessage(ErrorType.Warning, "Warning", msg, loc);
}

export function printWarningMessage(msg: string, loc?: Location): void {
  printCompilerMessage(ErrorType.Warning, "Warning", msg, loc);
}

export function getCallerLocation(depth = 1): Location {
  const stack = new Error().stack?.split("\n") ?? [];
  const frame = stack[depth + 1];
  const matches = frame.match(/at (?:(.+)\s+\()?(.+?):(\d+):(\d+)/);
  if (!matches) {
    return new Location("Unknown", 0, 0);
  }
  return new Location(
    matches[2],
    parseInt(matches[3], 10),
    parseInt(matches[4], 10),
  );
}

export class CompilerError extends Error {
  constructor(msg: string, loc: Location) {
    super(formatErrorMessage(msg, loc));
  }
}

export class InternalError extends Error {
  constructor(msg: string, loc?: Location) {
    super(formatErrorMessage(msg, loc ?? getCallerLocation(2)));
  }
}

export class ImpossibleSituation extends Error {
  constructor() {
    super(
      formatErrorMessage(
        "Impossible situation, something fatal has happened",
        getCallerLocation(2),
      ),
    );
  }
}

export class UnreachableCode extends Error {
  constructor() {
    super(
      formatErrorMessage("Unreachable Code was reached", getCallerLocation(2)),
    );
  }
}

export class GeneralError extends Error {
  text: string;

  constructor(msg: string) {
    super(formatErrorMessage(msg));
    this.text = formatErrorMessage(msg);
  }
}
