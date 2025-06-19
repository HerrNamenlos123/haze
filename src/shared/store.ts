export type ID = bigint & {
  __nonZeroBrand?: never;
};

// const ID_BASE = 10n ** 18n;
const ID_BASE = 10n ** 3n;
let nextIdCounter = 0n;

function assertId() {
  if (nextIdCounter >= ID_BASE) {
    throw new Error(
      "Ran out of parsed Symbol IDs - What did you do to make the program so huge???",
    );
  }
}

function makeId(namespace: number): ID {
  assertId();
  return (nextIdCounter++ + ID_BASE * BigInt(namespace)) as ID;
}

export function makeTypeId() {
  return makeId(1);
}

export function makeSymbolId() {
  return makeId(2);
}

export function makeScopeId() {
  return makeId(3);
}

export function makeLoweredId() {
  return makeId(4);
}
