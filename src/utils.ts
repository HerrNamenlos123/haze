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

function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost // substitution
      );

      // Transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }

  return dp[m][n];
}

function levenshteinSimilarity(a: string, b: string): number {
  const distance = damerauLevenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

export function findClosestByLevenshtein(
  name: string,
  candidates: string[]
): number {
  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < candidates.length; i++) {
    const score = levenshteinSimilarity(name, candidates[i]);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestScore >= 0.65 ? bestIndex : -1;
}
