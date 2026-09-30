#ifndef HZ_PDF_H
#define HZ_PDF_H

#include "hzstd/hzstd_types.h"

// A growing byte buffer for a page's operators, with the number formatting
// done in C: a page of handwriting is hundreds of thousands of numbers. The
// handle is an hz_pdf_buffer_t in GC memory, like its bytes, so it needs no
// cleanup.

// Numbers are written with at most `decimals` decimal places (0 to 8).
hzstd_cptr_t hz_pdf_buffer_create(hzstd_int_t decimals);
// Appends the number and a space.
void hz_pdf_buffer_number(hzstd_cptr_t b, hzstd_real_t value);
void hz_pdf_buffer_text(hzstd_cptr_t b, hzstd_str_t text);
hzstd_int_t hz_pdf_buffer_length(hzstd_cptr_t b);
// Hands over the bytes so far; the buffer starts over empty.
hzstd_cptr_t hz_pdf_buffer_take(hzstd_cptr_t b);

hzstd_str_t hz_pdf_format_number(hzstd_real_t value, hzstd_int_t decimals);

typedef struct {
  bool ok;
  hzstd_int_t width;
  hzstd_int_t height;
  hzstd_int_t components;
  // An Adobe APP14 marker: its CMYK is stored inverted.
  bool adobe;
  hzstd_str_t error;
} hz_pdf_jpeg_info_t;

hz_pdf_jpeg_info_t hz_pdf_jpeg_info(hzstd_cptr_t data, hzstd_int_t length);

// Copies channels [first, first + count) of `pixelCount` pixels of
// `channels` bytes each into a new GC buffer of pixelCount * count bytes.
hzstd_cptr_t hz_pdf_extract_channels(hzstd_cptr_t pixels, hzstd_int_t pixelCount, hzstd_int_t channels,
                                     hzstd_int_t first, hzstd_int_t count);
// Whether any of `length` bytes is below 255.
bool hz_pdf_any_below_255(hzstd_cptr_t data, hzstd_int_t length);

#endif // HZ_PDF_H
