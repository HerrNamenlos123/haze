// Blocking access to long-lived helper processes.
//
// Two of the compiler's helpers are external programs that used to be spawned
// once per item of work:
//
//   * the native parser, once per synchronous parse (every synthetic function)
//   * haze-regex-compile, once per regex literal in the program
//
// On Windows a process spawn plus runtime start-up is ~25ms, which dwarfed the
// work itself — parsing ten lines, or compiling one regex — and a build with a
// few hundred regexes paid it a few hundred times.
//
// Both call sites are synchronous and sit deep inside code that cannot await:
// elaboration is ~16k lines with no async in it at all, and regex compilation
// runs inside the code generator. So neither can talk to a long-lived process
// the normal way.
//
// This bridges the two worlds. A worker thread owns the helper process and
// talks to it with ordinary async I/O, while the main thread blocks on
// Atomics.wait until the worker signals a result. The payload travels over a
// MessageChannel — a SharedArrayBuffer would have to be sized up front, and
// neither ASTs nor error messages have a useful upper bound — and is drained
// with receiveMessageOnPort, which does not need the main thread's event loop
// to spin (it cannot: it is blocked).
//
// The bridge is deliberately protocol-agnostic: callers hand it an opaque
// request buffer and get the response body back. Both helpers speak the same
// framing, which is the only thing this file knows about them:
//
//     OK <byteLength>\n<body>     success
//     ERR <message>\n             failure
//
// Measured: ~24.5ms per one-shot parser spawn versus ~0.4ms through the bridge,
// and ~23ms versus ~3.8ms per regex.

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

const proc = child_process.spawn(workerData.binary, workerData.args, {
  cwd: workerData.cwd,
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = Buffer.alloc(0);
let stderr = "";
let pending = false;

proc.stderr.on("data", (chunk) => {
  // Bounded: a helper stuck in a failure loop must not grow this forever.
  stderr = (stderr + chunk.toString("utf8")).slice(-4096);
});

proc.on("error", (err) => {
  if (pending) {
    pending = false;
    respond({ fatal: "helper failed to start: " + err.message });
  }
});

proc.on("exit", (code) => {
  if (pending) {
    pending = false;
    respond({
      fatal: "helper exited (code " + code + ")" +
        (stderr.trim() ? ": " + stderr.trim() : ""),
    });
  }
});

proc.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drain();
});

// A header line, then exactly the number of body bytes it names.
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
  respond({ body: body });
}

parentPort.on("message", (msg) => {
  if (msg.quit) {
    try {
      proc.stdin.write("__quit__\\n");
      proc.stdin.end();
    } catch {}
    process.exit(0);
  }

  pending = true;
  proc.stdin.write(Buffer.from(msg.payload));
  // A complete response may already be sitting in the buffer.
  drain();
});
`;

/**
 * How long the main thread will block before giving up on a helper.
 *
 * Reaching this means the helper is wedged. The bridge cannot be reused after
 * that — a late response would be handed to the *next* request — so a timeout
 * retires it permanently and the caller falls back to one-shot spawning.
 */
const REQUEST_TIMEOUT_MS = 30_000;

type Bridge = {
  worker: Worker;
  port: MessagePort;
  signal: Int32Array;
};

/** One bridge per helper, keyed by caller-chosen name ("parser", "regex"). */
const bridges = new Map<string, Bridge>();
/** Helpers known to be unusable; never retried for the rest of the run. */
const disabled = new Set<string>();

function createBridge(
  binary: string,
  cwd: string,
  args: string[]
): Bridge | null {
  try {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    const channel = new MessageChannel();

    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        signal: signal.buffer,
        port: channel.port2,
        binary: binary,
        args: args,
        cwd: cwd,
      },
      transferList: [channel.port2],
    });

    // Neither the worker nor the helper it owns may hold the compiler open;
    // both are torn down explicitly when the command finishes.
    worker.unref();
    channel.port1.unref();

    return { worker: worker, port: channel.port1, signal: signal };
  } catch {
    return null;
  }
}

/**
 * Start a helper if it is not running yet.
 *
 * Worth calling as soon as the helper is known to be needed: the worker and the
 * process behind it take ~100ms to come up, and doing that eagerly hides the
 * cost behind work the build is doing anyway.
 */
export function warmupBridge(
  key: string,
  binary: string,
  cwd: string,
  args: string[] = ["--server"]
): void {
  if (bridges.has(key) || disabled.has(key)) {
    return;
  }
  const bridge = createBridge(binary, cwd, args);
  if (bridge) {
    bridges.set(key, bridge);
  } else {
    disabled.add(key);
  }
}

/** Tear one helper down. Safe to call when it was never started. */
export function shutdownBridge(key: string): void {
  const current = bridges.get(key);
  if (!current) {
    return;
  }
  bridges.delete(key);
  try {
    current.worker.postMessage({ quit: true });
    current.port.close();
  } catch {
    // The worker is already gone; terminate() below is enough.
  }
  current.worker.terminate();
}

/** Tear every helper down. Called once when the command finishes. */
export function shutdownAllBridges(): void {
  for (const key of [...bridges.keys()]) {
    shutdownBridge(key);
  }
}

/** Retire a helper after a fault, so callers fall back for the rest of the run. */
function retire(key: string): void {
  disabled.add(key);
  shutdownBridge(key);
}

/**
 * Send one request to a helper and block until it answers.
 *
 * Returns the response body, or null if the bridge is unavailable — in which
 * case the caller should fall back to a one-shot process. Errors *reported by
 * the helper* are thrown instead: those come from the input and a fallback
 * would only reproduce them.
 */
export function requestSync(
  key: string,
  binary: string,
  cwd: string,
  payload: Buffer,
  args: string[] = ["--server"]
): string | null {
  warmupBridge(key, binary, cwd, args);
  const bridge = bridges.get(key);
  if (!bridge) {
    return null;
  }

  const { worker, port, signal } = bridge;

  Atomics.store(signal, 0, 0);
  try {
    // The buffer is copied into the message; the worker gets its own bytes.
    worker.postMessage({ payload: payload });
  } catch {
    retire(key);
    return null;
  }

  if (Atomics.wait(signal, 0, 0, REQUEST_TIMEOUT_MS) === "timed-out") {
    retire(key);
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
    retire(key);
    return null;
  }

  const result = message.message as {
    body?: string;
    err?: string;
    fatal?: string;
  };

  // A dead helper is a bridge fault: fall back rather than fail the build.
  if (typeof result.fatal === "string") {
    retire(key);
    return null;
  }

  if (typeof result.err === "string") {
    throw new Error(result.err);
  }

  return result.body ?? null;
}
