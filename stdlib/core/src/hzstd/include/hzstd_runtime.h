
#ifndef HZSTD_RUNTIME_H
#define HZSTD_RUNTIME_H

#include "../hzstd_types.h"
#include <stdatomic.h>
#include "hzstd_reactive.h"
#include "hzstd_source_location.h"
#include "hzstd_string.h"

// ── The context (Axiom C468-C477, C500-C510, C567-C569) ─────────────────────
//
// The types are in hzstd_types.h. The settings of a new context: what
// `Context()` gives (C398, C479): the heap allocator, a logger that writes to
// stderr, and empty user boxes.
hzstd_context_settings_t hzstd_context_settings_default(void);

// Sets up the main thread (id 1); called once by hzstd_initialize.
void hzstd_initialize_main_thread(void);

// ── Tasks (hzstd_sched.c; docs/async-runtime.md sections 5 and 7) ──────────

// The generated `main`: runs `main_fn` as the main thread's first task and the
// thread's scheduler until no task keeps the thread alive, then `end_fn` (if
// not NULL) as one more task; returns what `main_fn` returned.
int32_t hzstd_sched_run_main(int32_t (*main_fn)(hzstd_context_t *ctx), void (*end_fn)(hzstd_context_t *ctx));
// A new task on the thread of `ctx`, running entry(its context, arg) with a
// copy of the context's settings and of the task's task-local values; it
// starts when the spawner suspends (C384). `future` (or NULL) is settled as
// killed or never ran if the task is killed; the entry completes it otherwise.
// The profiler's record of the scheduler (hzstd_sched.c, docs/profiler-timelines.md).
void hzstd_sched_trace_begin(void);
void hzstd_sched_trace_end(hzstd_profiling_result_t *result, double time_ref);
// Seconds per tick of the threads' CPU clocks (Windows: the TSC, learnt by the watchdog).
double hzstd_cpu_seconds_per_tick(void);

void hzstd_task_spawn(hzstd_context_t *ctx,
                      hzstd_task_entry_t entry,
                      void *arg,
                      bool background,
                      hzstd_future_core_t *future,
                      hzstd_source_location_t spawned_at);
// Lets every task that is ready run first (C243). A suspension point.
void hzstd_task_yield(hzstd_context_t *ctx);
// Suspends the calling task for `ms` milliseconds of the thread's event loop
// (time.sleep, C301): a libuv timer readies it.
void hzstd_task_sleep_ms(hzstd_context_t *ctx, uint64_t ms);
// A future's shared core: its state and the tasks waiting for it. Every
// function here may be called from any thread (S5-11).
hzstd_future_core_t *hzstd_future_core_new(void);
hzstd_int_t hzstd_future_state(hzstd_future_core_t *core);
// Future.complete is three steps (S5-14): claim (panics if the future has or
// is getting its value, C444), store the value, then complete, which settles
// the future and readies its waiters; a join reads the value only after it
// saw the future settled, so the value is there.
void hzstd_future_claim(hzstd_context_t *ctx, hzstd_future_core_t *core);
void hzstd_future_complete(hzstd_context_t *ctx, hzstd_future_core_t *core);
// Suspends the calling task until the future is settled; returns its state.
// A suspension point.
hzstd_int_t hzstd_future_wait(hzstd_context_t *ctx, hzstd_future_core_t *core);

// Suspension points and windows (sys.limitSuspensions, sys.traceSuspensions;
// hzstd_sched.c). Every call that can suspend calls hzstd_suspension_point
// first: it panics inside a computed (C539), counts the point in the task's
// open windows and panics, before anything suspends, when one would pass its
// limit (-1: none).
void hzstd_suspension_point(hzstd_context_t *ctx);
hzstd_int_t hzstd_suspension_window_open(hzstd_context_t *ctx, hzstd_int_t max_count, hzstd_source_location_t where);
// The window of a lockWhen/waitUntil condition: suspending panics in it.
hzstd_int_t hzstd_condition_window_open(hzstd_context_t *ctx);
hzstd_suspension_stats_t hzstd_suspension_window_close(hzstd_context_t *ctx, hzstd_int_t window);
// A panic recovery: back to the windows open when its frame was pushed.
void hzstd_suspension_windows_restore(hzstd_context_t *ctx, size_t depth);
// Sets the thread's yield gate from the running task's state: closed while it
// has a suspension window open or evaluates a computed. Called where either
// changes (hzstd_reactive.c, the recovery path).
void hzstd_yield_gate_refresh(hzstd_context_t *ctx);

// sys.Mutex's core (hzstd_sched.c, "Mutexes"). Lock and unlock pair up per
// lock region; hzstd_mutex_lock_when starts a lockWhen/waitUntil (it panics on
// a mutex the task holds), hzstd_mutex_wait_change waits, while the condition
// does not hold, for the end of a lock region of the mutex.
hzstd_mutex_core_t *hzstd_mutex_core_new(void);
void hzstd_mutex_lock(hzstd_context_t *ctx, hzstd_mutex_core_t *m, hzstd_source_location_t where);
void hzstd_mutex_unlock(hzstd_context_t *ctx, hzstd_mutex_core_t *m);
void hzstd_mutex_lock_when(hzstd_context_t *ctx, hzstd_mutex_core_t *m, hzstd_source_location_t where);
void hzstd_mutex_wait_change(hzstd_context_t *ctx, hzstd_mutex_core_t *m);
// A panic recovery: releases and poisons the holds taken after its frame (C340).
void hzstd_held_locks_restore(hzstd_context_t *ctx, size_t count);

// sys.Flag's core.
void *hzstd_flag_core_new(void);
void hzstd_flag_set(hzstd_context_t *ctx, void *flag);
void hzstd_flag_clear(hzstd_context_t *ctx, void *flag);
bool hzstd_flag_is_set(void *flag);
void hzstd_flag_wait(hzstd_context_t *ctx, void *flag);
// For the fault handler: where it interrupted (NULL clears it), and the stack
// of the running task (NULL if none). Both async-signal-safe.
void hzstd_sched_note_interrupted_sp(void *sp);
const fiber_stack *hzstd_current_task_stack(void);

void hzstd_yield_after_slow(hzstd_context_t *ctx, hzstd_real_t seconds);
// sys.yieldAfter (docs/async-runtime.md section 2), called inline by
// generated code under its Haze name: one load and one compare, no clock
// read, no call, unless the task has run longer than `seconds` since its last
// switch (as the stall watchdog measured it, 5 ms precision); then it yields.
// While the task has a suspension window open the gate is +infinity: every
// call goes to the slow path, which counts it as a suspension point.
static inline void yieldAfter(hzstd_context_t *ctx, hzstd_real_t seconds)
{
  if (__builtin_expect(atomic_load_explicit(&ctx->thread->yield_gate, memory_order_relaxed) > seconds, 0)) {
    hzstd_yield_after_slow(ctx, seconds);
  }
}
// sys.exit: a graceful exit with `status` (0 to 255, else it panics): this
// task stops here, its thread stops every other task at its suspension, the
// thread's last task runs, then the process ends with `status` (C521, C576,
// C586). The first status is final.
_Noreturn void hzstd_task_exit(hzstd_context_t *ctx, hzstd_int_t status);
// The first step of a recovery frame, on the stack the panic unwound to:
// re-arms what the failure used up (Windows: a stack's guard, after an
// overflow).
void hzstd_panic_recovered(hzstd_context_t *ctx);
// Whether the calling thread runs a collection (it holds the collector's
// lock, and maybe the world stopped): the panic worker cannot report a
// failure then, so the fault handler reports it directly.
bool hzstd_this_thread_is_collecting(void);
// The status of a graceful exit that has started, or -1.
int hzstd_exit_status(void);
// sys.abort: ends the process at once, status 134, no cleanup (C547, C574).
_Noreturn void hzstd_abort(void);
// The stall warning's trace of the task a scheduler runs, taken and named on
// the watchdog's thread (docs/async-runtime.md section 10); false if none
// could be taken. Linux: a signal whose handler walks the frame pointers.
// Windows: the thread is suspended while its registers and stack are copied,
// and unwound from the copy once it runs again. What it needs is set up once,
// before any task runs (hzstd_stall_trace_initialize): the signal handler,
// the copy buffer.
void hzstd_stall_trace_initialize(void);
bool hzstd_capture_stall_trace(hzstd_sched_t *s, hzstd_raw_report_t *out);
// sys.timeSinceTaskSwitch: the same measurement, in seconds.
hzstd_real_t hzstd_time_since_task_switch(hzstd_context_t *ctx);

// The id for a thread Haze starts: process-unique, never reused, from 2 on.
uint64_t hzstd_next_thread_id(void);
// Gives back what a thread's stackref table holds (its thread has ended).
void hzstd_gen_table_free(hzstd_gen_table_t *table);

// thread.spawn (S5-10): a new OS thread with its own scheduler, a blank
// context and fresh per-thread globals, whose first task runs entry(its
// context, arg) and completes `future` (the entry does). `stall_warning`
// false: the watchdog never warns about it; `has_stack_size`: every task of
// the thread gets `stack_size` bytes of stack (it panics outside 64 KiB to
// 1 GiB, naming the option).
void hzstd_thread_spawn(hzstd_context_t *ctx,
                        hzstd_task_entry_t entry,
                        void *arg,
                        hzstd_future_core_t *future,
                        bool stall_warning,
                        bool has_stack_size,
                        hzstd_int_t stack_size,
                        hzstd_source_location_t spawned_at);

// A context for the calling thread (C504): the runtime data of the thread and
// the task running on it, with the default settings. The result is a value of
// the caller's stack; pass its address to the `extern C` Haze function being
// called, for that call only (C400, C401). Panics on a thread Haze does not
// manage (C505). It is the one place the thread-local lookup happens (C502).
hzstd_context_t hzstd_context_for_current_thread(void);

// A module's task-local block in the task `ctx` runs: two loads and two checks
// inline (TL-3); the first access of a module in a task makes the block from
// its initial image (TL-5), the first in the process registers the module.
void *hzstd_tl_block_slow(hzstd_context_t *ctx, hzstd_tl_desc_t *desc);
static inline void *hzstd_tl_block(hzstd_context_t *ctx, hzstd_tl_desc_t *desc)
{
  size_t index = atomic_load_explicit(&desc->index, memory_order_relaxed);
  hzstd_task_t *task = ctx->task;
  void *block;
  if (index < task->tl_capacity && (block = task->tl_blocks[index]) != NULL) {
    return block;
  }
  return hzstd_tl_block_slow(ctx, desc);
}

// A task-local variable as an lvalue: the field of its module's block.
#define HZSTD_TL_FIELD(ctx, desc, block_type, field) \
  (((block_type *)hzstd_tl_block((ctx), &(desc)))->field)

// A module's per-thread block (S5-12: its module-level `let` variables) on
// the thread `ctx` runs on: the same two loads and checks, in the thread's
// table (its own index space); the first access of a module on a thread
// makes the block from its initial image (C518).
void *hzstd_tg_block_slow(hzstd_context_t *ctx, hzstd_tl_desc_t *desc);
static inline void *hzstd_tg_block(hzstd_context_t *ctx, hzstd_tl_desc_t *desc)
{
  size_t index = atomic_load_explicit(&desc->index, memory_order_relaxed);
  hzstd_thread_t *thread = ctx->thread;
  void *block;
  if (index < thread->global_capacity && (block = thread->global_blocks[index]) != NULL) {
    return block;
  }
  return hzstd_tg_block_slow(ctx, desc);
}

// A module-level `let` as an lvalue: the field of its module's block on the
// running thread.
#define HZSTD_TG_FIELD(ctx, desc, block_type, field) \
  (((block_type *)hzstd_tg_block((ctx), &(desc)))->field)

// What `sys.threadId()` is (C477): the process-unique id of the context's
// thread. `ctx` is a `hzstd_context_t *`, passed as `void *` so Haze can hand
// over `sys.contextPtr()` directly.
hzstd_int_t hzstd_thread_id(void *ctx);

// What `sys.log` is: writes through the context's logger. `ctx` as above.
void hzstd_log(void *ctx, hzstd_str_t text);

// hzstd_stackframe_t, hzstd_panic_type_t, hzstd_stacktrace_t,
// hzstd_panic_info_t, HZSTD_JMP_BUF/SETJMP/LONGJMP,
// hzstd_panic_recovery_cleanup_entry_t, hzstd_panic_recovery_frame_t are
// defined in hzstd_types.h.

// ── Thread-local panic stacktrace ────────────────────────────────────────────
//
// The panic machinery sets this on the panicking thread before longjmping to
// the nearest recovery frame.  Read it from the recover: label that follows a
// HAZE_ATTEMPT block.  NULL if no panic has reached this thread.
// The task the calling thread runs, NULL on a thread Haze does not manage.
// For the panic path only, which has no context: everything else reaches the
// task through the context it is handed (C502).
hzstd_task_t *hzstd_current_task(void);

// ── Recovery frame API ───────────────────────────────────────────────────────

int hzstd_panic_recovery_frame_count(void);
// `frame` is the caller's stack storage (see HAZE_ATTEMPT); nothing is allocated.
hzstd_panic_recovery_frame_t *hzstd_push_panic_recovery_frame(hzstd_context_t *ctx, hzstd_panic_recovery_frame_t *frame);
// The innermost frame of the task of `ctx`, taken off its stack.
hzstd_panic_recovery_frame_t *hzstd_pop_panic_recovery_frame(hzstd_context_t *ctx);
hzstd_panic_recovery_frame_t *hzstd_get_current_panic_recovery_frame(void);

void hzstd_panic_recovery_frame_push_cleanup(void (*fn)(void *), void *env);
void hzstd_panic_recovery_frame_pop_cleanup(void);

// Run all cleanup handlers registered on `frame` in registration order.
// Pass the frame explicitly so it can be called in the recovery path before
// the frame is popped.
void hzstd_panic_recovery_frame_run_cleanup(hzstd_panic_recovery_frame_t *frame);

// ── Generational stack references ────────────────────────────────────────────
//
// See hzstd_stackref_t / hzstd_gen_table_t in hzstd_types.h and the design of
// record in R&D/Storage Classes and References.md §4-§5.
//
// Only scopes that create a stackref to their own storage ("participating"
// scopes) call enter/exit; every other scope costs nothing. The compiler emits:
//
//   size_t __hz_slot = hzstd_stackref_scope_enter();   // scope entry
//   ...
//   hzstd_stackref_scope_exit();                       // every exit path
//
// and builds references as HZSTD_STACKREF_MAKE(&local, __hz_slot). A loop body
// that participates calls hzstd_stackref_scope_renew(slot) at the top of each
// iteration so a reference from iteration N cannot alias iteration N+1's
// storage. Every read/write through a stackref goes through HZSTD_STACKREF_DEREF.

hzstd_gen_table_t hzstd_gen_table_new(void);
size_t hzstd_stackref_scope_enter(hzstd_context_t *ctx);
void hzstd_stackref_scope_exit(hzstd_context_t *ctx);
void hzstd_stackref_scope_renew(hzstd_context_t *ctx, size_t slot);
size_t hzstd_stackref_held_count(hzstd_context_t *ctx);
void hzstd_stackref_unwind_to(hzstd_context_t *ctx, size_t held);
_Noreturn void hzstd_panic_bad_stackref(hzstd_thread_t *thread, hzstd_stackref_t ref);

#define HZSTD_STACKREF_IMMORTAL_SLOT ((uint64_t)0)
#define HZSTD_STACKREF_IMMORTAL_GEN ((uint64_t)1)

// A stackref is made on the thread whose context is at hand and records it
// (C280); it reads that thread's table.
#define HZSTD_STACKREF_MAKE(ctx, pointer, slot_)                                                                       \
  ((hzstd_stackref_t) { .ptr = (void *)(pointer),                                                                      \
                        .slot = ((uint64_t)(ctx)->thread->id << HZSTD_STACKREF_THREAD_SHIFT) | (uint64_t)(slot_),      \
                        .gen = (ctx)->thread->stackrefs.gens[(slot_)] })

#define HZSTD_STACKREF_IMMORTAL(ctx, pointer)                                                                          \
  ((hzstd_stackref_t) { .ptr = (void *)(pointer),                                                                      \
                        .slot = ((uint64_t)(ctx)->thread->id << HZSTD_STACKREF_THREAD_SHIFT) | HZSTD_STACKREF_IMMORTAL_SLOT, \
                        .gen = HZSTD_STACKREF_IMMORTAL_GEN })

// Using a stackref checks, before anything is accessed, that this thread owns
// it (C280) and that its scope is still alive (C261): one compare of the
// thread, then one of the generation.
#define HZSTD_STACKREF_VALID(thread, r)                                                                                \
  ((uint32_t)((r).slot >> HZSTD_STACKREF_THREAD_SHIFT) == (uint32_t)(thread)->id &&                                    \
   (thread)->stackrefs.gens[(uint32_t)(r).slot] == (r).gen)

#define HZSTD_STACKREF_DEREF(ctx, type, ref)                                                                           \
  ((type *)({                                                                                                          \
    hzstd_stackref_t __hz_r = (ref);                                                                                   \
    hzstd_thread_t *__hz_t = (ctx)->thread;                                                                            \
    if (__builtin_expect(!HZSTD_STACKREF_VALID(__hz_t, __hz_r), 0)) {                                                  \
      hzstd_panic_bad_stackref(__hz_t, __hz_r);                                                                        \
    }                                                                                                                  \
    __hz_r.ptr;                                                                                                        \
  }))

#define HZSTD_STACKREF_CHECK(ctx, ref)                                                                                 \
  do {                                                                                                                 \
    hzstd_stackref_t __hz_r = (ref);                                                                                   \
    hzstd_thread_t *__hz_t = (ctx)->thread;                                                                            \
    if (__builtin_expect(!HZSTD_STACKREF_VALID(__hz_t, __hz_r), 0)) {                                                  \
      hzstd_panic_bad_stackref(__hz_t, __hz_r);                                                                        \
    }                                                                                                                  \
  } while (0)

// ── HAZE_ATTEMPT macro ───────────────────────────────────────────────────────
//
// Usage:
//   HAZE_ATTEMPT(unique_id, recover_label, { ...body... });
//   // normal completion falls through here
//   goto done;
//   recover_label:
//     // the task's panic_info holds the panic's report (GC memory)
//     ...
//   done:
//
// Design notes:
// * HZSTD_SETJMP is used so that signal-mask is restored on Linux recovery.
// * cleanup handlers are run on the recovery path only (defer-on-panic).
// * the task's panic_info is set by the recovery's last step
//   (hzstd_panic_adopt_report: the report copied from the thread's record into
//   GC memory), so it is readable from the recover label even though the label
//   is outside this macro's scope.

// A plain block, deliberately NOT do{}while(0): a `break`/`continue` in the
// body must bind to the enclosing Haze loop, not to the macro. The frame is
// this block's own stack storage. The compiler pops it on every way out of
// the body (it is an entry on the same exit stack as stackref scopes:
// fall-through/goto, return, break, continue -- see CodeGenerator.ts), and
// the panic path pops it here; so control never reaches the end of this
// block, and a frame pointer never outlives its storage.
#define HAZE_ATTEMPT(id, recovery_label, body)                                                                         \
  {                                                                                                                    \
    hzstd_panic_recovery_frame_t __hz_frame_storage_##id;                                                              \
    hzstd_panic_recovery_frame_t *__hz_frame_##id = hzstd_push_panic_recovery_frame(__hz_ctx, &__hz_frame_storage_##id);\
    int __hz_jmp_##id = HZSTD_SETJMP(__hz_frame_##id->recovery_point);                                                 \
    if (__hz_jmp_##id == 0) {                                                                                          \
      body;                                                                                                            \
    }                                                                                                                  \
    else if (__hz_jmp_##id == 1) {                                                                                     \
      /* First: the allocation windows the longjmp left open are closed before anything can allocate. */             \
      hzstd_alloc_windows_restore(__hz_frame_##id->saved_alloc_window_depth);                                          \
      hzstd_panic_recovered(__hz_ctx);                                                                                 \
      /* The suspension windows and the mutex holds of the discarded code (holds: released, poisoned). */             \
      hzstd_suspension_windows_restore(__hz_ctx, __hz_frame_##id->saved_suspension_window_depth);                     \
      hzstd_held_locks_restore(__hz_ctx, __hz_frame_##id->saved_held_lock_count);                                      \
      /* The longjmp skipped every stackref scope exit between the panic site and here. */                             \
      hzstd_stackref_unwind_to(__hz_ctx, __hz_frame_##id->saved_stackref_count);                                       \
      /* ...and every computed evaluation and write delivery: see hzstd_reactive_state_t. */                           \
      hzstd_reactive_restore_state(__hz_ctx, &__hz_frame_##id->saved_reactive);                                        \
      hzstd_yield_gate_refresh(__hz_ctx);                                                                              \
      hzstd_panic_recovery_frame_run_cleanup(__hz_frame_##id);                                                         \
      hzstd_pop_panic_recovery_frame(__hz_ctx);                                                                        \
      /* Last: the report into GC memory, with the frame gone (a failure here goes to the next one out). */          \
      hzstd_panic_adopt_report(__hz_ctx, __hz_frame_##id);                                                             \
      goto recovery_label;                                                                                             \
    }                                                                                                                  \
    else {                                                                                                             \
      hzstd_panic_fmt("Unexpected longjmp result: %d", __hz_jmp_##id);                                                 \
    }                                                                                                                  \
    hzstd_trap_ccstr("HAZE_ATTEMPT body fell through without leaving its recovery frame");                           \
  }

// ── Panic functions ──────────────────────────────────────────────────────────
//
// All of these are safe to call from anywhere EXCEPT from signal/exception
// handlers on a thread with no remaining stack — use
// hzstd_panic_with_stacktrace directly there, which only touches globals (no
// meaningful stack allocation).

// Only reached when an assertion fails; the trace starts at the assertion.
_Noreturn void hzstd_assert_failed(void);

// Checked inline, so an assertion that holds costs a compare and a branch,
// not two calls: it guards every dynamic array access.
static inline void hzstd_assert(bool condition)
{
  if (__builtin_expect(!condition, 0)) {
    hzstd_assert_failed();
  }
}
void hzstd_assert_fmt(bool condition, const char *fmt, ...);
void hzstd_assert_fmt_n(bool condition, int skip_n_frames, const char *fmt, ...);
_Noreturn void hzstd_panic_fmt(const char *fmt, ...);
_Noreturn void hzstd_panic_fmt_n(int skip_n_frames, const char *fmt, ...);

_Noreturn void hzstd_panic(hzstd_ccstr_t msg);
_Noreturn void hzstd_panic_n(hzstd_ccstr_t msg, int skip_n_frames);
_Noreturn void hzstd_panic_str(hzstd_str_t msg);
_Noreturn void hzstd_panic_str_n(hzstd_str_t msg, int skip_n_frames);
_Noreturn void hzstd_unreachable(int skip_n_frames);

// ── Stacktrace API ───────────────────────────────────────────────────────────
//
// hzstd_build_stacktrace: capture the current call stack (frames only).
//   Returns hzstd_stacktrace_t by value; frames array inside is heap-allocated.
//   skip_n_frames: innermost frames to skip (pass 1 to hide this function).
//   NOT async-signal-safe.
hzstd_stacktrace_t hzstd_build_stacktrace(int skip_n_frames);

// Print only the "Stack trace:" section (no message/type header).
void hzstd_print_stacktrace(hzstd_stacktrace_t st);

// ── Raw reports (hzstd_types.h) ─────────────────────────────────────────────
void hzstd_raw_report_clear(hzstd_raw_report_t *report);
// Appends a frame (names cut to what the text buffer still holds); false
// once the report holds HZSTD_RAW_REPORT_FRAMES.
bool hzstd_raw_report_add_frame(hzstd_raw_report_t *report,
                                void *ip,
                                const char *name,
                                size_t name_length,
                                const char *file,
                                size_t file_length,
                                hzstd_int_t line);
void hzstd_raw_report_set_message(hzstd_raw_report_t *report, hzstd_str_t message);
// GC copies, for Haze; on a thread that may allocate GC memory.
hzstd_stacktrace_t hzstd_raw_report_to_stacktrace(const hzstd_raw_report_t *report);
hzstd_panic_info_t hzstd_raw_report_to_panic_info(const hzstd_raw_report_t *report);
// Printed to stderr without GC memory: the whole panic report, or only the
// "Stack trace:" section.
void hzstd_raw_report_print_panic(const hzstd_raw_report_t *report);
void hzstd_raw_report_print_trace(const hzstd_raw_report_t *report);
// Where a stalled task is (docs/async-runtime.md section 10): the frames from
// the innermost one of the program or a library (not the standard library,
// the runtime or the system) outwards, as a hash, and that frame's index
// (its display name: hzstd_raw_report_display_name).
uint64_t hzstd_raw_report_place(const hzstd_raw_report_t *report, size_t *place_frame);
size_t hzstd_raw_report_display_name(const hzstd_raw_report_t *report, size_t frame, char *out, size_t capacity);
// The current thread's report record: where a panic it can recover from is
// written (its scheduler's), NULL on a thread without a scheduler.
hzstd_raw_report_t *hzstd_thread_panic_report(void);
// The last step of a recovery: the task takes the panic's report from its
// thread's record into GC memory (task->panic_info), after the recovery
// frame is popped, so a failure here goes to the next frame out.
void hzstd_panic_adopt_report(hzstd_context_t *ctx, const hzstd_panic_recovery_frame_t *frame);

// Stringify only the "Stack trace:" section (no message/type header).
// Pass hzstd_make_heap_allocator() for a persistent result.
hzstd_str_t hzstd_stringify_stacktrace(hzstd_allocator_t alloc, hzstd_stacktrace_t st);

// Print the full panic report: "[FATAL]" header + message + "Stack trace:" +
// frames.
void hzstd_print_panic_info(hzstd_panic_info_t info);

// Stringify the full panic report (same layout as hzstd_print_panic_info).
hzstd_str_t hzstd_stringify_panic_info(hzstd_allocator_t alloc, hzstd_panic_info_t info);

// ── Internal: used by the worker thread ──────────────────────────────────────

// ── hzstd_trap_* — hard trap with no stacktrace ──────────────────────────────
//
// These are cold, static, and inline so they are duplicated in every
// translation unit and can be inlined directly.  Use only for internal
// invariant violations where the panic machinery itself might be broken.

void hzstd_print_stderr_cstr(const char *str);
void hzstd_print_stderr_str(hzstd_str_t str);
void hzstd_flush_stderr();

__attribute__((noreturn, cold)) static inline _Noreturn void hzstd_trap_ccstr(hzstd_ccstr_t msg)
{
  hzstd_print_stderr_cstr("Runtime error: ");
  hzstd_print_stderr_cstr(msg);
  hzstd_print_stderr_cstr("\n");
  hzstd_flush_stderr();
  __builtin_trap();
}

__attribute__((noreturn, cold)) static inline _Noreturn void hzstd_trap_cstr(hzstd_cstr_t msg)
{
  hzstd_trap_ccstr(msg);
}

__attribute__((noreturn, cold)) static inline _Noreturn void hzstd_trap_str(hzstd_str_t msg)
{
  hzstd_print_stderr_cstr("Runtime error: ");
  hzstd_print_stderr_str(msg);
  hzstd_print_stderr_cstr("\n");
  hzstd_flush_stderr();
  __builtin_trap();
}

// ── Refinement assertion macros ──────────────────────────────────────────────

#define HZ_GET_UNION_TAG(union_expr, tag_idx, expected_name, tag_name_fn)                                              \
  (*(__extension__({                                                                                                   \
    __typeof__(union_expr) *__hz_uptr = &(union_expr);                                                                 \
    if (__hz_uptr->tag != (tag_idx))                                                                                   \
      hzstd_panic_fmt("Haze runtime assertion failed: union refinement invalidated"                                    \
                      " - expected active variant '%s' from previous refinement, but "                                 \
                      "found active variant '%s' at access site; the value was modified"                               \
                      " after refinement and no longer satisfies the compiler's narrowing"                             \
                      " assumptions.",                                                                                 \
                      (expected_name),                                                                                 \
                      (tag_name_fn)(__hz_uptr->tag));                                                                  \
    &__hz_uptr->as_tag_##tag_idx;                                                                                      \
  })))

#define HZ_ASSERT_UNION_SET(union_expr, condition_expr, mapping_fn, valid_set_str, tag_name_fn)                        \
  (__extension__({                                                                                                     \
    __typeof__(union_expr) __hz_tmp = (union_expr);                                                                    \
    if (!(condition_expr))                                                                                             \
      hzstd_panic_fmt("Haze runtime assertion failed: union refinement invalidated"                                    \
                      " - expected active variant to remain within narrowed union subset"                              \
                      " '{%s}', but found active variant '%s' at access site; the value"                               \
                      " was modified after refinement and no longer satisfies the"                                     \
                      " compiler's narrowing assumptions.",                                                            \
                      (valid_set_str),                                                                                 \
                      (tag_name_fn)(__hz_tmp.tag));                                                                    \
    mapping_fn(__hz_tmp);                                                                                              \
  }))

#define HZ_ASSERT_INT_RANGE(expr, target_type, cond, target_name, fmt_spec)                                            \
  (__extension__({                                                                                                     \
    __typeof__(expr) __hz_tmp = (expr);                                                                                \
    if (cond)                                                                                                          \
      hzstd_panic_fmt("Haze runtime assertion failed: integer refinement invalidated"                                  \
                      " - expected value to remain within narrowed range for cast to"                                  \
                      " '%s', but found value %" fmt_spec                                                              \
                      " at cast site; the value was modified after refinement and no"                                  \
                      " longer satisfies the compiler's narrowing assumptions.",                                       \
                      (target_name),                                                                                   \
                      __hz_tmp);                                                                                       \
    (target_type) __hz_tmp;                                                                                            \
  }))

hzstd_str_t hzstd_errno_to_str(int err);

#endif // HZSTD_RUNTIME_H
