import { printLine, printLineWarning } from "../ModuleCompiler/CLIPrinter";
import { HazeErrorCode } from "./ErrorCodes";

export enum ErrorType {
  Error = 0,
  Warning = 1,
  Info = 2,
}

// ── Diagnostic codes ────────────────────────────────────────────────────────
//
// Every user-facing compiler diagnostic (CompilerError / assertCompilerError /
// printWarningMessage) carries a stable numeric code, printed as `H<code>`
// (e.g. `H2351`), analogous to MSVC's C-numbers. These codes are the contract
// the test suite (testsuite/) asserts against, so they must stay stable once
// assigned: don't renumber an existing code, only add new ones.
//
// Ranges, one block of 1000 per phase, plus a shared block for warnings:
//   1000        generic ANTLR syntax error (Parser.ts error listener)
//   1001-1999   Parser.ts        (explicit parser errors)
//   2001-2999   SymbolCollection.ts
//   3001-3999   Semantic/SemanticTypes.ts
//   4001-4999   Semantic/Conversion.ts
//   5001-5999   Semantic/CTFE.ts
//   6001-6999   Semantic/SemanticBuilder.ts
//   7001-7999   Semantic/Elaborate.ts
//   8001-8999   ProjectCompiler.ts (build/project-level errors)
//   9001-9999   warnings (any file)
export function formatDiagnosticCode(code: HazeErrorCode): string {
  return `H${code}`;
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

export type CompilerDiagnostic = {
  type: ErrorType;
  message: string;
  loc?: SourceLoc;
  title?: string;
  code?: HazeErrorCode;
};

type DiagnosticSink = (diag: CompilerDiagnostic) => void;
let diagnosticSink: DiagnosticSink | null = null;

export function setDiagnosticSink(sink: DiagnosticSink | null) {
  diagnosticSink = sink;
}

export function formatSourceLoc(loc: SourceLocNotNull) {
  if (loc.end) {
    if (loc.end.line === loc.start.line) {
      return `${loc.filename}:${loc.start.line}:${loc.start.column + 1}-${
        loc.end.column + 1
      }`;
    }
    return `${loc.filename}:${loc.start.line}:${loc.start.column + 1}-${
      loc.end.line
    }.${loc.end.column + 1}`;
  }
  return `${loc.filename}:${loc.start.line}:${loc.start.column + 1}`;
}

function formatCompilerMessage(
  type: ErrorType,
  error: string | null,
  msg: string,
  loc?: SourceLoc,
  code?: HazeErrorCode
): string {
  let text = "";
  if (loc) {
    text += `\x1b[31m${formatSourceLoc(loc)}: \x1b[0m`;
  }

  const title =
    error && code !== undefined
      ? `${error} ${formatDiagnosticCode(code)}`
      : error;

  if (title) {
    if (type === ErrorType.Error) {
      text += `\x1b[31m${title}\x1b[0m: ${msg}`;
    } else if (type === ErrorType.Warning) {
      text += `\x1b[33m${title}\x1b[0m: ${msg}`;
    } else {
      text += `${title}: ${msg}`;
    }
  } else {
    text += msg;
  }
  return text;
}

export function printCompilerMessage(
  type: ErrorType,
  error: string | null,
  msg: string,
  loc?: SourceLoc,
  code?: HazeErrorCode
): void {
  if (diagnosticSink) {
    diagnosticSink({
      type: type,
      message: msg,
      loc: loc,
      title: error ?? undefined,
      code: code,
    });
    return;
  }
  if (type === ErrorType.Error) {
    printLine(formatCompilerMessage(type, error, msg, loc, code));
  } else {
    printLineWarning(formatCompilerMessage(type, error, msg, loc, code));
  }
}

export function formatErrorMessage(
  msg: string,
  loc?: SourceLoc,
  code?: HazeErrorCode
): string {
  return formatCompilerMessage(ErrorType.Error, "Error", msg, loc, code);
}

export function printErrorMessage(
  msg: string,
  loc: SourceLoc | undefined,
  code: HazeErrorCode,
  title?: string
): void {
  printCompilerMessage(ErrorType.Error, title ?? "Error", msg, loc, code);
}

export function formatWarningMessage(
  msg: string,
  loc?: SourceLoc,
  code?: HazeErrorCode
): string {
  return formatCompilerMessage(ErrorType.Warning, "Warning", msg, loc, code);
}

export function printWarningMessage(
  msg: string,
  loc: SourceLoc | undefined,
  code: HazeErrorCode
): void {
  printCompilerMessage(ErrorType.Warning, "Warning", msg, loc, code);
}

const callerLocationRegex = /at (?:(.+)\s+\()?(.+?):(\d+):(\d+)/;
export function getCallerLocation(depth = 1): SourceLoc {
  const stack = new Error().stack?.split("\n") ?? [];
  const frame = stack[depth + 1];
  const matches = frame.match(callerLocationRegex);
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
      line: Number.parseInt(matches[3], 10),
      column: Number.parseInt(matches[4], 10),
    },
    filename: matches[2],
  };
}

export class CompilerError extends Error {
  loc: SourceLoc;
  rawMessage: string;
  code: HazeErrorCode;

  constructor(msg: string, loc: SourceLoc, code: HazeErrorCode) {
    super(formatErrorMessage(msg, loc, code));
    this.loc = loc;
    this.rawMessage = msg;
    this.code = code;
  }
}

export class InternalError extends Error {
  constructor(msg: string, loc?: SourceLoc, callFrames?: number) {
    super(
      formatErrorMessage(
        msg,
        loc ?? getCallerLocation(callFrames ? callFrames + 2 : 2)
      )
    );
  }
}

export class ImpossibleSituation extends Error {
  constructor() {
    super(
      formatErrorMessage(
        "Impossible situation, something fatal has happened",
        getCallerLocation(2)
      )
    );
  }
}

export class UnreachableCode extends Error {
  constructor() {
    super(
      formatErrorMessage("Unreachable Code was reached", getCallerLocation(2))
    );
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

export class SilentError extends Error {
  constructor() {
    super();
  }
}

export class GeneralError extends Error {
  text: string;

  constructor(msg: string) {
    super(formatErrorMessage(msg));
    this.text = formatErrorMessage(msg);
  }
}

export function assertFalse(message: string): never {
  throw new InternalError(message, undefined, 1);
}

export function assert(
  condition: unknown,
  message = "Assertion failed"
): asserts condition {
  if (!condition) {
    throw new InternalError(message, undefined, 1);
  }
}

export function assertCompilerError(
  condition: unknown,
  message: string,
  sourceloc: SourceLoc,
  code: HazeErrorCode
): asserts condition {
  if (!condition) {
    throw new CompilerError(message, sourceloc, code);
  }
}
