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

/**
 * main: work on the main thread. queued: waiting for the main thread.
 * background: a process of its own (clang, link, ar, a generator).
 * waiting: blocked on other modules finishing (an executable's link waits for
 * every library it links).
 */
export type SpanKind = "main" | "queued" | "background" | "waiting";

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
  /** When the module was started: every dependency's interface was ready. */
  ready: number | null;
  /**
   * When this library's import.hz and metadata.json were written, which is
   * when its dependents may start; its own clang and ar run on after that.
   */
  interfaceReady: number | null;
  done: number | null;
  outcome: RowOutcome | null;
  /** The module's main-thread priority (see MainThreadLock). */
  priority?: number;
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

  setPriority(row: string, priority: number) {
    const r = this.rows.get(row);
    if (r) {
      r.priority = priority;
    }
  }

  setOutcome(row: string, outcome: RowOutcome) {
    const r = this.rows.get(row);
    if (r) {
      r.outcome = outcome;
    }
  }

  /**
   * For every module this build rebuilt: its main-thread plus background
   * time in ms, generators left out. Keyed by module name.
   */
  rebuiltModuleCosts(build: number) {
    const rows = new Map<string, string>();
    for (const r of this.rows.values()) {
      if (r.build === build && r.outcome === "built") {
        rows.set(r.key, r.module);
      }
    }
    const costs = new Map<string, number>();
    for (const s of this.spans) {
      const module = rows.get(s.row);
      if (
        module === undefined ||
        s.kind === "queued" ||
        s.kind === "waiting" ||
        s.label.startsWith("build generator") ||
        s.label.startsWith("run generator")
      ) {
        continue;
      }
      costs.set(module, (costs.get(module) ?? 0) + (s.end - s.start));
    }
    return costs;
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
 * runs to completion, the background work it starts (clang and friends) still
 * overlaps freely, and each span is exact.
 *
 * Waiters are served by priority, then in request order. ProjectCompiler gives
 * every module the cost of the longest chain of work waiting for it, so the
 * module the rest of the build waits on goes first: in request order, the
 * module every UI module depends on sat queued for 4 s behind twenty leaf
 * modules.
 *
 * Whatever runs inside must not start a nested build: the nested build's own
 * modules would wait for a lock their caller holds. That is reported rather
 * than left to hang.
 */
class MainThreadLock {
  private held = false;
  private waiters: {
    priority: number;
    order: number;
    resolve: () => void;
  }[] = [];
  private requests = 0;
  private priorities = new Map<string, number>();
  private holder = new AsyncLocalStorage<string>();

  /** Rows with a higher priority get the lock first (default 0). */
  setPriority(row: string, priority: number) {
    this.priorities.set(row, priority);
  }

  priorityOf(row: string) {
    return this.priorities.get(row) ?? 0;
  }

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
        this.waiters.push({
          priority: this.priorityOf(row),
          order: this.requests++,
          resolve: resolve,
        });
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
      const next = this.takeNextWaiter();
      if (next) {
        // Handed straight to the next waiter: `held` stays true, so nothing
        // that asks in between can jump the queue.
        next.resolve();
      } else {
        this.held = false;
      }
    }
  }

  private takeNextWaiter() {
    let best = -1;
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i]!;
      const b = best < 0 ? undefined : this.waiters[best]!;
      if (
        !b ||
        w.priority > b.priority ||
        (w.priority === b.priority && w.order < b.order)
      ) {
        best = i;
      }
    }
    return best < 0 ? undefined : this.waiters.splice(best, 1)[0];
  }
}

/** Lock holds, labelled with the row that held the lock. */
export const MAIN_THREAD_ROW = "(main thread)";

export const mainThread = new MainThreadLock();
