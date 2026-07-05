#!/usr/bin/env bash
# Builds the Haze compiler distributable and runs the compiler test suite
# against it exclusively — never the dev bun CLI, never a system-installed
# haze. Every phase below (compiling the test-suite program itself, and
# every test case it drives) uses only dist/haze and dist/stdlib produced by
# `bun run build`.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$(pwd)"

echo "==> Building the Haze compiler distributable (bun run build)"
bun run build

export HAZE_STDLIB_DIR="$REPO_ROOT/dist/stdlib"
export HAZE_TEST_BINARY="$REPO_ROOT/dist/haze"
export HAZE_TEST_WORKDIR="$REPO_ROOT/testsuite/.work"

HAZE_BIN="$REPO_ROOT/dist/haze"

rm -rf "$HAZE_TEST_WORKDIR"
mkdir -p "$HAZE_TEST_WORKDIR"

echo "==> Building the test suite runner (dist/haze build)"
"$HAZE_BIN" build --quiet --dir "$REPO_ROOT/testsuite"

echo "==> Running the test suite (dist/haze run)"
set +e
"$HAZE_BIN" run --quiet --dir "$REPO_ROOT/testsuite"
exit_code=$?
set -e

exit "$exit_code"
