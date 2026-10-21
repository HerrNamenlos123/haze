
#include "../include/hzstd_filesystem.h"
#include "../include/hzstd_memory.h"
#include "../include/hzstd_string.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#if defined(HAZE_PLATFORM_LINUX)

#define HAZE_MAX_PATH_LENGTH PATH_MAX
#include <dirent.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#define PATH_SEPARATOR '/'
#define MKDIR(path) mkdir(path, 0777)
#define STAT stat
#define FSTAT fstat
#define FILENO fileno
#define IS_DIR(mode) S_ISDIR(mode)

#elif defined(HAZE_PLATFORM_WIN32)

#define WIN32_LEAN_AND_MEAN
#define HAZE_MAX_PATH_LENGTH MAX_PATH
#include <direct.h>
#include <io.h>
#include <sys/stat.h>
#include <windows.h>
#include <shellapi.h> // SHFileOperationW
#include <wchar.h>
#define PATH_SEPARATOR '\\'
#define MKDIR(path) _mkdir(path)
#define STAT _stat
#define FSTAT _fstat
#define FILENO _fileno
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

  case EEXIST:
    return hzstd_fs_error_code_already_exists;

  default:
    return hzstd_fs_error_code_io_error;
  }
}

// The message for an errno value, as a str, without copying it where that is
// safe. strerror() may hand back a buffer that the next call overwrites (for an
// unknown code it formats one), which a str must never point into, so its text
// had to be copied every time. glibc >= 2.32 has strerrordesc_np(), which
// returns the immutable entry of its own table (or NULL for an unknown code):
// a view of that is safe forever. It is declared here rather than through
// _GNU_SOURCE because hzstd is one translation unit whose headers are already
// in by now. Everywhere else, and for unknown codes, the text is copied.
#if defined(__GLIBC__) && (__GLIBC__ > 2 || (__GLIBC__ == 2 && __GLIBC_MINOR__ >= 32))
#define HZSTD_FS_HAS_STRERRORDESC 1
extern const char *strerrordesc_np(int errnum);
#endif

static hzstd_str_t hzstd_fs_errno_message(int err)
{
#ifdef HZSTD_FS_HAS_STRERRORDESC
  const char* desc = strerrordesc_np(err);
  if (desc) {
    return (hzstd_str_t) { .data = (char*)desc, .length = (hzstd_int_t)strlen(desc) };
  }
#endif
  const char* msg = strerror(err);
  return msg ? hzstd_cstr_dup((char*)msg) : HZSTD_STRING(NULL, 0);
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

hzstd_read_file_text_result_t hzstd_read_file_text(hzstd_allocator_t allocator, hzstd_str_t path)
{
  HZSTD_SCRATCH_CSTR(nullTermPath, path);
  if (!nullTermPath) {
    return (hzstd_read_file_text_result_t) {
      .data = HZSTD_STRING(NULL, 0),
      .error = {
        .code = hzstd_fs_error_code_out_of_memory,
        .message = HZSTD_STRING("out of memory", 13),
      },
    };
  }

  FILE* f = fopen(nullTermPath, "r");
  if (!f) {
    int err = errno;
    return (hzstd_read_file_text_result_t) {
      .data = HZSTD_STRING(NULL, 0),
      .error = {
        .code = hzstd_fs_error_from_errno(err),
        .message = hzstd_fs_errno_message(err),
      },
    };
  }

  if (fseek(f, 0, SEEK_END) != 0) {
    int err = errno;
    fclose(f);
    return (hzstd_read_file_text_result_t) {
      .data = HZSTD_STRING(NULL, 0),
      .error = {
        .code = hzstd_fs_error_from_errno(err),
        .message = hzstd_fs_errno_message(err),
      },
    };
  }

  long size = ftell(f);
  if (size < 0) {
    int err = errno;
    fclose(f);
    return (hzstd_read_file_text_result_t) {
      .data = HZSTD_STRING(NULL, 0),
      .error = {
        .code = hzstd_fs_error_from_errno(err),
        .message = hzstd_fs_errno_message(err),
      },
    };
  }

  if (fseek(f, 0, SEEK_SET) != 0) {
    int err = errno;
    fclose(f);
    return (hzstd_read_file_text_result_t) {
      .data = HZSTD_STRING(NULL, 0),
      .error = {
        .code = hzstd_fs_error_from_errno(err),
        .message = hzstd_fs_errno_message(err),
      },
    };
  }

  if (size == 0) {
    fclose(f);
    return (hzstd_read_file_text_result_t) {
      .data = HZSTD_STRING(NULL, 0),
      .error = {
        .code = hzstd_fs_error_code_none,
        .message = HZSTD_STRING(NULL, 0),
      },
    };
  }

  char* buffer = hzstd_allocate(allocator, (size_t)size, NULL);
  if (!buffer) {
    fclose(f);
    return (hzstd_read_file_text_result_t) {
      .data = HZSTD_STRING(NULL, 0),
      .error = {
        .code = hzstd_fs_error_code_out_of_memory,
        .message = HZSTD_STRING("out of memory", 13),
      },
    };
  }

  size_t totalRead = fread(buffer, 1, (size_t)size, f);
  if (totalRead < (size_t)size && ferror(f)) {
    int err = errno;
    fclose(f);
    return (hzstd_read_file_text_result_t) {
      .data = HZSTD_STRING(NULL, 0),
      .error = {
        .code = hzstd_fs_error_code_io_error,
        .message = hzstd_fs_errno_message(err),
      },
    };
  }

  fclose(f);

  return (hzstd_read_file_text_result_t) {
    .data = (hzstd_str_t) {
      .data = buffer,
      .length = totalRead,
    },
    .error = {
      .code = hzstd_fs_error_code_none,
      .message = HZSTD_STRING(NULL, 0),
    },
  };
}

hzstd_fs_error_t hzstd_read_file_binary(hzstd_allocator_t allocator, hzstd_str_t path, void* buffer, hzstd_int_t length)
{
  if (!buffer || length <= 0) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_invalid_path,
      .message = HZSTD_STRING("invalid buffer or length", 24),
    };
  }

  HZSTD_SCRATCH_CSTR(nullTermPath, path);
  if (!nullTermPath) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_out_of_memory,
      .message = HZSTD_STRING("out of memory", 13),
    };
  }

  FILE* f = fopen(nullTermPath, "rb");
  if (!f) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }

  size_t totalRead = fread(buffer, 1, (size_t)length, f);
  if (totalRead < (size_t)length && ferror(f)) {
    int err = errno;
    fclose(f);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_io_error,
      .message = hzstd_fs_errno_message(err),
    };
  }

  fclose(f);

  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

hzstd_fs_error_t hzstd_write_file_text(hzstd_allocator_t allocator, hzstd_str_t path, hzstd_str_t input)
{
  HZSTD_SCRATCH_CSTR(nullTermPath, path);
  if (!nullTermPath) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_out_of_memory,
      .message = HZSTD_STRING("out of memory", 13),
    };
  }

  // Create parent directory, not the file path itself
  hzstd_str_t parent = hzstd_fs_parent_dir(nullTermPath);
  hzstd_mkdir_recursive(parent);

  FILE* f = fopen(nullTermPath, "wb");
  if (!f) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }

  if (input.length > 0) {
    size_t written = fwrite(input.data, 1, input.length, f);
    if (written < input.length) {
      int err = errno;
      fclose(f);
      return (hzstd_fs_error_t) {
        .code = hzstd_fs_error_code_io_error,
        .message = hzstd_fs_errno_message(err),
      };
    }
  }

  if (fclose(f) != 0) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }

  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

// hzstd_write_file_text for a file that must not exist yet. The file is
// created by the same call that checks for it (O_EXCL), so nothing at `path`,
// a file or a folder, is ever replaced, and no other program can create the
// file between a check and the write. Anything there is already_exists. A
// write that fails part way removes the file it created.
hzstd_fs_error_t hzstd_create_file_text(hzstd_allocator_t allocator, hzstd_str_t path, hzstd_str_t input)
{
  // A NUL inside the path would cut it short and name a different file.
  if (path.length > 0 && memchr(path.data, '\0', (size_t)path.length)) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_invalid_path,
      .message = HZSTD_STRING("invalid path", 12),
    };
  }
  HZSTD_SCRATCH_CSTR(nullTermPath, path);
  if (!nullTermPath) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_out_of_memory,
      .message = HZSTD_STRING("out of memory", 13),
    };
  }

  hzstd_str_t parent = hzstd_fs_parent_dir(nullTermPath);
  hzstd_mkdir_recursive(parent);

#if defined(HAZE_PLATFORM_WIN32)
  int fd = _open(nullTermPath, _O_WRONLY | _O_CREAT | _O_EXCL | _O_BINARY, _S_IREAD | _S_IWRITE);
#else
  int fd = open(nullTermPath, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0666);
#endif
  if (fd < 0) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }

  const char* data = input.data;
  hzstd_int_t left = input.length;
  while (left > 0) {
#if defined(HAZE_PLATFORM_WIN32)
    int written = _write(fd, data, left > INT_MAX ? INT_MAX : (unsigned int)left);
#else
    ssize_t written = write(fd, data, (size_t)left);
    if (written < 0 && errno == EINTR) {
      continue;
    }
#endif
    if (written <= 0) {
      int err = written < 0 ? errno : EIO;
#if defined(HAZE_PLATFORM_WIN32)
      _close(fd);
#else
      close(fd);
#endif
      remove(nullTermPath);
      return (hzstd_fs_error_t) {
        .code = hzstd_fs_error_code_io_error,
        .message = hzstd_fs_errno_message(err),
      };
    }
    data += written;
    left -= written;
  }

#if defined(HAZE_PLATFORM_WIN32)
  int closed = _close(fd);
#else
  int closed = close(fd);
#endif
  if (closed != 0) {
    int err = errno;
    remove(nullTermPath);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }

  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

// Removes the file at `path`; a folder there is not_a_file and stays. A
// symbolic link is removed itself, not what it points to.
hzstd_fs_error_t hzstd_remove_file(hzstd_str_t path)
{
  // A NUL inside the path would cut it short and name a different file.
  if (path.length > 0 && memchr(path.data, '\0', (size_t)path.length)) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_invalid_path,
      .message = HZSTD_STRING("invalid path", 12),
    };
  }
  HZSTD_SCRATCH_CSTR(nullTermPath, path);
  if (!nullTermPath) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_out_of_memory,
      .message = HZSTD_STRING("out of memory", 13),
    };
  }

#if defined(HAZE_PLATFORM_WIN32)
  DWORD attributes = GetFileAttributesA(nullTermPath);
  if (attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY)) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_not_a_file,
      .message = HZSTD_STRING("path is a directory", 19),
    };
  }
  if (!DeleteFileA(nullTermPath)) {
    DWORD err = GetLastError();
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_windows_error(err),
      .message = HZSTD_STRING("could not remove the file", 25),
    };
  }
#else
  struct stat st;
  if (lstat(nullTermPath, &st) == 0 && S_ISDIR(st.st_mode)) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_not_a_file,
      .message = HZSTD_STRING("path is a directory", 19),
    };
  }
  if (unlink(nullTermPath) != 0) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }
#endif

  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

// ── Trash ───────────────────────────────────────────────────────────────────
//
// hzstd_move_to_trash moves a file or folder to the desktop's trash, from
// where the user can restore it. Nothing here ever deletes the item: when no
// trash can take it, the error is returned and the item stays where it is.
//
// On Linux that is the freedesktop.org Trash specification 1.0. A trash is a
// folder with two folders in it: files/ holds the trashed items, and info/
// holds a <name>.trashinfo for each, saying where it came from and when,
// which is what a file manager's Restore reads. The item is only ever
// renamed, never copied, so it goes to a trash on its own device: the user's
// home trash ($XDG_DATA_HOME/Trash) when it is on the same device as that,
// and otherwise a trash in the top folder of its device. On Windows it is the
// Recycle Bin, through the shell.

#if defined(HAZE_PLATFORM_WIN32)

// SHFileOperationW returns its own legacy codes next to a few ordinary
// Windows error codes. This one is the source being denied.
#define HZSTD_TRASH_DE_ACCESSDENIEDSRC 0x78

hzstd_fs_error_t hzstd_move_to_trash(hzstd_str_t path)
{
  if (path.length <= 0) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_not_found,
      .message = HZSTD_STRING("no such file or folder", 22),
    };
  }
  // A NUL inside the path would cut it short and name a different item.
  if (path.length > INT_MAX || memchr(path.data, '\0', (size_t)path.length)) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_invalid_path,
      .message = HZSTD_STRING("invalid path", 12),
    };
  }

  int wideLength = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path.data, (int)path.length, NULL, 0);
  if (wideLength <= 0) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_invalid_path,
      .message = HZSTD_STRING("path is not valid UTF-8", 23),
    };
  }
  wchar_t* wide = (wchar_t*)malloc(((size_t)wideLength + 1) * sizeof(wchar_t));
  if (!wide) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_out_of_memory,
      .message = HZSTD_STRING("out of memory", 13),
    };
  }
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path.data, (int)path.length, wide, wideLength);
  wide[wideLength] = L'\0';

  // The shell expands a wildcard and would trash every item it matches. No
  // Windows file name can contain one, so such a path names no item.
  if (wcspbrk(wide, L"*?")) {
    free(wide);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_invalid_path,
      .message = HZSTD_STRING("path contains a wildcard", 24),
    };
  }

  // SHFileOperationW wants a full path: it resolves a relative one against
  // whatever the current folder is at that moment. Its list of paths ends in
  // two NULs, hence the room for one more.
  DWORD fullSize = GetFullPathNameW(wide, 0, NULL, NULL);
  wchar_t* full = fullSize > 0 ? (wchar_t*)malloc(((size_t)fullSize + 1) * sizeof(wchar_t)) : NULL;
  DWORD fullLength = full ? GetFullPathNameW(wide, fullSize, full, NULL) : 0;
  free(wide);
  if (!full || fullLength == 0 || fullLength >= fullSize) {
    free(full);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_invalid_path,
      .message = HZSTD_STRING("could not make the path absolute", 32),
    };
  }
  // A trailing separator names the same folder; the shell wants it without.
  while (fullLength > 3 && (full[fullLength - 1] == L'\\' || full[fullLength - 1] == L'/')) {
    fullLength--;
  }
  full[fullLength] = L'\0';
  full[fullLength + 1] = L'\0';

  if (GetFileAttributesW(full) == INVALID_FILE_ATTRIBUTES) {
    DWORD err = GetLastError();
    free(full);
    hzstd_fs_error_code_t code = hzstd_fs_error_from_windows_error(err);
    return (hzstd_fs_error_t) {
      .code = code,
      .message = code == hzstd_fs_error_code_not_found ? HZSTD_STRING("no such file or folder", 22)
                                                       : HZSTD_STRING("could not reach the item", 24),
    };
  }

  // FOF_ALLOWUNDO is what sends it to the Recycle Bin. When the bin cannot
  // take an item (a network drive, a file larger than the bin), the shell
  // deletes it for good instead, and FOF_NOCONFIRMATION alone would let it do
  // that without a word; FOF_WANTNUKEWARNING makes it ask the user first, and
  // a "no" there leaves the item where it is and reports the move aborted.
  SHFILEOPSTRUCTW operation;
  memset(&operation, 0, sizeof(operation));
  operation.hwnd = NULL;
  operation.wFunc = FO_DELETE;
  operation.pFrom = full;
  operation.pTo = NULL;
  operation.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_NOCONFIRMMKDIR
                     | FOF_WANTNUKEWARNING;
  int result = SHFileOperationW(&operation);
  BOOL aborted = operation.fAnyOperationsAborted;
  free(full);

  if (result != 0) {
    return (hzstd_fs_error_t) {
      .code = result == HZSTD_TRASH_DE_ACCESSDENIEDSRC ? hzstd_fs_error_code_permission_denied
                                                       : hzstd_fs_error_from_windows_error((DWORD)result),
      .message = HZSTD_STRING("could not move the item to the Recycle Bin", 42),
    };
  }
  if (aborted) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_io_error,
      .message = HZSTD_STRING("the move to the Recycle Bin was cancelled", 41),
    };
  }

  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

#else

// Every path one move works with, in one block on the heap rather than tens
// of kilobytes on the stack.
typedef struct {
  char name[PATH_MAX];   // the item's own name
  char parent[PATH_MAX]; // the folder it is in, resolved
  char item[PATH_MAX];   // its absolute path: `parent` + "/" + `name`
  char top[PATH_MAX];    // the top folder of its device
  char trash[PATH_MAX];  // the trash it goes to
  char files[PATH_MAX];  // its path in that trash
  char info[PATH_MAX];   // its .trashinfo
  char scratch[PATH_MAX];
  char trashinfo[3 * PATH_MAX + 64]; // the .trashinfo's text
} hzstd_trash_paths_t;

// `dir` + "/" + `name` into `out` (PATH_MAX bytes, never `dir` itself). 0, or
// ENAMETOOLONG when it does not fit.
static int hzstd_trash_join(char* out, const char* dir, const char* name)
{
  int n = strcmp(dir, "/") == 0 ? snprintf(out, PATH_MAX, "/%s", name)
                                : snprintf(out, PATH_MAX, "%s/%s", dir, name);
  return n < 0 || n >= PATH_MAX ? ENAMETOOLONG : 0;
}

// Makes the folder `path`, private to the user (0700), unless it is there. 0
// when a folder is there afterwards, else an errno value. `strict` is for a
// trash in a top folder that other users can write to: there it must not be
// a symbolic link and must belong to the user, or someone else could have
// made it to read what is trashed into it.
static int hzstd_trash_ensure_dir(const char* path, int strict)
{
  if (mkdir(path, 0700) != 0 && errno != EEXIST) {
    return errno;
  }
  struct stat st;
  if ((strict ? lstat(path, &st) : stat(path, &st)) != 0) {
    return errno;
  }
  if (!S_ISDIR(st.st_mode)) {
    return ENOTDIR;
  }
  if (strict && st.st_uid != getuid()) {
    return EACCES;
  }
  return 0;
}

// Makes the trash at `p->trash` and its files/ and info/ folders, as
// hzstd_trash_ensure_dir does.
static int hzstd_trash_ensure_layout(hzstd_trash_paths_t* p, int strict)
{
  int err = hzstd_trash_ensure_dir(p->trash, strict);
  if (!err) {
    err = hzstd_trash_join(p->scratch, p->trash, "files");
  }
  if (!err) {
    err = hzstd_trash_ensure_dir(p->scratch, strict);
  }
  if (!err) {
    err = hzstd_trash_join(p->scratch, p->trash, "info");
  }
  if (!err) {
    err = hzstd_trash_ensure_dir(p->scratch, strict);
  }
  return err;
}

// Makes the absolute folder `path` and every missing folder above it, each
// private to the user (0700, as the XDG base directory specification asks of
// the folders it makes). 0 or an errno value.
static int hzstd_trash_make_dirs(char* path)
{
  for (char* c = path + 1; *c; c++) {
    if (*c != '/') {
      continue;
    }
    *c = '\0';
    int err = mkdir(path, 0700) != 0 && errno != EEXIST ? errno : 0;
    *c = '/';
    if (err) {
      return err;
    }
  }
  return hzstd_trash_ensure_dir(path, 0);
}

// The home trash's path into `p->trash`: $XDG_DATA_HOME/Trash, or
// $HOME/.local/share/Trash when XDG_DATA_HOME is unset, empty or relative (a
// relative path there is to be ignored, says the XDG base directory
// specification). 0, or an errno value when there is none.
static int hzstd_trash_home(hzstd_trash_paths_t* p)
{
  const char* data = getenv("XDG_DATA_HOME");
  if (data && data[0] == '/') {
    return hzstd_trash_join(p->trash, data, "Trash");
  }
  const char* home = getenv("HOME");
  if (home && home[0] == '/') {
    return hzstd_trash_join(p->trash, home, ".local/share/Trash");
  }
  return ENOENT;
}

// The device of the absolute path `p->trash` into `device`, or the device it
// would be on once made: that of the nearest thing above it that exists. 0 or
// an errno value.
static int hzstd_trash_home_device(hzstd_trash_paths_t* p, dev_t* device)
{
  strcpy(p->scratch, p->trash);
  struct stat st;
  while (stat(p->scratch, &st) != 0) {
    if (strcmp(p->scratch, "/") == 0) {
      return errno;
    }
    char* last = strrchr(p->scratch, '/');
    if (last == p->scratch) {
      last++;
    }
    *last = '\0';
  }
  *device = st.st_dev;
  return 0;
}

// The trash in the top folder of the item's device (the highest folder above
// it still on `device`) into `p->trash`, made if needed: $topdir/.Trash/$uid
// when an administrator has set up $topdir/.Trash as a sticky folder for
// every user, otherwise $topdir/.Trash-$uid. 0 or an errno value.
static int hzstd_trash_top(hzstd_trash_paths_t* p, dev_t device)
{
  strcpy(p->top, p->parent);
  while (strcmp(p->top, "/") != 0) {
    char* cut = strrchr(p->top, '/');
    if (cut == p->top) {
      cut++; // the parent of "/tmp" is "/"
    }
    char kept = *cut;
    *cut = '\0';
    struct stat st;
    if (stat(p->top, &st) != 0 || st.st_dev != device) {
      *cut = kept;
      break;
    }
  }

  char uid[32];
  snprintf(uid, sizeof(uid), "%lu", (unsigned long)getuid());

  // The shared $topdir/.Trash counts only as a real folder (not a symbolic
  // link) with the sticky bit, so that no user can take another's folder in
  // it. When it fails that, or the user's folder in it cannot be made, the
  // specification falls back to $topdir/.Trash-$uid.
  struct stat st;
  int err = hzstd_trash_join(p->scratch, p->top, ".Trash");
  if (!err && lstat(p->scratch, &st) == 0 && S_ISDIR(st.st_mode) && (st.st_mode & S_ISVTX)) {
    err = hzstd_trash_join(p->trash, p->scratch, uid);
    if (!err && hzstd_trash_ensure_layout(p, 1) == 0) {
      return 0;
    }
  }

  char own[48];
  snprintf(own, sizeof(own), ".Trash-%s", uid);
  err = hzstd_trash_join(p->trash, p->top, own);
  if (!err) {
    err = hzstd_trash_ensure_layout(p, 1);
  }
  return err;
}

// The .trashinfo text for the item into `p->trashinfo`, and its length, or
// -1 when the time cannot be had. Path is the absolute path with every byte
// but the unreserved ones (A-Z a-z 0-9 - _ . ~) and "/" percent-encoded, and
// DeletionDate the local time.
static int hzstd_trash_info_text(hzstd_trash_paths_t* p)
{
  static const char hex[] = "0123456789ABCDEF";
  char* out = p->trashinfo;
  const char* header = "[Trash Info]\nPath=";
  memcpy(out, header, strlen(header));
  out += strlen(header);
  for (const unsigned char* c = (const unsigned char*)p->item; *c; c++) {
    if ((*c >= 'A' && *c <= 'Z') || (*c >= 'a' && *c <= 'z') || (*c >= '0' && *c <= '9') || *c == '-'
        || *c == '_' || *c == '.' || *c == '~' || *c == '/') {
      *out++ = (char)*c;
    }
    else {
      *out++ = '%';
      *out++ = hex[*c >> 4];
      *out++ = hex[*c & 15];
    }
  }

  time_t now = time(NULL);
  struct tm local;
  char date[32];
  if (!localtime_r(&now, &local) || strftime(date, sizeof(date), "%Y-%m-%dT%H:%M:%S", &local) == 0) {
    return -1;
  }
  out += sprintf(out, "\nDeletionDate=%s\n", date);
  return (int)(out - p->trashinfo);
}

// Writes all `length` bytes of `data` to `fd`. 0 or an errno value.
static int hzstd_trash_write_all(int fd, const char* data, int length)
{
  while (length > 0) {
    ssize_t written = write(fd, data, (size_t)length);
    if (written < 0 && errno == EINTR) {
      continue;
    }
    if (written <= 0) {
      return written < 0 ? errno : EIO;
    }
    data += written;
    length -= (int)written;
  }
  return 0;
}

// Puts the item into the trash at `p->trash` under the first free name: its
// own, then with .2, .3, ... appended. A name is taken while either half of
// an earlier item has it. The .trashinfo is made first, with O_EXCL, which
// reserves the name against every other program trashing at the same time;
// then the item is renamed into files/. When the rename fails, the .trashinfo
// goes again and the item is where it was.
static int hzstd_trash_put(hzstd_trash_paths_t* p)
{
  int length = hzstd_trash_info_text(p);
  if (length < 0) {
    return EIO;
  }

  for (unsigned long n = 1;; n++) {
    char suffix[32] = "";
    if (n > 1) {
      snprintf(suffix, sizeof(suffix), ".%lu", n);
    }
    int filesLength = snprintf(p->files, PATH_MAX, "%s/files/%s%s", p->trash, p->name, suffix);
    int infoLength = snprintf(p->info, PATH_MAX, "%s/info/%s%s.trashinfo", p->trash, p->name, suffix);
    if (filesLength < 0 || filesLength >= PATH_MAX || infoLength < 0 || infoLength >= PATH_MAX) {
      return ENAMETOOLONG;
    }

    struct stat st;
    if (lstat(p->files, &st) == 0) {
      continue;
    }
    if (errno != ENOENT) {
      return errno;
    }
    int fd = open(p->info, O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (fd < 0) {
      if (errno == EEXIST) {
        continue;
      }
      return errno;
    }

    int err = hzstd_trash_write_all(fd, p->trashinfo, length);
    if (close(fd) != 0 && !err) {
      err = errno;
    }
    if (!err && rename(p->item, p->files) != 0) {
      err = errno;
    }
    if (err) {
      unlink(p->info);
    }
    return err;
  }
}

// The whole move, 0 or an errno value.
static int hzstd_trash_move(const char* path, hzstd_trash_paths_t* p)
{
  // The item's own name and the folder it is in, as written. Trailing
  // slashes name the same item.
  size_t length = strlen(path);
  if (length == 0) {
    return ENOENT;
  }
  while (length > 1 && path[length - 1] == '/') {
    length--;
  }
  size_t nameStart = length;
  while (nameStart > 0 && path[nameStart - 1] != '/') {
    nameStart--;
  }
  size_t nameLength = length - nameStart;
  if (nameLength == 0 || (nameLength == 1 && path[nameStart] == '.')
      || (nameLength == 2 && path[nameStart] == '.' && path[nameStart + 1] == '.')) {
    return EINVAL; // "/", "." and ".." name no item that can be moved
  }
  if (nameLength >= PATH_MAX || nameStart > PATH_MAX) {
    return ENAMETOOLONG;
  }
  memcpy(p->name, path + nameStart, nameLength);
  p->name[nameLength] = '\0';
  if (nameStart == 0) {
    strcpy(p->scratch, ".");
  }
  else if (nameStart == 1) {
    strcpy(p->scratch, "/");
  }
  else {
    memcpy(p->scratch, path, nameStart - 1);
    p->scratch[nameStart - 1] = '\0';
  }

  // The absolute path: the folder resolved, the name kept as it is, so that
  // a symbolic link is trashed as the link and not as what it points to.
  if (!realpath(p->scratch, p->parent)) {
    return errno;
  }
  int err = hzstd_trash_join(p->item, p->parent, p->name);
  if (err) {
    return err;
  }
  struct stat st;
  if (lstat(p->item, &st) != 0) {
    return errno;
  }

  // The item's device is that of its folder, which is what rename() moves it
  // out of.
  if (stat(p->parent, &st) != 0) {
    return errno;
  }
  dev_t device = st.st_dev;

  // The home trash takes the items on its own device. When it cannot be
  // made, that is the error: the top folder trash of the home device is not
  // where an item of the user's belongs.
  int inHome = 0;
  dev_t homeDevice;
  if (hzstd_trash_home(p) == 0 && hzstd_trash_home_device(p, &homeDevice) == 0 && homeDevice == device) {
    err = hzstd_trash_make_dirs(p->trash);
    if (!err) {
      err = hzstd_trash_ensure_layout(p, 0);
    }
    if (err) {
      return err;
    }
    inHome = stat(p->trash, &st) == 0 && st.st_dev == device;
  }
  if (!inHome) {
    err = hzstd_trash_top(p, device);
    if (err) {
      return err;
    }
  }
  return hzstd_trash_put(p);
}

hzstd_fs_error_t hzstd_move_to_trash(hzstd_str_t path)
{
  HZSTD_SCRATCH_CSTR(nullTermPath, path);
  hzstd_trash_paths_t* paths = nullTermPath ? (hzstd_trash_paths_t*)malloc(sizeof(hzstd_trash_paths_t)) : NULL;
  if (!paths) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_out_of_memory,
      .message = HZSTD_STRING("out of memory", 13),
    };
  }

  // A NUL inside the path would cut it short and name a different item.
  int err = path.length > 0 && memchr(path.data, '\0', (size_t)path.length) ? EINVAL
                                                                            : hzstd_trash_move(nullTermPath, paths);
  free(paths);
  if (err) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }

  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

#endif

// ── Streaming writes ────────────────────────────────────────────────────────
//
// See the block comment on these in hzstd_filesystem.h for why they exist.
// Same fopen/mkdir-parent/errno-mapping behavior as hzstd_write_file_text, just
// split across three calls so the caller never has to hold the whole file.

hzstd_fs_error_t hzstd_file_open_write(hzstd_allocator_t allocator, hzstd_str_t path, void* out_handle_raw)
{
  if (!out_handle_raw) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_invalid_path,
      .message = HZSTD_STRING("out_handle must not be null", 27),
    };
  }
  void** out_handle = (void**)out_handle_raw;
  *out_handle = NULL;

  HZSTD_SCRATCH_CSTR(nullTermPath, path);
  if (!nullTermPath) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_out_of_memory,
      .message = HZSTD_STRING("out of memory", 13),
    };
  }

  // Create parent directory, not the file path itself -- same as
  // hzstd_write_file_text, so a streamed write can target a fresh directory.
  hzstd_str_t parent = hzstd_fs_parent_dir(nullTermPath);
  hzstd_mkdir_recursive(parent);

  FILE* f = fopen(nullTermPath, "wb");
  if (!f) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }

  // A big stdio buffer is what keeps this from becoming a syscall per append:
  // the caller emits many small chunks (one JSON event at a time), and the
  // default BUFSIZ (typically 4-8 KB) would turn that into millions of tiny
  // write()s. 1 MB is small enough to be irrelevant next to what streaming
  // saves, and large enough that the syscall count stops mattering.
  setvbuf(f, NULL, _IOFBF, 1024 * 1024);

  *out_handle = (void*)f;
  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

hzstd_fs_error_t hzstd_file_append_text(hzstd_allocator_t allocator, void* handle, hzstd_str_t input)
{
  if (!handle) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_io_error,
      .message = HZSTD_STRING("append to a closed or unopened file", 35),
    };
  }

  if (input.length <= 0) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_none,
      .message = HZSTD_STRING(NULL, 0),
    };
  }

  FILE* f = (FILE*)handle;
  size_t written = fwrite(input.data, 1, (size_t)input.length, f);
  if (written < (size_t)input.length) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_io_error,
      .message = hzstd_fs_errno_message(err),
    };
  }

  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

hzstd_fs_error_t
hzstd_file_open_read(hzstd_allocator_t allocator, hzstd_str_t path, void* out_handle_raw, void* out_size_raw)
{
  hzstd_int_t* out_size = (hzstd_int_t*)out_size_raw;
  if (!out_handle_raw || !out_size) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_invalid_path,
      .message = HZSTD_STRING("out_handle and out_size must not be null", 40),
    };
  }
  void** out_handle = (void**)out_handle_raw;
  *out_handle = NULL;
  *out_size = 0;

  HZSTD_SCRATCH_CSTR(nullTermPath, path);
  if (!nullTermPath) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_out_of_memory,
      .message = HZSTD_STRING("out of memory", 13),
    };
  }

  // Only a regular file is opened: the reader is made for one of a known
  // size, and a named pipe with no writer would block a plain open for ever.
  // So the open does not wait, and anything else is not_a_file.
#if defined(HAZE_PLATFORM_WIN32)
  FILE* f = fopen(nullTermPath, "rb");
  if (!f) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }
#else
  int fd = open(nullTermPath, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
  if (fd < 0) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }
  FILE* f = fdopen(fd, "rb");
  if (!f) {
    int err = errno;
    close(fd);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }
#endif

  struct STAT st;
  if (FSTAT(FILENO(f), &st) != 0) {
    int err = errno;
    fclose(f);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }
#if defined(HAZE_PLATFORM_WIN32)
  if (!(st.st_mode & _S_IFREG)) {
#else
  if (!S_ISREG(st.st_mode)) {
#endif
    fclose(f);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_not_a_file,
      .message = HZSTD_STRING("not a regular file", 18),
    };
  }
#if !defined(HAZE_PLATFORM_WIN32)
  // Reads of a regular file wait as reads always have.
  int flags = fcntl(fd, F_GETFL);
  if (flags != -1) {
    fcntl(fd, F_SETFL, flags & ~O_NONBLOCK);
  }
#endif

  *out_handle = f;
  *out_size = (hzstd_int_t)st.st_size;
  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

hzstd_fs_error_t hzstd_file_read_some(
    hzstd_allocator_t allocator, void* handle, void* dest, hzstd_int_t max_bytes, void* out_read_raw)
{
  hzstd_int_t* out_read = (hzstd_int_t*)out_read_raw;
  *out_read = 0;
  if (!handle || max_bytes <= 0) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_none,
      .message = HZSTD_STRING(NULL, 0),
    };
  }
  size_t got = fread(dest, 1, (size_t)max_bytes, (FILE*)handle);
  *out_read = (hzstd_int_t)got;
  if (got < (size_t)max_bytes && ferror((FILE*)handle)) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }
  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

hzstd_fs_error_t hzstd_file_close(hzstd_allocator_t allocator, void* handle)
{
  if (!handle) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_none,
      .message = HZSTD_STRING(NULL, 0),
    };
  }

  // fclose flushes first, so a write error that only surfaces at flush time
  // (a full disk being the usual one) is reported here rather than silently
  // truncating the file.
  if (fclose((FILE*)handle) != 0) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }

  return (hzstd_fs_error_t) {
    .code = hzstd_fs_error_code_none,
    .message = HZSTD_STRING(NULL, 0),
  };
}

hzstd_fs_error_t
hzstd_write_file_binary(hzstd_allocator_t allocator, hzstd_str_t path, void* buffer, hzstd_int_t length)
{
  if (!buffer || length <= 0) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_invalid_path,
      .message = HZSTD_STRING("invalid buffer or length", 24),
    };
  }

  HZSTD_SCRATCH_CSTR(nullTermPath, path);
  if (!nullTermPath) {
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_out_of_memory,
      .message = HZSTD_STRING("out of memory", 13),
    };
  }

  // Create parent directory, not the file path itself
  hzstd_str_t parent = hzstd_fs_parent_dir(nullTermPath);
  hzstd_mkdir_recursive(parent);

  FILE* f = fopen(nullTermPath, "wb");
  if (!f) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
    };
  }

  size_t written = fwrite(buffer, 1, (size_t)length, f);
  if (written < (size_t)length) {
    int err = errno;
    fclose(f);
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_code_io_error,
      .message = hzstd_fs_errno_message(err),
    };
  }

  if (fclose(f) != 0) {
    int err = errno;
    return (hzstd_fs_error_t) {
      .code = hzstd_fs_error_from_errno(err),
      .message = hzstd_fs_errno_message(err),
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
            .message = hzstd_fs_errno_message(err),
          };
        }

        if (MKDIR(tmp) != 0 && errno != EEXIST) {
          int err = errno;
          return (hzstd_fs_error_t) {
            .code = hzstd_fs_error_from_errno(err),
            .message = hzstd_fs_errno_message(err),
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
        .message = hzstd_fs_errno_message(err),
      };
    }

    if (MKDIR(tmp) != 0 && errno != EEXIST) {
      int err = errno;
      return (hzstd_fs_error_t) {
        .code = hzstd_fs_error_from_errno(err),
        .message = hzstd_fs_errno_message(err),
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
    .message = hzstd_fs_errno_message(err),
  };

  return result;
}


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
    return HZSTD_STRING("Unknown error", 13);
  }
  hzstd_str_t out = hzstd_cstr_dup(msg);
  LocalFree(msg);
  return out;
}
#endif

// --- Copy single file ---
static hzstd_fs_error_t
hzstd_fs_copy_file_internal(const char* src, const char* dst, const hzstd_fs_copy_options_t* opts)
{
  struct STAT st;
  if (STAT(src, &st) != 0) {
#if defined(HAZE_PLATFORM_LINUX)
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                .message = hzstd_fs_errno_message(errno) };
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
                                  .message = HZSTD_STRING("destination exists", 18) };
    }
  }

  int fd_src = open(src, O_RDONLY);
  if (fd_src < 0) {
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                .message = hzstd_fs_errno_message(errno) };
  }

  int fd_dst = open(dst, O_WRONLY | O_CREAT | O_TRUNC, st.st_mode & 0777);
  if (fd_dst < 0) {
    close(fd_src);
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                .message = hzstd_fs_errno_message(errno) };
  }

  char buf[8192];
  ssize_t r;
  while ((r = read(fd_src, buf, sizeof(buf))) > 0) {
    ssize_t w = write(fd_dst, buf, r);
    if (w != r) {
      close(fd_src);
      close(fd_dst);
      return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                  .message = hzstd_fs_errno_message(errno) };
    }
  }

  close(fd_src);
  close(fd_dst);
  if (r < 0) {
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                .message = hzstd_fs_errno_message(errno) };
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
                                .message = hzstd_fs_errno_message(errno) };
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
                                  .message = hzstd_fs_errno_message(errno) };
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
// The internals take C strings. A str is pointer + length and not
// NUL-terminated (a slice ends inside other bytes), so every path is copied by
// its length first; handing over the raw pointer read past the end of the path.
// The copies only live for the call, so they are scratch copies (HZSTD_SCRATCH_CSTR):
// on the stack, not the GC heap. The options are three bools and come by value
// for the same reason: as a pointer, Haze had to put them on the heap first.
hzstd_fs_error_t hzstd_fs_copy_file(hzstd_str_t src, hzstd_str_t dst, hzstd_fs_copy_options_t options)
{
  const hzstd_fs_copy_options_t* opts = &options;
  HZSTD_SCRATCH_CSTR(srcPath, src);
  HZSTD_SCRATCH_CSTR(dstPath, dst);
  if (!srcPath || !dstPath) {
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_code_out_of_memory, .message = HZSTD_STRING("out of memory", 13) };
  }
  return hzstd_fs_copy_file_internal(srcPath, dstPath, opts);
}

hzstd_fs_error_t hzstd_fs_copy_dir(hzstd_str_t src, hzstd_str_t dst, hzstd_fs_copy_options_t options)
{
  const hzstd_fs_copy_options_t* opts = &options;
  HZSTD_SCRATCH_CSTR(srcPath, src);
  HZSTD_SCRATCH_CSTR(dstPath, dst);
  if (!srcPath || !dstPath) {
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_code_out_of_memory, .message = HZSTD_STRING("out of memory", 13) };
  }
  return hzstd_fs_copy_dir_internal(srcPath, dstPath, opts);
}

hzstd_fs_error_t hzstd_fs_copy(hzstd_str_t src, hzstd_str_t dst, hzstd_fs_copy_options_t options)
{
  const hzstd_fs_copy_options_t* opts = &options;
  HZSTD_SCRATCH_CSTR(srcPath, src);
  HZSTD_SCRATCH_CSTR(dstPath, dst);
  if (!srcPath || !dstPath) {
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_code_out_of_memory, .message = HZSTD_STRING("out of memory", 13) };
  }
  struct STAT st;
  if (STAT(srcPath, &st) != 0) {
#if defined(HAZE_PLATFORM_LINUX)
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                .message = hzstd_fs_errno_message(errno) };
#elif defined(HAZE_PLATFORM_WIN32)
    DWORD err = GetLastError();
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_windows_error(err),
                                .message = hzstd_fs_windows_error(err) };
#endif
  }

  if (IS_DIR(st.st_mode)) {
    return hzstd_fs_copy_dir_internal(srcPath, dstPath, opts);
  }
  else {
    return hzstd_fs_copy_file_internal(srcPath, dstPath, opts);
  }
}

hzstd_fs_error_t hzstd_fs_move(hzstd_str_t src, hzstd_str_t dst, hzstd_fs_copy_options_t options)
{
  const hzstd_fs_copy_options_t* opts = &options;
  // Within one filesystem a move is a rename: instant whatever the size, and
  // atomic -- dst is the old file or the whole new one, never a partial copy,
  // which is what makes "write a temporary file, then move it over the real
  // one" a save that a crash cannot corrupt. Only a move to another
  // filesystem (or a directory onto an existing one, which is merged) falls
  // back to copying and deleting.
  HZSTD_SCRATCH_CSTR(srcPath, src);
  HZSTD_SCRATCH_CSTR(dstPath, dst);
  if (!srcPath || !dstPath) {
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_code_out_of_memory, .message = HZSTD_STRING("out of memory", 13) };
  }
#if defined(HAZE_PLATFORM_LINUX)
  {
    struct STAT dst_st;
    if (!opts->overwrite && STAT(dstPath, &dst_st) == 0) {
      return (hzstd_fs_error_t) { .code = hzstd_fs_error_code_already_exists,
                                  .message = HZSTD_STRING("destination exists", 18) };
    }
    hzstd_mkdir_recursive(hzstd_fs_parent_dir(dstPath));
    if (rename(srcPath, dstPath) == 0) {
      return (hzstd_fs_error_t) { .code = hzstd_fs_error_code_none };
    }
    if (errno != EXDEV && errno != ENOTEMPTY && errno != EEXIST && errno != EISDIR) {
      return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                  .message = hzstd_fs_errno_message(errno) };
    }
  }
#elif defined(HAZE_PLATFORM_WIN32)
  {
    hzstd_mkdir_recursive(hzstd_fs_parent_dir(dstPath));
    DWORD flags = opts->overwrite ? MOVEFILE_REPLACE_EXISTING : 0;
    if (MoveFileExA(srcPath, dstPath, flags)) {
      return (hzstd_fs_error_t) { .code = hzstd_fs_error_code_none };
    }
    DWORD moveErr = GetLastError();
    if (moveErr != ERROR_NOT_SAME_DEVICE && moveErr != ERROR_ACCESS_DENIED) {
      return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_windows_error(moveErr),
                                  .message = hzstd_fs_windows_error(moveErr) };
    }
  }
#endif

  hzstd_fs_error_t err = hzstd_fs_copy(src, dst, options);
  if (err.code != hzstd_fs_error_code_none) {
    return err;
  }

#if defined(HAZE_PLATFORM_LINUX)
  struct STAT st;
  if (STAT(srcPath, &st) != 0) {
    return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                .message = hzstd_fs_errno_message(errno) };
  }

  if (IS_DIR(st.st_mode)) {
    if (rmdir(srcPath) != 0) {
      return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                  .message = hzstd_fs_errno_message(errno) };
    }
  }
  else {
    if (unlink(srcPath) != 0) {
      return (hzstd_fs_error_t) { .code = hzstd_fs_error_from_errno(errno),
                                  .message = hzstd_fs_errno_message(errno) };
    }
  }
#elif defined(HAZE_PLATFORM_WIN32)
  if (IS_DIR(GetFileAttributesA(srcPath))) {
    RemoveDirectoryA(srcPath);
  }
  else {
    DeleteFileA(srcPath);
  }
#endif

  return (hzstd_fs_error_t) { .code = hzstd_fs_error_code_none };
}

#if defined(HAZE_PLATFORM_WIN32)
static int64_t hzstd_filetime_to_unix_ns(const FILETIME* ft)
{
  // Windows FILETIME is 100ns ticks since 1601-01-01
  const int64_t WINDOWS_TO_UNIX_EPOCH = 11644473600LL; // seconds
  uint64_t ticks = ((uint64_t)ft->dwHighDateTime << 32) | (uint64_t)ft->dwLowDateTime;

  int64_t seconds = (int64_t)(ticks / 10000000ULL);
  int64_t nanos = (int64_t)(ticks % 10000000ULL) * 100;

  return (seconds - WINDOWS_TO_UNIX_EPOCH) * 1000000000LL + nanos;
}
#endif

hzstd_file_stat_t hzstd_file_stat(hzstd_str_t path)
{
  hzstd_file_stat_t result = { 0, 0, 0 };

  const char* cpath = hzstd_raw_malloc_null_terminated_str(path);

#if defined(HAZE_PLATFORM_WIN32)
  WIN32_FILE_ATTRIBUTE_DATA data;
  if (!GetFileAttributesExA(cpath, GetFileExInfoStandard, &data)) {
    free((void*)cpath);
    return result;
  }

  result.exists = 1;

  uint64_t size = ((uint64_t)data.nFileSizeHigh << 32) | (uint64_t)data.nFileSizeLow;

  result.size = (int64_t)size;
  result.mtime_ns = hzstd_filetime_to_unix_ns(&data.ftLastWriteTime);
#elif defined(HAZE_PLATFORM_LINUX)
  struct stat st;
  if (stat(cpath, &st) != 0) {
    free((void*)cpath);
    return result;
  }

  result.exists = 1;
  result.size = (int64_t)st.st_size;

#if defined(__APPLE__)
  result.mtime_ns = (int64_t)st.st_mtimespec.tv_sec * 1000000000LL + (int64_t)st.st_mtimespec.tv_nsec;
#elif defined(st_mtim) || defined(__linux__)
  result.mtime_ns = (int64_t)st.st_mtim.tv_sec * 1000000000LL + (int64_t)st.st_mtim.tv_nsec;
#else
  result.mtime_ns = (int64_t)st.st_mtime * 1000000000LL;
#endif

#else
#error unknown platform
#endif

  free((void*)cpath);

  return result;
}

// --- Directory iteration ---

#if defined(HAZE_PLATFORM_LINUX)
typedef struct {
  DIR* dir;
  char base_path[HAZE_MAX_PATH_LENGTH];
  size_t base_path_len;
} hzstd_dir_handle_linux_t;

hzstd_open_dir_result_t hzstd_open_dir(hzstd_str_t path)
{
  if (path.data == NULL || path.length == 0) {
    return (hzstd_open_dir_result_t) { .handle = NULL, .error = hzstd_fs_error_code_invalid_path };
  }
  if (path.length >= HAZE_MAX_PATH_LENGTH) {
    return (hzstd_open_dir_result_t) { .handle = NULL, .error = hzstd_fs_error_code_name_too_long };
  }

  char tmp[HAZE_MAX_PATH_LENGTH];
  memcpy(tmp, path.data, path.length);
  tmp[path.length] = '\0';

  DIR* dir = opendir(tmp);
  if (!dir) {
    return (hzstd_open_dir_result_t) { .handle = NULL, .error = hzstd_fs_error_from_errno(errno) };
  }

  hzstd_dir_handle_linux_t* h = malloc(sizeof(hzstd_dir_handle_linux_t));
  if (!h) {
    closedir(dir);
    return (hzstd_open_dir_result_t) { .handle = NULL, .error = hzstd_fs_error_code_out_of_memory };
  }

  h->dir = dir;
  memcpy(h->base_path, path.data, path.length);
  h->base_path[path.length] = '\0';
  h->base_path_len = path.length;

  return (hzstd_open_dir_result_t) { .handle = h, .error = hzstd_fs_error_code_none };
}

hzstd_dir_entry_t hzstd_read_next_dir_entry(void* handle)
{
  hzstd_dir_handle_linux_t* h = (hzstd_dir_handle_linux_t*)handle;
  struct dirent* entry;

  while ((entry = readdir(h->dir)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
      continue;
    }

    bool is_dir;
    if (entry->d_type == DT_DIR) {
      is_dir = true;
    } else if (entry->d_type == DT_UNKNOWN || entry->d_type == DT_LNK) {
      // stat fallback for filesystems that don't populate d_type
      char full[HAZE_MAX_PATH_LENGTH];
      snprintf(full, sizeof(full), "%s/%s", h->base_path, entry->d_name);
      struct stat st;
      is_dir = (stat(full, &st) == 0) && S_ISDIR(st.st_mode);
    } else {
      is_dir = false;
    }

    return (hzstd_dir_entry_t) {
      .valid = true,
      .is_dir = is_dir,
      .name = hzstd_cstr_dup(entry->d_name),
    };
  }

  return (hzstd_dir_entry_t) { .valid = false };
}

void hzstd_close_dir(void* handle)
{
  if (!handle) return;
  hzstd_dir_handle_linux_t* h = (hzstd_dir_handle_linux_t*)handle;
  closedir(h->dir);
  free(h);
}

#elif defined(HAZE_PLATFORM_WIN32)

typedef struct {
  HANDLE hFind;
  WIN32_FIND_DATAA ffd;
  bool exhausted;
  bool has_pending; // ffd holds the next unconsumed entry
} hzstd_dir_handle_win32_t;

hzstd_open_dir_result_t hzstd_open_dir(hzstd_str_t path)
{
  if (path.data == NULL || path.length == 0) {
    return (hzstd_open_dir_result_t) { .handle = NULL, .error = hzstd_fs_error_code_invalid_path };
  }
  if (path.length + 2 >= HAZE_MAX_PATH_LENGTH) {
    return (hzstd_open_dir_result_t) { .handle = NULL, .error = hzstd_fs_error_code_name_too_long };
  }

  char pattern[HAZE_MAX_PATH_LENGTH];
  memcpy(pattern, path.data, path.length);
  pattern[path.length] = '\0';
  strcat(pattern, "\\*");

  hzstd_dir_handle_win32_t* h = malloc(sizeof(hzstd_dir_handle_win32_t));
  if (!h) {
    return (hzstd_open_dir_result_t) { .handle = NULL, .error = hzstd_fs_error_code_out_of_memory };
  }

  h->hFind = FindFirstFileA(pattern, &h->ffd);
  if (h->hFind == INVALID_HANDLE_VALUE) {
    DWORD err = GetLastError();
    free(h);
    return (hzstd_open_dir_result_t) { .handle = NULL, .error = hzstd_fs_error_from_windows_error(err) };
  }

  h->exhausted = false;
  h->has_pending = true;

  return (hzstd_open_dir_result_t) { .handle = h, .error = hzstd_fs_error_code_none };
}

hzstd_dir_entry_t hzstd_read_next_dir_entry(void* handle)
{
  hzstd_dir_handle_win32_t* h = (hzstd_dir_handle_win32_t*)handle;

  while (!h->exhausted) {
    WIN32_FIND_DATAA ffd;
    if (h->has_pending) {
      ffd = h->ffd;
      h->has_pending = false;
    } else {
      if (!FindNextFileA(h->hFind, &ffd)) {
        h->exhausted = true;
        break;
      }
    }

    if (strcmp(ffd.cFileName, ".") == 0 || strcmp(ffd.cFileName, "..") == 0) {
      continue;
    }

    bool is_dir = (ffd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
    return (hzstd_dir_entry_t) {
      .valid = true,
      .is_dir = is_dir,
      .name = hzstd_cstr_dup(ffd.cFileName),
    };
  }

  return (hzstd_dir_entry_t) { .valid = false };
}

void hzstd_close_dir(void* handle)
{
  if (!handle) return;
  hzstd_dir_handle_win32_t* h = (hzstd_dir_handle_win32_t*)handle;
  if (h->hFind != INVALID_HANDLE_VALUE) {
    FindClose(h->hFind);
  }
  free(h);
}

#endif
