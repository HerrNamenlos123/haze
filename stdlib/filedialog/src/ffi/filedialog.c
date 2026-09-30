
#include <hzstd/hzstd_types.h>
#include <hzstd/include/hzstd_array.h>
#include <hzstd/include/hzstd_string.h>

#include "ffi/nfd.h"
#include "hzstd/include/hzstd_memory.h"
#include "hzstd/include/hzstd_string.h"
#include "hzstd/include/hzstd_platform.h"
#include "nfd_common.c"

#if defined(HAZE_PLATFORM_WIN32)
#include "nfd_win.c"
#elif defined(HAZE_PLATFORM_LINUX)
#include "nfd_zenity.c"
#else
#error "Unsupported platform"
#endif

typedef enum {
  hz_filedialog_result_ok = 1,
  hz_filedialog_result_cancel = 2,
  hz_filedialog_result_error = 3,
} hz_filedialog_result_t;

// path is only valid when result == hz_filedialog_result_ok.
// error is only valid when result == hz_filedialog_result_error.
typedef struct {
  hz_filedialog_result_t result;
  hzstd_str_t path;
  hzstd_str_t error;
} hz_filedialog_path_result_t;

// error is only valid when result == hz_filedialog_result_error.
typedef struct {
  hz_filedialog_result_t result;
  hzstd_str_t error;
} hz_filedialog_multiple_result_t;

hz_filedialog_path_result_t
hz_filedialog_open_dialog(hzstd_str_t filters, hzstd_str_t defaultPath) {
  const char *c_filters =
      filters.length > 0
          ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), filters)
          : NULL;

  nfdchar_t *c_defaultPath =
      defaultPath.length > 0
          ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), defaultPath)
          : NULL;

  nfdchar_t *c_outPath = NULL;
  nfdresult_t result = NFD_OpenDialog(c_filters, c_defaultPath, &c_outPath);

  if (result == NFD_OKAY) {
    hzstd_str_t path =
        hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), c_outPath);
    free(c_outPath);
    return (hz_filedialog_path_result_t){.result = hz_filedialog_result_ok, .path = path};
  } else if (result == NFD_CANCEL) {
    return (hz_filedialog_path_result_t){.result = hz_filedialog_result_cancel};
  } else {
    const char *error = NFD_GetError();
    hzstd_str_t errorMessage =
        hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), (char *)error);
    return (hz_filedialog_path_result_t){.result = hz_filedialog_result_error, .error = errorMessage};
  }
}

hz_filedialog_multiple_result_t
hz_filedialog_open_dialog_multiple(hzstd_str_t filters, hzstd_str_t defaultPath,
                                   hzstd_dynamic_array_t *outPaths) {
  const char *c_filters =
      filters.length > 0
          ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), filters)
          : NULL;

  nfdchar_t *c_defaultPath =
      defaultPath.length > 0
          ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), defaultPath)
          : NULL;

  nfdpathset_t c_outPaths;
  nfdresult_t result =
      NFD_OpenDialogMultiple(c_filters, c_defaultPath, &c_outPaths);

  if (result == NFD_OKAY) {
    hzstd_allocator_t arena = hzstd_make_arena_allocator();
    for (size_t i = 0; i < NFD_PathSet_GetCount(&c_outPaths); ++i) {
      nfdchar_t *c_path = NFD_PathSet_GetPath(&c_outPaths, i);
      hzstd_str_t path = hzstd_str_from_cstr_dup(arena, c_path);
      HZSTD_DYNAMIC_ARRAY_PUSH(outPaths, path);
    }
    NFD_PathSet_Free(&c_outPaths);
    return (hz_filedialog_multiple_result_t){.result = hz_filedialog_result_ok};
  } else if (result == NFD_CANCEL) {
    return (hz_filedialog_multiple_result_t){.result = hz_filedialog_result_cancel};
  } else {
    const char *error = NFD_GetError();
    hzstd_str_t errorMessage =
        hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), (char *)error);
    return (hz_filedialog_multiple_result_t){.result = hz_filedialog_result_error, .error = errorMessage};
  }
}

hz_filedialog_path_result_t
hz_filedialog_save_dialog(hzstd_str_t filters, hzstd_str_t defaultPath) {
  const char *c_filters =
      filters.length > 0
          ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), filters)
          : NULL;

  nfdchar_t *c_defaultPath =
      defaultPath.length > 0
          ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), defaultPath)
          : NULL;

  nfdchar_t *c_outPath = NULL;
  nfdresult_t result = NFD_SaveDialog(c_filters, c_defaultPath, &c_outPath);

  if (result == NFD_OKAY) {
    hzstd_str_t path =
        hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), c_outPath);
    free(c_outPath);
    return (hz_filedialog_path_result_t){.result = hz_filedialog_result_ok, .path = path};
  } else if (result == NFD_CANCEL) {
    return (hz_filedialog_path_result_t){.result = hz_filedialog_result_cancel};
  } else {
    const char *error = NFD_GetError();
    hzstd_str_t errorMessage =
        hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), (char *)error);
    return (hz_filedialog_path_result_t){.result = hz_filedialog_result_error, .error = errorMessage};
  }
}

hz_filedialog_path_result_t
hz_filedialog_open_folder_dialog(hzstd_str_t defaultPath) {
  nfdchar_t *c_defaultPath =
      defaultPath.length > 0
          ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), defaultPath)
          : NULL;

  nfdchar_t *c_outPath = NULL;
  nfdresult_t result = NFD_PickFolder(c_defaultPath, &c_outPath);

  if (result == NFD_OKAY) {
    hzstd_str_t path =
        hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), c_outPath);
    free(c_outPath);
    return (hz_filedialog_path_result_t){.result = hz_filedialog_result_ok, .path = path};
  } else if (result == NFD_CANCEL) {
    return (hz_filedialog_path_result_t){.result = hz_filedialog_result_cancel};
  } else {
    const char *error = NFD_GetError();
    hzstd_str_t errorMessage =
        hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), (char *)error);
    return (hz_filedialog_path_result_t){.result = hz_filedialog_result_error, .error = errorMessage};
  }
}

// ── Dialogs on a worker thread ──────────────────────────────────────────────
//
// The dialogs above block the calling thread until the user closes them --
// the zenity backend waits for the zenity process, the Windows one runs the
// dialog's own message loop. Called from an app's frame loop, that freezes
// its window for as long as the dialog is open. These run the same call on a
// worker thread instead; the caller polls hz_filedialog_job_done and then
// takes the result on its own thread, where the Haze strings are made.

typedef enum {
  hz_filedialog_kind_open = 1,
  hz_filedialog_kind_save = 2,
  hz_filedialog_kind_folder = 3,
} hz_filedialog_kind_t;

typedef struct {
  hz_filedialog_kind_t kind;
  // NULL for none, as the blocking calls pass them.
  const char *filters;
  nfdchar_t *defaultPath;

  int done;
  nfdresult_t result;
  // malloc'd by NFD; handed over as a Haze string and freed by
  // hz_filedialog_job_result.
  nfdchar_t *outPath;
  // NFD keeps its error in one global, which another dialog may overwrite:
  // copied here as soon as the call returns.
  char error[NFD_MAX_STRLEN];
  bool collected;
  hz_filedialog_path_result_t collectedResult;
} hz_filedialog_job_t;

static void hz_filedialog_job_run(void *arg)
{
  hz_filedialog_job_t *job = arg;
  nfdresult_t result = NFD_ERROR;
  if (job->kind == hz_filedialog_kind_open) {
    result = NFD_OpenDialog(job->filters, job->defaultPath, &job->outPath);
  }
  else if (job->kind == hz_filedialog_kind_save) {
    result = NFD_SaveDialog(job->filters, job->defaultPath, &job->outPath);
  }
  else {
    result = NFD_PickFolder(job->defaultPath, &job->outPath);
  }
  if (result == NFD_ERROR) {
    NFDi_SafeStrncpy(job->error, NFD_GetError(), NFD_MAX_STRLEN);
  }
  job->result = result;
  __atomic_store_n(&job->done, 1, __ATOMIC_RELEASE);
}

static hzstd_cptr_t hz_filedialog_job_start(hz_filedialog_kind_t kind, hzstd_str_t filters, hzstd_str_t defaultPath)
{
  // GC memory, not atomic: it holds the strings below. The worker keeps it
  // alive while it runs, the Haze side for as long as it polls.
  hz_filedialog_job_t *job = hzstd_heap_allocate(sizeof(hz_filedialog_job_t), NULL);
  memset(job, 0, sizeof(*job));
  job->kind = kind;
  job->filters = filters.length > 0 ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), filters) : NULL;
  job->defaultPath = defaultPath.length > 0 ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), defaultPath) : NULL;
  if (!hzstd_run_on_worker_thread(hz_filedialog_job_run, job)) {
    // No thread to be had: block, as the plain calls do, rather than fail.
    hz_filedialog_job_run(job);
  }
  return job;
}

hzstd_cptr_t hz_filedialog_open_dialog_async(hzstd_str_t filters, hzstd_str_t defaultPath)
{
  return hz_filedialog_job_start(hz_filedialog_kind_open, filters, defaultPath);
}

hzstd_cptr_t hz_filedialog_save_dialog_async(hzstd_str_t filters, hzstd_str_t defaultPath)
{
  return hz_filedialog_job_start(hz_filedialog_kind_save, filters, defaultPath);
}

hzstd_cptr_t hz_filedialog_open_folder_dialog_async(hzstd_str_t defaultPath)
{
  return hz_filedialog_job_start(hz_filedialog_kind_folder, HZSTD_STRING(NULL, 0), defaultPath);
}

bool hz_filedialog_job_done(hzstd_cptr_t job_)
{
  hz_filedialog_job_t *job = job_;
  return __atomic_load_n(&job->done, __ATOMIC_ACQUIRE) != 0;
}

// Only once hz_filedialog_job_done; the same result however often it is
// asked for.
hz_filedialog_path_result_t hz_filedialog_job_result(hzstd_cptr_t job_)
{
  hz_filedialog_job_t *job = job_;
  if (job->collected) {
    return job->collectedResult;
  }
  hz_filedialog_path_result_t result = { 0 };
  if (job->result == NFD_OKAY) {
    result.result = hz_filedialog_result_ok;
    result.path = hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), job->outPath);
    free(job->outPath);
    job->outPath = NULL;
  }
  else if (job->result == NFD_CANCEL) {
    result.result = hz_filedialog_result_cancel;
  }
  else {
    result.result = hz_filedialog_result_error;
    result.error = hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), job->error);
  }
  job->collected = true;
  job->collectedResult = result;
  return result;
}
