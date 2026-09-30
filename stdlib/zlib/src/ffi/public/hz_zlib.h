#ifndef HZ_ZLIB_H
#define HZ_ZLIB_H

#include "hzstd/hzstd_types.h"

// A zlib stream (RFC 1950) being compressed, fed a piece at a time. The
// handle is an hz_zlib_deflater_t in GC memory, like everything it points
// to, so an abandoned one needs no cleanup.
hzstd_cptr_t hz_zlib_deflater_create(hzstd_int_t level);
void hz_zlib_deflater_write(hzstd_cptr_t d, hzstd_cptr_t data, hzstd_int_t length);
void hz_zlib_deflater_finish(hzstd_cptr_t d);
hzstd_int_t hz_zlib_deflater_output_length(hzstd_cptr_t d);
hzstd_cptr_t hz_zlib_deflater_take_output(hzstd_cptr_t d);
hzstd_int_t hz_zlib_deflater_total_in(hzstd_cptr_t d);
hzstd_int_t hz_zlib_deflater_total_out(hzstd_cptr_t d);

#endif // HZ_ZLIB_H
