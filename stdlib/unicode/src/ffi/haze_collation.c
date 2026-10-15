// Unicode collation: comparing strings the way people expect them sorted.
//
// This is the Unicode Collation Algorithm (UTS #10) over CLDR's root
// collation, at tertiary strength with the "non-ignorable" setting -- the
// order ICU (and so JavaScript's `localeCompare`) uses by default for every
// language without a tailoring of its own, German and English among them.
// With `numeric`, a run of decimal digits compares by its value, like ICU's
// numeric collation (`{ numeric: true }`).
//
// What that order is, roughly: case and accents are ignored at first
// ("a" = "A" = "ä"), whitespace < punctuation < symbols < currency < digits
// < letters, and letters go by their script's alphabet. Only strings equal
// under that are then told apart by their accents (secondary level), and only
// after that by case and variant forms (tertiary level: "a" < "A").
//
// === How ===
//
// A string becomes a SORT KEY: a byte string whose plain byte order
// (memcmp, then length) is the collation order. Building it:
//
//   1. Decode UTF-8 (an invalid byte becomes U+FFFD, as a browser would read
//      it) and normalize to NFD with utf8proc, which also puts combining
//      marks into canonical order. The table only has NFD entries.
//   2. Map each code point -- or a contraction, a sequence with weights of its
//      own -- to its collation elements (CEs): three weights each, primary
//      (base letter), secondary (accent), tertiary (case/variant). A code
//      point the table lacks gets UCA's implicit weights (section 10.1.3).
//   3. Write every non-zero primary weight, a 0x00 separator, every non-zero
//      secondary weight, 0x00, every non-zero tertiary weight.
//
// Byte layout of the weights, chosen so that a weight never compares against
// a separator unless the other key really ended there: a primary is 3 bytes
// (its two weight bytes, then 0x00 -- the third byte is only ever non-zero
// for a number, below), a secondary 2 bytes (high byte + 1, low byte), a
// tertiary 1 byte. Every weight's first byte is non-zero, so a key that ends
// a level earlier (its 0x00 separator) sorts first, as UCA requires.
//
// === Numbers ===
//
// In numeric mode a run of decimal digits (any script's: Unicode category Nd)
// becomes one primary of 3 bytes -- the primary just below DIGIT ZERO's, then
// the digit count -- followed by one byte per digit. Leading zeros are dropped
// (keeping one: "0" and "000" are both zero), so a longer number is a larger
// one and two numbers of the same length compare digit by digit. On the
// other levels a number counts as one ordinary character. That gives ICU's
// observable behaviour: "2" < "10", "01" = "1", every number sorts after the
// currency symbols and before digit-like non-digits such as "²" or "½" (which
// keep their ordinary weights). A run longer than 254 digits is split, as in
// ICU.
//
// === Not implemented ===
//
// Discontiguous contractions (a contraction whose parts are separated by a
// combining mark) match only when contiguous; no tailorings, no alternate
// shifted / backwards-secondary / case-first options, no identical level.
// None of them occur in ICU's default root order for real-world text but
// the first.
//
// Nor does it copy a quirk of ICU's numeric mode. ICU skips the common
// prefix of the two strings first, and backs up over digits so as not to
// split a number, but not over a surrogate pair. So a number holding a digit
// beyond the BMP that runs across that prefix is compared in two halves
// there ("𝟏𝟏" < "𝟏a𝟏", although "11" > "1a1"). Here a number is always one
// number.

#include "haze_collation_data.h"

#include <stdlib.h>
#include <string.h>

// A growable byte buffer for one level of a sort key. Plain malloc: a key is
// built, copied out once and thrown away, so the GC never needs to see it.
typedef struct {
  unsigned char* data;
  size_t length;
  size_t capacity;
} haze_collation_bytes_t;

static void haze_collation_bytes_reserve(haze_collation_bytes_t* b, size_t extra)
{
  if (b->length + extra <= b->capacity) {
    return;
  }
  size_t capacity = b->capacity ? b->capacity * 2 : 64;
  while (capacity < b->length + extra) {
    capacity *= 2;
  }
  unsigned char* data = (unsigned char*)realloc(b->data, capacity);
  if (!data) {
    abort();
  }
  b->data = data;
  b->capacity = capacity;
}

static void haze_collation_bytes_push(haze_collation_bytes_t* b, unsigned char byte)
{
  haze_collation_bytes_reserve(b, 1);
  b->data[b->length++] = byte;
}

typedef struct {
  haze_collation_bytes_t primary;
  haze_collation_bytes_t secondary;
  haze_collation_bytes_t tertiary;
} haze_collation_levels_t;

static void haze_collation_levels_free(haze_collation_levels_t* levels)
{
  free(levels->primary.data);
  free(levels->secondary.data);
  free(levels->tertiary.data);
}

static void haze_collation_append_weights(haze_collation_levels_t* levels, uint32_t p, uint32_t s, uint32_t t)
{
  if (p != 0) {
    haze_collation_bytes_reserve(&levels->primary, 3);
    if (p < 0x100) {
      // Only U+FFFE (CLDR's merge separator, primary 0001) is this low. Its
      // first byte must still be above the 0x00 level separator; no other
      // primary starts with 0x01 (the generator checks), so order holds.
      levels->primary.data[levels->primary.length++] = 0x01;
      levels->primary.data[levels->primary.length++] = (unsigned char)p;
    } else {
      levels->primary.data[levels->primary.length++] = (unsigned char)(p >> 8);
      levels->primary.data[levels->primary.length++] = (unsigned char)(p & 0xFF);
    }
    levels->primary.data[levels->primary.length++] = 0;
  }
  if (s != 0) {
    haze_collation_bytes_reserve(&levels->secondary, 2);
    levels->secondary.data[levels->secondary.length++] = (unsigned char)((s >> 8) + 1);
    levels->secondary.data[levels->secondary.length++] = (unsigned char)(s & 0xFF);
  }
  if (t != 0) {
    haze_collation_bytes_push(&levels->tertiary, (unsigned char)t);
  }
}

static void haze_collation_append_ce(haze_collation_levels_t* levels, uint32_t ce)
{
  haze_collation_append_weights(levels, ce >> 16, (ce >> 5) & 0x1FF, ce & 0x1F);
}

// The CEs of one code point in the table: their offset into
// haze_collation_ces, and how many (0 when the table has no entry).
static uint32_t haze_collation_lookup(int32_t cp, uint32_t* count)
{
  *count = 0;
  if (cp < 0 || cp > 0x10FFFF) {
    return 0;
  }
  uint16_t block = haze_collation_stage1[cp >> 8];
  if (block == 0) {
    return 0;
  }
  const uint16_t* starts = haze_collation_stage2[block - 1];
  uint32_t low = (uint32_t)cp & 0xFF;
  *count = (uint32_t)starts[low + 1] - (uint32_t)starts[low];
  return starts[low];
}

// UCA's implicit weights (UTS #10 section 10.1.3): two CEs, ordering what the
// table leaves out after everything it has, by code point within each group.
static void haze_collation_append_implicit(haze_collation_levels_t* levels, int32_t cp)
{
  uint32_t a;
  uint32_t b;
  if ((cp >= 0x17000 && cp <= 0x18AFF) || (cp >= 0x18D00 && cp <= 0x18D8F)) {
    // Tangut
    a = 0xFB00;
    b = (uint32_t)(cp - 0x17000) | 0x8000;
  } else if (cp >= 0x1B170 && cp <= 0x1B2FF) {
    // Nushu
    a = 0xFB01;
    b = (uint32_t)(cp - 0x1B170) | 0x8000;
  } else if (cp >= 0x18B00 && cp <= 0x18CFF) {
    // Khitan Small Script
    a = 0xFB02;
    b = (uint32_t)(cp - 0x18B00) | 0x8000;
  } else {
    uint32_t base = 0xFBC0;
    for (int i = 0; i < HAZE_COLLATION_IDEOGRAPH_RANGE_COUNT; i++) {
      const haze_collation_ideograph_range_t* r = &haze_collation_ideograph_ranges[i];
      if ((uint32_t)cp >= r->first && (uint32_t)cp <= r->last) {
        base = r->base;
        break;
      }
    }
    a = base + ((uint32_t)cp >> 15);
    b = ((uint32_t)cp & 0x7FFF) | 0x8000;
  }
  haze_collation_append_weights(levels, a, 0x20, 0x02);
  haze_collation_append_weights(levels, b, 0, 0);
}

static bool haze_collation_is_contraction_starter(int32_t cp)
{
  int lo = 0;
  int hi = HAZE_COLLATION_CONTRACTION_STARTER_COUNT;
  while (lo < hi) {
    int mid = (lo + hi) / 2;
    if (haze_collation_contraction_starters[mid] < (uint32_t)cp) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo < HAZE_COLLATION_CONTRACTION_STARTER_COUNT && haze_collation_contraction_starters[lo] == (uint32_t)cp;
}

// The longest contraction that starts at cps[i], or NULL.
//
// The table is sorted by first code point, so the candidates are one run of
// it, found by binary search: common letters start contractions too ("l" of
// Catalan "l·l"), and scanning all of the table for each of them cost more
// than the rest of building a key.
static const haze_collation_contraction_t* haze_collation_match_contraction(const int32_t* cps, size_t count, size_t i)
{
  if (!haze_collation_is_contraction_starter(cps[i])) {
    return NULL;
  }
  int lo = 0;
  int hi = HAZE_COLLATION_CONTRACTION_COUNT;
  while (lo < hi) {
    int mid = (lo + hi) / 2;
    if (haze_collation_contractions[mid].codepoints[0] < (uint32_t)cps[i]) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const haze_collation_contraction_t* best = NULL;
  for (int k = lo; k < HAZE_COLLATION_CONTRACTION_COUNT; k++) {
    const haze_collation_contraction_t* c = &haze_collation_contractions[k];
    if (c->codepoints[0] != (uint32_t)cps[i]) {
      break;
    }
    if (i + c->length > count) {
      continue;
    }
    bool match = true;
    for (int j = 1; j < c->length; j++) {
      if (c->codepoints[j] != (uint32_t)cps[i + j]) {
        match = false;
        break;
      }
    }
    if (match && (!best || c->length > best->length)) {
      best = c;
    }
  }
  return best;
}

// The value of a decimal digit for numeric collation, or -1. A digit is a
// code point of category Nd whose single CE is one of the ten digit primaries
// -- which is how DUCET weighs every script's digits.
static int haze_collation_digit_value(int32_t cp)
{
  uint32_t count;
  uint32_t start = haze_collation_lookup(cp, &count);
  if (count != 1) {
    return -1;
  }
  uint32_t p = haze_collation_ces[start] >> 16;
  if (p < HAZE_COLLATION_DIGIT_ZERO_PRIMARY || p > HAZE_COLLATION_DIGIT_ZERO_PRIMARY + 9) {
    return -1;
  }
  if (utf8proc_category(cp) != UTF8PROC_CATEGORY_ND) {
    return -1;
  }
  return (int)(p - HAZE_COLLATION_DIGIT_ZERO_PRIMARY);
}

// Appends a run of digits (their values) as numeric weights -- see the top of
// this file.
static void haze_collation_append_number(haze_collation_levels_t* levels, const unsigned char* digits, size_t count)
{
  size_t start = 0;
  while (start + 1 < count && digits[start] == 0) {
    start++;
  }
  const uint32_t marker = HAZE_COLLATION_DIGIT_ZERO_PRIMARY - 1;
  while (start < count) {
    size_t chunk = count - start;
    if (chunk > 254) {
      chunk = 254;
    }
    haze_collation_bytes_reserve(&levels->primary, 3 + chunk);
    levels->primary.data[levels->primary.length++] = (unsigned char)(marker >> 8);
    levels->primary.data[levels->primary.length++] = (unsigned char)(marker & 0xFF);
    levels->primary.data[levels->primary.length++] = (unsigned char)chunk;
    for (size_t i = 0; i < chunk; i++) {
      levels->primary.data[levels->primary.length++] = (unsigned char)(digits[start + i] + 1);
    }
    haze_collation_append_weights(levels, 0, 0x20, 0x02);
    start += chunk;
  }
}

// Decodes `text` (invalid bytes as U+FFFD) and normalizes it to NFD. Returns
// a malloc'd array the caller frees, and its length in *count.
static int32_t* haze_collation_nfd(hzstd_str_t text, size_t* count)
{
  size_t capacity = (size_t)text.length + 8;
  int32_t* out = (int32_t*)malloc(capacity * sizeof(int32_t));
  if (!out) {
    abort();
  }
  size_t length = 0;
  hzstd_int_t offset = 0;
  while (offset < text.length) {
    haze_unicode_codepoint_t decoded = haze_unicode_decode_at(text, offset);
    int32_t cp = decoded.codepoint < 0 ? 0xFFFD : decoded.codepoint;
    offset += decoded.size;
    // Decompositions are short (at most 4 code points in Unicode 16 for
    // canonical ones, 3 for Hangul); 18 leaves room to spare.
    utf8proc_int32_t parts[18];
    int boundclass = UTF8PROC_BOUNDCLASS_START;
    utf8proc_ssize_t n = utf8proc_decompose_char(cp, parts, 18, UTF8PROC_DECOMPOSE, &boundclass);
    if (n < 0 || n > 18) {
      parts[0] = cp;
      n = 1;
    }
    if (length + (size_t)n > capacity) {
      capacity = (length + (size_t)n) * 2;
      int32_t* grown = (int32_t*)realloc(out, capacity * sizeof(int32_t));
      if (!grown) {
        abort();
      }
      out = grown;
    }
    for (utf8proc_ssize_t i = 0; i < n; i++) {
      out[length++] = parts[i];
    }
  }

  // Canonical ordering: a stable sort of each run of combining marks by
  // their combining class (the same bubble utf8proc_decompose does).
  size_t pos = 0;
  while (length > 0 && pos < length - 1) {
    int class1 = utf8proc_get_property(out[pos])->combining_class;
    int class2 = utf8proc_get_property(out[pos + 1])->combining_class;
    if (class1 > class2 && class2 > 0) {
      int32_t swap = out[pos];
      out[pos] = out[pos + 1];
      out[pos + 1] = swap;
      if (pos > 0) {
        pos--;
      } else {
        pos++;
      }
    } else {
      pos++;
    }
  }
  *count = length;
  return out;
}

static void haze_collation_build(hzstd_str_t text, hzstd_bool_t numeric, haze_collation_levels_t* levels)
{
  memset(levels, 0, sizeof(*levels));
  size_t count = 0;
  int32_t* cps = haze_collation_nfd(text, &count);

  unsigned char digitsOnStack[64];
  unsigned char* digits = digitsOnStack;
  size_t digitsCapacity = sizeof(digitsOnStack);

  size_t i = 0;
  while (i < count) {
    if (numeric && haze_collation_digit_value(cps[i]) >= 0) {
      size_t run = 0;
      while (i < count) {
        int value = haze_collation_digit_value(cps[i]);
        if (value < 0) {
          break;
        }
        if (run == digitsCapacity) {
          digitsCapacity *= 2;
          unsigned char* grown = (unsigned char*)malloc(digitsCapacity);
          if (!grown) {
            abort();
          }
          memcpy(grown, digits, run);
          if (digits != digitsOnStack) {
            free(digits);
          }
          digits = grown;
        }
        digits[run++] = (unsigned char)value;
        i++;
      }
      haze_collation_append_number(levels, digits, run);
      continue;
    }

    const haze_collation_contraction_t* contraction = haze_collation_match_contraction(cps, count, i);
    if (contraction) {
      for (int k = 0; k < contraction->ce_count; k++) {
        haze_collation_append_ce(levels, haze_collation_ces[contraction->ce_start + k]);
      }
      i += contraction->length;
      continue;
    }

    uint32_t ceCount;
    uint32_t start = haze_collation_lookup(cps[i], &ceCount);
    if (ceCount == 0) {
      haze_collation_append_implicit(levels, cps[i]);
    } else {
      for (uint32_t k = 0; k < ceCount; k++) {
        haze_collation_append_ce(levels, haze_collation_ces[start + k]);
      }
    }
    i++;
  }

  if (digits != digitsOnStack) {
    free(digits);
  }
  free(cps);
}

// The three levels as one key: primary, 0x00, secondary, 0x00, tertiary.
static size_t haze_collation_key_length(const haze_collation_levels_t* levels)
{
  return levels->primary.length + 1 + levels->secondary.length + 1 + levels->tertiary.length;
}

static void haze_collation_write_key(const haze_collation_levels_t* levels, unsigned char* out)
{
  size_t o = 0;
  if (levels->primary.length) {
    memcpy(out + o, levels->primary.data, levels->primary.length);
  }
  o += levels->primary.length;
  out[o++] = 0;
  if (levels->secondary.length) {
    memcpy(out + o, levels->secondary.data, levels->secondary.length);
  }
  o += levels->secondary.length;
  out[o++] = 0;
  if (levels->tertiary.length) {
    memcpy(out + o, levels->tertiary.data, levels->tertiary.length);
  }
}

static hzstd_int_t haze_collation_compare_bytes(const unsigned char* a, size_t aLength, const unsigned char* b, size_t bLength)
{
  size_t shorter = aLength < bLength ? aLength : bLength;
  int result = shorter ? memcmp(a, b, shorter) : 0;
  if (result != 0) {
    return result < 0 ? -1 : 1;
  }
  if (aLength != bLength) {
    return aLength < bLength ? -1 : 1;
  }
  return 0;
}

hzstd_str_t haze_unicode_collation_key(hzstd_str_t text, hzstd_bool_t numeric)
{
  haze_collation_levels_t levels;
  haze_collation_build(text, numeric, &levels);
  size_t length = haze_collation_key_length(&levels);
  // Atomic: a key is bytes, nothing in it for the collector to scan.
  unsigned char* out = (unsigned char*)hzstd_heap_allocate_atomic(length, NULL);
  haze_collation_write_key(&levels, out);
  haze_collation_levels_free(&levels);
  return HZSTD_STRING((char*)out, (hzstd_int_t)length);
}

hzstd_int_t haze_unicode_compare_collation_keys(hzstd_str_t a, hzstd_str_t b)
{
  return haze_collation_compare_bytes((const unsigned char*)a.data, (size_t)a.length, (const unsigned char*)b.data,
                                      (size_t)b.length);
}

hzstd_int_t haze_unicode_collate(hzstd_str_t a, hzstd_str_t b, hzstd_bool_t numeric)
{
  haze_collation_levels_t levelsA;
  haze_collation_levels_t levelsB;
  haze_collation_build(a, numeric, &levelsA);
  haze_collation_build(b, numeric, &levelsB);
  size_t lengthA = haze_collation_key_length(&levelsA);
  size_t lengthB = haze_collation_key_length(&levelsB);
  unsigned char* keyA = (unsigned char*)malloc(lengthA);
  unsigned char* keyB = (unsigned char*)malloc(lengthB);
  if (!keyA || !keyB) {
    abort();
  }
  haze_collation_write_key(&levelsA, keyA);
  haze_collation_write_key(&levelsB, keyB);
  hzstd_int_t result = haze_collation_compare_bytes(keyA, lengthA, keyB, lengthB);
  free(keyA);
  free(keyB);
  haze_collation_levels_free(&levelsA);
  haze_collation_levels_free(&levelsB);
  return result;
}

hzstd_str_t haze_unicode_collation_version(void)
{
  return HZSTD_STRING_FROM_CSTR(HAZE_COLLATION_UCA_VERSION);
}
