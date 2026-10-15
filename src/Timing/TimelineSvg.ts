// Draws a recorded build timeline (BuildTimeline.ts) as an SVG, for
// `--timing-graph`, and writes it with the raw data next to it.
//
// One row per module, in dependency order, deps above their dependents. A
// row shows: a dashed line while the module waits for its dependencies, a
// hatched bar while it waits for the main thread, coloured bars for its own
// main-thread work and its background processes, and a triangle where its
// interface was ready (dependents could have started there; they start at
// the end of the row). The critical path -- the chain of modules each of which
// was the last thing its successor waited for -- is outlined in red. Above the
// rows: machine-wide CPU use, how many background processes ran at once, and
// which module held the main thread.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAIN_THREAD_ROW,
  type TimelineData,
  type TimelineRow,
  type TimelineSpan,
} from "./BuildTimeline";

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export type CriticalStep = {
  row: TimelineRow;
  /** ready -> done of this module, split by what it was doing. */
  main: number;
  queued: number;
  background: number;
  other: number;
  /**
   * How long after this module's interface was ready its successor on the
   * path was still waiting for it (its clang, ar and packaging).
   */
  waitedAfterInterface: number;
};

export type TimelineAnalysis = {
  total: number;
  mainThreadBusy: number;
  projectMain: number;
  backgroundSum: number;
  maxConcurrentBackground: number;
  built: number;
  upToDate: number;
  failed: number;
  criticalPath: CriticalStep[];
  criticalPathStart: number;
  criticalPathEnd: number;
};

function rowsOfBuild(data: TimelineData, build: number) {
  return data.rows.filter((r) => r.build === build && r.module !== "(project)");
}

function spansByRow(data: TimelineData) {
  const map = new Map<string, TimelineSpan[]>();
  for (const s of data.spans) {
    let list = map.get(s.row);
    if (!list) {
      list = [];
      map.set(s.row, list);
    }
    list.push(s);
  }
  return map;
}

function sum(spans: TimelineSpan[], pred: (s: TimelineSpan) => boolean) {
  let t = 0;
  for (const s of spans) {
    if (pred(s)) {
      t += s.end - s.start;
    }
  }
  return t;
}

/** Background spans that are a process of their own (not a nested build). */
function isProcessSpan(s: TimelineSpan) {
  return s.kind === "background" && !s.label.startsWith("build generator");
}

export function analyzeTimeline(data: TimelineData): TimelineAnalysis {
  const byRow = spansByRow(data);
  const root = data.builds[0];
  const total = root?.end ?? 0;

  const mainThreadBusy = sum(byRow.get(MAIN_THREAD_ROW) ?? [], () => true);
  const projectMain = data.rows
    .filter((r) => r.module === "(project)")
    .reduce((t, r) => t + sum(byRow.get(r.key) ?? [], () => true), 0);
  const processSpans = data.spans.filter(isProcessSpan);
  const backgroundSum = sum(processSpans, () => true);

  // Sweep for the most background processes alive at once.
  const edges: [number, number][] = [];
  for (const s of processSpans) {
    edges.push([s.start, 1], [s.end, -1]);
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let alive = 0;
  let maxConcurrentBackground = 0;
  for (const [, d] of edges) {
    alive += d;
    maxConcurrentBackground = Math.max(maxConcurrentBackground, alive);
  }

  const modules = data.rows.filter((r) => r.module !== "(project)");
  const built = modules.filter((r) => r.outcome === "built").length;
  const upToDate = modules.filter((r) => r.outcome === "up-to-date").length;
  const failed = modules.filter((r) => r.outcome === "failed").length;

  // Critical path of the outermost build: from the module that finished
  // last, follow the dependency that finished last, back to the start.
  const criticalPath: CriticalStep[] = [];
  const rootRows = root ? rowsOfBuild(data, root.id) : [];
  const byName = new Map(rootRows.map((r) => [r.module, r]));
  let current = rootRows
    .filter((r) => r.done !== null)
    .sort((a, b) => b.done! - a.done!)[0];
  let successor: TimelineRow | null = null;
  while (current) {
    const spans = byRow.get(current.key) ?? [];
    const span = (current.done ?? 0) - (current.ready ?? 0);
    const main = sum(spans, (s) => s.kind === "main");
    const queued = sum(spans, (s) => s.kind === "queued");
    const background = sum(spans, (s) => s.kind === "background");
    const waitedAfterInterface =
      successor && current.interfaceReady !== null && current.done !== null
        ? current.done - current.interfaceReady
        : 0;
    criticalPath.unshift({
      row: current,
      main: main,
      queued: queued,
      background: background,
      other: Math.max(0, span - main - queued - background),
      waitedAfterInterface: waitedAfterInterface,
    });
    successor = current;
    const deps = current.deps
      .map((d) => byName.get(d))
      .filter((d): d is TimelineRow => !!d && d.done !== null);
    current = deps.sort((a, b) => b.done! - a.done!)[0];
  }

  return {
    total: total,
    mainThreadBusy: mainThreadBusy,
    projectMain: projectMain,
    backgroundSum: backgroundSum,
    maxConcurrentBackground: maxConcurrentBackground,
    built: built,
    upToDate: upToDate,
    failed: failed,
    criticalPath: criticalPath,
    criticalPathStart: criticalPath[0]?.row.ready ?? 0,
    criticalPathEnd: criticalPath.at(-1)?.row.done ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

type Style = { fill: string; text: string };

const LIGHT_TEXT = "#ffffff";
const DARK_TEXT = "#1d232b";

function styleOf(span: TimelineSpan): Style {
  const l = span.label;
  if (span.kind === "queued") {
    return { fill: "url(#queued)", text: DARK_TEXT };
  }
  if (span.kind === "background") {
    if (l === "clang -c") {
      return { fill: "#f28e2b", text: DARK_TEXT };
    }
    if (l === "link") {
      return { fill: "#e15759", text: LIGHT_TEXT };
    }
    if (l.startsWith("build generator")) {
      return { fill: "#f6e3a1", text: DARK_TEXT };
    }
    if (l.startsWith("run generator")) {
      return { fill: "#d4a017", text: DARK_TEXT };
    }
    return { fill: "#9c755f", text: LIGHT_TEXT }; // ar, strip
  }
  switch (l) {
    case "check":
      return { fill: "#aab4c0", text: DARK_TEXT };
    case "import deps":
      return { fill: "#a0cbe8", text: DARK_TEXT };
    case "collect sources":
      return { fill: "#4e79a7", text: LIGHT_TEXT };
    case "analyze":
      return { fill: "#7b5ea7", text: LIGHT_TEXT };
    case "lower":
      return { fill: "#c26fae", text: LIGHT_TEXT };
    case "codegen":
      return { fill: "#2a9d8f", text: LIGHT_TEXT };
    case "prepare C":
      return { fill: "#76b7b2", text: DARK_TEXT };
    case "export interface":
      return { fill: "#3e8e3e", text: LIGHT_TEXT };
    case "tar.gz":
      return { fill: "#8cd17d", text: DARK_TEXT };
    case "write metadata":
    case "write interface":
    case "save cache":
      return { fill: "#59a14f", text: LIGHT_TEXT };
    case "startup":
      return { fill: "#d0d0d0", text: DARK_TEXT };
    default:
      return { fill: "#b8b8b8", text: DARK_TEXT };
  }
}

const LEGEND: [string, string][] = [
  ["check", "up-to-date check"],
  ["import deps", "import deps (untar, parse, collect)"],
  ["collect sources", "collect own sources"],
  ["analyze", "analyze"],
  ["lower", "lower"],
  ["codegen", "generate C"],
  ["prepare C", "prepare clang"],
  ["export interface", "export interface"],
  ["tar.gz", "tar.gz"],
  ["save cache", "write files"],
];
const LEGEND_BACKGROUND: [string, string][] = [
  ["clang -c", "clang -c"],
  ["link", "link"],
  ["ar", "ar / strip"],
  ["run generator", "generator run"],
  ["build generator", "generator build"],
];

function esc(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function secs(ms: number) {
  if (ms >= 10_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return `${Math.round(ms)} ms`;
}

function niceStep(totalMs: number) {
  const steps = [
    50, 100, 200, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000,
    120_000, 300_000,
  ];
  for (const s of steps) {
    if (totalMs / s <= 24) {
      return s;
    }
  }
  return 600_000;
}

function rowName(data: TimelineData, row: TimelineRow) {
  if (row.module !== "(project)") {
    return row.module;
  }
  if (row.build === 0) {
    return "(startup, setup, finish)";
  }
  return `(build of ${data.builds[row.build]?.root ?? "?"})`;
}

/** Rows in drawing order: each nested (generator) build under its module. */
function orderRows(data: TimelineData) {
  const children = new Map<string, TimelineRow[]>();
  const top: TimelineRow[] = [];
  for (const r of data.rows) {
    if (r.build === 0 || r.parentRow === null) {
      if (r.build === 0) {
        top.push(r);
      }
      continue;
    }
    let list = children.get(r.parentRow);
    if (!list) {
      list = [];
      children.set(r.parentRow, list);
    }
    list.push(r);
  }
  const out: { row: TimelineRow; depth: number }[] = [];
  const visit = (r: TimelineRow, depth: number) => {
    out.push({ row: r, depth: depth });
    for (const c of children.get(r.key) ?? []) {
      visit(c, depth + 1);
    }
  };
  for (const r of top) {
    visit(r, 0);
  }
  return out;
}

export function renderTimelineSvg(data: TimelineData): string {
  const a = analyzeTimeline(data);
  const byRow = spansByRow(data);
  const rows = orderRows(data);
  const critical = new Set(a.criticalPath.map((c) => c.row.key));

  const W = 1800;
  const LABEL_W = 360;
  const RIGHT = 24;
  const plotW = W - LABEL_W - RIGHT;
  const end = Math.max(
    a.total,
    ...data.spans.map((s) => s.end),
    ...data.rows.map((r) => r.done ?? 0)
  );
  const x = (t: number) => LABEL_W + (Math.max(0, t) / end) * plotW;
  const w = (s: number, e: number) => Math.max(0, x(e) - x(s));

  const out: string[] = [];
  let y = 0;

  // --- Header ------------------------------------------------------------
  const root = data.builds[0];
  const cp = a.criticalPath;
  const cpMain = cp.reduce((t, c) => t + c.main, 0);
  const cpQueued = cp.reduce((t, c) => t + c.queued, 0);
  const cpBackground = cp.reduce((t, c) => t + c.background, 0);
  const cpOther = cp.reduce((t, c) => t + c.other, 0);
  const cpWaited = cp.reduce((t, c) => t + c.waitedAfterInterface, 0);
  const header = [
    `Main thread: ${secs(a.mainThreadBusy)} held by modules (${Math.round(
      (a.mainThreadBusy / Math.max(1, end)) * 100
    )} % of wall time), plus ${secs(a.projectMain)} startup/setup/finish. Background processes: ${secs(
      a.backgroundSum
    )} summed, at most ${a.maxConcurrentBackground} at once. Modules: ${a.built} built, ${a.upToDate} up to date${
      a.failed ? `, ${a.failed} FAILED` : ""
    }.`,
    `Critical path, ${cp.length} modules, ${secs(
      a.criticalPathEnd - a.criticalPathStart
    )}: main thread ${secs(cpMain)} + background ${secs(
      cpBackground
    )} + queued for main thread ${secs(cpQueued)} + other ${secs(cpOther)}.`,
    `Along it, each dependent waited ${secs(
      cpWaited
    )} in total for clang/ar/packaging of a module whose interface was already ready.`,
  ];
  y = 28;
  out.push(
    `<text x="16" y="${y}" class="title">${esc(root?.root ?? "build")} · ${secs(
      end
    )} · ${esc(root?.description ?? "")}</text>`
  );
  out.push(
    `<text x="${W - RIGHT}" y="${y}" class="small" text-anchor="end">${esc(
      new Date(data.createdAt).toLocaleString()
    )} · ${data.cpuCount} logical CPUs</text>`
  );
  for (const line of header) {
    y += 18;
    out.push(`<text x="16" y="${y}" class="info">${esc(line)}</text>`);
  }

  // Legend.
  y += 16;
  let lx = 16;
  const legendItem = (fill: string, label: string, stroke = "none") => {
    out.push(
      `<rect x="${lx}" y="${y}" width="12" height="12" fill="${fill}" stroke="${stroke}"/>`
    );
    out.push(
      `<text x="${lx + 16}" y="${y + 10}" class="small">${esc(label)}</text>`
    );
    lx += 22 + label.length * 6.2;
  };
  out.push(`<text x="${lx}" y="${y + 10}" class="small b">main thread:</text>`);
  lx += 80;
  for (const [key, label] of LEGEND) {
    legendItem(
      styleOf({ row: "", kind: "main", label: key, start: 0, end: 0 }).fill,
      label
    );
  }
  y += 18;
  lx = 16;
  out.push(`<text x="${lx}" y="${y + 10}" class="small b">background:</text>`);
  lx += 80;
  for (const [key, label] of LEGEND_BACKGROUND) {
    legendItem(
      styleOf({ row: "", kind: "background", label: key, start: 0, end: 0 })
        .fill,
      label
    );
  }
  legendItem("url(#queued)", "queued for the main thread", "#999");
  out.push(
    `<line x1="${lx}" y1="${y + 6}" x2="${lx + 24}" y2="${y + 6}" class="depwait"/>`
  );
  out.push(
    `<text x="${lx + 30}" y="${y + 10}" class="small">waiting for dependencies</text>`
  );
  lx += 190;
  out.push(
    `<path d="M${lx} ${y + 1} l10 0 l-5 9 z" class="iface"/><text x="${lx + 16}" y="${y + 10}" class="small">interface ready</text>`
  );
  lx += 120;
  legendItem("none", "critical path", "#c0392b");

  // --- Time axis helpers ---------------------------------------------------
  const step = niceStep(end);
  const axis = (ay: number, top: boolean) => {
    for (let t = 0; t <= end + 1e-6; t += step) {
      out.push(
        `<text x="${x(t)}" y="${top ? ay - 4 : ay + 12}" class="tick" text-anchor="middle">${esc(
          secs(t)
        )}</text>`
      );
    }
  };

  // --- CPU chart -----------------------------------------------------------
  y += 40;
  const cpuTop = y;
  const cpuH = 70;
  axis(cpuTop, true);
  out.push(
    `<rect x="${LABEL_W}" y="${cpuTop}" width="${plotW}" height="${cpuH}" class="panel"/>`
  );
  const cy = (cores: number) =>
    cpuTop + cpuH - (Math.min(cores, data.cpuCount) / data.cpuCount) * cpuH;
  if (data.cpu.length > 0) {
    const pts = data.cpu.map(
      (s) => `${x(s.t).toFixed(1)},${cy(s.machineCores).toFixed(1)}`
    );
    out.push(
      `<path d="M${x(data.cpu[0]!.t).toFixed(1)},${cpuTop + cpuH} L${pts.join(" L")} L${x(
        data.cpu.at(-1)!.t
      ).toFixed(
        1
      )},${cpuTop + cpuH} Z" fill="#9ecae9" stroke="#4e79a7" stroke-width="0.8"/>`
    );
    const ppts = data.cpu.map(
      (s) => `${x(s.t).toFixed(1)},${cy(s.compilerCores).toFixed(1)}`
    );
    out.push(
      `<path d="M${ppts.join(" L")}" fill="none" stroke="#1d3557" stroke-width="1.2"/>`
    );
  }
  for (const frac of [0.25, 0.5, 0.75]) {
    const gy = cpuTop + cpuH * (1 - frac);
    out.push(
      `<line x1="${LABEL_W}" y1="${gy}" x2="${LABEL_W + plotW}" y2="${gy}" class="grid"/>`
    );
  }
  out.push(
    `<text x="${LABEL_W - 8}" y="${cpuTop + 14}" class="label" text-anchor="end">CPU cores busy (of ${data.cpuCount})</text>`
  );
  out.push(
    `<text x="${LABEL_W - 8}" y="${cpuTop + 30}" class="small" text-anchor="end"><tspan fill="#4e79a7">■</tspan> whole machine  <tspan fill="#1d3557">━</tspan> compiler process</text>`
  );
  out.push(
    `<text x="${LABEL_W - 8}" y="${cpuTop + 46}" class="small" text-anchor="end">grid lines at 25 / 50 / 75 %</text>`
  );
  y = cpuTop + cpuH;

  // --- Background concurrency ---------------------------------------------
  y += 10;
  const bgTop = y;
  const bgH = 36;
  out.push(
    `<rect x="${LABEL_W}" y="${bgTop}" width="${plotW}" height="${bgH}" class="panel"/>`
  );
  const processSpans = data.spans.filter(isProcessSpan);
  const ev: [number, number][] = [];
  for (const s of processSpans) {
    ev.push([s.start, 1], [s.end, -1]);
  }
  ev.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const maxBg = Math.max(1, a.maxConcurrentBackground, 4);
  const by = (n: number) => bgTop + bgH - (n / maxBg) * bgH;
  let n = 0;
  let d = `M${x(0)},${by(0)}`;
  for (const [t, delta] of ev) {
    d += ` L${x(t).toFixed(1)},${by(n).toFixed(1)}`;
    n += delta;
    d += ` L${x(t).toFixed(1)},${by(n).toFixed(1)}`;
  }
  d += ` L${x(end)},${by(0)} Z`;
  out.push(
    `<path d="${d}" fill="#f6c28b" stroke="#c8691c" stroke-width="0.8"/>`
  );
  out.push(
    `<text x="${LABEL_W - 8}" y="${bgTop + 14}" class="label" text-anchor="end">background processes running</text>`
  );
  out.push(
    `<text x="${LABEL_W - 8}" y="${bgTop + 29}" class="small" text-anchor="end">clang, link, ar, generator runs (max ${a.maxConcurrentBackground}; full height = ${maxBg})</text>`
  );
  y = bgTop + bgH;

  // --- Main thread row ------------------------------------------------------
  y += 10;
  const ROW_H = 20;
  const BAR_H = 14;
  const mainTop = y;
  out.push(
    `<rect x="${LABEL_W}" y="${mainTop}" width="${plotW}" height="${ROW_H}" class="panel"/>`
  );
  out.push(
    `<text x="${LABEL_W - 8}" y="${mainTop + 14}" class="label b" text-anchor="end">main thread (held by)</text>`
  );
  const rowByKey = new Map(data.rows.map((r) => [r.key, r]));
  for (const s of byRow.get(MAIN_THREAD_ROW) ?? []) {
    const holder = rowByKey.get(s.label);
    const name = holder?.module ?? s.label;
    const title = esc(
      `${name}: held ${secs(s.end - s.start)} (${secs(s.start)} → ${secs(s.end)})`
    );
    const bw = w(s.start, s.end);
    // The hold in grey (anything not inside a labelled step), then the
    // holder's steps in it in their colours.
    out.push(
      `<rect x="${x(s.start).toFixed(2)}" y="${mainTop + 3}" width="${Math.max(
        bw,
        0.6
      ).toFixed(
        2
      )}" height="${BAR_H}" fill="#b8b8b8"><title>${title}</title></rect>`
    );
    for (const q of byRow.get(s.label) ?? []) {
      if (q.kind !== "main" || q.end < s.start || q.start > s.end) {
        continue;
      }
      out.push(
        `<rect x="${x(q.start).toFixed(2)}" y="${mainTop + 3}" width="${Math.max(
          w(q.start, q.end),
          0.4
        ).toFixed(2)}" height="${BAR_H}" fill="${styleOf(q).fill}"><title>${esc(
          `${name} · ${q.label}: ${secs(q.end - q.start)}`
        )}</title></rect>`
      );
    }
    out.push(
      `<rect x="${x(s.start).toFixed(2)}" y="${mainTop + 3}" width="${Math.max(
        bw,
        0.6
      ).toFixed(
        2
      )}" height="${BAR_H}" fill="none" stroke="#ffffff" stroke-width="0.6"/>`
    );
    if (bw > name.length * 6 + 6) {
      out.push(
        `<text x="${x(s.start) + 3}" y="${mainTop + 14}" class="bar" fill="${LIGHT_TEXT}" stroke="#1d232b" stroke-width="2" paint-order="stroke">${esc(name)}</text>`
      );
    }
  }
  y = mainTop + ROW_H;

  // --- Module rows --------------------------------------------------------
  y += 16;
  axis(y, true);
  const rowsTop = y;
  const rowY = new Map<string, number>();
  rows.forEach(({ row }, i) => {
    rowY.set(row.key, rowsTop + i * ROW_H);
  });
  const rowsH = rows.length * ROW_H;

  // Zebra + grid first, so bars draw on top.
  rows.forEach((_, i) => {
    if (i % 2 === 0) {
      out.push(
        `<rect x="0" y="${rowsTop + i * ROW_H}" width="${W}" height="${ROW_H}" fill="#f4f6f8"/>`
      );
    }
  });
  for (let t = 0; t <= end + 1e-6; t += step) {
    out.push(
      `<line x1="${x(t)}" y1="${cpuTop}" x2="${x(t)}" y2="${rowsTop + rowsH}" class="grid"/>`
    );
  }

  for (const { row, depth } of rows) {
    const ry = rowY.get(row.key)!;
    const spans = byRow.get(row.key) ?? [];
    const isCritical = critical.has(row.key);
    const isProject = row.module === "(project)";
    const name = rowName(data, row);

    // Label: name left, totals right.
    const mainT = sum(spans, (s) => s.kind === "main");
    const bgT = sum(spans, isProcessSpan);
    const qT = sum(spans, (s) => s.kind === "queued");
    out.push(
      `<text x="${12 + depth * 16}" y="${ry + 14}" class="label${
        isCritical ? " crit" : ""
      }">${depth > 0 ? "↳ " : ""}${esc(name)}</text>`
    );
    let stats = "";
    if (row.outcome === "up-to-date") {
      stats = "up to date";
    } else if (row.outcome === "failed") {
      stats = "FAILED";
    } else if (!isProject) {
      stats = `${secs(mainT)} main · ${secs(bgT)} bg${
        qT >= 1 ? ` · ${secs(qT)} queued` : ""
      }`;
    }
    out.push(
      `<text x="${LABEL_W - 8}" y="${ry + 14}" class="small${
        row.outcome === "failed" ? " fail" : ""
      }" text-anchor="end">${esc(stats)}</text>`
    );

    // Waiting for dependencies.
    if (!isProject && row.ready !== null && row.ready - row.discovered > 1) {
      const lastDep = row.deps
        .map((dn) =>
          data.rows.find((r) => r.build === row.build && r.module === dn)
        )
        .filter((r): r is TimelineRow => !!r && r.done !== null)
        .sort((p, q) => q.done! - p.done!)[0];
      out.push(
        `<line x1="${x(row.discovered)}" y1="${ry + ROW_H / 2}" x2="${x(
          row.ready
        )}" y2="${ry + ROW_H / 2}" class="depwait"><title>${esc(
          `${row.module} waited ${secs(row.ready - row.discovered)} for its dependencies${
            lastDep ? `; the last to finish was ${lastDep.module}` : ""
          }`
        )}</title></line>`
      );
    }

    // Spans. Nested-build spans ("build generator") go first so the
    // generator's own rows explain them.
    for (const s of spans) {
      const st = styleOf(s);
      const bw = w(s.start, s.end);
      const drawW = s.kind === "queued" ? bw : Math.max(bw, 0.8);
      let stroke = "";
      if (s.kind === "queued") {
        stroke = ' stroke="#9a9a9a" stroke-width="0.5"';
      } else if (isCritical) {
        stroke = ' stroke="#c0392b" stroke-width="1"';
      }
      out.push(
        `<rect x="${x(s.start).toFixed(2)}" y="${ry + 3}" width="${drawW.toFixed(
          2
        )}" height="${BAR_H}" fill="${st.fill}"${stroke}><title>${esc(
          `${row.module} · ${s.label}: ${secs(s.end - s.start)} (${secs(
            s.start
          )} → ${secs(s.end)})`
        )}</title></rect>`
      );
      const text = s.label;
      if (bw > text.length * 5.6 + 6) {
        out.push(
          `<text x="${x(s.start) + 3}" y="${ry + 14}" class="bar" fill="${st.text}">${esc(text)}</text>`
        );
      }
    }

    if (row.interfaceReady !== null && !isProject) {
      const ix = x(row.interfaceReady);
      out.push(
        `<path d="M${ix - 4} ${ry} l8 0 l-4 6 z" class="iface"><title>${esc(
          `${row.module}: interface ready at ${secs(row.interfaceReady)}${
            row.done !== null
              ? `, ${secs(row.done - row.interfaceReady)} before dependents could start`
              : ""
          }`
        )}</title></path>`
      );
    }
  }

  // Critical path connectors: from a dependency's finish to the start of the
  // module that was waiting for it.
  for (let i = 1; i < cp.length; i++) {
    const from = cp[i - 1]!.row;
    const to = cp[i]!.row;
    const fy = rowY.get(from.key);
    const ty = rowY.get(to.key);
    if (
      fy === undefined ||
      ty === undefined ||
      from.done === null ||
      to.ready === null
    ) {
      continue;
    }
    out.push(
      `<path d="M${x(from.done).toFixed(1)} ${fy + ROW_H / 2} L${x(to.ready).toFixed(1)} ${
        ty + ROW_H / 2
      }" class="critline"/>`
    );
  }

  y = rowsTop + rowsH;
  axis(y, false);
  y += 30;

  const H = y;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
<defs>
  <pattern id="queued" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="6" height="6" fill="#ececec"/>
    <line x1="0" y1="0" x2="0" y2="6" stroke="#a8a8a8" stroke-width="2"/>
  </pattern>
  <style>
    .title { font-size: 18px; font-weight: 700; fill: #1d232b; }
    .info { font-size: 13px; fill: #2c3440; }
    .label { font-size: 12px; fill: #1d232b; }
    .small { font-size: 10.5px; fill: #5a6573; }
    .b { font-weight: 700; }
    .crit { font-weight: 700; fill: #c0392b; }
    .fail { fill: #c0392b; font-weight: 700; }
    .tick { font-size: 10px; fill: #5a6573; }
    .bar { font-size: 9.5px; pointer-events: none; }
    .grid { stroke: #d5dae0; stroke-width: 0.6; }
    .panel { fill: #fbfcfd; stroke: #d5dae0; stroke-width: 0.6; }
    .depwait { stroke: #8a96a3; stroke-width: 1; stroke-dasharray: 3 3; }
    .iface { fill: #1d232b; }
    .critline { stroke: #c0392b; stroke-width: 1.2; fill: none; }
  </style>
</defs>
<rect width="100%" height="100%" fill="#ffffff"/>
${out.join("\n")}
</svg>
`;
}

function stamp(iso: string) {
  const dt = new Date(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}-${p(
    dt.getHours()
  )}${p(dt.getMinutes())}${p(dt.getSeconds())}`;
}

/** Writes `<root>-<time>.svg` and the raw data as `.json` into dir. */
export function writeTimingGraph(
  data: TimelineData,
  dir: string,
  root: string
) {
  mkdirSync(dir, { recursive: true });
  const base = join(
    dir,
    `${root.replace(/[^A-Za-z0-9_.-]/g, "_")}-${stamp(data.createdAt)}`
  );
  const svg = `${base}.svg`;
  const json = `${base}.json`;
  writeFileSync(svg, renderTimelineSvg(data));
  writeFileSync(json, JSON.stringify(data));
  return { svg: svg, json: json };
}
