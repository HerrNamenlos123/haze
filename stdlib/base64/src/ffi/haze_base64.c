
#include "hzstd/hzstd_memory.h"
#include "hzstd/hzstd_string.h"

#include "public/haze_base64.h"

// Standard RFC 4648 alphabet (same table used by https://github.com/elzoughby/Base64).
static const char HAZE_BASE64_ALPHABET[64] = {
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
  'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f',
  'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v',
  'w', 'x', 'y', 'z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '/',
};

// -1 marks bytes that are not part of the alphabet (and are therefore invalid input).
static int haze_base64_decode_char(unsigned char c)
{
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

// Encoding can never fail -- any byte sequence has a valid Base64 representation --
// so this returns a plain hzstd_str_t (maps directly to Haze's `str`) rather than a result struct.
hzstd_str_t haze_base64_encode(hzstd_cptr_t data, hzstd_int_t length)
{
  if (length <= 0) {
    return HZSTD_STRING("", 0);
  }

  const unsigned char* bytes = (const unsigned char*)data;
  hzstd_int_t outLength = ((length + 2) / 3) * 4;

  // Atomic: the encoded text has no internal pointers for the collector to scan,
  // same as the raw pixel buffer in stdlib/image's haze_image.c.
  char* out = (char*)hzstd_heap_allocate_atomic((size_t)outLength);

  hzstd_int_t i = 0;
  hzstd_int_t o = 0;
  while (i + 3 <= length) {
    unsigned int n = ((unsigned int)bytes[i] << 16) | ((unsigned int)bytes[i + 1] << 8) | (unsigned int)bytes[i + 2];
    out[o++] = HAZE_BASE64_ALPHABET[(n >> 18) & 0x3F];
    out[o++] = HAZE_BASE64_ALPHABET[(n >> 12) & 0x3F];
    out[o++] = HAZE_BASE64_ALPHABET[(n >> 6) & 0x3F];
    out[o++] = HAZE_BASE64_ALPHABET[n & 0x3F];
    i += 3;
  }

  hzstd_int_t remaining = length - i;
  if (remaining == 1) {
    unsigned int n = (unsigned int)bytes[i] << 16;
    out[o++] = HAZE_BASE64_ALPHABET[(n >> 18) & 0x3F];
    out[o++] = HAZE_BASE64_ALPHABET[(n >> 12) & 0x3F];
    out[o++] = '=';
    out[o++] = '=';
  }
  else if (remaining == 2) {
    unsigned int n = ((unsigned int)bytes[i] << 16) | ((unsigned int)bytes[i + 1] << 8);
    out[o++] = HAZE_BASE64_ALPHABET[(n >> 18) & 0x3F];
    out[o++] = HAZE_BASE64_ALPHABET[(n >> 12) & 0x3F];
    out[o++] = HAZE_BASE64_ALPHABET[(n >> 6) & 0x3F];
    out[o++] = '=';
  }

  return HZSTD_STRING(out, outLength);
}

haze_base64_decode_result_t haze_base64_decode(hzstd_str_t data)
{
  haze_base64_decode_result_t result = { 0 };
  hzstd_int_t length = (hzstd_int_t)data.length;

  if (length == 0) {
    result.success = true;
    return result;
  }

  if (length % 4 != 0) {
    result.error = HZSTD_STRING_FROM_CSTR("Invalid Base64 string: length must be a multiple of 4");
    return result;
  }

  const unsigned char* input = (const unsigned char*)data.data;

  hzstd_int_t padding = 0;
  if (input[length - 1] == '=') padding++;
  if (input[length - 2] == '=') padding++;

  // Every character before the padding must be a valid alphabet character; '='
  // is only legal in the last one or two positions.
  for (hzstd_int_t i = 0; i < length - padding; i++) {
    if (input[i] == '=' || haze_base64_decode_char(input[i]) < 0) {
      result.error = HZSTD_STRING_FROM_CSTR("Invalid Base64 string: unexpected character");
      return result;
    }
  }

  hzstd_int_t outLength = (length / 4) * 3 - padding;
  void* out = NULL;
  if (outLength > 0) {
    out = hzstd_heap_allocate_atomic((size_t)outLength);
  }
  unsigned char* bytesOut = (unsigned char*)out;

  hzstd_int_t o = 0;
  for (hzstd_int_t i = 0; i < length; i += 4) {
    int a = haze_base64_decode_char(input[i]);
    int b = haze_base64_decode_char(input[i + 1]);
    int c = (input[i + 2] == '=') ? 0 : haze_base64_decode_char(input[i + 2]);
    int d = (input[i + 3] == '=') ? 0 : haze_base64_decode_char(input[i + 3]);

    unsigned int n = ((unsigned int)a << 18) | ((unsigned int)b << 12) | ((unsigned int)c << 6) | (unsigned int)d;

    if (o < outLength) bytesOut[o++] = (unsigned char)((n >> 16) & 0xFF);
    if (o < outLength) bytesOut[o++] = (unsigned char)((n >> 8) & 0xFF);
    if (o < outLength) bytesOut[o++] = (unsigned char)(n & 0xFF);
  }

  result.success = true;
  result.data = out;
  result.length = outLength;
  return result;
}
