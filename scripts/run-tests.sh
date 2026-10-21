#!/usr/bin/env bash
# Builds the Haze compiler distributable and runs the compiler test suite
# against it exclusively — never the dev bun CLI, never a system-installed
# haze. Every phase below (compiling the test-suite program itself, and
# every test case it drives) uses only dist/haze and dist/stdlib produced by
# `bun run build`. The stdlib path test is built by dist/haze as well, from
# the packages in stdlib/ it tests.
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

# What each parser accepts and builds, construct by construct, including what
# the native parser must reject even where no file in the tree spells it (the
# equivalence check below only sees the tree).
echo "==> Running the parser tests"
bun test src/Parser/Parser.test.ts

# What an incremental build skips, and that the skipped work would have changed
# nothing. Builds with the dev compiler, like the bootstrap check above.
echo "==> Checking incremental builds"
bun test src/ModuleCompiler/FileStamps.test.ts src/ModuleCompiler/ModuleBuildCache.test.ts \
  src/shared/Workspace.test.ts scripts/incremental-build.test.ts

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

# dist/haze keys its build cache on its version alone, so it would reuse what
# an earlier run built even when the compiler changed in between (and a reused
# case replays none of its warnings). Every run therefore compiles everything
# the gate builds with the compiler under test:
# - every case: its outputs and build record (case_*), and the libraries of
#   multi-module cases, whose names the cases choose (found by their records,
#   which name files in the work dir);
# - the test suite runner and the stdlib path test, with every module their
#   last build linked (named in their records): the records only, so what a
#   generator built (SDL) stays.
for record in "$REPO_ROOT"/__haze__/build-cache/*.json; do
  [ -e "$record" ] || continue
  if grep -qF "\"$HAZE_TEST_WORKDIR/" "$record"; then
    module="$(basename "$record" .json)"
    rm -rf "$REPO_ROOT/__haze__/${module%.published}" "$record"
  fi
done
rm -rf "$REPO_ROOT"/__haze__/case_* "$REPO_ROOT"/__haze__/build-cache/case_*

forget_build() {
  local record="$REPO_ROOT/__haze__/build-cache/$1.json"
  [ -e "$record" ] || return 0
  local module
  for module in $(grep -o '__haze__/[^/"]*/build/import\.hz' "$record" | cut -d/ -f2 | sort -u); do
    rm -f "$REPO_ROOT/__haze__/build-cache/$module.json"
  done
  rm -f "$record" "$REPO_ROOT/__haze__/build-cache/$1.published.json"
}
forget_build testsuite
forget_build stdlib-paths

rm -rf "$HAZE_TEST_WORKDIR"
mkdir -p "$HAZE_TEST_WORKDIR"

# The stdlib's C <-> Haze paths that run headless (SDL with the offscreen
# driver, Clay without a renderer): the Haze code C reaches runs under the
# context of the code that drove the C call. The paths that need a GPU or a
# second process: scripts/run-stdlib-path-tests.sh (opt-in).
echo "==> Checking the stdlib's C <-> Haze paths (tests/stdlib-paths/headless)"
"$HAZE_BIN" build --quiet --dir "$REPO_ROOT/tests/stdlib-paths/headless"
"$REPO_ROOT/__haze__/stdlib-paths/bin/stdlib-paths"

echo "==> Building the test suite runner (dist/haze build)"
"$HAZE_BIN" build --quiet --dir "$REPO_ROOT/testsuite"

echo "==> Running the test suite (dist/haze run)"
set +e
"$HAZE_BIN" run --quiet --dir "$REPO_ROOT/testsuite"
exit_code=$?
set -e

exit "$exit_code"
