// Records where a build's time goes, for `--timing-graph`.
//
// Every module gets a row. On it are the module's main-thread work (the
// compiler's own JS: checking, parsing, analysis, lowering, C generation), the
// time it spent queued for the main thread, and its background work (clang,
// the linker, ar, generators), all as spans on one clock: milliseconds since
// the process started.
//
// The numbers are exact rather than sampled because of MainThreadLock below:
// the compiler runs on one JS thread, so if several modules interleaved their
// work at every `await`, a span's wall time would include whatever the other
// modules did in between. Holding the lock, a module has the thread to itself,
// so a main span's length is the cost of that work.

import { AsyncLocalStorage } from "node:async_hooks";
import os from "node:os";
import { InternalError } from "../shared/Errors";

export type SpanKind = "main" | "queued" | "background";

export type TimelineSpan = {
  row: string;
  kind: SpanKind;
  label: string;
  start: number;
  end: number;
};

export type RowOutcome = "built" | "up-to-date" | "failed";

export type TimelineRow = {
  key: string;
  build: number;
  module: string;
  /** Names of the modules this one waits for, within the same build. */
  deps: string[];
  /** The row of the module whose generator started this row's build. */
  parentRow: string | null;
  /** When the build this row belongs to started scheduling modules. */
  discovered: number;
  /** When every dependency had finished and the module was started. */
  ready: number | null;
  /**
   * When everything a dependent module needs from this one was known: the
   * end of C generation. Dependents are still only started at `done`, after
   * this module's own clang, ar and packaging.
   */
  interfaceReady: number | null;
  done: number | null;
  outcome: RowOutcome | null;
};

export type TimelineBuild = {
  id: number;
  root: string;
  parentRow: string | null;
  start: number;
  end: number | null;
  /** Settings summary shown in the graph's header. */
  description: string;
};

export type CpuSample = {
  t: number;
  /** Cores busy machine-wide during the interval ending at t. */
  machineCores: number;
  /** Cores used by the compiler process itself (all its threads). */
  compilerCores: number;
};

export type TimelineData = {
  version: 1;
  createdAt: string;
  cpuCount: number;
  builds: TimelineBuild[];
  rows: TimelineRow[];
  spans: TimelineSpan[];
  cpu: CpuSample[];
};

/** The row for work that belongs to a build rather than to one module. */
export function projectRowKey(build: number) {
  return `${build}/(project)`;
}

export function moduleRowKey(build: number, module: string) {
  return `${build}/${module}`;
}

const CPU_SAMPLE_INTERVAL_MS = 50;

class BuildTimeline {
  private enabled = false;
  private builds: TimelineBuild[] = [];
  private rows = new Map<string, TimelineRow>();
  private spans: TimelineSpan[] = [];
  private cpu: CpuSample[] = [];
  private cpuTimer: ReturnType<typeof setInterval> | null = null;
  private openBuilds = 0;

  /** Recording costs next to nothing, but it is only kept when asked for. */
  enable() {
    this.enabled = true;
  }

  get isEnabled() {
    return this.enabled;
  }

  now() {
    return performance.now();
  }

  beginBuild(root: string, parentRow: string | null, description: string) {
    const id = this.builds.length;
    this.builds.push({
      id: id,
      root: root,
      parentRow: parentRow,
      start: this.now(),
      end: null,
      description: description,
    });
    this.addRow(id, projectRowKey(id), "(project)", [], parentRow);
    this.openBuilds++;
    if (this.enabled && !this.cpuTimer) {
      this.startCpuSampling();
    }
    return id;
  }

  /** Returns true when this was the outermost build of the process. */
  endBuild(id: number) {
    const build = this.builds[id];
    if (build) {
      build.end = this.now();
    }
    this.openBuilds--;
    if (this.openBuilds === 0 && this.cpuTimer) {
      clearInterval(this.cpuTimer);
      this.cpuTimer = null;
    }
    return this.openBuilds === 0;
  }

  addModuleRow(
    build: number,
    module: string,
    deps: string[],
    parentRow: string | null
  ) {
    const key = moduleRowKey(build, module);
    this.addRow(build, key, module, deps, parentRow);
    return key;
  }

  private addRow(
    build: number,
    key: string,
    module: string,
    deps: string[],
    parentRow: string | null
  ) {
    this.rows.set(key, {
      key: key,
      build: build,
      module: module,
      deps: deps,
      parentRow: parentRow,
      discovered: this.now(),
      ready: null,
      interfaceReady: null,
      done: null,
      outcome: null,
    });
  }

  markReady(row: string) {
    const r = this.rows.get(row);
    if (r) {
      r.ready = this.now();
    }
  }

  markInterfaceReady(row: string) {
    const r = this.rows.get(row);
    if (r) {
      r.interfaceReady = this.now();
    }
  }

  markDone(row: string, outcome: RowOutcome) {
    const r = this.rows.get(row);
    if (r) {
      r.done = this.now();
      // "up-to-date" is decided inside the build and must not be overwritten
      // by the scheduler's plain success.
      if (r.outcome === null || outcome === "failed") {
        r.outcome = outcome;
      }
    }
  }

  setOutcome(row: string, outcome: RowOutcome) {
    const r = this.rows.get(row);
    if (r) {
      r.outcome = outcome;
    }
  }

  span(row: string, kind: SpanKind, label: string, start: number, end: number) {
    this.spans.push({
      row: row,
      kind: kind,
      label: label,
      start: start,
      end: end,
    });
  }

  /** Times fn as one labelled span; works for sync and async fn. */
  measure<T>(row: string, kind: SpanKind, label: string, fn: () => T): T {
    const start = this.now();
    let result: T;
    try {
      result = fn();
    } catch (e) {
      this.span(row, kind, label, start, this.now());
      throw e;
    }
    if (result instanceof Promise) {
      return result.finally(() => {
        this.span(row, kind, label, start, this.now());
      }) as T;
    }
    this.span(row, kind, label, start, this.now());
    return result;
  }

  snapshot(): TimelineData {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      cpuCount: os.cpus().length,
      builds: this.builds,
      rows: [...this.rows.values()],
      spans: this.spans,
      cpu: this.cpu,
    };
  }

  private startCpuSampling() {
    const totals = () => {
      let busy = 0;
      let all = 0;
      for (const c of os.cpus()) {
        const t = c.times;
        busy += t.user + t.nice + t.sys + t.irq;
        all += t.user + t.nice + t.sys + t.irq + t.idle;
      }
      return { busy: busy, all: all };
    };
    const cpuCount = os.cpus().length;
    let last = totals();
    let lastProcess = process.cpuUsage();
    let lastT = this.now();
    this.cpuTimer = setInterval(() => {
      const t = this.now();
      const cur = totals();
      const proc = process.cpuUsage();
      const dAll = cur.all - last.all;
      const dt = t - lastT;
      if (dAll > 0 && dt > 0) {
        const procMs =
          (proc.user - lastProcess.user + proc.system - lastProcess.system) /
          1000;
        this.cpu.push({
          t: t,
          machineCores: ((cur.busy - last.busy) / dAll) * cpuCount,
          compilerCores: procMs / dt,
        });
      }
      last = cur;
      lastProcess = proc;
      lastT = t;
    }, CPU_SAMPLE_INTERVAL_MS);
    this.cpuTimer.unref?.();
  }
}

export const timeline = new BuildTimeline();

/**
 * Gives one module at a time the compiler's main thread.
 *
 * Interleaving several modules' work on one JS thread never made anything
 * faster -- the thread does the same amount of work either way -- it only made
 * every module's phases take the wall time of everyone's. With the lock, work
 * runs to completion in order of request, the background work it starts
 * (clang and friends) still overlaps freely, and each span is exact.
 *
 * Whatever runs inside must not start a nested build: the nested build's own
 * modules would wait for a lock their caller holds. That is reported rather
 * than left to hang.
 */
class MainThreadLock {
  private held = false;
  private waiters: (() => void)[] = [];
  private holder = new AsyncLocalStorage<string>();

  async run<T>(row: string, fn: () => Promise<T> | T): Promise<T> {
    const holding = this.holder.getStore();
    if (holding !== undefined) {
      throw new InternalError(
        `The main-thread lock was requested by '${row}' while '${holding}' holds it; this would deadlock.`
      );
    }
    const requested = timeline.now();
    if (this.held) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    this.held = true;
    const acquired = timeline.now();
    if (acquired - requested >= 0.1) {
      timeline.span(row, "queued", "queued", requested, acquired);
    }
    try {
      return await this.holder.run(row, fn);
    } finally {
      timeline.span(MAIN_THREAD_ROW, "main", row, acquired, timeline.now());
      const next = this.waiters.shift();
      if (next) {
        // Handed straight to the next waiter: `held` stays true, so nothing
        // that asks in between can jump the queue.
        next();
      } else {
        this.held = false;
      }
    }
  }
}

/** Lock holds, labelled with the row that held the lock. */
export const MAIN_THREAD_ROW = "(main thread)";

export const mainThread = new MainThreadLock();
