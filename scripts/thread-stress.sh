#!/bin/bash
# Stress test of threads and cross-thread wake-ups (stage 5 of
# docs/async-implementation-plan.md; docs/async-decisions.md S5-10 to S5-14):
# several threads hammering mutexes, lockWhen queues, futures and flags,
# atomic arrays and fields, one atomic arena,
# poisoning across threads, recovered panics on every thread at once, threads
# that start and end all the time (also while another thread wakes one of
# their tasks), with collections in between. Each round
# checks its results exactly; a lost wake-up leaves every thread waiting,
# which the runtime reports as a deadlock (a panic, status 255).
# Not in the gate: it runs for as long as it is told to.
#
#   scripts/thread-stress.sh [seconds per run, default 10] [runs, default 3]
#
# Under ASan and UBSan: flip HAZE_ENABLE_ASAN in
# src/ModuleCompiler/ModuleCompiler.ts in a throwaway worktree (with
# -fsanitize=address,undefined for both flags) and run this script there;
# docs/agent-notes/sanitizer-runs.md has the switch and its traps. The
# options below are the ones that note names; they change nothing without
# the sanitizers.
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
seconds="${1:-10}"
runs="${2:-3}"
dir="$root/.claude/bench-thread-stress"
mkdir -p "$dir"
cat > "$dir/thread_stress.hz" <<'HAZE'
// Written by scripts/thread-stress.sh.

// Shared state crosses threads only as atomic data (C147).
atomic opaque ref struct Cell {
    n: atomic int = 0;
    fn constructor(): mut Cell { return Cell {}; }
}

// A bounded queue whose unsafe fields are touched only under its mutex (C172).
atomic opaque ref struct Bounded {
    private lock: sys.Mutex;
    private unsafe items: mut []int = [];
    private unsafe finished: int = 0;
    const capacity: int = 16;

    fn constructor(): mut Bounded { return Bounded { lock: sys.Mutex() }; }

    // Waits while the queue is full.
    mut fn push(job: int) {
        let me = this;
        this.lock.lockWhen(() => me.items.length < me.capacity, () => { me.items.push(job); });
    }

    mut fn producerDone() {
        let me = this;
        this.lock.lock(() => { me.finished += 1; });
    }

    // The next job, or -1 once every one of `producers` is done and the
    // queue is empty.
    mut fn take(producers: int): int {
        let me = this;
        return this.lock.lockWhen(() => me.items.length > 0 || me.finished == producers, () => {
            if me.items.length > 0 { return me.items.pop(); }
            return -1;
        });
    }
}

__c__("#define HZ_S_THREADS 6");
__c__("#define HZ_S_BLOCKS 2000");
__c__("static unsigned char *hz_s_blocks[HZ_S_THREADS][HZ_S_BLOCKS];");
__c__("static size_t hz_s_size(hzstd_int_t i) { return i % 89 == 0 ? 5000 : (size_t)(1 + (i * 13) % 70); }");
__c__("static hzstd_int_t hz_s_check(hzstd_int_t t) { hzstd_int_t bad = 0; for (hzstd_int_t i = 0; i < HZ_S_BLOCKS; i++) { size_t n = hz_s_size(i); for (size_t k = 0; k < n; k++) { if (hz_s_blocks[t][i][k] != (unsigned char)(t + 1)) { bad++; } } } return bad; }");
__c__("static hzstd_int_t hz_s_fill(hzstd_allocator_t arena, hzstd_int_t t) { for (hzstd_int_t i = 0; i < HZ_S_BLOCKS; i++) { size_t n = hz_s_size(i); unsigned char *p = (i % 3 == 0) ? hzstd_allocate_unscanned(arena, n, NULL) : hzstd_allocate(arena, n, NULL); memset(p, (int)(t + 1), n); hz_s_blocks[t][i] = p; } return hz_s_check(t); }");
__c__("static hzstd_int_t hz_s_expected(bool unscanned) { size_t sum = 0; for (hzstd_int_t i = 0; i < HZ_S_BLOCKS; i++) { if ((i % 3 == 0) == unscanned) { sum += (hz_s_size(i) + 15) & ~(size_t)15; } } return (hzstd_int_t)(sum * HZ_S_THREADS); }");
extern C fn hz_s_fill(arena: Allocator, t: int): int :: final;
extern C fn hz_s_check(t: int): int :: final;
extern C fn hz_s_expected(unscanned: bool): int :: final;

fn counterRound(threads: int, perThread: int): bool {
    let m = sys.Mutex();
    let counter = Cell();
    let workers: mut []Future<int> = [];
    for (let t = 0; t < threads; t++) {
        workers.push(thread.spawn(() => {
            for (let i = 0; i < perThread; i++) {
                m.lock(() => {
                    counter.n = counter.n + 1;
                    if i % 64 == 0 { sys.yield(); }
                });
                if i % 97 == 0 { sys.yield(); }
            }
            return 0;
        }, { stallWarning: false }));
    }
    let r = sys.joinAll(workers);
    return counter.n == threads * perThread;
}

// Thread t completes its futures; thread t + 1 joins them, as they come.
fn futureRingRound(threads: int, perThread: int): bool {
    let rings: mut atomic []mut atomic []mut Future<int> = [];
    for (let t = 0; t < threads; t++) {
        let ring: mut atomic []mut Future<int> = [];
        for (let k = 0; k < perThread; k++) { ring.push(Future<int>()); }
        rings.push(ring);
    }
    let workers: mut []Future<int> = [];
    for (let t = 0; t < threads; t++) {
        let me = t;
        workers.push(thread.spawn(() => {
            let mine = rings[me];
            let before = (me + threads - 1) % threads;
            let prev = rings[before];
            let wrong = 0;
            for (let k = 0; k < perThread; k++) {
                let f = mine[k];
                f.complete(me * 100000 + k);
                let p = prev[k];
                let r = p.join();
                if r is int { if r != before * 100000 + k { wrong++; } } else { wrong++; }
            }
            return wrong;
        }, { stallWarning: false }));
    }
    let r = sys.joinAll(workers);
    let wrong = 0;
    for w in r { wrong += w; }
    return wrong == 0;
}

// One set() wakes tasks on every thread; the flag is cleared and set again.
fn flagRound(threads: int, waiters: int, pulses: int): bool {
    let m = sys.Mutex();
    let woke = Cell();
    let flags: mut atomic []mut sys.Flag = [];
    for (let p = 0; p < pulses; p++) { flags.push(sys.Flag()); }
    let workers: mut []Future<int> = [];
    for (let t = 0; t < threads; t++) {
        workers.push(thread.spawn(() => {
            let tasks: mut []Future<int> = [];
            for (let w = 0; w < waiters; w++) {
                tasks.push(task.spawn(() => {
                    for (let p = 0; p < flags.length; p++) {
                        let f = flags[p];
                        f.wait();
                        m.lock(() => { woke.n = woke.n + 1; });
                    }
                    return 0;
                }));
            }
            let r = sys.joinAll(tasks);
            return 0;
        }));
    }
    for (let p = 0; p < pulses; p++) {
        time.sleep(0.0005);
        let f = flags[p];
        f.set();
    }
    let r = sys.joinAll(workers);
    return woke.n == threads * waiters * pulses;
}

// A bounded queue between producer and consumer threads, lockWhen both ways.
fn queueRound(producers: int, consumers: int, jobs: int): bool {
    let queue = Bounded();
    let sum = Cell();
    let all: mut []Future<int> = [];
    for (let p = 0; p < producers; p++) {
        all.push(thread.spawn(() => {
            for (let k = 1; k <= jobs; k++) { queue.push(k); }
            queue.producerDone();
            return 0;
        }, { stallWarning: false }));
    }
    for (let c = 0; c < consumers; c++) {
        all.push(thread.spawn(() => {
            let mine = 0;
            while true {
                let job = queue.take(producers);
                if job < 0 { break; }
                mine += job;
            }
            sum.n += mine;
            return 0;
        }, { stallWarning: false }));
    }
    let r = sys.joinAll(all);
    return sum.n == producers * jobs * (jobs + 1) / 2;
}

// A panic poisons a mutex on one thread; every other thread sees it poisoned.
fn poisonRound(threads: int): bool {
    let m = sys.Mutex();
    let code = Cell();
    code.n = threads;
    let poisoner = thread.spawn(() => {
        return attempt {
            m.lock(() => { if code.n > 0 { sys.panic("poison"); } });
            0
        } recover e { 1 };
    });
    let rp = poisoner.join();
    let seers: mut []Future<int> = [];
    for (let t = 0; t < threads; t++) {
        seers.push(thread.spawn(() => {
            return attempt {
                m.lock(() => {});
                0
            } recover e { e.message.contains("poisoned") ? 1 : 2 };
        }));
    }
    let seen = sys.joinAll(seers);
    let ok = 0;
    for s in seen { if s == 1 { ok++; } }
    if rp is int { return rp == 1 && ok == threads; }
    return false;
}

// Panics recovered on every thread at once.
fn recoverRound(threads: int, each: int): bool {
    let code = Cell();
    code.n = each;
    let workers: mut []Future<int> = [];
    for (let t = 0; t < threads; t++) {
        workers.push(thread.spawn(() => {
            let n = 0;
            for (let i = 0; i < each; i++) {
                n += attempt {
                    if code.n > 0 { sys.panic("recovered"); }
                    0
                } recover e { 1 };
            }
            return n;
        }, { stallWarning: false }));
    }
    let r = sys.joinAll(workers);
    let total = 0;
    for n in r { total += n; }
    return total == threads * each;
}

// Threads that start and end all the time, some with a task left that keeps
// them alive and a background one that is killed.
fn churnRound(count: int): bool {
    let all: mut []Future<int> = [];
    for (let i = 0; i < count; i++) {
        let k = i;
        all.push(thread.spawn(() => {
            let bg = task.spawn(() => {
                let never = Future<int>();
                let r = never.join();
                return 0;
            }, { background: true });
            let kept = task.spawn(() => {
                sys.yield();
                return k;
            });
            let r = kept.join();
            if r is int { return r; }
            return -1;
        }));
    }
    let r = sys.joinAll(all);
    let total = 0;
    for v in r { total += v; }
    return total == count * (count - 1) / 2;
}

// A thread ends while another thread wakes its background task: the wake-up
// and the end's kill meet in the flag's queue (the kill must see the push).
fn wakeAtEndRound(count: int): bool {
    let flags: mut atomic []mut sys.Flag = [];
    for (let i = 0; i < count; i++) { flags.push(sys.Flag()); }
    let all: mut []Future<int> = [];
    for (let i = 0; i < count; i++) {
        let f = flags[i];
        all.push(thread.spawn(() => {
            let bg = task.spawn(() => {
                f.wait();
                return 1;
            }, { background: true });
            sys.yield();
            return 0;
        }));
    }
    for (let i = 0; i < count; i++) {
        let f = flags[i];
        f.set();
    }
    let r = sys.joinAll(all);
    return r.length == count;
}

// Atomic containers under contention: element updates, pushes and an
// atomic field from every thread at once, then exact totals (C192).
fn atomicRound(threads: int, perThread: int): bool {
    let counts: mut atomic []int = [0, 0, 0, 0, 0, 0, 0, 0];
    let log: mut atomic []int = [];
    let total = Cell();
    let workers: mut []Future<int> = [];
    for (let t = 0; t < threads; t++) {
        let me = t;
        workers.push(thread.spawn(() => {
            for (let i = 0; i < perThread; i++) {
                counts[(i + me) % 8] += 1;
                total.n += 1;
                if i % 16 == 0 { log.push(me); }
                if i % 101 == 0 { sys.yield(); }
            }
            return 0;
        }, { stallWarning: false }));
    }
    let r = sys.joinAll(workers);
    let sum = 0;
    for c in counts { sum += c; }
    let logged = 0;
    for v in log { if v >= 0 && v < threads { logged++; } }
    return sum == threads * perThread && total.n == threads * perThread && logged == threads * ((perThread + 15) / 16);
}

// Every thread allocates into one atomic arena with small chunks at once
// (S5-5): no block handed out twice, the usage exact.
fn arenaRound(): bool {
    let small: ChunkPolicy = { firstBytes: 256, nextBytes: 1024, growth: 1.0 };
    let arena = Alloc.atomicArena({ label: "stress", scanned: small, unscanned: small });
    let workers: mut []Future<int> = [];
    for (let t = 0; t < 6; t++) {
        let id = t;
        workers.push(thread.spawn(() => {
            let a: Allocator = arena;
            return hz_s_fill(a, id);
        }, { stallWarning: false }));
    }
    let during = sys.joinAll(workers);
    let bad = 0;
    for b in during { bad += b; }
    for (let t = 0; t < 6; t++) { bad += hz_s_check(t); }
    let usage = arena.measure();
    return bad == 0 && usage.scanned == hz_s_expected(false) && usage.unscanned == hz_s_expected(true);
}

fn main(): int {
    let args = sys.args();
    let seconds = 10;
    if args.length > 1 {
        let parsed = int(args[1]);
        if parsed is int { seconds = parsed; }
    }
    let start = time.now();
    let rounds = 0;
    while time.now() - start < (seconds as real) {
        if !counterRound(8, 3000) { fmt.println(f"round {rounds}: mutex counter wrong"); return 1; }
        if !futureRingRound(6, 2000) { fmt.println(f"round {rounds}: future ring wrong"); return 1; }
        if !flagRound(6, 8, 20) { fmt.println(f"round {rounds}: flag wake-ups wrong"); return 1; }
        if !queueRound(3, 4, 3000) { fmt.println(f"round {rounds}: queue sum wrong"); return 1; }
        if !poisonRound(6) { fmt.println(f"round {rounds}: poisoning not seen"); return 1; }
        if !recoverRound(6, 40) { fmt.println(f"round {rounds}: recovered panics lost"); return 1; }
        if !churnRound(40) { fmt.println(f"round {rounds}: thread churn wrong"); return 1; }
        if !wakeAtEndRound(40) { fmt.println(f"round {rounds}: wake-up at a thread's end wrong"); return 1; }
        if !atomicRound(6, 4000) { fmt.println(f"round {rounds}: atomic containers wrong"); return 1; }
        if !arenaRound() { fmt.println(f"round {rounds}: atomic arena wrong"); return 1; }
        if rounds % 4 == 0 { sys.forceGc(); }
        rounds++;
    }
    fmt.println(f"thread stress: {rounds} rounds, all exact");
    return 0;
}
HAZE
cd "$root"
NODE_ENV=development bun run src/main.ts build "$dir/thread_stress.hz" --quiet
export ASAN_OPTIONS="detect_leaks=0:detect_stack_use_after_return=0:handle_segv=0"
export UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1"
for i in $(seq 1 "$runs"); do
    echo "run $i of $runs, $seconds s:"
    "$root/__haze__/thread_stress_hz/bin/thread_stress_hz" "$seconds"
done
