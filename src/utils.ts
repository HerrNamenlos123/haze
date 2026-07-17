export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Serializes access to a shared resource across concurrent async callers.
 * Needed anywhere code temporarily patches global state (e.g. process.stdout.write)
 * for the duration of an awaited call -- without this, two concurrent patches
 * interleave and one caller's restore can clobber another's still-active patch.
 */
export class Mutex {
  private queue: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release: () => void;
    this.queue = new Promise((resolve) => (release = resolve));
    await previous;
    try {
      return await fn();
    } finally {
      release!();
    }
  }
}
