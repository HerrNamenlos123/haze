
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
void hzstd_task_spawn(hzstd_context_t *ctx, hzstd_task_entry_t entry, void *arg, bool background, hzstd_future_core_t *future);
// Lets every task that is ready run first (C243).
void hzstd_task_yield(hzstd_context_t *ctx);
// Suspends the calling task for `ms` milliseconds of the thread's event loop
// (time.sleep, C301): a libuv timer readies it.
void hzstd_task_sleep_ms(hzstd_context_t *ctx, uint64_t ms);
// A future's shared core: its state and the tasks waiting for it.
hzstd_future_core_t *hzstd_future_core_new(void);
hzstd_int_t hzstd_future_state(hzstd_future_core_t *core);
// Settles a pending future with its value; panics if it is settled (C444).
void hzstd_future_complete(hzstd_context_t *ctx, hzstd_future_core_t *core);
// Suspends the calling task until the future is settled; returns its state.
hzstd_int_t hzstd_future_wait(hzstd_context_t *ctx, hzstd_future_core_t *core);
// For the fault handler: where it interrupted (NULL clears it), and the stack
// of the running task (NULL if none). Both async-signal-safe.
void hzstd_sched_note_interrupted_sp(void *sp);
const fiber_stack *hzstd_current_task_stack(void);

// sys.yieldAfter (docs/async-runtime.md section 2), called inline by
// generated code under its Haze name: one load and one compare, no clock
// read, no call, unless the task has run longer than `seconds` since its last
// switch (as the stall watchdog measured it, 5 ms precision); then it yields.
static inline void yieldAfter(hzstd_context_t *ctx, hzstd_real_t seconds)
{
  if (__builtin_expect(atomic_load_explicit(&ctx->thread->running_for, memory_order_relaxed) > seconds, 0)) {
    hzstd_task_yield(ctx);
  }
}
// sys.exit: a graceful exit with `status` (0 to 255, else it panics): this
// task stops here, its thread stops every other task at its suspension, the
// thread's last task runs, then the process ends with `status` (C521, C576,
// C586). The first status is final.
_Noreturn void hzstd_task_exit(hzstd_context_t *ctx, hzstd_int_t status);
// The status of a graceful exit that has started, or -1.
int hzstd_exit_status(void);
// sys.abort: ends the process at once, status 134, no cleanup (C547, C574).
_Noreturn void hzstd_abort(void);
// sys.timeSinceTaskSwitch: the same measurement, in seconds.
hzstd_real_t hzstd_time_since_task_switch(hzstd_context_t *ctx);

// The id for a thread Haze starts: process-unique, never reused, from 2 on.
uint64_t hzstd_next_thread_id(void);

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
// Pre-sizes this thread's frame stack (64 frames); called at startup for the main thread.
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
//     // the task's panic_info holds the stacktrace, or NULL if not set
//     ...
//   done:
//
// Design notes:
// * HZSTD_SETJMP is used so that signal-mask is restored on Linux recovery.
// * cleanup handlers are run on the recovery path only (defer-on-panic).
// * the task's panic_info is set by the panic machinery
//   before longjmping, so it is readable from the recover label even though
//   the label is outside this macro's scope.

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
      /* the panic machinery already set the task's panic_info */                                                      \
      /* The longjmp skipped every stackref scope exit between the panic site and here. */                             \
      hzstd_stackref_unwind_to(__hz_ctx, __hz_frame_##id->saved_stackref_count);                                       \
      /* ...and every computed evaluation and write delivery: see hzstd_reactive_state_t. */                           \
      hzstd_reactive_restore_state(__hz_ctx, &__hz_frame_##id->saved_reactive);                                        \
      hzstd_panic_recovery_frame_run_cleanup(__hz_frame_##id);                                                         \
      hzstd_pop_panic_recovery_frame(__hz_ctx);                                                                        \
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

// Stringify only the "Stack trace:" section (no message/type header).
// Pass hzstd_make_heap_allocator() for a persistent result.
hzstd_str_t hzstd_stringify_stacktrace(hzstd_allocator_t alloc, hzstd_stacktrace_t st);

// Print the full panic report: "[FATAL]" header + message + "Stack trace:" +
// frames.
void hzstd_print_panic_info(hzstd_panic_info_t info);

// Stringify the full panic report (same layout as hzstd_print_panic_info).
hzstd_str_t hzstd_stringify_panic_info(hzstd_allocator_t alloc, hzstd_panic_info_t info);

// ── Internal: used by the worker thread ──────────────────────────────────────
void hzstd_print_panic_report(hzstd_panic_info_t *info);

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
