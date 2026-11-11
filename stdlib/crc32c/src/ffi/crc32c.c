// CRC-32C (Castagnoli, reflected polynomial 0x82F63B78), slicing-by-8: eight
// bytes per step through eight 256-entry tables, about eight times the speed
// of the byte-at-a-time loop, with nothing but table lookups and xors.
#include <stdint.h>
#include <string.h>

#include "crc32c_tables.h"

// `crc` is the running register, already inverted (~0 to start).
static uint32_t haze_crc32c_process(uint32_t crc, const uint8_t* data, size_t length)
{
  while (length > 0 && ((uintptr_t)data & 7) != 0) {
    crc = haze_crc32c_table[0][(crc ^ *data++) & 0xff] ^ (crc >> 8);
    length--;
  }
  while (length >= 8) {
    uint64_t word;
    memcpy(&word, data, 8);
    // Little-endian only, as every Haze target is (HZSTD_ASSERT_LITTLE_ENDIAN
    // holds for each build): the first byte is the lowest.
    _Static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__, "crc32c needs a little-endian target");
    uint32_t low = (uint32_t)word ^ crc;
    uint32_t high = (uint32_t)(word >> 32);
    crc = haze_crc32c_table[7][low & 0xff] ^ haze_crc32c_table[6][(low >> 8) & 0xff] ^
          haze_crc32c_table[5][(low >> 16) & 0xff] ^ haze_crc32c_table[4][low >> 24] ^
          haze_crc32c_table[3][high & 0xff] ^ haze_crc32c_table[2][(high >> 8) & 0xff] ^
          haze_crc32c_table[1][(high >> 16) & 0xff] ^ haze_crc32c_table[0][high >> 24];
    data += 8;
    length -= 8;
  }
  while (length > 0) {
    crc = haze_crc32c_table[0][(crc ^ *data++) & 0xff] ^ (crc >> 8);
    length--;
  }
  return crc;
}

uint32_t haze_crc32c_update(uint32_t crc, const void* data, int64_t length)
{
  if (length <= 0) {
    return crc;
  }
  return ~haze_crc32c_process(~crc, (const uint8_t*)data, (size_t)length);
}
