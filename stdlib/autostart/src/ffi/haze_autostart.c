#include "hzstd/hzstd_types.h"

#if defined(HAZE_PLATFORM_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <stdio.h>
#include <windows.h>

#define HAZE_AUTOSTART_RUN_KEY L"Software\\Microsoft\\Windows\\CurrentVersion\\Run"
#define HAZE_AUTOSTART_APPROVED_KEY L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run"

static void haze_autostart_widen(hzstd_str_t text, wchar_t *out, int capacity)
{
  int written = MultiByteToWideChar(CP_UTF8, 0, text.data, (int)text.length, out, capacity - 1);
  out[written > 0 ? written : 0] = 0;
}

hzstd_bool_t haze_autostart_set(hzstd_str_t appId, hzstd_str_t args, hzstd_bool_t enabled)
{
  wchar_t name[256];
  haze_autostart_widen(appId, name, 256);
  if (!enabled) {
    LSTATUS status = RegDeleteKeyValueW(HKEY_CURRENT_USER, HAZE_AUTOSTART_RUN_KEY, name);
    return status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND;
  }

  wchar_t exe[MAX_PATH];
  if (!GetModuleFileNameW(NULL, exe, MAX_PATH)) {
    return false;
  }
  wchar_t wideArgs[1024];
  haze_autostart_widen(args, wideArgs, 1024);
  wchar_t command[MAX_PATH + 1024 + 4];
  _snwprintf(command, sizeof(command) / sizeof(wchar_t), L"\"%ls\" %ls", exe, wideArgs);
  command[sizeof(command) / sizeof(wchar_t) - 1] = 0;
  RegDeleteKeyValueW(HKEY_CURRENT_USER, HAZE_AUTOSTART_APPROVED_KEY, name);
  return RegSetKeyValueW(HKEY_CURRENT_USER, HAZE_AUTOSTART_RUN_KEY, name, REG_SZ, command,
                         (DWORD)((wcslen(command) + 1) * sizeof(wchar_t))) == ERROR_SUCCESS;
}

hzstd_bool_t haze_autostart_is_enabled(hzstd_str_t appId)
{
  wchar_t name[256];
  haze_autostart_widen(appId, name, 256);
  return RegGetValueW(HKEY_CURRENT_USER, HAZE_AUTOSTART_RUN_KEY, name, RRF_RT_REG_SZ, NULL, NULL, NULL) ==
         ERROR_SUCCESS;
}

#else
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int haze_autostart_dir(char *out, size_t capacity)
{
  const char *config = getenv("XDG_CONFIG_HOME");
  if (config && config[0]) {
    return snprintf(out, capacity, "%s/autostart", config) < (int)capacity;
  }
  const char *home = getenv("HOME");
  if (!home) {
    return 0;
  }
  return snprintf(out, capacity, "%s/.config/autostart", home) < (int)capacity;
}

static int haze_autostart_path(hzstd_str_t appId, char *out, size_t capacity)
{
  char dir[4096];
  if (!haze_autostart_dir(dir, sizeof(dir))) {
    return 0;
  }
  return snprintf(out, capacity, "%s/%.*s.desktop", dir, (int)appId.length, appId.data) < (int)capacity;
}

hzstd_bool_t haze_autostart_set(hzstd_str_t appId, hzstd_str_t args, hzstd_bool_t enabled)
{
  char path[4096];
  if (!haze_autostart_path(appId, path, sizeof(path))) {
    return false;
  }
  if (!enabled) {
    return unlink(path) == 0 || access(path, F_OK) != 0;
  }

  char exe[4096];
  ssize_t length = readlink("/proc/self/exe", exe, sizeof(exe) - 1);
  if (length <= 0) {
    return false;
  }
  exe[length] = 0;

  char dir[4096];
  haze_autostart_dir(dir, sizeof(dir));
  char *slash = strrchr(dir, '/');
  if (slash) {
    *slash = 0;
    mkdir(dir, 0755);
    *slash = '/';
  }
  mkdir(dir, 0755);

  FILE *file = fopen(path, "w");
  if (!file) {
    return false;
  }
  fprintf(file,
          "[Desktop Entry]\nType=Application\nName=%.*s\nExec=\"%s\" %.*s\nNoDisplay=true\n"
          "X-GNOME-Autostart-enabled=true\n",
          (int)appId.length, appId.data, exe, (int)args.length, args.data);
  return fclose(file) == 0;
}

hzstd_bool_t haze_autostart_is_enabled(hzstd_str_t appId)
{
  char path[4096];
  return haze_autostart_path(appId, path, sizeof(path)) && access(path, F_OK) == 0;
}
#endif
