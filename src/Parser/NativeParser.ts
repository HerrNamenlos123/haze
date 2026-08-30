// Bridge to the native Haze parser (compiler/haze-parser).
//
// The native parser is a Haze program compiled to a binary. It reads file paths
// on stdin and writes AST JSON on stdout, so a whole build pays for one process
// instead of one per file.
//
// JSON cannot represent everything the AST uses, so two field shapes are encoded
// and revived here:
//   * integer literal `value` is a decimal string  -> BigInt
//     (values routinely exceed 2^53 and can exceed 64 bits, so a JSON number
//      would silently corrupt them)
//   * regex literal `flags` is an array            -> Set<string>

import * as child_process from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ASTRoot } from "../shared/AST";
import { EPrimitive } from "../shared/common";
import { HazeErrorCode } from "../shared/ErrorCodes";
import { CompilerError } from "../shared/Errors";
import {
  getInstalledParserBinary,
  isInstalledBuild,
} from "../shared/InstallPaths";
import { requestSync, warmupBridge } from "./SyncBridge";

export const PARSER_PROJECT_DIR = path.join("compiler", "haze-parser");
// The `.exe` suffix matters for more than spawning: isParserUpToDate() probes
// this path with existsSync, which does no PATHEXT resolution, so an
// extensionless path made the check fail forever on Windows and rebuilt the
// parser (through the slow ANTLR pipeline) on every single build.
const PARSER_BINARY = path.join(
  "__haze__",
  "haze-parser",
  "bin",
  process.platform === "win32" ? "haze-parser.exe" : "haze-parser"
);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Turn a native parser error line (`<file>:<line>:<col>: <message>`) into the
 * same H1000 syntax error the ANTLR path raises, so error codes are identical
 * regardless of which parser ran.
 */
export function nativeParseErrorToCompilerError(message: string): Error {
  const m = /^(.*?):(\d+):(\d+): (.*)$/s.exec(message);
  if (m) {
    return new CompilerError(
      m[4],
      {
        filename: m[1],
        start: { line: Number(m[2]), column: Number(m[3]) },
      },
      HazeErrorCode.SyntaxError
    );
  }
  return new CompilerError(message, null, HazeErrorCode.SyntaxError);
}

// ---------------------------------------------------------------------------
// Reviving
// ---------------------------------------------------------------------------

/**
 * Walk the parsed JSON and restore the values JSON cannot carry.
 *
 * Done as one iterative pass with an explicit stack: ASTs nest deeply enough
 * that recursion risks a stack overflow on generated files.
 */
export function reviveAST(root: unknown): ASTRoot {
  // The parser emits an envelope {f: filename, d: [...]} so the filename is
  // sent once rather than on all ~10k nodes.
  let declarations: unknown = root;
  let filename = "";
  if (root !== null && typeof root === "object" && !Array.isArray(root)) {
    const envelope = root as { f?: unknown; d?: unknown };
    if (typeof envelope.f === "string" && Array.isArray(envelope.d)) {
      filename = envelope.f;
      declarations = envelope.d;
    }
  }

  const stack: unknown[] = [declarations];

  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") {
      continue;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        if (item !== null && typeof item === "object") {
          stack.push(item);
        }
      }
      continue;
    }

    const obj = node as {
      type?: unknown;
      value?: unknown;
      flags?: unknown;
      L?: unknown;
      F?: unknown;
      variant?: unknown;
      generics?: unknown;
      sourceloc?: unknown;
      [key: string]: unknown;
    };

    // Expand the compact source location: L = [startLine, startCol, endLine,
    // endCol], with the end pair omitted when the node has no end, and F set
    // only when a `#source` block redirects to another file.
    if (Array.isArray(obj.L)) {
      const l = obj.L as number[];
      const loc: {
        filename: string;
        start: { line: number; column: number };
        end?: { line: number; column: number };
      } = {
        // A relative F (from a #source directive) is resolved against the
        // directory of the file that contains the directive.
        filename:
          typeof obj.F === "string"
            ? path.isAbsolute(obj.F)
              ? obj.F
              : path.resolve(path.dirname(filename), obj.F)
            : filename,
        start: { line: l[0] ?? 0, column: l[1] ?? 0 },
      };
      if (l.length >= 4) {
        loc.end = { line: l[2] ?? 0, column: l[3] ?? 0 };
      }
      obj.sourceloc = loc;
      delete obj.L;
      delete obj.F;
    }

    // `generics` is omitted when empty; every consumer expects an array.
    if (typeof obj.variant === "string" && obj.generics === undefined) {
      if (NODES_WITH_GENERICS.has(obj.variant)) {
        obj.generics = [];
      }
    }

    // A LiteralValue is the only place these encodings appear.
    if (typeof obj.type === "number") {
      if (isIntegerPrimitive(obj.type) && typeof obj.value === "string") {
        obj.value = BigInt(obj.value);
      } else if (obj.type === EPrimitive.Regex && Array.isArray(obj.flags)) {
        obj.flags = new Set(obj.flags as string[]);
      }
    }

    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value !== null && typeof value === "object") {
        stack.push(value);
      }
    }
  }

  return declarations as ASTRoot;
}

/** AST variants whose `generics` field is non-optional in shared/AST.ts. */
const NODES_WITH_GENERICS = new Set([
  "SymbolValueExpr",
  "ExprMemberAccess",
  "OptionalChainingExprMemberAccess",
  "FunctionDefinition",
  "StructDefinition",
  "AliasDef",
]);

function isIntegerPrimitive(type: number): boolean {
  return (
    type === EPrimitive.int ||
    type === EPrimitive.i8 ||
    type === EPrimitive.i16 ||
    type === EPrimitive.i32 ||
    type === EPrimitive.i64 ||
    type === EPrimitive.u8 ||
    type === EPrimitive.u16 ||
    type === EPrimitive.u32 ||
    type === EPrimitive.u64 ||
    type === EPrimitive.usize
  );
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Hash of the parser's own sources. The binary is rebuilt only when this
 * changes, so the ANTLR-based bootstrap cost is paid once rather than per run.
 */
function parserSourceHash(repoRoot: string): string {
  const srcDir = path.join(repoRoot, PARSER_PROJECT_DIR, "src");
  const hash = crypto.createHash("sha256");

  const files = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith(".hz"))
    .sort();
  for (const file of files) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(srcDir, file)));
  }
  return hash.digest("hex");
}

function stampPath(repoRoot: string): string {
  return path.join(repoRoot, "__haze__", "haze-parser", ".source-hash");
}

export function isParserUpToDate(repoRoot: string): boolean {
  const binary = path.join(repoRoot, PARSER_BINARY);
  const stamp = stampPath(repoRoot);
  if (!(fs.existsSync(binary) && fs.existsSync(stamp))) {
    return false;
  }
  try {
    return fs.readFileSync(stamp, "utf8").trim() === parserSourceHash(repoRoot);
  } catch {
    return false;
  }
}

/**
 * The argv the bootstrap rebuild spawns, minus the executable itself.
 *
 * The compiler runs in two shapes and `process.execPath` means something
 * different in each. Under `bun run src/main.ts` it is the JS runtime, which
 * needs to be told which script to run. Under a compiled `dist/haze` it *is*
 * the compiler, and handing it `src/main.ts` makes argparse reject it as an
 * unknown subcommand -- which is exactly what made the rebuild silently
 * impossible and left the build quietly on the ANTLR parser (§8.1).
 *
 * Pure and exported so `scripts/parser-bootstrap.test.ts` can pin both shapes
 * without needing a compiled compiler to hand.
 *
 * `--parser antlr` is essential in both: the default parser mode is `native`,
 * so without it the child would find the binary missing/stale, call
 * buildNativeParser() itself, and recurse forever.
 */
export function nativeParserBuildArgs(
  hostIsCompiledCompiler: boolean
): string[] {
  const command = ["build", "--dir", PARSER_PROJECT_DIR, "--parser", "antlr"];
  return hostIsCompiledCompiler
    ? command
    : [path.join("src", "main.ts"), ...command];
}

/**
 * Build the native parser with the existing (ANTLR) pipeline. Returns false and
 * leaves stderr in place if the build fails, so the caller can report it.
 */
export function buildNativeParser(repoRoot: string): boolean {
  const result = child_process.spawnSync(
    process.execPath,
    nativeParserBuildArgs(isInstalledBuild()),
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "development" },
    }
  );

  if (result.status !== 0) {
    return false;
  }

  stampNativeParser(repoRoot);
  return true;
}

/**
 * Record the parser sources the current binary was built from, so later runs
 * (and `bun run install`) can tell whether it is still current. Exported for
 * the installer, which builds the parser itself.
 */
export function stampNativeParser(repoRoot: string): void {
  fs.mkdirSync(path.dirname(stampPath(repoRoot)), { recursive: true });
  fs.writeFileSync(stampPath(repoRoot), parserSourceHash(repoRoot), "utf8");
}

export function ensureNativeParser(repoRoot: string): boolean {
  // The deployed parser was built from the same commit as the compiler, so it
  // is current by construction and there is nothing to rebuild it from.
  if (getInstalledParserBinary()) {
    return true;
  }
  if (isParserUpToDate(repoRoot)) {
    return true;
  }
  return buildNativeParser(repoRoot);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/**
 * A long-lived native parser process.
 *
 * Protocol: write a path plus newline, read back `OK <byteLength>\n` followed by
 * exactly that many bytes of JSON, or `ERR <message>\n`. Byte counts avoid
 * having to scan or escape the payload.
 */
export class NativeParserServer {
  private proc: child_process.ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private pending: {
    resolve: (v: string) => void;
    reject: (e: Error) => void;
  } | null = null;
  private queue: { run: () => void; reject: (e: Error) => void }[] = [];

  constructor(private readonly repoRoot: string) {}

  start(): void {
    if (this.proc) {
      return;
    }
    this.proc = child_process.spawn(
      parserBinaryPath(this.repoRoot),
      ["--server"],
      { cwd: this.repoRoot, stdio: ["pipe", "pipe", "pipe"] }
    );

    // The parser must never keep the compiler process alive on its own; it is
    // shut down explicitly when the command finishes (see main.ts).
    this.proc.unref();

    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });

    this.proc.on("exit", () => {
      this.proc = null;
      this.failAll(new Error("native parser exited"));
    });
  }

  /** Fail the in-flight request and everything still queued behind it. */
  private failAll(error: Error): void {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
    const queued = this.queue;
    this.queue = [];
    for (const job of queued) {
      job.reject(error);
    }
  }

  /** Try to complete the in-flight request from the buffered bytes. */
  private drain(): void {
    if (!this.pending) {
      return;
    }

    const newline = this.buffer.indexOf(0x0a);
    if (newline < 0) {
      return;
    }

    const header = this.buffer.subarray(0, newline).toString("utf8");

    if (header.startsWith("ERR ")) {
      const pending = this.pending;
      this.pending = null;
      this.buffer = this.buffer.subarray(newline + 1);
      pending.reject(nativeParseErrorToCompilerError(header.slice(4)));
      this.next();
      return;
    }

    if (!header.startsWith("OK ")) {
      // Drop the offending line and keep going. Returning here (as this used
      // to) left the bytes in the buffer and never called next(), so one
      // unexpected line on stdout wedged every queued parse forever.
      const pending = this.pending;
      this.pending = null;
      this.buffer = this.buffer.subarray(newline + 1);
      pending.reject(new Error(`bad response header: ${header}`));
      this.next();
      return;
    }

    const length = Number.parseInt(header.slice(3), 10);
    const bodyStart = newline + 1;
    if (this.buffer.length < bodyStart + length) {
      return; // wait for the rest of the payload
    }

    const body = this.buffer
      .subarray(bodyStart, bodyStart + length)
      .toString("utf8");
    this.buffer = this.buffer.subarray(bodyStart + length);

    const pending = this.pending;
    this.pending = null;
    pending.resolve(body);
    this.next();
  }

  private next(): void {
    const job = this.queue.shift();
    if (job) {
      job.run();
    }
  }

  /** Parse source text the caller already holds, via the TEXT request. */
  parseTextRaw(text: string, filename: string): Promise<string> {
    const payload = Buffer.from(text, "utf8");
    return this.request(
      Buffer.concat([
        Buffer.from(`TEXT ${payload.length} ${filename}\n`, "utf8"),
        payload,
      ])
    );
  }

  async parseText(text: string, filename: string): Promise<ASTRoot> {
    return reviveAST(JSON.parse(await this.parseTextRaw(text, filename)));
  }

  /** Parse one file, returning the raw (un-revived) JSON text. */
  parseRaw(filepath: string): Promise<string> {
    return this.request(Buffer.from(`${filepath}\n`, "utf8"));
  }

  /**
   * Send one request and await its response. Requests are serialised: the
   * protocol has no request ids, so only one may be in flight at a time.
   */
  private request(payload: Buffer): Promise<string> {
    this.start();

    return new Promise<string>((resolve, reject) => {
      const run = () => {
        this.start();
        if (!this.proc) {
          reject(new Error("native parser is not running"));
          this.next();
          return;
        }
        this.pending = { resolve: resolve, reject: reject };
        this.proc.stdin.write(payload);
        // A previous response may already be buffered.
        this.drain();
      };

      if (this.pending) {
        this.queue.push({ run: run, reject: reject });
      } else {
        run();
      }
    });
  }

  async parse(filepath: string): Promise<ASTRoot> {
    const json = await this.parseRaw(filepath);
    return reviveAST(JSON.parse(json));
  }

  stop(): void {
    if (!this.proc) {
      return;
    }
    this.proc.stdin.write("__quit__\n");
    this.proc.stdin.end();
    this.proc = null;
  }
}

/** Parse a single file in a one-shot process. Used by the equivalence checker. */
export function parseFileNativeSync(
  repoRoot: string,
  filepath: string
): ASTRoot {
  const result = child_process.spawnSync(
    parserBinaryPath(repoRoot),
    [filepath],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }
  );

  if (result.status !== 0) {
    throw new Error(
      `native parser failed for ${filepath}: ${result.stderr?.trim()}`
    );
  }
  return reviveAST(JSON.parse(result.stdout));
}

/** Absolute path to the parser binary, for callers outside this module. */
/** Bridge key for the long-lived parser process. */
const PARSER_BRIDGE = "parser";

export function parserBinaryPath(repoRoot: string): string {
  // An installed compiler ships the parser beside itself; there is no checkout
  // under the user's cwd to look in, and none to rebuild from either.
  return getInstalledParserBinary() ?? path.join(repoRoot, PARSER_BINARY);
}

/**
 * Start the synchronous bridge's worker ahead of the first parse, so its
 * ~100ms of worker and parser start-up overlaps with the rest of the build.
 */
export function warmupNativeParserSync(repoRoot: string): void {
  warmupBridge(PARSER_BRIDGE, parserBinaryPath(repoRoot), repoRoot);
}

/**
 * Parse source text the compiler already holds.
 *
 * The compiler's parse entry point is synchronous and is called from deep
 * inside the collection phase, so it cannot await the async server. It goes
 * through SyncParserBridge instead, which blocks on a worker that owns one
 * persistent parser process. Spawning a process per call — what this used to
 * do, and what it still falls back to if the bridge is unavailable — costs
 * ~25ms each, which dominated synthetic function generation.
 *
 * The text is passed in memory (via the server protocol's TEXT request) so
 * nothing has to be written to disk, and so sources with no file at all — the
 * synthetic "internal" ones — work too.
 */
export function parseTextNativeSync(
  repoRoot: string,
  text: string,
  filename: string
): ASTRoot {
  const payload = Buffer.from(text, "utf8");
  const request = Buffer.concat([
    Buffer.from(
      `TEXT ${payload.length} ${filename}
`,
      "utf8"
    ),
    payload,
  ]);

  let viaBridge: string | null;
  try {
    viaBridge = requestSync(
      PARSER_BRIDGE,
      parserBinaryPath(repoRoot),
      repoRoot,
      request
    );
  } catch (e) {
    throw new Error(
      `native parser failed for ${filename}: ${(e as Error).message}`
    );
  }

  if (viaBridge !== null) {
    return reviveAST(JSON.parse(viaBridge));
  }
  return parseTextNativeSpawn(repoRoot, text, filename);
}

/**
 * One parse, one process. The fallback for when the bridge cannot run; also
 * what every synchronous parse used to do.
 */
function parseTextNativeSpawn(
  repoRoot: string,
  text: string,
  filename: string
): ASTRoot {
  const payload = Buffer.from(text, "utf8");
  const header = Buffer.from(`TEXT ${payload.length} ${filename}\n`, "utf8");

  const result = child_process.spawnSync(
    parserBinaryPath(repoRoot),
    ["--server"],
    {
      cwd: repoRoot,
      input: Buffer.concat([header, payload, Buffer.from("__quit__\n")]),
      maxBuffer: 512 * 1024 * 1024,
    }
  );

  if (result.status !== 0) {
    throw new Error(
      `native parser failed for ${filename}: ${result.stderr?.toString().trim()}`
    );
  }

  const stdout = result.stdout;
  const newline = stdout.indexOf(0x0a);
  const head = stdout.subarray(0, newline).toString("utf8");
  if (!head.startsWith("OK ")) {
    if (head.startsWith("ERR ")) {
      throw nativeParseErrorToCompilerError(head.slice(4));
    }
    throw new Error(`native parser failed for ${filename}: ${head}`);
  }
  const length = Number.parseInt(head.slice(3), 10);
  const body = stdout
    .subarray(newline + 1, newline + 1 + length)
    .toString("utf8");
  return reviveAST(JSON.parse(body));
}
