// UTF-8 <-> UTF-16 for the Win32 calls.
//
// Haze strings are UTF-8, and every Windows call hzstd makes that takes or
// returns text is the UTF-16 (...W) variant: an ANSI (...A) call reads the
// bytes in the system's ANSI code page instead, which garbles anything outside
// it ("日本", "✓", on most systems also "Ü"). These conversions are the only
// place the encodings meet. hzstd_win_utf16 and hzstd_win_utf8 return malloc'd
// text (it lives for one call), NUL-terminated, for the caller to free;
// hzstd_win_utf8_into writes into the caller's buffer.
//
// Needs <windows.h> and <stdlib.h> before it is included.

#ifndef HZSTD_WIN_UTF16_H
#define HZSTD_WIN_UTF16_H

#include <limits.h>
#include <stdbool.h>
#include <stddef.h>

// `length` bytes of UTF-8 as UTF-16; *invalid is set when they are not valid
// UTF-8 (and NULL returned), NULL with *invalid false means out of memory.
static inline wchar_t* hzstd_win_utf16(const char* text, size_t length, bool* invalid)
{
  *invalid = false;
  if (length > INT_MAX) {
    *invalid = true;
    return NULL;
  }
  int wideLength = 0;
  if (length > 0) {
    wideLength = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text, (int)length, NULL, 0);
    if (wideLength <= 0) {
      *invalid = true;
      return NULL;
    }
  }
  wchar_t* wide = (wchar_t*)malloc(((size_t)wideLength + 1) * sizeof(wchar_t));
  if (!wide) {
    return NULL;
  }
  if (wideLength > 0) {
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text, (int)length, wide, wideLength);
  }
  wide[wideLength] = L'\0';
  return wide;
}

// A NUL-terminated UTF-16 string as UTF-8 in `buffer` (`room` bytes), itself
// NUL-terminated; its byte length, or -1 when it does not fit. Unpaired
// surrogates (which Windows names may hold) become U+FFFD.
static inline int hzstd_win_utf8_into(const wchar_t* wide, char* buffer, size_t room)
{
  int bytes = WideCharToMultiByte(CP_UTF8, 0, wide, -1, buffer, room > INT_MAX ? INT_MAX : (int)room, NULL, NULL);
  return bytes > 0 ? bytes - 1 : -1;
}

// A NUL-terminated UTF-16 string as UTF-8, its byte length in *length. NULL
// when memory runs out. Unpaired surrogates become U+FFFD.
static inline char* hzstd_win_utf8(const wchar_t* wide, size_t* length)
{
  int bytes = WideCharToMultiByte(CP_UTF8, 0, wide, -1, NULL, 0, NULL, NULL);
  if (bytes <= 0) {
    return NULL;
  }
  char* text = (char*)malloc((size_t)bytes);
  if (!text) {
    return NULL;
  }
  WideCharToMultiByte(CP_UTF8, 0, wide, -1, text, bytes, NULL, NULL);
  *length = (size_t)bytes - 1;
  return text;
}

#endif
