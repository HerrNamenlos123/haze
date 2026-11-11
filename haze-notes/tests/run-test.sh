#!/bin/bash
# Runs one haze-notes test program with the dev compiler.
#
#   haze-notes/tests/run-test.sh <test.hz> <source.hz ...>
#
# haze-notes is an executable, so nothing can depend on it: the test becomes
# the main file of a throwaway exe project under .claude/bench-hn-tests/
# (gitignored), with the listed haze-notes sources (names in haze-notes/src)
# copied in beside it and every dependency haze-notes has. Extra arguments
# after `--` go to the test program; RELEASE=1 builds it as a release.
set -e
root="$(cd "$(dirname "$0")/../.." && pwd)"
test="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
shift
sources=()
while [ $# -gt 0 ] && [ "$1" != "--" ]; do
    sources+=("$1")
    shift
done
[ "$1" = "--" ] && shift
name="$(basename "$test" .hz)"
project="$root/.claude/bench-hn-tests/$name"
rm -rf "$project/src"
mkdir -p "$project/src"
cp "$test" "$project/src/main.hz"
for source in "${sources[@]}"; do
    cp "$root/haze-notes/src/$source" "$project/src/"
done
{
    echo "name = \"$name\""
    echo "id = \"$(printf %s "hn-$name" | md5sum | head -c 8)\""
    echo 'version = "0.1.0"'
    echo 'description = ""'
    echo 'license = "MIT"'
    echo 'authors = []'
    echo 'type = "exe"'
    echo
    echo '[dependencies]'
    sed -n '/^\[dependencies\]/,/^\[/p' "$root/haze-notes/haze.toml" | grep '= { path' | sed 's#"\.\./stdlib/#"../../../stdlib/#'
} > "$project/haze.toml"
cd "$root"
NODE_ENV=development bun run src/main.ts build --dir "$project" --quiet ${RELEASE:+--release}
"$root/__haze__/$name/bin/$name" "$@"
