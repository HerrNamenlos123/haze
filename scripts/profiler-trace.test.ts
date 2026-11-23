/**
 * The profiler's trace.json as DevTools reads it (docs/profiler-timelines.md).
 *
 * A program with four tasks (one yields, one sleeps, one blocks in C, one
 * works) writes a trace; DevTools' own trace engine (@paulirish/trace_engine,
 * pinned: the code the Performance panel runs) parses it. Checked: the thread
 * is DevTools' main thread; every run, loop turn and off-CPU bar is in the
 * thread's tree under its label (DevTools silently drops an event that breaks
 * the nesting); the work's samples hang under their task's bar; the extension
 * tracks hold the runs; the blocking run's off-CPU time is in its details.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as TraceEngine from "@paulirish/trace_engine";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXE = process.platform === "win32" ? ".exe" : "";
const NAME = "proftrace";

const PROGRAM = `__c__("#ifdef _WIN32\\n#include <windows.h>\\nstatic void block_ms(int ms) { Sleep((DWORD)ms); }\\n#else\\n#include <time.h>\\nstatic void block_ms(int ms) { struct timespec t = { ms / 1000, (long)(ms % 1000) * 1000000L }; nanosleep(&t, NULL); }\\n#endif");
fn work(seconds: real): int {
    let start = time.now();
    let x = 0;
    while time.now() - start < seconds {
        for (let i = 0; i < 10000; i++) { x = x + i; }
    }
    return x;
}
fn main(): int {
    let args = sys.args();
    let p = Profiler({ samplingRate: 2000, memoryInstrumentation: false, memoryInstrumentationStacktraces: false });
    let yielder = task.spawn(() => {
        sys.yield();
        return 1;
    });
    let sleeper = task.spawn(() => {
        // Outlasts the others (20 ms blocked, 30 ms of work): the scheduler
        // then has nothing to run and waits in the event loop.
        time.sleep(0.08);
        return 2;
    });
    let blocker = task.spawn(() => {
        do unsafe { __c__("block_ms(20);"); };
        return 3;
    });
    let worker = task.spawn(() => {
        return work(0.03);
    });
    let a = yielder.join();
    let b = sleeper.join();
    let c = blocker.join();
    let d = worker.join();
    p.stopAndSave(args[1]);
    return 0;
}
`;

/** The line of the n-th `task.spawn` in PROGRAM (1-based). */
function spawnLine(n: number): number {
  const lines = PROGRAM.split("\n");
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("task.spawn")) {
      seen++;
      if (seen === n) {
        return i + 1;
      }
    }
  }
  throw new Error("no such spawn");
}

type Ev = { name: string; ph: string; tid: number; ts: number; dur?: number; args?: any };
let root = "";
let events: Ev[] = [];
let data: any;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "haze-proftrace-"));
  const app = join(root, "app");
  mkdirSync(join(app, "src"), { recursive: true });
  writeFileSync(
    join(app, "haze.toml"),
    `name = "${NAME}"\nid = "PrfTrc01"\nversion = "0.1.0"\ndescription = ""\nlicense = "MIT"\nauthors = []\nsrc = "src"\ntype = "exe"\n`
  );
  writeFileSync(join(app, "src", "main.hz"), PROGRAM);
  const build = spawnSync("bun", ["run", "src/main.ts", "build", "--dir", app, "--quiet"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "development" },
  });
  if (build.status !== 0) {
    throw new Error(`build failed:\n${build.stdout}${build.stderr}`);
  }
  const tracePath = join(root, "trace.json");
  const run = spawnSync(join(REPO_ROOT, "__haze__", NAME, "bin", NAME + EXE), [tracePath], {
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`run failed (${run.status}):\n${run.stdout}${run.stderr}`);
  }
  const trace = JSON.parse(readFileSync(tracePath, "utf8"));
  events = trace.traceEvents;
  const model = TraceEngine.TraceModel.Model.createWithAllHandlers();
  await model.parse(events, { metadata: trace.metadata });
  data = model.parsedTrace(0).data;
  rmSync(root, { recursive: true, force: true });
}, 300_000);

const bars = () => events.filter((e) => e.name === "EventDispatch");
const barTypes = () => bars().map((e) => e.args.data.type as string);

describe("the profiler's trace in DevTools' trace engine", () => {
  test("the Haze main thread is DevTools' main thread", () => {
    const threads = TraceEngine.Handlers.Threads.threadsInTrace(data);
    const main = threads.find((t: any) => t.tid === 1);
    expect(main?.name).toBe("CrRendererMain");
    expect(main?.type).toBe("MAIN_THREAD");
  });

  test("every task run is a bar labelled with the task and where it was spawned", () => {
    const types = new Set(barTypes());
    expect(types.has("task 1 main")).toBe(true);
    for (let n = 1; n <= 4; n++) {
      expect(types.has(`task ${n + 1} main.hz:${spawnLine(n)}`)).toBe(true);
    }
    expect(types.has("event loop")).toBe(true);
    expect(types.has("event loop, waiting")).toBe(true);
  });

  test("no bar is dropped: each is in the thread's tree", () => {
    const inTree = new Set<any>();
    for (const [event] of data.Renderer.entryToNode) {
      if (event.name === "EventDispatch") {
        inTree.add(event);
      }
    }
    const missing = bars().filter((e) => !inTree.has(e));
    expect(missing.map((e) => `${e.args.data.type} @${e.ts}+${e.dur}`)).toEqual([]);
  });

  test("the work's samples hang under its task's bar", () => {
    const label = `task 5 main.hz:${spawnLine(4)}`;
    let calls = 0;
    let underBar = 0;
    for (const [event, node] of data.Renderer.entryToNode) {
      if (event.name !== "ProfileCall" || event.callFrame?.functionName !== "work()") {
        continue;
      }
      calls++;
      for (let up = node.parent; up; up = up.parent) {
        if (up.entry.name === "EventDispatch") {
          if (up.entry.args.data.type === label) {
            underBar++;
          }
          break;
        }
      }
    }
    expect(calls).toBeGreaterThan(0);
    expect(underBar).toBe(calls);
  });

  test("the runs are in the extension track group, with their properties", () => {
    const group = data.ExtensionTraceData.extensionTrackData.find((t: any) => t.name === "Haze");
    expect(group?.isTrackGroup).toBe(true);
    const runs = group.entriesByTrack["main tasks"];
    const runBars = bars().filter((e) => (e.args.data.type as string).startsWith("task "));
    expect(runs.length).toBe(runBars.length);
    const props = new Map<string, string>(runs[0].devtoolsObj.properties);
    expect(props.has("spawned at")).toBe(true);
    expect(props.has("ended by")).toBe(true);
  });

  test("the blocking run spent its 20 ms off the CPU", () => {
    const label = `task 4 main.hz:${spawnLine(3)}`;
    const run = bars().find((e) => e.args.data.type === label);
    expect(run?.args.data.wallMs).toBeGreaterThanOrEqual(19);
    expect(run?.args.data.offCpuMs).toBeGreaterThanOrEqual(15);
    if (process.platform === "linux") {
      // The kernel's record: a voluntary switch out inside that run.
      const inside = bars().filter(
        (e) => e.args.data.type === "off CPU, waiting" && e.ts >= run!.ts && e.ts + (e.dur ?? 0) <= run!.ts + (run!.dur ?? 0)
      );
      expect(inside.length).toBeGreaterThanOrEqual(1);
    }
  });
});
