#include <errno.h>
#include <ftw.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int unlink_cb(const char* fpath, const struct stat* sb, int typeflag, struct FTW* ftwbuf)
{
  int rv = remove(fpath);
  if (rv) {
    perror(fpath);
  }
  return rv;
}

int haze_filesystem_remove(const char* path) { return nftw(path, unlink_cb, 64, FTW_DEPTH | FTW_PHYS); }

char* haze_get_errno_string() { return strerror(errno); }

int haze_filename_exists(const char* path)
{
  if (access(path, F_OK) == 0) {
    return 1;
  }
  else {
    return 0;
  }
}

int haze_mkdir(const char* path) { return mkdir(path, S_IRWXU); }