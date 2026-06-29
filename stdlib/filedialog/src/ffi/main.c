
#include <hzstd/hzstd_array.h>
#include <hzstd/hzstd_common.h>
#include <hzstd/hzstd_string.h>

#include "hzstd/hzstd_string.h"
#include "nfd_common.c"

#if defined(HAZE_PLATFORM_WIN32)
#include "nfd_win32.cpp"
#elif defined(HAZE_PLATFORM_LINUX)
#include "nfd_zenity.c"
#else
#error "Unsupported platform"
#endif

void hz_filedialog_open_dialog()
{
  nfdchar_t* outPath = NULL;
  nfdresult_t result = NFD_OpenDialog(NULL, NULL, &outPath);

  if (result == NFD_OKAY) {
    puts("Success!");
    puts(outPath);
    free(outPath);
  }
  else if (result == NFD_CANCEL) {
    puts("User pressed cancel.");
  }
  else {
    printf("Error: %s\n", NFD_GetError());
  }
}