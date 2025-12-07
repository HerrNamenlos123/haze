let nextTempId = 0n;

export function makeTempId() {
  return nextTempId++;
}

export function makeTempName() {
  return `__temp_${nextTempId++}`;
}
