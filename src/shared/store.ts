// Fresh numbers for generated names (__temp_N, __hz_callable_N, attempt
// labels, ...).
//
// Each module counts from 0 on its own: a module's generated C must depend on
// its inputs only, not on which other modules this process compiled before
// it, or an unchanged module would produce different C (and a different
// interface) depending on the build order, and nothing could be skipped by
// comparing contents. Module-local numbering is safe because every generated
// symbol with external linkage is mangled under the namespace of the module
// that emits it, and generic instantiations emitted in a dependent are
// static; builds in separate processes always relied on that already.
//
// The counter in use is the one of the module whose main-thread work is
// running (ModuleCompiler.onMainThread installs it); outside any module, e.g.
// in the language server, the process-wide one.

import { AsyncLocalStorage } from "node:async_hooks";

export class TempIdCounter {
  next = 0n;
}

const processCounter = new TempIdCounter();
const moduleCounter = new AsyncLocalStorage<TempIdCounter>();

/** Runs fn with makeTempId()/makeTempName() drawing from counter. */
export function withTempIdCounter<T>(counter: TempIdCounter, fn: () => T): T {
  return moduleCounter.run(counter, fn);
}

export function makeTempId() {
  const counter = moduleCounter.getStore() ?? processCounter;
  return counter.next++;
}

export function makeTempName() {
  return `__temp_${makeTempId()}`;
}
