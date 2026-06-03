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

export type ModuleHandle = {
  readonly name: string;
};

type ModuleState = ModuleHandle & {
  phase: EModulePrintCompilerPhase;
  startTime: Date;
  endTime?: Date;
  bar?: SingleBar;
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const TICK_MS = 80;

export class CLIPrinter {
  private modules: ModuleState[] = [];
  private multibar: MultiBar;
  private updateInterval: NodeJS.Timeout | null = null;
  private spinnerIndex = 0;

  constructor() {
    this.multibar = new MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: (_options, _params, payload) =>
          this.renderRow(
            payload.module as ModuleState,
            payload.spinnerIndex as number
          ),
      },
      Presets.shades_classic
    );
  }

  /**
   * Register a module. Can be called before or after start().
   * Returns a handle to pass back to setPhase() / markDone().
   */
  addModule(name: string): ModuleHandle {
    const state: ModuleState = {
      name: name,
      phase: EModulePrintCompilerPhase.Parsing,
      startTime: new Date(),
    };
    this.modules.push(state);

    if (this.updateInterval !== null) {
      this.createBar(state);
      this.tick();
    }

    return state;
  }

  setPhase(handle: ModuleHandle, phase: EModulePrintCompilerPhase) {
    const state = handle as ModuleState;
    if (state.phase === EModulePrintCompilerPhase.Done) {
      throw new Error("Cannot set phase after Done");
    }
    state.phase = phase;
    if (phase === EModulePrintCompilerPhase.Done) {
      state.endTime = new Date();
    }
    this.refreshBar(state);
  }

  /** Begin rendering. Must be called after all initial modules are registered, or addModule() will add rows on the fly. */
  start() {
    if (this.updateInterval) {
      return;
    }

    for (const m of this.modules) {
      if (!m.bar) {
        this.createBar(m);
      }
    }

    this.tick();
    this.updateInterval = setInterval(() => this.tick(), TICK_MS);
  }

  /** Stop the animation and freeze the output. */
  stop() {
    if (!this.updateInterval) {
      return;
    }
    clearInterval(this.updateInterval);
    this.updateInterval = null;
    this.tick();
    this.multibar.stop();
  }

  log(message: string) {
    this.multibar.log(message + "\n");
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

  private tick() {
    this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER.length;
    for (const m of this.modules) {
      this.refreshBar(m);
    }
  }

  private renderRow(state: ModuleState, spinnerIndex: number): string {
    const index = this.modules.indexOf(state);
    const total = this.modules.length;

    const indexStr = chalk.gray(`[${index + 1}/${total}]`);
    const actionStr = chalk.greenBright("Compiling");
    const nameStr = chalk.white(state.name.padEnd(20));

    const elapsedMs = state.endTime
      ? state.endTime.getTime() - state.startTime.getTime()
      : Date.now() - state.startTime.getTime();
    const timeStr = chalk.gray(`${elapsedMs}ms`.padStart(8));

    let phaseBlock: string;
    if (state.endTime) {
      phaseBlock = `[${chalk.green("Done          ✔")}]`;
    } else {
      const label = PHASE_LABEL[state.phase];
      phaseBlock = `[${chalk.cyan(label)}${chalk.cyan(SPINNER[spinnerIndex])}]`;
    }

    return `${indexStr} ${actionStr} ${nameStr} ${phaseBlock} ${timeStr}`;
  }
}

// ---------------------------------------------------------------------------
// Test — run with: npx tsx src/ModuleCompiler/CLIPrinter.ts
// ---------------------------------------------------------------------------

export async function testPrinter() {
  const printer = new CLIPrinter();
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
