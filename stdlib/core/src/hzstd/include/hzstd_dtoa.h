#ifndef HZSTD_DTOA_H
#define HZSTD_DTOA_H

#include <stddef.h>

// Room for any double hzstd_format_real can write, terminator included.
#define HZSTD_FORMAT_REAL_BUFFER_SIZE 32

// Writes `value` as the shortest decimal number that reads back as exactly
// the same double, and returns its length. The text is a valid JSON number
// and is NUL-terminated. `value` must be finite.
size_t hzstd_format_real(double value, char *buffer);

#endif // HZSTD_DTOA_H
