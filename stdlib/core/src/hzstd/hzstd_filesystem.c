
#include "hzstd_filesystem.h"
#include "hzstd_arena.h"
#include "hzstd_string.h"
#include <stdio.h>

hzstd_fs_error_t hzstd_read_file_text(hzstd_arena_t* arena, hzstd_str_t path, hzstd_str_ref_t* outputBuffer)
{
  hzstd_arena_t* scratchArena = hzstd_arena_create();
  char* nullTermPath = hzstd_cstr_from_str(scratchArena, path);

  FILE* f = fopen(nullTermPath, "r");
  if (!f) {
    hzstd_arena_cleanup_and_free(scratchArena);
    return hzstd_fs_error_no_such_file_or_directory;
  }

  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  if (size < 0) {
    fclose(f);
    hzstd_arena_cleanup_and_free(scratchArena);
    return hzstd_fs_error_failed;
  }
  fseek(f, 0, SEEK_SET);

  if (size == 0) {
    fclose(f);
    hzstd_arena_cleanup_and_free(scratchArena);
    outputBuffer->data = HZSTD_STRING(NULL, 0);
    return hzstd_fs_error_none;
  }

  char* buffer = hzstd_arena_allocate(arena, size, alignof(char));
  if (!buffer) {
    fclose(f);
    hzstd_arena_cleanup_and_free(scratchArena);
    return hzstd_fs_error_failed;
  }

  long totalRead = 0;
  while (totalRead < size) {
    size_t n = fread(buffer + totalRead, 1, size - totalRead, f);
    if (n == 0) {
      break; // EOF or error
    }
    totalRead += n;
  }

  // Do not check since CRLF conversion causes length to be different.
  // But the actual length is always going to be smaller than the told length,
  // so the buffer is always large enough printf("%ld %ld\n", totalRead, size);
  // if (totalRead != size) {
  //   fclose(f);
  //   hzstd_arena_cleanup_and_free(scratchArena);
  //   return hzstd_fs_error_failed;
  // }

  fclose(f);

  outputBuffer->data = (hzstd_str_t) { .data = buffer, .length = totalRead };
  hzstd_arena_cleanup_and_free(scratchArena);
  return hzstd_fs_error_none;
}