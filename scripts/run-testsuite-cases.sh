#!/bin/bash
# Runs some of the compiler test suite's case files with the dev compiler
# (src/ via bun), without rebuilding dist/ the way scripts/run-tests.sh does:
# for the red/green loop of one compiler fix.
#
#   scripts/run-testsuite-cases.sh cases_foo [cases_bar ...]
#
# A throwaway runner under .claude/bench-testsuite/ (gitignored) registers
# just those files; every case is built by a wrapper that runs the dev
# compiler from the repo root. The full suite stays scripts/run-tests.sh.
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
runner="$root/.claude/bench-testsuite/runner"
rm -rf "$runner/src"
mkdir -p "$runner/src" "$root/.claude/bench-testsuite/work"
cp "$root/testsuite/haze.toml" "$runner/haze.toml"
sed -i 's/^name = .*/name = "testsuite"/' "$runner/haze.toml"
cp "$root/testsuite/src/framework.hz" "$root/testsuite/src/error_codes.hz" "$runner/src/"
{
    sed -n '/^fn buildConfig/,/^}/p' "$root/testsuite/src/main.hz"
    echo
    echo 'fn main(): int {'
    echo '    let config = buildConfig();'
    echo '    let suite = testsuite.Suite {};'
    for case in "$@"; do
        cp "$root/testsuite/src/$case.hz" "$runner/src/"
        echo "    $case.register(suite);"
    done
    echo '    return testsuite.runAll(config, suite);'
    echo '}'
} > "$runner/src/main.hz"
cat > "$root/.claude/bench-testsuite/haze-dev" <<WRAP
#!/bin/bash
cd "$root" && NODE_ENV=development exec bun run src/main.ts "\$@"
WRAP
chmod +x "$root/.claude/bench-testsuite/haze-dev"
export HAZE_TEST_BINARY="$root/.claude/bench-testsuite/haze-dev"
export HAZE_STDLIB_DIR="$root/stdlib"
export HAZE_TEST_WORKDIR="$root/.claude/bench-testsuite/work"
cd "$root"
NODE_ENV=development bun run src/main.ts run --dir "$runner" --quiet
