#!/bin/bash
# Runs one standalone stdlib test program (stdlib/<module>/tests/*.hz) with the
# dev compiler, until Haze has a test feature of its own.
#
#   scripts/run-stdlib-test.sh <test.hz> [module ...]
#
# Each test is a `fn main(): int` program (non-zero = failed). It is built as
# the main file of a throwaway exe project under .claude/bench-stdlib-tests/
# (gitignored), with every listed stdlib module as a dependency; core needs
# none. Run from anywhere; the compiler runs from the repo root, as it must.
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
test="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
shift
name="$(basename "$test" .hz)"
project="$root/.claude/bench-stdlib-tests/$name"
mkdir -p "$project/src"
cp "$test" "$project/src/main.hz"
{
    echo "name = \"$name\""
    echo "id = \"$(printf %s "$name" | md5sum | head -c 8)\""
    echo 'version = "0.1.0"'
    echo 'description = ""'
    echo 'license = "MIT"'
    echo 'authors = []'
    echo 'type = "exe"'
    echo
    echo '[dependencies]'
    for module in "$@"; do
        echo "$module = { path = \"../../../stdlib/$module\" }"
    done
} > "$project/haze.toml"
cd "$root"
NODE_ENV=development bun run src/main.ts run --dir "$project" --quiet
