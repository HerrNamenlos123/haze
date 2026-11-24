// The order a module's source files are collected in is the order the file
// system lists their directories in, which differs between file systems and
// machines and changes when files are recreated. Nothing the compiler
// produces may depend on it (scripts/directory-order.test.ts).
//
// HAZE_DIRECTORY_ORDER, for tests only, replaces the file system's order with
// a chosen one, the same on every machine, so a test can build in several
// orders and an order that fails can be reproduced anywhere:
//   sorted          the names in code unit order
//   reversed        the other way round
//   shuffle:<seed>  a permutation of the sorted names, from the seed
// Without it the listing is used exactly as the file system gives it.

import { readdirSync } from "node:fs";

export const DIRECTORY_ORDER_ENV = "HAZE_DIRECTORY_ORDER";

export function listDirectoryForCollection(dirpath: string): string[] {
  const entries = readdirSync(dirpath);
  const order = process.env[DIRECTORY_ORDER_ENV];
  if (order === undefined || order === "") {
    return entries;
  }
  return orderEntries(entries, order);
}

export function orderEntries(entries: string[], order: string): string[] {
  const sorted = [...entries].sort();
  if (order === "sorted") {
    return sorted;
  }
  if (order === "reversed") {
    return sorted.reverse();
  }
  const shuffle = /^shuffle:(\d+)$/.exec(order);
  if (shuffle === null) {
    throw new Error(
      `${DIRECTORY_ORDER_ENV} must be 'sorted', 'reversed' or 'shuffle:<seed>', not '${order}'`
    );
  }
  // Fisher-Yates driven by the Park-Miller generator: small, and the same on
  // every machine.
  const modulus = 2_147_483_647;
  let state = (Number(shuffle[1]) % (modulus - 1)) + 1;
  const next = () => {
    state = (state * 48_271) % modulus;
    return state / modulus;
  };
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  }
  return sorted;
}
