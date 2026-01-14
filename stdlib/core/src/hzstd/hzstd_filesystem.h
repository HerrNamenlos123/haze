
#ifndef HZSTD_FILESYSTEM_H
#define HZSTD_FILESYSTEM_H

#include "hzstd_common.h"
#include "hzstd_string.h"

typedef enum {
  hzstd_fs_error_code_none = 0,

  hzstd_fs_error_code_not_found, // path does not exist
  hzstd_fs_error_code_not_a_file, // exists but not a regular file
  hzstd_fs_error_code_not_a_directory, // exists but not a directory
  hzstd_fs_error_code_permission_denied,
  hzstd_fs_error_code_invalid_path, // malformed path, invalid characters, etc.
  hzstd_fs_error_code_name_too_long,
  hzstd_fs_error_code_io_error, // generic read/write failure
  hzstd_fs_error_code_out_of_memory,
} hzstd_fs_error_code_t;

typedef struct {
  hzstd_fs_error_code_t code;
  hzstd_str_t message;
} hzstd_fs_error_t;

// struct FILE;
// typedef struct {
//   FILE *file;
// } hzstd_file_t;

hzstd_fs_error_t hzstd_read_file_text(hzstd_allocator_t allocator, hzstd_str_t path, hzstd_str_ref_t* outputBuffer);

hzstd_fs_error_t hzstd_mkdir_recursive(hzstd_str_t path);

typedef struct {
  bool exists;
  hzstd_fs_error_t error;
} hzstd_fs_exists_result_t;

hzstd_fs_exists_result_t hzstd_fs_exists(hzstd_str_t path);

#endif // HZSTD_FILESYSTEM_H