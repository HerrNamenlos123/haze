import chalk from "chalk";
import { MultiBar, Presets, type SingleBar } from "cli-progress";
import { sleep } from "../utils";

export enum EModulePrintCompilerPhase {
  Parsing = 0,
  Collecting = 1,
  Analyzing = 2,
  Lowering = 3,
  Generating = 4,
  CCompiling = 5,
  Done = 6,
}

const PHASE_LABEL: Record<EModulePrintCompilerPhase, string> = {
  [EModulePrintCompilerPhase.Parsing]: "Parsing      ",
  [EModulePrintCompilerPhase.Collecting]: "Collecting   ",
  [EModulePrintCompilerPhase.Analyzing]: "Analyzing    ",
  [EModulePrintCompilerPhase.Lowering]: "Lowering     ",
  [EModulePrintCompilerPhase.Generating]: "Generating C ",
  [EModulePrintCompilerPhase.CCompiling]: "Compiling C  ",
  [EModulePrintCompilerPhase.Done]: "Done         ",
};

const PHASE_SHORT: Partial<Record<EModulePrintCompilerPhase, string>> = {
  [EModulePrintCompilerPhase.Parsing]: "Parsing",
  [EModulePrintCompilerPhase.Collecting]: "Collecting",
  [EModulePrintCompilerPhase.Analyzing]: "Analyzing",
  [EModulePrintCompilerPhase.Lowering]: "Lowering",
  [EModulePrintCompilerPhase.Generating]: "Generating C",
  [EModulePrintCompilerPhase.CCompiling]: "Compiling C",
};

type PhaseRecord = {
  phase: EModulePrintCompilerPhase;
  durationMs: number;
};

export type ModuleHandle = {
  readonly name: string;
};

type ModuleState = ModuleHandle & {
  phase: EModulePrintCompilerPhase;
  startTime: Date;
  endTime?: Date;
  bar?: SingleBar;
  phaseStartTime: Date;
  phaseHistory: PhaseRecord[];
  /** False until build() begins — bar is not created until then. */
  active: boolean;
  failed: boolean;
};

type GeneratorState = {
  moduleName: string;
  genName: string;
  startTime: Date;
  bar?: SingleBar;
};

export type GeneratorHandle = GeneratorState;

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const TICK_MS = 80;

let _activePrinter: CLIPrinter | null = null;

/**
 * Print a line of text. If a CLIPrinter is active, inserts the line above the
 * progress bars without truncation. Otherwise writes directly to stdout.
 */
export function printLine(message: string) {
  if (_activePrinter) {
    _activePrinter.log(message);
  } else {
    process.stdout.write(message + "\n");
  }
}

export class CLIPrinter {
  private modules: ModuleState[] = [];
  private generators: GeneratorState[] = [];
  private multibar: MultiBar;
  private updateInterval: NodeJS.Timeout | null = null;
  private spinnerIndex = 0;
  private showTiming: boolean;

  constructor(showTiming = false) {
    this.showTiming = showTiming;
    this.multibar = new MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: (_options, _params, payload) =>
          payload.gen
            ? this.renderGeneratorRow(
                payload.gen as GeneratorState,
                payload.spinnerIndex as number
              )
            : this.renderRow(
                payload.module as ModuleState,
                payload.spinnerIndex as number
              ),
      },
      Presets.shades_classic
    );
  }

  /**
   * Register a module for index counting ([1/N] total).
   * The bar is NOT created here — call beginModule() when build() actually starts.
   */
  addModule(name: string): ModuleHandle {
    const state: ModuleState = {
      name: name,
      phase: EModulePrintCompilerPhase.Parsing,
      startTime: new Date(),
      phaseStartTime: new Date(),
      phaseHistory: [],
      active: false,
      failed: false,
    };
    this.modules.push(state);
    return state;
  }

  /**
   * Mark a module as actively building: reveals its bar, resets all timers to
   * now, and clears any accumulated phase history from the wait period.
   * Call this at the start of ModuleCompiler.build().
   */
  beginModule(handle: ModuleHandle) {
    const state = handle as ModuleState;
    const now = new Date();
    state.startTime = now;
    state.phaseStartTime = now;
    state.phaseHistory = [];
    state.active = true;

    if (this.updateInterval !== null && !state.bar) {
      this.createBar(state);
      this.tick();
    }
  }

  setPhase(handle: ModuleHandle, phase: EModulePrintCompilerPhase) {
    const state = handle as ModuleState;
    if (state.phase === EModulePrintCompilerPhase.Done) {
      throw new Error("Cannot set phase after Done");
    }

    const now = new Date();
    state.phaseHistory.push({
      phase: state.phase,
      durationMs: now.getTime() - state.phaseStartTime.getTime(),
    });
    state.phaseStartTime = now;
    state.phase = phase;

    if (phase === EModulePrintCompilerPhase.Done) {
      state.endTime = now;
    }

    this.refreshBar(state);
  }

  /** Begin the animation loop. Bars only appear when beginModule() is called. */
  start() {
    if (this.updateInterval) {
      return;
    }
    // Only register as the active printer if none is already running.
    // Generator sub-builds create their own CLIPrinter while the outer build's
    // printer is still active; we must not clobber the outer reference.
    if (_activePrinter === null) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      _activePrinter = this;
    }
    this.tick();
    this.updateInterval = setInterval(() => this.tick(), TICK_MS);
  }

  /**
   * Temporarily freeze the animation without destroying bar state.
   * Call resume() to restart. Used to suppress output during generator builds.
   */
  pause() {
    if (!this.updateInterval) {
      return;
    }
    clearInterval(this.updateInterval);
    this.updateInterval = null;
  }

  /** Restart the animation after a pause(). */
  resume() {
    if (this.updateInterval) {
      return;
    }
    this.tick();
    this.updateInterval = setInterval(() => this.tick(), TICK_MS);
  }

  /** Stop the animation and freeze the output. */
  stop() {
    this.stopBars();
    if (this.showTiming) {
      this.printAllTimingReports();
    }
  }

  /** Freeze bars and print message — use for errors. */
  log(message: string) {
    for (const m of this.modules) {
      if (m.active && m.phase !== EModulePrintCompilerPhase.Done) {
        m.failed = true;
      }
    }
    this.stopBars();
    process.stdout.write(message + "\n");
  }

  /** Insert a status line above the live bars without stopping them. */
  logInfo(message: string) {
    this.multibar.log(message + "\n");
  }

  private stopBars() {
    if (this.updateInterval === null) {
      return;
    }
    clearInterval(this.updateInterval);
    this.updateInterval = null;
    if (_activePrinter === this) {
      _activePrinter = null;
    }
    this.tick();

    // multibar.stop() re-enables line-wrapping before it renders the final
    // bars.  After that, terminal.write() uses substr(0, columns) on the raw
    // string (including ANSI codes), which truncates the last bar mid-sequence.
    // Patching write() to always use rawWrite=true skips the truncation so the
    // full bar content is displayed, then we restore immediately after.
    const terminal = (this.multibar as any).terminal;
    const origWrite = terminal.write.bind(terminal) as (s: string, raw?: boolean) => void;
    terminal.write = (s: string, _raw?: boolean) => origWrite(s, true);
    this.multibar.stop();
    terminal.write = origWrite;
  }

  private printAllTimingReports() {
    const done = this.modules.filter((m) => m.endTime !== undefined);
    if (done.length === 0) {
      return;
    }

    const phases = [
      EModulePrintCompilerPhase.Parsing,
      EModulePrintCompilerPhase.Collecting,
      EModulePrintCompilerPhase.Analyzing,
      EModulePrintCompilerPhase.Lowering,
      EModulePrintCompilerPhase.Generating,
      EModulePrintCompilerPhase.CCompiling,
    ];

    // Per-column width: "Label 9999ms" — max across all modules for that phase.
    const nameColWidth = Math.max(...done.map((m) => m.name.length));
    const colWidths = phases.map((phase) => {
      const label = PHASE_SHORT[phase]!;
      const maxDurLen = Math.max(
        ...done.map((m) => {
          const r = m.phaseHistory.find((h) => h.phase === phase);
          return r ? String(r.durationMs).length : 0;
        })
      );
      return label.length + 1 + maxDurLen + 2 + 2; // "Label Xms" + "ms"(2) + 2 spaces gap
    });
    const totalColWidth =
      Math.max(
        ...done.map(
          (m) => String(m.endTime!.getTime() - m.startTime.getTime()).length
        )
      ) + 5; // "Xms total"

    process.stdout.write("\n");
    for (const m of done) {
      const name = chalk.white(m.name.padEnd(nameColWidth));
      const cols = phases.map((phase, i) => {
        const r = m.phaseHistory.find((h) => h.phase === phase);
        const label = PHASE_SHORT[phase]!;
        const cell = r
          ? `${chalk.gray(label)} ${chalk.white(`${r.durationMs}ms`)}`
          : `${chalk.gray(label)} ${chalk.gray("-")}`;
        // padEnd using visible length (strip ANSI for measurement)
        const raw = r ? `${label} ${r.durationMs}ms` : `${label} -`;
        const pad = " ".repeat(Math.max(0, colWidths[i] - raw.length));
        return cell + pad;
      });
      const totalMs = m.endTime!.getTime() - m.startTime.getTime();
      const totalCell = chalk.gray(
        `${totalMs}ms total`.padStart(totalColWidth)
      );
      process.stdout.write(`  ${name}  ${cols.join("")}${totalCell}\n`);
    }
    process.stdout.write("\n");
  }

  private createBar(state: ModuleState) {
    state.bar = this.multibar.create(100, 0, {
      module: state,
      spinnerIndex: this.spinnerIndex,
    });
  }

  private refreshBar(state: ModuleState) {
    state.bar?.update(0, {
      module: state,
      spinnerIndex: this.spinnerIndex,
    });
  }

  beginGenerator(moduleName: string, genName: string): GeneratorHandle {
    const state: GeneratorState = {
      moduleName: moduleName,
      genName: genName,
      startTime: new Date(),
    };
    this.generators.push(state);
    if (this.updateInterval !== null) {
      state.bar = this.multibar.create(100, 0, {
        gen: state,
        spinnerIndex: this.spinnerIndex,
      });
    }
    return state;
  }

  endGenerator(handle: GeneratorHandle) {
    const state = handle as GeneratorState;
    const idx = this.generators.indexOf(state);
    if (idx >= 0) { this.generators.splice(idx, 1); }
    if (state.bar) {
      this.multibar.remove(state.bar);
      state.bar = undefined;
    }
  }

  private refreshGeneratorBar(state: GeneratorState) {
    state.bar?.update(0, { gen: state, spinnerIndex: this.spinnerIndex });
  }

  private tick() {
    this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER.length;
    for (const m of this.modules) {
      this.refreshBar(m);
    }
    for (const g of this.generators) {
      this.refreshGeneratorBar(g);
    }
  }

  private renderGeneratorRow(state: GeneratorState, spinnerIndex: number): string {
    // Aligns with module bars: 5-char tag + 1 space + 32-char name field + 1 space = 39 before phase block
    const tag = chalk.blue("[gen]");
    const rawCombined = `${state.moduleName} › ${state.genName}`;
    const visName = chalk.blue(state.moduleName) + chalk.dim(" › ") + chalk.blueBright(state.genName) +
      " ".repeat(Math.max(0, 32 - rawCombined.length));
    const phaseBlock = `[${chalk.blue("Running      ")}${chalk.blue(SPINNER[spinnerIndex])}]`;
    const elapsedMs = Date.now() - state.startTime.getTime();
    const timeStr = chalk.blue(`${elapsedMs}ms`.padStart(8));
    return `${tag} ${visName} ${phaseBlock} ${timeStr}`;
  }

  private renderRow(state: ModuleState, spinnerIndex: number): string {
    const index = this.modules.indexOf(state);
    const total = this.modules.length;

    // Pad index to match width of total so columns stay fixed (e.g. [ 1/10] vs [10/10])
    const totalStr = String(total);
    const indexLabel = `[${String(index + 1).padStart(totalStr.length)}/${totalStr}]`;
    const indexStr = chalk.gray(indexLabel);
    // Pad index tag to 5 chars minimum so it aligns with [gen]
    const indexPad = " ".repeat(Math.max(0, 5 - indexLabel.length));
    const nameStr = chalk.white(state.name.padEnd(32));

    const elapsedMs = state.endTime
      ? state.endTime.getTime() - state.startTime.getTime()
      : Date.now() - state.startTime.getTime();
    const timeStr = chalk.gray(`${elapsedMs}ms`.padStart(8));

    let phaseBlock: string;
    if (state.failed) {
      phaseBlock = `[${chalk.red("Error         ✘")}]`;
    } else if (state.endTime) {
      phaseBlock = `[${chalk.green("Done          ✔")}]`;
    } else {
      const label = PHASE_LABEL[state.phase];
      phaseBlock = `[${chalk.cyan(label)}${chalk.cyan(SPINNER[spinnerIndex])}]`;
    }

    return `${indexStr}${indexPad} ${nameStr} ${phaseBlock} ${timeStr}`;
  }
}

// ---------------------------------------------------------------------------
// Test —
// ---------------------------------------------------------------------------

export async function testPrinter() {
  const printer = new CLIPrinter(true /* showTiming */);
  printer.start();

  // --- Module 1 starts immediately ---
  const stdlib = printer.addModule("haze-stdlib");

  await sleep(350);
  printer.setPhase(stdlib, EModulePrintCompilerPhase.Collecting);

  // --- Module 2 starts while stdlib is still collecting ---
  const app = printer.addModule("my-app");

  await sleep(300);
  printer.setPhase(stdlib, EModulePrintCompilerPhase.Analyzing);
  printer.setPhase(app, EModulePrintCompilerPhase.Collecting);

  // --- Module 3 starts while 1 is analyzing and 2 is collecting ---
  const lib = printer.addModule("my-lib");

  await sleep(250);
  printer.setPhase(stdlib, EModulePrintCompilerPhase.Lowering);
  printer.setPhase(app, EModulePrintCompilerPhase.Analyzing);

  await sleep(200);
  printer.setPhase(stdlib, EModulePrintCompilerPhase.Generating);
  printer.setPhase(lib, EModulePrintCompilerPhase.Collecting);

  await sleep(250);
  printer.setPhase(stdlib, EModulePrintCompilerPhase.CCompiling);
  printer.setPhase(app, EModulePrintCompilerPhase.Lowering);

  await sleep(400);
  // stdlib finishes first
  printer.setPhase(stdlib, EModulePrintCompilerPhase.Done);
  printer.setPhase(app, EModulePrintCompilerPhase.Generating);
  printer.setPhase(lib, EModulePrintCompilerPhase.Analyzing);

  await sleep(250);
  printer.setPhase(app, EModulePrintCompilerPhase.CCompiling);
  printer.setPhase(lib, EModulePrintCompilerPhase.Lowering);

  await sleep(350);
  // app finishes
  printer.setPhase(app, EModulePrintCompilerPhase.Done);
  printer.setPhase(lib, EModulePrintCompilerPhase.Generating);

  await sleep(250);
  printer.setPhase(lib, EModulePrintCompilerPhase.CCompiling);

  await sleep(450);
  // lib finishes last
  printer.setPhase(lib, EModulePrintCompilerPhase.Done);

  printer.stop();
}
