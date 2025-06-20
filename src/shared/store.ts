import { InternalError } from "./Errors";

type ID = bigint & {
  __nonZeroBrand?: never;
};

export type CollectScopeId = ID & { __brand: "CollectScopeId" };
export type SemanticSymbolId = ID & { __brand: "SemanticSymbolId" };
export type SemanticScopeId = ID & { __brand: "SemanticScopeId" };
export type LoweredTypeId = ID & { __brand: "LoweredTypeId" };

// const ID_BASE = 10n ** 18n;
const ID_BASE = 10n ** 3n;
let nextIdCounter = 0n;

let nextTempId = 0n;

function assertId() {
  if (nextIdCounter >= ID_BASE) {
    throw new InternalError(
      "Ran out of parsed Symbol IDs - What did you do to make the program so huge???",
      undefined,
      2,
    );
  }
}

export function makeTempName() {
  return `__temp_${nextTempId++}`;
}

function makeId(namespace: number): ID {
  assertId();
  return (nextIdCounter++ + ID_BASE * BigInt(namespace)) as ID;
}

export function makeCollectScopeId() {
  return makeId(1) as CollectScopeId;
}

export function makeSemanticSymbolId() {
  return makeId(2) as SemanticSymbolId;
}

export function makeSemanticScopeId() {
  return makeId(3) as SemanticScopeId;
}

export function makeLoweredId() {
  return makeId(4) as LoweredTypeId;
}
