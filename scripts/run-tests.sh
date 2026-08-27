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

# The compiler's own bootstrap, checked before anything depends on it. A broken
# one used to surface only as an hour-long suite run with no error to explain
# it -- see R&D/Aliases, Anonymous Structs and Spreading.md §8.
echo "==> Checking the parser bootstrap (§8.2)"
bun test scripts/parser-bootstrap.test.ts

# haze.toml validation, which no testsuite/ case can reach: the framework
# writes every case's manifest itself, so they are well-formed by construction.
echo "==> Checking haze.toml validation"
bun test src/shared/Config.test.ts

# ANTLR is not a compilation path, but it is the oracle the native parser is
# checked against. This proves the two still agree on every .hz file in the
# tree, not just on whatever a compiled project happens to reach (§8.3).
echo "==> Checking parser equivalence over the whole repository (§8.3)"
bun run scripts/parser-equivalence.ts

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
