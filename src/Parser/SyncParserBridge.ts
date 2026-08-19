// Blocking access to a long-lived native parser process.
//
// The compiler's synchronous parse entry point (Parser.parseTextToAST, reached
// from collectImmediate) used to spawn a fresh parser process per call. That is
// ~25ms of process creation and runtime start-up on Windows for a parse that
// takes well under a millisecond, and every synthetic function generated during
// elaboration paid it. Elaboration is ~16k lines of straight-line synchronous
// code with no async anywhere in it, so it cannot simply await the async
// NativeParserServer.
//
// This bridges the two: a worker thread owns the persistent parser process and
// talks to it with ordinary async I/O, while the main thread blocks on
// Atomics.wait until the worker signals a result. The payload itself travels
// over a MessageChannel — a SharedArrayBuffer would have to be sized up front,
// and ASTs have no useful upper bound — and is drained with
// receiveMessageOnPort, which does not need the main thread's event loop to
// spin (it cannot: it is blocked).
//
// Measured on the machine this was written for: ~24.5ms per one-shot spawn
// versus ~0.4ms through this bridge.

import {
  MessageChannel,
  type MessagePort,
  Worker,
  receiveMessageOnPort,
} from "node:worker_threads";

/**
 * The worker body, inlined as a string rather than kept in its own file.
 *
 * `bun build --compile` bundles from a single entry point, so a worker loaded
 * from a sibling path would resolve in development and be missing from the
 * shipped binary. An eval worker has no path to resolve.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const child_process = require("node:child_process");

const signal = new Int32Array(workerData.signal);
const port = workerData.port;

// Hand the result to the main thread. The message must be posted before the
// signal is raised: the main thread calls receiveMessageOnPort the instant it
// wakes, and that only sees messages already queued on the port.
function respond(message) {
  port.postMessage(message);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
}

const proc = child_process.spawn(workerData.binary, ["--server"], {
  cwd: workerData.cwd,
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = Buffer.alloc(0);
let stderr = "";
let pending = false;

proc.stderr.on("data", (chunk) => {
  // Bounded: a parser stuck in a failure loop must not grow this forever.
  stderr = (stderr + chunk.toString("utf8")).slice(-4096);
});

proc.on("error", (err) => {
  if (pending) {
    pending = false;
    respond({ err: "native parser failed to start: " + err.message });
  }
});

proc.on("exit", (code) => {
  if (pending) {
    pending = false;
    respond({
      err: "native parser exited (code " + code + ")" +
        (stderr.trim() ? ": " + stderr.trim() : ""),
    });
  }
});

proc.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drain();
});

// Same framing as NativeParserServer: a header line, then exactly the number of
// body bytes it names.
function drain() {
  if (!pending) {
    return;
  }

  const newline = buffer.indexOf(0x0a);
  if (newline < 0) {
    return;
  }

  const header = buffer.subarray(0, newline).toString("utf8");

  if (!header.startsWith("OK ")) {
    buffer = buffer.subarray(newline + 1);
    pending = false;
    respond({
      err: header.startsWith("ERR ") ? header.slice(4) : "bad response header: " + header,
    });
    return;
  }

  const length = Number.parseInt(header.slice(3), 10);
  const bodyStart = newline + 1;
  if (buffer.length < bodyStart + length) {
    return; // wait for the rest of the payload
  }

  const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
  buffer = buffer.subarray(bodyStart + length);
  pending = false;
  respond({ json: body });
}

parentPort.on("message", (msg) => {
  if (msg.quit) {
    proc.stdin.write("__quit__\\n");
    proc.stdin.end();
    process.exit(0);
  }

  const payload = Buffer.from(msg.text, "utf8");
  pending = true;
  proc.stdin.write(
    Buffer.concat([
      Buffer.from("TEXT " + payload.length + " " + msg.filename + "\\n", "utf8"),
      payload,
    ])
  );
  // A complete response may already be sitting in the buffer.
  drain();
});
`;

/**
 * How long the main thread will block before giving up on the worker.
 *
 * Reaching this means the parser is wedged. The bridge cannot be reused after
 * that — a late response would be handed to the *next* request — so a timeout
 * retires it permanently and the caller falls back to one-shot spawning.
 */
const REQUEST_TIMEOUT_MS = 30_000;

type Bridge = {
  worker: Worker;
  port: MessagePort;
  signal: Int32Array;
};

let bridge: Bridge | null = null;
/** Set once the bridge is known to be unusable; never retried after that. */
let disabled = false;

function createBridge(repoRoot: string, binary: string): Bridge | null {
  try {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    const channel = new MessageChannel();

    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        signal: signal.buffer,
        port: channel.port2,
        binary: binary,
        cwd: repoRoot,
      },
      transferList: [channel.port2],
    });

    // Neither the worker nor the parser it owns may hold the compiler open;
    // both are torn down explicitly when the command finishes.
    worker.unref();
    channel.port1.unref();

    return { worker: worker, port: channel.port1, signal: signal };
  } catch {
    return null;
  }
}

/**
 * Start the bridge if it is not running yet.
 *
 * Worth calling as soon as the native parser is known to be in use: the worker
 * and its parser process take ~100ms to come up, and doing that eagerly hides
 * the cost behind work the build is doing anyway.
 */
export function warmupSyncParser(repoRoot: string, binary: string): void {
  if (bridge || disabled) {
    return;
  }
  bridge = createBridge(repoRoot, binary);
  if (!bridge) {
    disabled = true;
  }
}

/** Tear the bridge down. Safe to call when it was never started. */
export function shutdownSyncParser(): void {
  if (!bridge) {
    return;
  }
  const current = bridge;
  bridge = null;
  try {
    current.worker.postMessage({ quit: true });
    current.port.close();
  } catch {
    // The worker is already gone; terminate() below is enough.
  }
  current.worker.terminate();
}

/** Retire the bridge after a fault, so callers fall back for the rest of the run. */
function retire(): void {
  disabled = true;
  shutdownSyncParser();
}

/**
 * Parse source text through the persistent parser, blocking until it answers.
 *
 * Returns the raw response JSON, or null if the bridge is unavailable — in
 * which case the caller should fall back to a one-shot process. Parse *errors*
 * are thrown rather than returned as null: those come from the source text and
 * a fallback would only reproduce them.
 */
export function parseTextSyncViaBridge(
  repoRoot: string,
  binary: string,
  text: string,
  filename: string
): string | null {
  warmupSyncParser(repoRoot, binary);
  if (!bridge) {
    return null;
  }

  const { worker, port, signal } = bridge;

  Atomics.store(signal, 0, 0);
  try {
    worker.postMessage({ text: text, filename: filename });
  } catch {
    retire();
    return null;
  }

  if (Atomics.wait(signal, 0, 0, REQUEST_TIMEOUT_MS) === "timed-out") {
    retire();
    return null;
  }

  // The store that woke us and the queued message are published by different
  // mechanisms, so on rare occasions the message lands a moment after the
  // wake-up. Spin briefly rather than treating that as a failure.
  let message = receiveMessageOnPort(port);
  for (let attempt = 0; !message && attempt < 1000; attempt++) {
    message = receiveMessageOnPort(port);
  }

  if (!message) {
    retire();
    return null;
  }

  const result = message.message as { json?: string; err?: string };

  if (typeof result.err === "string") {
    // A dead parser is a bridge fault; a rejected parse is the caller's problem.
    if (result.err.includes("native parser exited") ||
        result.err.includes("native parser failed to start")) {
      retire();
      return null;
    }
    throw new Error(`native parser failed for ${filename}: ${result.err}`);
  }

  return result.json ?? null;
}
