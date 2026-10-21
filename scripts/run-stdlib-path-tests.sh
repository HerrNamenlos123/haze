#!/usr/bin/env bash
# The stdlib path tests scripts/run-tests.sh cannot run: they need a GPU
# adapter (wgpu, GL through the offscreen SDL driver's EGL) or two processes
# (single_instance). Opt-in; run it after changing a C <-> Haze path in
# stdlib/wgpu, stdlib/gl, stdlib/sdl's GL loader or stdlib/single_instance.
# The headless paths (SDL events, Clay) are in the gate. See DEVELOPMENT.md,
# "What the test gate covers".
#
# Builds tests/stdlib-paths/optin with the dev compiler (bun run src/main.ts)
# from the repository root, then runs every mode and reports each.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$(pwd)"
BIN="$REPO_ROOT/__haze__/stdlib-paths-optin/bin/stdlib-paths-optin"

echo "==> Building tests/stdlib-paths/optin (dev compiler)"
bun run src/main.ts build --quiet --dir "$REPO_ROOT/tests/stdlib-paths/optin" || exit 1

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# Anything a GPU driver caches goes here, not into the user's cache.
export XDG_CACHE_HOME="$TMP/cache"

failed=()

run_mode() {
  local name="$1"
  shift
  echo "==> $name"
  if ! "$BIN" "$@"; then
    failed+=("$name")
  fi
}

run_mode "wgpu: request callbacks" wgpu
run_mode "gl: glad loads through getProcAddress" gl

# single_instance: a primary, then a secondary that sends it a payload. The
# app id is unique to this run, so no other instance can answer.
echo "==> single_instance: the server thread's parse and onActivate"
app_id="haze-stdlib-paths-$$-$(date +%s%N)"
ready="$TMP/primary-ready"
"$BIN" si-primary "$app_id" "$ready" > "$TMP/primary.log" 2>&1 &
primary=$!
for _ in $(seq 1 100); do
  [ -e "$ready" ] && break
  kill -0 "$primary" 2> /dev/null || break
  sleep 0.05
done
if [ -e "$ready" ]; then
  "$BIN" si-secondary "$app_id"
  secondary_exit=$?
else
  echo "the primary never became ready"
  secondary_exit=1
fi
wait "$primary"
primary_exit=$?
echo "-- primary:"
cat "$TMP/primary.log"
if [ "$primary_exit" -ne 0 ] || [ "$secondary_exit" -ne 0 ]; then
  failed+=("single_instance")
fi

echo
if [ "${#failed[@]}" -ne 0 ]; then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
echo "All stdlib path tests passed."
