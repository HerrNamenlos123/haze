export enum ErrorType {
  Error,
  Warning,
}

export class Location {
  constructor(
    public filename: string,
    public line: number,
    public column: number,
  ) {}

  public toString(): string {
    return `${this.filename}:${this.line}:${this.column}`;
  }
}

export function formatCompilerMessage(
  loc: Location,
  type: ErrorType,
  error: string,
  msg: string,
): string {
  return `[${loc.filename}:${loc.line}:${loc.column}]: ${type === ErrorType.Error ? "\x1b[31m" : "\x1b[33m"}${error}\x1b[0m: ${msg}`;
}

export function printCompilerMessage(
  loc: Location,
  type: ErrorType,
  error: string,
  msg: string,
): void {
  console.log(formatCompilerMessage(loc, type, error, msg));
}

export function formatErrorMessage(loc: Location, msg: string): string {
  return formatCompilerMessage(loc, ErrorType.Error, "Error", msg);
}

export function printErrorMessage(loc: Location, msg: string): void {
  printCompilerMessage(loc, ErrorType.Error, "Error", msg);
}

export function formatWarningMessage(loc: Location, msg: string): string {
  return formatCompilerMessage(loc, ErrorType.Warning, "Warning", msg);
}

export function printWarningMessage(loc: Location, msg: string): void {
  printCompilerMessage(loc, ErrorType.Warning, "Warning", msg);
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
    super(formatErrorMessage(loc, msg));
  }
}

export class InternalError extends Error {
  constructor(msg: string, loc?: Location) {
    super(formatErrorMessage(loc ?? getCallerLocation(), msg));
  }
}

export class ImpossibleSituation extends Error {
  constructor() {
    super(
      formatErrorMessage(
        getCallerLocation(),
        "Impossible situation, something fatal has happened",
      ),
    );
  }
}

export class UnreachableCode extends Error {
  constructor() {
    super(
      formatErrorMessage(getCallerLocation(), "Unreachable Code was reached"),
    );
  }
}
