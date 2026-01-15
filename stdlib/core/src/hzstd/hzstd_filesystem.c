
#include "hzstd_filesystem.h"
#include "hzstd_memory.h"
#include "hzstd_string.h"

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#if defined(HAZE_PLATFORM_LINUX)

#define HAZE_MAX_PATH_LENGTH PATH_MAX
#include <sys/stat.h>
#include <unistd.h>
#define PATH_SEPARATOR '/'
#define MKDIR(path) mkdir(path, 0777)
#define STAT stat
#define IS_DIR(mode) S_ISDIR(mode)

#elif defined(HAZE_PLATFORM_WIN32)

#define HAZE_MAX_PATH_LENGTH MAX_PATH
#include <direct.h>
#include <sys/stat.h>
#include <windows.h>
#define PATH_SEPARATOR '\\'
#define MKDIR(path) _mkdir(path)
#define STAT _stat
#define IS_DIR(mode) ((mode) & _S_IFDIR)

#else
#error "Unsupported platform"
#endif

static hzstd_fs_error_code_t hzstd_fs_error_from_errno(int err) {
  switch (err) {
  case ENOENT:
    return hzstd_fs_error_code_not_found;

  case EACCES:
  case EPERM:
    return hzstd_fs_error_code_permission_denied;

  case EINVAL:
    return hzstd_fs_error_code_invalid_path;

  case ENAMETOOLONG:
    return hzstd_fs_error_code_name_too_long;

  case ENOTDIR:
    return hzstd_fs_error_code_not_a_directory;

  default:
    return hzstd_fs_error_code_io_error;
  }
}

hzstd_fs_error_t hzstd_read_file_text(hzstd_allocator_t allocator,
                                      hzstd_str_t path,
                                      hzstd_str_ref_t *outputBuffer) {
  outputBuffer->data = HZSTD_STRING(NULL, 0);

  char *nullTermPath = hzstd_cstr_from_str(allocator, path);
  if (!nullTermPath) {
    return (hzstd_fs_error_t){
        .code = hzstd_fs_error_code_out_of_memory,
        .message = HZSTD_STRING("out of memory", 13),
    };
  }

  FILE *f = fopen(nullTermPath, "r");
  if (!f) {
    int err = errno;
    return (hzstd_fs_error_t){
        .code = hzstd_fs_error_from_errno(err),
        .message = strerror(err)
                       ? hzstd_str_from_cstr_dup(allocator, strerror(err))
                       : HZSTD_STRING(NULL, 0),
    };
  }

  if (fseek(f, 0, SEEK_END) != 0) {
    int err = errno;
    fclose(f);
    return (hzstd_fs_error_t){
        .code = hzstd_fs_error_from_errno(err),
        .message = strerror(err)
                       ? hzstd_str_from_cstr_dup(allocator, strerror(err))
                       : HZSTD_STRING(NULL, 0),
    };
  }

  long size = ftell(f);
  if (size < 0) {
    int err = errno;
    fclose(f);
    return (hzstd_fs_error_t){
        .code = hzstd_fs_error_from_errno(err),
        .message = strerror(err)
                       ? hzstd_str_from_cstr_dup(allocator, strerror(err))
                       : HZSTD_STRING(NULL, 0),
    };
  }

  if (fseek(f, 0, SEEK_SET) != 0) {
    int err = errno;
    fclose(f);
    return (hzstd_fs_error_t){
        .code = hzstd_fs_error_from_errno(err),
        .message = strerror(err)
                       ? hzstd_str_from_cstr_dup(allocator, strerror(err))
                       : HZSTD_STRING(NULL, 0),
    };
  }

  if (size == 0) {
    fclose(f);
    outputBuffer->data = HZSTD_STRING(NULL, 0);
    return (hzstd_fs_error_t){
        .code = hzstd_fs_error_code_none,
        .message = HZSTD_STRING(NULL, 0),
    };
  }

  char *buffer = hzstd_allocate(allocator, (size_t)size);
  if (!buffer) {
    fclose(f);
    return (hzstd_fs_error_t){
        .code = hzstd_fs_error_code_out_of_memory,
        .message = HZSTD_STRING("out of memory", 13),
    };
  }

  size_t totalRead = fread(buffer, 1, (size_t)size, f);
  if (totalRead < (size_t)size && ferror(f)) {
    int err = errno;
    fclose(f);
    return (hzstd_fs_error_t){
        .code = hzstd_fs_error_code_io_error,
        .message = strerror(err)
                       ? hzstd_str_from_cstr_dup(allocator, strerror(err))
                       : HZSTD_STRING(NULL, 0),
    };
  }

  fclose(f);

  outputBuffer->data = (hzstd_str_t){
      .data = buffer,
      .length = totalRead,
  };

  return (hzstd_fs_error_t){
      .code = hzstd_fs_error_code_none,
      .message = HZSTD_STRING(NULL, 0),
  };
}

hzstd_fs_error_t hzstd_mkdir_recursive(hzstd_str_t path) {
  if (path.data == NULL || path.length == 0) {
    return (hzstd_fs_error_t){
        .code = hzstd_fs_error_code_invalid_path,
        .message = HZSTD_STRING("invalid path", 12),
    };
  }

  if (path.length >= HAZE_MAX_PATH_LENGTH) {
    return (hzstd_fs_error_t){
        .code = hzstd_fs_error_code_name_too_long,
        .message = HZSTD_STRING("path too long", 13),
    };
  }

  // Copy path into mutable buffer
  char tmp[HAZE_MAX_PATH_LENGTH];
  memcpy(tmp, path.data, path.length);
  tmp[path.length] = '\0';

  // Strip trailing slashes (except "/")
  size_t len = path.length;
  while (len > 1 && tmp[len - 1] == '/') {
    tmp[len - 1] = '\0';
    len--;
  }

  // Iterate through path components
  for (char *p = tmp + 1; *p; ++p) {
    if (*p == '/') {
      *p = '\0';

      struct stat st;
      if (stat(tmp, &st) != 0) {
        if (errno != ENOENT) {
          int err = errno;
          return (hzstd_fs_error_t){
              .code = hzstd_fs_error_from_errno(err),
              .message = strerror(err) ? HZSTD_STRING(strerror(err),
                                                      strlen(strerror(err)))
                                       : HZSTD_STRING(NULL, 0),
          };
        }

        if (MKDIR(tmp) != 0 && errno != EEXIST) {
          int err = errno;
          return (hzstd_fs_error_t){
              .code = hzstd_fs_error_from_errno(err),
              .message = strerror(err) ? HZSTD_STRING(strerror(err),
                                                      strlen(strerror(err)))
                                       : HZSTD_STRING(NULL, 0),
          };
        }
      } else if (!IS_DIR(st.st_mode)) {
        return (hzstd_fs_error_t){
            .code = hzstd_fs_error_code_not_a_file,
            .message = HZSTD_STRING("path component is not a directory", 35),
        };
      }

      *p = '/';
    }
  }

  // Final directory
  struct stat st;
  if (stat(tmp, &st) != 0) {
    if (errno != ENOENT) {
      int err = errno;
      return (hzstd_fs_error_t){
          .code = hzstd_fs_error_from_errno(err),
          .message = strerror(err)
                         ? HZSTD_STRING(strerror(err), strlen(strerror(err)))
                         : HZSTD_STRING(NULL, 0),
      };
    }

    if (MKDIR(tmp) != 0 && errno != EEXIST) {
      int err = errno;
      return (hzstd_fs_error_t){
          .code = hzstd_fs_error_from_errno(err),
          .message = strerror(err)
                         ? HZSTD_STRING(strerror(err), strlen(strerror(err)))
                         : HZSTD_STRING(NULL, 0),
      };
    }
  } else if (!IS_DIR(st.st_mode)) {
    return (hzstd_fs_error_t){
        .code = hzstd_fs_error_code_not_a_file,
        .message = HZSTD_STRING("path exists but is not a directory", 36),
    };
  }

  return (hzstd_fs_error_t){
      .code = hzstd_fs_error_code_none,
      .message = HZSTD_STRING(NULL, 0),
  };
}

hzstd_fs_exists_result_t hzstd_fs_exists(hzstd_str_t path) {
  hzstd_fs_exists_result_t result;
  result.exists = false;
  result.error = (hzstd_fs_error_t){
      .code = hzstd_fs_error_code_none,
      .message = HZSTD_STRING(NULL, 0),
  };

  if (path.data == NULL || path.length == 0) {
    result.error = (hzstd_fs_error_t){
        .code = hzstd_fs_error_code_invalid_path,
        .message = HZSTD_STRING("invalid path", 12),
    };
    return result;
  }

  if (path.length >= HAZE_MAX_PATH_LENGTH) {
    result.error = (hzstd_fs_error_t){
        .code = hzstd_fs_error_code_name_too_long,
        .message = HZSTD_STRING("path too long", 13),
    };
    return result;
  }

  char tmp[HAZE_MAX_PATH_LENGTH];
  memcpy(tmp, path.data, path.length);
  tmp[path.length] = '\0';

  struct stat st;
  if (stat(tmp, &st) == 0) {
    result.exists = true;
    return result;
  }

  // Normal "does not exist" case
  if (errno == ENOENT) {
    result.exists = false;
    return result;
  }

  // Actual error
  int err = errno;
  result.error = (hzstd_fs_error_t){
      .code = hzstd_fs_error_from_errno(err),
      .message = strerror(err)
                     ? HZSTD_STRING(strerror(err), strlen(strerror(err)))
                     : HZSTD_STRING(NULL, 0),
  };

  return result;
}