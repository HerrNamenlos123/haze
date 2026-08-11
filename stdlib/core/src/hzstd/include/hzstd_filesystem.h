
#ifndef HZSTD_FILESYSTEM_H
#define HZSTD_FILESYSTEM_H

#include "../hzstd_types.h"
#include "hzstd_string.h"

// hzstd_fs_error_code_t, hzstd_fs_error_t, hzstd_fs_copy_options_t,
// hzstd_fs_exists_result_t, hzstd_file_stat_t, hzstd_open_dir_result_t,
// hzstd_dir_entry_t are defined in hzstd_types.h.

hzstd_read_file_text_result_t hzstd_read_file_text(hzstd_allocator_t allocator, hzstd_str_t path);
hzstd_fs_error_t
hzstd_read_file_binary(hzstd_allocator_t allocator, hzstd_str_t path, void* buffer, hzstd_int_t length);

hzstd_fs_error_t hzstd_write_file_text(hzstd_allocator_t allocator, hzstd_str_t path, hzstd_str_t input);
hzstd_fs_error_t
hzstd_write_file_binary(hzstd_allocator_t allocator, hzstd_str_t path, void* buffer, hzstd_int_t length);

// ── Streaming writes ────────────────────────────────────────────────────────
//
// hzstd_write_file_text above takes the ENTIRE file contents as one already-
// built string, which means the caller must materialize the whole thing in
// memory first. That is fine for a config file and ruinous for anything
// generated: the profiler's trace writer had to hold a ~1 GB JSON string
// (plus the intermediate representations it was built from) live at once,
// which is what made writing a trace need many gigabytes of RAM.
//
// These three let a caller emit a file incrementally instead, so peak memory
// is one small buffer rather than the whole output. Deliberately a raw
// open/append/close triple rather than a handle struct: hzstd_types.h stays
// freestanding, and the FILE* is opaque to Haze either way.
//
// Ownership: a successful hzstd_file_open_write MUST be paired with exactly
// one hzstd_file_close, which flushes and releases the handle. Append after
// close, or close twice, is undefined.
// `out_handle` is a void** in spirit -- it receives the FILE* -- but is typed
// void* to match what Haze's `cptr` lowers to at the FFI boundary.
hzstd_fs_error_t
hzstd_file_open_write(hzstd_allocator_t allocator, hzstd_str_t path, void* out_handle);
hzstd_fs_error_t hzstd_file_append_text(hzstd_allocator_t allocator, void* handle, hzstd_str_t input);
hzstd_fs_error_t hzstd_file_close(hzstd_allocator_t allocator, void* handle);

hzstd_fs_error_t hzstd_mkdir_recursive(hzstd_str_t path);

hzstd_fs_exists_result_t hzstd_fs_exists(hzstd_str_t path);

// Copy a file or directory (recursive if needed) to a destination.
// Automatically creates parent directories. Overwrite, symlink, and error
// behavior controlled via options.
hzstd_fs_error_t hzstd_fs_copy(hzstd_str_t src, hzstd_str_t dst, const hzstd_fs_copy_options_t* options);

// Copy a single file to a destination. Parent directories are created
// automatically. Fails if src is not a file.
hzstd_fs_error_t hzstd_fs_copy_file(hzstd_str_t src, hzstd_str_t dst, const hzstd_fs_copy_options_t* options);

// Copy a directory recursively to a destination. Parent directories are created
// automatically. All files and subdirectories are copied according to options.
hzstd_fs_error_t hzstd_fs_copy_dir(hzstd_str_t src, hzstd_str_t dst, const hzstd_fs_copy_options_t* options);

// Optional: move a file or directory (copy + delete original). Behaves like
// hzstd_fs_copy.
hzstd_fs_error_t hzstd_fs_move(hzstd_str_t src, hzstd_str_t dst, const hzstd_fs_copy_options_t* options);

hzstd_file_stat_t hzstd_file_stat(hzstd_str_t path);

hzstd_open_dir_result_t hzstd_open_dir(hzstd_str_t path);
hzstd_dir_entry_t hzstd_read_next_dir_entry(void* handle);
void hzstd_close_dir(void* handle);

#endif // HZSTD_FILESYSTEM_H