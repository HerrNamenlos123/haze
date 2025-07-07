
let nextTempId = 0n;

export function makeTempName() {
  return `__temp_${nextTempId++}`;
}
