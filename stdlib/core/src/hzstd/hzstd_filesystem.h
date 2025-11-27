
#ifndef HZSTD_FILESYSTEM_H
#define HZSTD_FILESYSTEM_H

#include "hzstd_common.h"
#include "hzstd_string.h"

typedef enum {
  hzstd_fs_error_none = 0,
  hzstd_fs_error_no_such_file_or_directory,
  hzstd_fs_error_failed,
} hzstd_fs_error_t;

// struct FILE;
// typedef struct {
//   FILE *file;
// } hzstd_file_t;

hzstd_fs_error_t hzstd_read_file_text(hzstd_arena_t *arena, hzstd_str_t path,
                                      hzstd_str_ref_t *outputBuffer);

#endif // HZSTD_FILESYSTEM_H