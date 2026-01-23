
#include "hzstd_filesystem.h"
#include "hzstd/hzstd_memory.h"
#include "hzstd/hzstd_string.h"
#include "hzstd_memory.h"
#include "hzstd_string.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
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

static hzstd_fs_error_code_t hzstd_fs_error_from_errno(int err)
{
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

#if defined(HAZE_PLATFORM_WIN32)
static hzstd_fs_error_code_t hzstd_fs_error_from_windows_error(DWORD err)
{
  switch (err) {
  case ERROR_FILE_NOT_FOUND:
  case ERROR_PATH_NOT_FOUND:
    return hzstd_fs_error_code_not_found;

  case ERROR_ACCESS_DENIED:
    return hzstd_fs_error_code_permission_denied;

  case ERROR_FILE_EXISTS:
    return hzstd_fs_error_code_already_exists;

  case ERROR_INVALID_NAME:
    return hzstd_fs_error_code_invalid_path;

  case ERROR_FILENAME_EXCED_RANGE:
    return hzstd_fs_error_code_name_too_long;

  default:
    return hzstd_fs_error_code_io_error;
  }
}
#endif

hzstd_fs_error_t hzstd_read_file_text(hzstd_allocator_t allocator, hzstd_str_t path, hzstd_str_ref_t* outputBuffer)
{
  outputBuffer->data = HZSTD_STRING(NULL, 0);

  char* nullTermPath = hzstd_cstr_from_str(allocator, path);
  if (!nullTermPath) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_out_of_memory,
      .message = HZSTD_STRING("out of memory", 13),
    };
  }

  FILE* f = fopen(nullTermPath, "r");
  if (!f) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = strerror(err) ? hzstd_str_from_cstr_dup(allocator, strerror(err)) : HZSTD_STRING(NULL, 0),
    };
  }

  if (fseek(f, 0, SEEK_END) != 0) {
    int err = errno;
    fclose(f);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = strerror(err) ? hzstd_str_from_cstr_dup(allocator, strerror(err)) : HZSTD_STRING(NULL, 0),
    };
  }

  long size = ftell(f);
  if (size < 0) {
    int err = errno;
    fclose(f);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = strerror(err) ? hzstd_str_from_cstr_dup(allocator, strerror(err)) : HZSTD_STRING(NULL, 0),
    };
  }

  if (fseek(f, 0, SEEK_SET) != 0) {
    int err = errno;
    fclose(f);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = strerror(err) ? hzstd_str_from_cstr_dup(allocator, strerror(err)) : HZSTD_STRING(NULL, 0),
    };
  }

  if (size == 0) {
    fclose(f);
    outputBuffer->data = HZSTD_STRING(NULL, 0);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_none,
      .message = HZSTD_STRING(NULL, 0),
    };
  }

  char* buffer = hzstd_allocate(allocator, (size_t)size);
  if (!buffer) {
    fclose(f);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_out_of_memory,
      .message = HZSTD_STRING("out of memory", 13),
    };
  }

  size_t totalRead = fread(buffer, 1, (size_t)size, f);
  if (totalRead < (size_t)size && ferror(f)) {
    int err = errno;
    fclose(f);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_io_error,
      .message = strerror(err) ? hzstd_str_from_cstr_dup(allocator, strerror(err)) : HZSTD_STRING(NULL, 0),
    };
  }

  fclose(f);

  outputBuffer->data = (hzstd_str_t) {
    .data = buffer,
    .length = totalRead,
  };

  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

hzstd_fs_error_t hzstd_write_file_text(hzstd_allocator_t allocator, hzstd_str_t path, hzstd_str_t input)
{
  char* nullTermPath = hzstd_cstr_from_str(allocator, path);
  if (!nullTermPath) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_out_of_memory,
      .message = HZSTD_STRING("out of memory", 13),
    };
  }

  FILE* f = fopen(nullTermPath, "wb");
  if (!f) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = strerror(err) ? hzstd_str_from_cstr_dup(allocator, strerror(err)) : HZSTD_STRING(NULL, 0),
    };
  }

  if (input.length > 0) {
    size_t written = fwrite(input.data, 1, input.length, f);
    if (written < input.length) {
      int err = errno;
      fclose(f);
      return (hzstd_fs_error_t) {
        .code = hzstd_fs_error_code_io_error,
        .message = strerror(err) ? hzstd_str_from_cstr_dup(allocator, strerror(err)) : HZSTD_STRING(NULL, 0),
      };
    }
  }

  if (fclose(f) != 0) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = strerror(err) ? hzstd_str_from_cstr_dup(allocator, strerror(err)) : HZSTD_STRING(NULL, 0),
    };
  }

  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

hzstd_fs_error_t hzstd_mkdir_recursive(hzstd_str_t path)
{
  if (path.data == NULL || path.length == 0) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_invalid_path,
      .message = HZSTD_STRING("invalid path", 12),
    };
  }

  if (path.length >= HAZE_MAX_PATH_LENGTH) {
    return (hzstd_fs_error_t) {
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
  for (char* p = tmp + 1; *p; ++p) {
    if (*p == '/') {
      *p = '\0';

      struct stat st;
      if (stat(tmp, &st) != 0) {
        if (errno != ENOENT) {
          int err = errno;
          return (hzstd_fs_error_t) {
            .code = hzstd_fs_error_from_errno(err),
            .message = strerror(err) ? HZSTD_STRING(strerror(err), strlen(strerror(err))) : HZSTD_STRING(NULL, 0),
          };
        }

        if (MKDIR(tmp) != 0 && errno != EEXIST) {
          int err = errno;
          return (hzstd_fs_error_t) {
            .code = hzstd_fs_error_from_errno(err),
            .message = strerror(err) ? HZSTD_STRING(strerror(err), strlen(strerror(err))) : HZSTD_STRING(NULL, 0),
          };
        }
      }
      else if (!IS_DIR(st.st_mode)) {
        return (hzstd_fs_error_t) {
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
      return (hzstd_fs_error_t) {
        .code = hzstd_fs_error_from_errno(err),
        .message = strerror(err) ? HZSTD_STRING(strerror(err), strlen(strerror(err))) : HZSTD_STRING(NULL, 0),
      };
    }

    if (MKDIR(tmp) != 0 && errno != EEXIST) {
      int err = errno;
      return (hzstd_fs_error_t) {
        .code = hzstd_fs_error_from_errno(err),
        .message = strerror(err) ? HZSTD_STRING(strerror(err), strlen(strerror(err))) : HZSTD_STRING(NULL, 0),
      };
    }
  }
  else if (!IS_DIR(st.st_mode)) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_not_a_file,
      .message = HZSTD_STRING("path exists but is not a directory", 36),
    };
  }

  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

hzstd_fs_exists_result_t hzstd_fs_exists(hzstd_str_t path)
{
  hzstd_fs_exists_result_t result;
  result.exists = false;
  result.error = (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };

  if (path.data == NULL || path.length == 0) {
    result.error = (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_invalid_path,
      .message = HZSTD_STRING("invalid path", 12),
    };
    return result;
  }

  if (path.length >= HAZE_MAX_PATH_LENGTH) {
    result.error = (hzstd_fs_error_t) {
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
  result.error = (hzstd_fs_error_t) {
    .code = hzstd_fs_error_from_errno(err),
    .message = strerror(err) ? HZSTD_STRING(strerror(err), strlen(strerror(err))) : HZSTD_STRING(NULL, 0),
  };

  return result;
}

// --- Helper: allocate GC string from static or system message ---
static inline hzstd_str_t hzstd_fs_strdup_msg(char* msg) { return msg ? hzstd_cstr_dup(msg) : hzstd_cstr_dup(""); }

#ifdef HAZE_PLATFORM_WIN32
static inline hzstd_str_t hzstd_fs_windows_error(DWORD err)
{
  LPSTR msg = NULL;
  DWORD size
      = FormatMessageA(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                       NULL,
                       err,
                       MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
                       (LPSTR)&msg,
                       0,
                       NULL);
  if (size == 0 || !msg) {
    return hzstd_cstr_dup("Unknown error");
  }
  hzstd_str_t out = hzstd_cstr_dup(msg);
  LocalFree(msg);
  return out;
}
#endif

// --- Helper: get parent directory from a path ---
static hzstd_str_t hzstd_fs_parent_dir(const char* path)
{
  size_t len = strlen(path);
  if (len == 0) {
    return (hzstd_str_t) { .data = (char*)".", .length = 1 };
  }

  // Find last separator
  int last_sep = -1;
  for (int i = (int)len - 1; i >= 0; i--) {
    if (path[i] == '/' || path[i] == '\\') {
      last_sep = i;
      break;
    }
  }

  if (last_sep <= 0) {
    return (hzstd_str_t) { .data = (char*)".", .length = 1 };
  }

  return (hzstd_str_t) { .data = (char*)path, .length = (size_t)last_sep };
}

// --- Copy single file ---
static hzstd_fs_error_t
hzstd_fs_copy_file_internal(const char* src, const char* dst, const hzstd_fs_copy_options_t* opts)
{
  struct STAT st;
  if (STAT(src, &st) != 0) {
#if defined(HAZE_PLATFORM_LINUX)
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                .message = hzstd_fs_strdup_msg(strerror(errno)) };
#elif defined(HAZE_PLATFORM_WIN32)
    DWORD err = GetLastError();
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_windows_error(err),
                                .message = hzstd_fs_windows_error(err) };
#endif
  }

  // Create parent directory, not the file path itself
  hzstd_str_t parent = hzstd_fs_parent_dir(dst);
  hzstd_mkdir_recursive(parent);

#if defined(HAZE_PLATFORM_LINUX)
  if (!opts->overwrite) {
    struct STAT dst_st;
    if (STAT(dst, &dst_st) == 0) {
      return (hzstd_fs_error_t) { .code = hzstd_fs_error_code_already_exists,
                                  .message = hzstd_cstr_dup("destination exists") };
    }
  }

  int fd_src = open(src, O_RDONLY);
  if (fd_src < 0) {
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                .message = hzstd_fs_strdup_msg(strerror(errno)) };
  }

  int fd_dst = open(dst, O_WRONLY | O_CREAT | O_TRUNC, st.st_mode & 0777);
  if (fd_dst < 0) {
    close(fd_src);
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                .message = hzstd_fs_strdup_msg(strerror(errno)) };
  }

  char buf[8192];
  ssize_t r;
  while ((r = read(fd_src, buf, sizeof(buf))) > 0) {
    ssize_t w = write(fd_dst, buf, r);
    if (w != r) {
      close(fd_src);
      close(fd_dst);
      return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                  .message = hzstd_fs_strdup_msg(strerror(errno)) };
    }
  }

  close(fd_src);
  close(fd_dst);
  if (r < 0) {
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                .message = hzstd_fs_strdup_msg(strerror(errno)) };
  }

#elif defined(HAZE_PLATFORM_WIN32)
  BOOL fail_if_exists = !opts->overwrite;
  if (!CopyFileA(src, dst, fail_if_exists)) {
    DWORD err = GetLastError();
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_windows_error(err),
                                .message = hzstd_fs_windows_error(err) };
  }
#endif

  return (hzstd_fs_error_t) { .code = hzstd_fs_error_code_none };
}

// --- Recursive directory copy ---
static hzstd_fs_error_t
hzstd_fs_copy_dir_internal(const char* src, const char* dst, const hzstd_fs_copy_options_t* opts)
{
  hzstd_mkdir_recursive((hzstd_str_t) { .data = dst, .length = strlen(dst) });

#if defined(HAZE_PLATFORM_LINUX)
  DIR* dir = opendir(src);
  if (!dir) {
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                .message = hzstd_fs_strdup_msg(strerror(errno)) };
  }

  struct dirent* entry;
  while ((entry = readdir(dir))) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
      continue;
    }

    char src_path[HAZE_MAX_PATH_LENGTH];
    char dst_path[HAZE_MAX_PATH_LENGTH];
    snprintf(src_path, sizeof(src_path), "%s/%s", src, entry->d_name);
    snprintf(dst_path, sizeof(dst_path), "%s/%s", dst, entry->d_name);

    struct STAT st;
    if (STAT(src_path, &st) != 0) {
      if (opts->skip_errors) {
        continue;
      }
      closedir(dir);
      return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                  .message = hzstd_fs_strdup_msg(strerror(errno)) };
    }

    hzstd_fs_error_t err;
    if (IS_DIR(st.st_mode)) {
      err = hzstd_fs_copy_dir_internal(src_path, dst_path, opts);
    }
    else {
      err = hzstd_fs_copy_file_internal(src_path, dst_path, opts);
    }

    if (err.code != hzstd_fs_error_code_none && !opts->skip_errors) {
      closedir(dir);
      return err;
    }
  }
  closedir(dir);

#elif defined(HAZE_PLATFORM_WIN32)
  WIN32_FIND_DATAA ffd;
  char search_path[HAZE_MAX_PATH_LENGTH];
  snprintf(search_path, sizeof(search_path), "%s\\*", src);
  HANDLE hFind = FindFirstFileA(search_path, &ffd);
  if (hFind == INVALID_HANDLE_VALUE) {
    DWORD err = GetLastError();
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_windows_error(err),
                                .message = hzstd_fs_windows_error(err) };
  }

  do {
    if (strcmp(ffd.cFileName, ".") == 0 || strcmp(ffd.cFileName, "..") == 0) {
      continue;
    }

    char src_path[HAZE_MAX_PATH_LENGTH];
    char dst_path[HAZE_MAX_PATH_LENGTH];
    snprintf(src_path, sizeof(src_path), "%s\\%s", src, ffd.cFileName);
    snprintf(dst_path, sizeof(dst_path), "%s\\%s", dst, ffd.cFileName);

    hzstd_fs_error_t err;
    if (ffd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      err = hzstd_fs_copy_dir_internal(src_path, dst_path, opts);
    }
    else {
      err = hzstd_fs_copy_file_internal(src_path, dst_path, opts);
    }

    if (err.code != hzstd_fs_error_code_none && !opts->skip_errors) {
      FindClose(hFind);
      return err;
    }
  } while (FindNextFileA(hFind, &ffd) != 0);
  FindClose(hFind);
#endif

  return (hzstd_fs_error_t) { .code = hzstd_fs_error_code_none };
}

// --- Public API ---
hzstd_fs_error_t hzstd_fs_copy_file(hzstd_str_t src, hzstd_str_t dst, const hzstd_fs_copy_options_t* opts)
{
  return hzstd_fs_copy_file_internal(src.data, dst.data, opts);
}

hzstd_fs_error_t hzstd_fs_copy_dir(hzstd_str_t src, hzstd_str_t dst, const hzstd_fs_copy_options_t* opts)
{
  return hzstd_fs_copy_dir_internal(src.data, dst.data, opts);
}

hzstd_fs_error_t hzstd_fs_copy(hzstd_str_t src, hzstd_str_t dst, const hzstd_fs_copy_options_t* opts)
{
  struct STAT st;
  if (STAT(src.data, &st) != 0) {
#if defined(HAZE_PLATFORM_LINUX)
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                .message = hzstd_fs_strdup_msg(strerror(errno)) };
#elif defined(HAZE_PLATFORM_WIN32)
    DWORD err = GetLastError();
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_windows_error(err),
                                .message = hzstd_fs_windows_error(err) };
#endif
  }

  if (IS_DIR(st.st_mode)) {
    return hzstd_fs_copy_dir_internal(src.data, dst.data, opts);
  }
  else {
    return hzstd_fs_copy_file_internal(src.data, dst.data, opts);
  }
}

hzstd_fs_error_t hzstd_fs_move(hzstd_str_t src, hzstd_str_t dst, const hzstd_fs_copy_options_t* opts)
{
  hzstd_fs_error_t err = hzstd_fs_copy(src, dst, opts);
  if (err.code != hzstd_fs_error_code_none) {
    return err;
  }

#if defined(HAZE_PLATFORM_LINUX)
  struct STAT st;
  if (STAT(src.data, &st) != 0) {
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                .message = hzstd_fs_strdup_msg(strerror(errno)) };
  }

  if (IS_DIR(st.st_mode)) {
    if (rmdir(src.data) != 0) {
      return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                  .message = hzstd_fs_strdup_msg(strerror(errno)) };
    }
  }
  else {
    if (unlink(src.data) != 0) {
      return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                  .message = hzstd_fs_strdup_msg(strerror(errno)) };
    }
  }
#elif defined(HAZE_PLATFORM_WIN32)
  if (IS_DIR(GetFileAttributesA(src.data))) {
    RemoveDirectoryA(src.data);
  }
  else {
    DeleteFileA(src.data);
  }
#endif

  return (hzstd_fs_error_t) { .code = hzstd_fs_error_code_none };
}