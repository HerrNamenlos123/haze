
#ifndef HZSTD_TYPES_H
#define HZSTD_TYPES_H

// This header contains every hzstd type/struct/enum definition and nothing
// else -- no function declarations, no macros that call a function. It is
// always available in every generated C file, regardless of whether the
// stdlib's function layer is statically linked or reached through a
// dynamically loaded plugin's imported function pointers, because a type
// definition has no linkage/instance to duplicate.
//
// Only freestanding, compiler-provided headers may be included here (never
// glibc/libc): stdint.h, stddef.h, stdbool.h, stdalign.h, setjmp.h define
// types only and require no linked symbol just to be named.

#include <setjmp.h>
#include <stdalign.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// ── Scalars ──────────────────────────────────────────────────────────────────

typedef bool hzstd_bool_t;

typedef int8_t hzstd_i8_t;
typedef int16_t hzstd_i16_t;
typedef int32_t hzstd_i32_t;
typedef int64_t hzstd_i64_t;
typedef int64_t hzstd_int_t;
typedef uint8_t hzstd_u8_t;
typedef uint16_t hzstd_u16_t;
typedef uint32_t hzstd_u32_t;
typedef uint64_t hzstd_u64_t;
typedef uint64_t hzstd_usize_t;

typedef float hzstd_f32_t;
typedef double hzstd_f64_t;
typedef double hzstd_real_t;

typedef void hzstd_void_t;
typedef void *hzstd_cptr_t;
typedef char *hzstd_cstr_t;
typedef const char *hzstd_ccstr_t;

typedef struct hzstd_null_t {
  hzstd_u8_t dummy;
} hzstd_null_t;

typedef struct hzstd_none_t {
  hzstd_u8_t dummy;
} hzstd_none_t;

#define HZSTD_MAX(a, b) ((a) > (b) ? (a) : (b))

// ── String ───────────────────────────────────────────────────────────────────

typedef struct hzstd_str_t {
  const char *data;
  // Signed to match Haze's `str.length: int` -- keeping this unsigned (as a
  // raw size_t would suggest) let comparisons like `str.length > -1` silently
  // do the wrong thing, since C promotes the signed side to unsigned instead
  // of performing the signed comparison Haze's type system promises.
  int64_t length;
} hzstd_str_t;

// The purpose of this struct is to wrap a hzstd_str in an object which can be
// passed around by reference. To be used if you actually want a 'hzstd_str*'
// for an out-parameter. Hint: 'hzstd_str*' cannot be used directly since
// hzstd_str is not a normal object but mapped to the 'str' primitive.
typedef struct {
  hzstd_str_t data;
} hzstd_str_ref_t;

#define HZSTD_STRING(str, len) ((hzstd_str_t){.data = str, .length = len})

#define HZSTD_STRING_SLICE(string, start, end)                                \
  ({                                                                          \
    hzstd_str_t __hz_str = (string);                                           \
    _HU2_hzstd_int_t_hzstd_none_t __hz_start = (start);                        \
    _HU2_hzstd_int_t_hzstd_none_t __hz_end = (end);                            \
                                                                               \
    hzstd_int_t __start = 0;                                                   \
    hzstd_int_t __end = __hz_str.length;                                       \
                                                                               \
    if (__hz_start.tag == 0)                                                   \
      __start = __hz_start.as_tag_0;                                           \
                                                                               \
    if (__hz_end.tag == 0)                                                     \
      __end = __hz_end.as_tag_0;                                               \
                                                                               \
    if (__start < 0)                                                           \
      __start += __hz_str.length;                                              \
    if (__end < 0)                                                             \
      __end += __hz_str.length;                                                \
                                                                               \
    if (__start < 0)                                                           \
      __start = 0;                                                             \
    if (__start > __hz_str.length)                                             \
      __start = __hz_str.length;                                               \
                                                                               \
    if (__end < 0)                                                             \
      __end = 0;                                                               \
    if (__end > __hz_str.length)                                               \
      __end = __hz_str.length;                                                 \
                                                                               \
    if (__end < __start)                                                       \
      __end = __start;                                                         \
                                                                               \
    HZSTD_STRING(__hz_str.data + __start, __end - __start);                    \
  })

#define HZSTD_STRING_CONTAINS(string, search, startIndex)                      \
  ({                                                                          \
    hzstd_str_t __hz_str = (string);                                           \
    hzstd_str_t __hz_search = (search);                                        \
    _HU2_hzstd_int_t_hzstd_none_t __hz_start_index = (startIndex);             \
                                                                               \
    hzstd_int_t __start = 0;                                                   \
    if (__hz_start_index.tag == 0) {                                           \
      __start = __hz_start_index.as_tag_0;                                     \
    }                                                                          \
                                                                               \
    if (__start < 0) {                                                         \
      __start = 0;                                                             \
    }                                                                          \
    if (__start > __hz_str.length) {                                           \
      __start = __hz_str.length;                                               \
    }                                                                          \
                                                                               \
    bool __result = false;                                                     \
                                                                               \
    if (__hz_search.length == 0) {                                             \
      __result = true;                                                         \
    } else if (__hz_search.length <= __hz_str.length) {                        \
      for (; __start <= __hz_str.length - __hz_search.length; __start++) {     \
        bool __match = true;                                                   \
                                                                               \
        for (hzstd_int_t __i = 0; __i < __hz_search.length; __i++) {           \
          if (__hz_str.data[__start + __i] != __hz_search.data[__i]) {         \
            __match = false;                                                   \
            break;                                                             \
          }                                                                    \
        }                                                                      \
                                                                               \
        if (__match) {                                                         \
          __result = true;                                                     \
          break;                                                               \
        }                                                                      \
      }                                                                        \
    }                                                                          \
                                                                               \
    __result;                                                                  \
  })

#define HZSTD_STRING_STARTS_WITH(string, search, position)                     \
  ({                                                                          \
    hzstd_str_t __hz_str = (string);                                           \
    hzstd_str_t __hz_search = (search);                                        \
    _HU2_hzstd_int_t_hzstd_none_t __hz_position = (position);                  \
                                                                               \
    hzstd_int_t __position = 0;                                                \
    if (__hz_position.tag == 0) {                                              \
      __position = __hz_position.as_tag_0;                                     \
    }                                                                          \
                                                                               \
    if (__position < 0)                                                        \
      __position = 0;                                                          \
    if (__position > __hz_str.length)                                          \
      __position = __hz_str.length;                                            \
                                                                               \
    bool __result = false;                                                     \
                                                                               \
    if (__hz_search.length == 0) {                                             \
      __result = true;                                                         \
    } else if (__position + __hz_search.length <= __hz_str.length) {           \
      __result = true;                                                         \
                                                                               \
      for (hzstd_int_t __i = 0; __i < __hz_search.length; __i++) {             \
        if (__hz_str.data[__position + __i] != __hz_search.data[__i]) {        \
          __result = false;                                                    \
          break;                                                               \
        }                                                                      \
      }                                                                        \
    }                                                                          \
                                                                               \
    __result;                                                                  \
  })

#define HZSTD_STRING_ENDS_WITH(string, search, endPosition)                    \
  ({                                                                          \
    hzstd_str_t __hz_str = (string);                                           \
    hzstd_str_t __hz_search = (search);                                        \
    _HU2_hzstd_int_t_hzstd_none_t __hz_end_position = (endPosition);           \
                                                                               \
    hzstd_int_t __end = __hz_str.length;                                       \
    if (__hz_end_position.tag == 0) {                                          \
      __end = __hz_end_position.as_tag_0;                                      \
    }                                                                          \
                                                                               \
    if (__end < 0)                                                             \
      __end = 0;                                                               \
    if (__end > __hz_str.length)                                               \
      __end = __hz_str.length;                                                 \
                                                                               \
    bool __result = false;                                                     \
                                                                               \
    if (__hz_search.length == 0) {                                             \
      __result = true;                                                         \
    } else if (__hz_search.length <= __end) {                                  \
      hzstd_int_t __offset = __end - __hz_search.length;                       \
      __result = true;                                                         \
                                                                               \
      for (hzstd_int_t __i = 0; __i < __hz_search.length; __i++) {             \
        if (__hz_str.data[__offset + __i] != __hz_search.data[__i]) {          \
          __result = false;                                                    \
          break;                                                               \
        }                                                                      \
      }                                                                        \
    }                                                                          \
                                                                               \
    __result;                                                                  \
  })

// ASCII whitespace, matching the byte-oriented scope of the rest of this
// file (the other string macros operate on raw bytes, not decoded Unicode
// codepoints).
static inline bool hzstd_str_is_whitespace_byte(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' ||
         c == '\f';
}

#define HZSTD_STRING_TRIM_START(string)                                       \
  ({                                                                          \
    hzstd_str_t __hz_str = (string);                                         \
    hzstd_int_t __hz_start = 0;                                              \
                                                                              \
    while (__hz_start < __hz_str.length &&                                   \
           hzstd_str_is_whitespace_byte(__hz_str.data[__hz_start])) {        \
      __hz_start++;                                                          \
    }                                                                        \
                                                                              \
    HZSTD_STRING(__hz_str.data + __hz_start, __hz_str.length - __hz_start);  \
  })

#define HZSTD_STRING_TRIM_END(string)                                        \
  ({                                                                         \
    hzstd_str_t __hz_str = (string);                                        \
    hzstd_int_t __hz_end = __hz_str.length;                                 \
                                                                              \
    while (__hz_end > 0 &&                                                  \
           hzstd_str_is_whitespace_byte(__hz_str.data[__hz_end - 1])) {     \
      __hz_end--;                                                           \
    }                                                                       \
                                                                              \
    HZSTD_STRING(__hz_str.data, __hz_end);                                  \
  })

#define HZSTD_STRING_TRIM(string)                                           \
  ({                                                                        \
    hzstd_str_t __hz_str = (string);                                       \
    hzstd_int_t __hz_start = 0;                                            \
    hzstd_int_t __hz_end = __hz_str.length;                                \
                                                                             \
    while (__hz_start < __hz_end &&                                        \
           hzstd_str_is_whitespace_byte(__hz_str.data[__hz_start])) {      \
      __hz_start++;                                                        \
    }                                                                      \
    while (__hz_end > __hz_start &&                                        \
           hzstd_str_is_whitespace_byte(__hz_str.data[__hz_end - 1])) {    \
      __hz_end--;                                                          \
    }                                                                      \
                                                                             \
    HZSTD_STRING(__hz_str.data + __hz_start, __hz_end - __hz_start);       \
  })

// ── Module metadata ──────────────────────────────────────────────────────────

// One entry per exported function: its callable name (mangled Haze name, or
// the bare C name for `export extern C fn`) paired with a function pointer.
// The pointer is untyped -- the name fully determines the real signature.
typedef struct hzstd_module_function_entry_t {
  hzstd_str_t name;
  void *function_ptr;
} hzstd_module_function_entry_t;

typedef struct hzstd_module_function_table_t {
  const hzstd_module_function_entry_t *entries;
  hzstd_usize_t count;
} hzstd_module_function_table_t;

// The single genuinely-exported symbol per module. `functions` holds raw
// function pointers; `trampoline_functions` holds the same entries in the
// same order, pointing at generated wrapper functions instead (used once
// hot-reload refcounting hooks land).
typedef struct hzstd_module_metadata_t {
  hzstd_str_t module_id;   // 8-character mixed-case alphanumeric, from haze.toml
  hzstd_str_t module_name; // from haze.toml
  hzstd_str_t version;     // from haze.toml
  hzstd_module_function_table_t functions;
  hzstd_module_function_table_t trampoline_functions;
} hzstd_module_metadata_t;

// ── Allocator / arena ────────────────────────────────────────────────────────

typedef struct hzstd_allocator_t {
  void* (*allocate)(void* ctx, size_t size);
  void* (*allocateAtomic)(void* ctx, size_t size);
  void* ctx;
} hzstd_allocator_t;

typedef struct hzstd_arena_chunk_t {
  struct hzstd_arena_chunk_t* next_chunk;
  size_t capacity;
  size_t used;
  // After here comes the data
  // dataPointer = chunkPointer + sizeof(ArenaChunk)
} hzstd_arena_chunk_t;

typedef struct hzstd_arena_t {
  hzstd_arena_chunk_t* first_chunk;
  hzstd_arena_chunk_t* last_chunk;
} hzstd_arena_t;

// ── Dynamic array ────────────────────────────────────────────────────────────

/*
 * Dynamic arrays are GC-managed mutable objects.
 *
 * - The control structure is allocated using the provided allocator.
 * - The backing buffer is always allocated on the GC heap and may be
 *   reallocated independently of the allocator used for the control structure.
 *
 * This design avoids conflicts between realloc semantics and arena allocation.
 */
typedef struct {
  void *buffer;
  size_t elem_size;
  size_t size;
  size_t capacity;
} hzstd_dynamic_array_t;

// This type is to be used for encoding the actual type in the code, so we know
// what it is, even if actually irrelevant.
#define HZSTD_DARRAY(arraytype) hzstd_dynamic_array_t *

typedef enum {
  hzstd_dynamic_array_result_ok,
  hzstd_dynamic_array_result_max_array_size,
  hzstd_dynamic_array_result_out_of_memory,
  hzstd_dynamic_array_result_out_of_bounds,
} hzstd_dynamic_array_result_t;

// ── Source location ──────────────────────────────────────────────────────────

typedef struct {
    hzstd_str_t _filename;  /* empty string = absent */
    hzstd_int_t _line;      /* 0 = absent (real lines are 1-indexed) */
    hzstd_int_t _column;    /* 0 = absent */
} hzstd_source_location_t;

// ── Stack frame / panic ──────────────────────────────────────────────────────

typedef struct {
  size_t id;
  hzstd_cptr_t instructionPointer;
  hzstd_str_t name;
  hzstd_source_location_t sourceloc; /* absent when _filename.length == 0 */
} hzstd_stackframe_t;

typedef enum {
  // This must match with system.hz!!!
  hzstd_panic_type_unknown = 0,
  hzstd_panic_type_user = 1,
  hzstd_panic_type_segfault = 2,
  hzstd_panic_type_stackoverflow = 3,
  hzstd_panic_type_arithmetic = 4,
} hzstd_panic_type_t;

// Captured stack frames (value type — no heap allocation for the wrapper).
// The frames array inside IS heap-allocated; the struct itself is a value.
typedef struct {
  hzstd_dynamic_array_t* frames; /* hzstd_stackframe_t[], heap-allocated */
  hzstd_int_t skip_n_frames;
} hzstd_stacktrace_t;

// Full panic context: message, type, and frames (value type).
typedef struct {
  hzstd_stacktrace_t stacktrace;
  hzstd_str_t message;
  hzstd_panic_type_t type;
} hzstd_panic_info_t;

// We use plain jmp_buf / setjmp / longjmp on all platforms.  On Linux the
// signal mask is restored manually after longjmp (see hzstd_platform_linux.c)
// so sigjmp_buf is not needed in this shared header.
#define HZSTD_JMP_BUF jmp_buf
#define HZSTD_SETJMP(buf) setjmp(buf)
#define HZSTD_LONGJMP(buf, v) longjmp((buf), (v))

typedef struct {
  void (*fn)(void*);
  void* env;
} hzstd_panic_recovery_cleanup_entry_t;

typedef struct {
  hzstd_dynamic_array_t* cleanup_handlers; /* hzstd_panic_recovery_cleanup_entry_t[] */
  HZSTD_JMP_BUF recovery_point;
  hzstd_panic_info_t _hz_panic_stacktrace; /* filled before longjmp */
} hzstd_panic_recovery_frame_t;

// ── Meta ─────────────────────────────────────────────────────────────────────

typedef struct {
  hzstd_str_t name;
} hzstd_meta_field_t;

typedef enum {
  hzstd_meta_type_category_internal = 0,
  hzstd_meta_type_category_namespace = 1,
  hzstd_meta_type_category_struct = 2,
  hzstd_meta_type_category_enum = 3,
  hzstd_meta_type_category_primitive = 4,
  hzstd_meta_type_category_function = 5,
  hzstd_meta_type_category_callable = 6,
  hzstd_meta_type_category_array = 7,
  hzstd_meta_type_category_slice = 8,
  hzstd_meta_type_category_union = 9,
  hzstd_meta_type_category_reactive = 10,
  hzstd_meta_type_category_generic = 11,
  hzstd_meta_type_category_literal = 12,
  hzstd_meta_type_category_parameter_pack = 13,
  hzstd_meta_type_category_dynamic_array = 16,
} hzstd_meta_type_category_t;

// ── Demangle ─────────────────────────────────────────────────────────────────

#define HZSTD_DEMANGLE_MAX_SEGMENTS 32

typedef struct {
  hzstd_str_t name;        /* segment name, view into the original symbol */
  bool        isModule;    /* true for HM-encoded module namespace segment */
  hzstd_str_t moduleId;    /* only valid when isModule -- always exactly 8 chars */
  hzstd_str_t moduleName;  /* only valid when isModule */
  hzstd_str_t moduleMajor;
  hzstd_str_t moduleMinor;
  hzstd_str_t modulePatch;
} hzstd_demangle_segment_t;

typedef struct {
  bool success;

  /* Module namespace info (absent when !hasModule) */
  bool        hasModule;
  hzstd_str_t moduleId; /* always exactly 8 chars */
  hzstd_str_t moduleName;
  hzstd_str_t moduleVersion; /* "major.minor.patch", allocated */

  /* Remaining segments (function / sub-namespace names) */
  size_t                     segmentCount;
  hzstd_demangle_segment_t   segments[HZSTD_DEMANGLE_MAX_SEGMENTS];

  /* True when the symbol looks like an anonymous callable */
  bool isAnonymous;

  /* True when a parameter list was present */
  bool hasParams;
} hzstd_demangle_result_t;

// ── Env ──────────────────────────────────────────────────────────────────────

typedef struct {
  bool found;
  hzstd_str_t value;
} hzstd_env_get_result_t;

// ── Filesystem ───────────────────────────────────────────────────────────────

typedef enum {
  hzstd_fs_error_code_none = 0,

  hzstd_fs_error_code_not_found, // path does not exist
  hzstd_fs_error_code_not_a_file, // exists but not a regular file
  hzstd_fs_error_code_not_a_directory, // exists but not a directory
  hzstd_fs_error_code_permission_denied,
  hzstd_fs_error_code_already_exists,
  hzstd_fs_error_code_invalid_path, // malformed path, invalid characters, etc.
  hzstd_fs_error_code_name_too_long,
  hzstd_fs_error_code_io_error, // generic read/write failure
  hzstd_fs_error_code_out_of_memory,
} hzstd_fs_error_code_t;

typedef struct {
  hzstd_fs_error_code_t code;
  hzstd_str_t message;
} hzstd_fs_error_t;

// Options controlling overwrite behavior, symlink handling, and error skipping.
typedef struct hzstd_fs_copy_options {
  bool overwrite; // true = overwrite existing files, false = fail if exists
  bool follow_symlinks; // true = follow symlinks, false = copy symlinks as-is
  bool skip_errors; // true = skip files that cannot be copied, false = fail
} hzstd_fs_copy_options_t;

typedef struct {
  bool exists;
  hzstd_fs_error_t error;
} hzstd_fs_exists_result_t;

typedef struct {
  bool exists;
  int64_t mtime_ns; // modification time (nanoseconds since Unix epoch)
  int64_t size; // file size in bytes
} hzstd_file_stat_t;

typedef struct {
  void* handle; // malloc'd internal struct; freed by hzstd_close_dir
  hzstd_fs_error_code_t error;
} hzstd_open_dir_result_t;

typedef struct {
  bool valid;
  bool is_dir;
  hzstd_str_t name; // GC-owned via hzstd_cstr_dup
} hzstd_dir_entry_t;

// ── Platform ─────────────────────────────────────────────────────────────────

// Opaque handle: concrete layout (sem_t on Linux, HANDLE on win32) is private
// to hzstd_platform_linux.c / hzstd_platform_win32.c. Callers only ever see a
// pointer, obtained from hzstd_create_semaphore and released with
// hzstd_destroy_semaphore -- this is what lets the semaphore API be used from
// just the type layer + the hzstd function-pointer table, with no knowledge
// of which platform is underneath.
typedef struct hzstd_semaphore_t hzstd_semaphore_t;

typedef hzstd_u64_t hzstd_thread_id_t;
typedef hzstd_u64_t hzstd_process_id_t;

typedef enum {
  hzstd_platform_runtime_unknown = 0,
  hzstd_platform_runtime_linux = 1,
  hzstd_platform_runtime_win32 = 2,
} hzstd_platform_runtime_t;

typedef struct {
  int exit_code;
  char* stdout_data;
  char* stderr_data;
} hzstd_process_result_t;

typedef struct {
  void* handle; /* opaque hzstd_process_t*, NULL on failure */
  int error_code; /* 0 on success */
  char* error_message; /* GC string, may be NULL */
} hzstd_process_spawn_result_t;

// ── Profiling ────────────────────────────────────────────────────────────────

// This struct is the temporary profiling context that is used during profiling, it contains
// intermediate, dirty, partial results only. It will be postprocessed when profiling is done.
typedef struct hzstd_profiling_context_t hzstd_profiling_context_t;

// One interned, resolved call site. Frames are deduplicated by instruction pointer across the
// whole profiling session, so each unique function appears here exactly once no matter how many
// samples observed it. Samples reference frames by index (see hzstd_profiling_sample_t::frames).
typedef struct {
  hzstd_cptr_t address;
  hzstd_str_t name;
  hzstd_source_location_t sourceloc; /* absent when _filename.length == 0 */
} hzstd_profiling_frame_t;

// One postprocessed sample.
//   timestamp:          hzstd_time_now() taken as close to the suspension point as possible
//                        (start of the signal handler), in seconds since program start.
//   sampling_duration:  wall time the signal handler + stackwalker spent capturing this sample,
//                        i.e. how much this single sample perturbed the profiled program.
//   frames:             hzstd_int_t[], indices into the owning hzstd_profiling_result_t.frames
//                        table, innermost frame first.
//   truncated:          true if the real call stack was deeper than what could be captured (see
//                        HZSTD_PROFILING_PERF_STACK_SIZE on Linux) -- `frames` holds only the
//                        innermost frames that fit; everything above them is real but missing,
//                        not fabricated. Always false on Windows (no such cap there).
//   lost_before:        how many samples the kernel reports it lost (PERF_RECORD_LOST) immediately
//                        before this one, or 0 if none -- a hard fact from the kernel (unlike
//                        truncated/off-cpu, which are inferred), meaning real code ran during the
//                        gap before this sample but we have no record of what it was. Always 0 on
//                        Windows.
typedef struct {
  hzstd_real_t timestamp;
  hzstd_real_t sampling_duration;
  hzstd_dynamic_array_t* frames;
  bool truncated;
  hzstd_int_t lost_before;
} hzstd_profiling_sample_t;

// This struct is the final result of profiling after postprocessing,
// neatly arranged into a format it is useful to work with.
typedef struct {
  hzstd_dynamic_array_t* frames; /* hzstd_profiling_frame_t[], interned/deduplicated */
  hzstd_dynamic_array_t* samples; /* hzstd_profiling_sample_t[] */
  hzstd_int_t sampling_rate_hz;
} hzstd_profiling_result_t;

// ── Reactive ─────────────────────────────────────────────────────────────────

typedef void* (*hzstd_computed_fn_t)(void* env);

typedef struct hzstd_dep_edge_t hzstd_dep_edge_t;
typedef struct hzstd_cell_dep_t hzstd_cell_dep_t;
typedef struct hzstd_reactive_cell_t hzstd_reactive_cell_t;
typedef struct hzstd_computed_node_t hzstd_computed_node_t;

typedef struct hzstd_node_t hzstd_node_t;

struct hzstd_dep_edge_t {
  hzstd_node_t* node;
  hzstd_dep_edge_t* next;
};

struct hzstd_node_t {
  hzstd_dep_edge_t* dependents;
};

struct hzstd_cell_dep_t {
  hzstd_node_t* node;
  struct hzstd_cell_dep_t* next;
};

struct hzstd_reactive_cell_t {
  hzstd_node_t base;
  void* value;
};

struct hzstd_computed_node_t {
  hzstd_node_t base;

  int dirty;
  void* cached;

  hzstd_computed_fn_t fn;
  void* env;

  hzstd_cell_dep_t* deps;
};

// ── Regex ────────────────────────────────────────────────────────────────────

typedef struct {
  const uint8_t* data;
  size_t size;
  void* code; // pcre2_code
} hzstd_regex_blob_t;

// This corresponds to the compiler-builtin primitive 'Regex'
typedef struct {
  hzstd_regex_blob_t* blob;
} hzstd_regex_t;

typedef struct {
  size_t start;
  size_t end;
} hzstd_regex_span_t;

typedef struct {
  hzstd_regex_span_t span;
  hzstd_str_t text;
  hzstd_bool_t present;
} hzstd_regex_group_t;

typedef struct {
  hzstd_regex_span_t span;
  hzstd_str_t text;
  HZSTD_DARRAY(hzstd_regex_group_t) groups;
} hzstd_regex_find_match_t;

typedef struct {
  int found;
  // If found == false, the 'match' object is garbage and not allowed to be accessed!!! (array is null)
  hzstd_regex_find_match_t match;
} hzstd_regex_find_one_result_t;

// ── Utils (color / vector) ───────────────────────────────────────────────────

typedef struct {
  hzstd_real_t r;
  hzstd_real_t g;
  hzstd_real_t b;
  hzstd_real_t a;
} hzstd_color_t;

typedef struct {
  hzstd_f32_t r;
  hzstd_f32_t g;
  hzstd_f32_t b;
  hzstd_f32_t a;
} hzstd_colorf_t;

typedef struct {
  hzstd_real_t x;
  hzstd_real_t y;
} hzstd_vec2_t;

typedef struct {
  hzstd_f32_t x;
  hzstd_f32_t y;
} hzstd_vec2f_t;

typedef struct {
  hzstd_int_t x;
  hzstd_int_t y;
} hzstd_vec2i_t;

typedef struct {
  hzstd_real_t x;
  hzstd_real_t y;
  hzstd_real_t z;
} hzstd_vec3_t;

// ── JSON (opaque) ────────────────────────────────────────────────────────────

typedef struct hzstd_json_node_t hzstd_json_node_t;

#endif // HZSTD_TYPES_H
