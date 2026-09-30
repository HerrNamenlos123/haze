#include "hzstd/include/hzstd_memory.h"

#include <stdint.h>
#include <string.h>

#include "public/hz_zlib.h"

// A streaming zlib compressor (RFC 1950 around RFC 1951 deflate).
//
// Compressing a whole buffer in one call takes time that grows with the
// input, so a large image would block for as long as it takes. Here the
// stream is fed a piece at a time and the 32 KB window carries over between
// pieces: a caller on a frame budget decides how much each call does, and
// the output does not depend on how the input was split.
//
// Input goes through LZ77 (hash chains, lazy matching; the search effort per
// level is zlib's) into a buffer of symbols. When that fills, or the window
// is about to slide past the block's first byte, the symbols go out as one
// block, in whichever of deflate's three forms is smallest for them: stored
// (raw bytes -- for data that does not compress), the fixed Huffman code, or
// a Huffman code made for the block.

#define HZ_ZLIB_WSIZE 32768
#define HZ_ZLIB_WMASK (HZ_ZLIB_WSIZE - 1)
#define HZ_ZLIB_HASH_BITS 15
#define HZ_ZLIB_HASH_SIZE (1 << HZ_ZLIB_HASH_BITS)
#define HZ_ZLIB_MIN_MATCH 3
#define HZ_ZLIB_MAX_MATCH 258
// Positions this close to the end of the input so far are left for the next
// write: a match found there could not run its full length yet.
#define HZ_ZLIB_LOOKAHEAD (HZ_ZLIB_MAX_MATCH + HZ_ZLIB_MIN_MATCH + 1)
// New input taken into the window per round, which bounds the window buffer.
#define HZ_ZLIB_CHUNK 65536
// Symbols per block at most.
#define HZ_ZLIB_BLOCK_SYMBOLS 32768
// Literal/length and distance alphabets, as counted in a block header.
#define HZ_ZLIB_LITLEN_CODES 286
#define HZ_ZLIB_DIST_CODES 30
#define HZ_ZLIB_CODELEN_CODES 19

typedef struct hz_zlib_deflater_t hz_zlib_deflater_t;

struct hz_zlib_deflater_t {
  // The window: the WSIZE bytes before `pos` and everything after it that is
  // buffered. buf[0] is stream position `base`.
  unsigned char* buf;
  int64_t base;
  int64_t len;
  int64_t cap;
  // The next position to look at.
  int64_t pos;
  // Lazy matching (see hz_zlib_encode): whether the byte at pos - 1 is
  // still to be written, and the match found there.
  int pending;
  int pendingLength;
  int pendingDistance;

  // Hash chains. head holds, by the hash of the three bytes at a position,
  // the last position with that hash, as position + 1 truncated to 32 bits
  // (0 for none) -- only ever compared as distances below WSIZE, which the
  // truncation does not change. prev holds, by position modulo the window,
  // how far back the position before it with the same hash is, 0 for out
  // of reach. Small entries keep more of the chains in cache.
  uint32_t* head;
  uint16_t* prev;

  // The block being collected: from stream position blockStart, as symbols.
  // A literal has distance 0 and its byte in `value`; a match its distance
  // and its length - 3.
  int64_t blockStart;
  uint16_t* symDist;
  unsigned char* symValue;
  int symCount;
  uint32_t litlenFreq[HZ_ZLIB_LITLEN_CODES + 2];
  uint32_t distFreq[HZ_ZLIB_DIST_CODES];

  unsigned char* out;
  int64_t outLen;
  int64_t outCap;
  int64_t totalIn;
  int64_t totalOut;

  uint64_t bits;
  int bitCount;

  uint32_t adlerA;
  uint32_t adlerB;

  int goodLength;
  int lazyLength;
  int niceLength;
  int maxChain;
  int started;
  int finished;
};

static const unsigned short hz_zlib_length_base[] = { 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43,
  51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 259 };
static const unsigned char hz_zlib_length_extra[]
    = { 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0 };
static const unsigned short hz_zlib_dist_base[] = { 1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257,
  385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 32769 };
static const unsigned char hz_zlib_dist_extra[]
    = { 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13 };
// The order a block header lists the code length code's lengths in.
static const unsigned char hz_zlib_codelen_order[HZ_ZLIB_CODELEN_CODES]
    = { 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 };

// zlib's search effort per level 1..9: a match this long cuts the next
// search to a quarter; one this long is not checked for a longer one a byte
// on; one this long ends the search; and how many earlier positions with the
// same hash are tried at most.
static const int hz_zlib_level_good[] = { 4, 4, 4, 4, 8, 8, 8, 32, 32 };
static const int hz_zlib_level_lazy[] = { 4, 5, 6, 4, 16, 16, 32, 128, 258 };
static const int hz_zlib_level_nice[] = { 8, 16, 32, 16, 32, 128, 128, 258, 258 };
static const int hz_zlib_level_chain[] = { 4, 8, 32, 16, 32, 128, 256, 1024, 4096 };

// ── Output ─────────────────────────────────────────────────────────────

// Makes room for `extra` more bytes, so the bit writer need not check.
static void hz_zlib_reserve(hz_zlib_deflater_t* d, int64_t extra)
{
  if (d->outLen + extra <= d->outCap) {
    return;
  }
  int64_t cap = d->outCap < 4096 ? 4096 : d->outCap;
  while (cap < d->outLen + extra) {
    cap *= 2;
  }
  // Atomic: compressed bytes hold no pointers for the collector to follow.
  d->out = d->out ? hzstd_heap_realloc(d->out, (size_t)cap, NULL) : hzstd_heap_allocate_atomic((size_t)cap, NULL);
  d->outCap = cap;
}

static inline void hz_zlib_put_bits(hz_zlib_deflater_t* d, uint32_t value, int count)
{
  d->bits |= (uint64_t)value << d->bitCount;
  d->bitCount += count;
  while (d->bitCount >= 8) {
    d->out[d->outLen++] = (unsigned char)d->bits;
    d->bits >>= 8;
    d->bitCount -= 8;
  }
}

static void hz_zlib_align(hz_zlib_deflater_t* d)
{
  if (d->bitCount > 0) {
    hz_zlib_put_bits(d, 0, 8 - d->bitCount);
  }
}

// ── Huffman codes ──────────────────────────────────────────────────────

// Huffman codes are packed from their most significant bit, everything else
// in deflate from the least significant -- so codes are kept reversed.
static uint16_t hz_zlib_reverse(uint32_t code, int length)
{
  uint32_t reversed = 0;
  for (int i = 0; i < length; i++) {
    reversed = (reversed << 1) | (code & 1);
    code >>= 1;
  }
  return (uint16_t)reversed;
}

// The canonical code for a set of code lengths (RFC 1951, 3.2.2), reversed.
static void hz_zlib_make_codes(const unsigned char* lengths, int count, uint16_t* codes)
{
  int lengthCount[16] = { 0 };
  for (int i = 0; i < count; i++) {
    lengthCount[lengths[i]]++;
  }
  lengthCount[0] = 0;
  uint32_t next[16] = { 0 };
  uint32_t code = 0;
  for (int bits = 1; bits < 16; bits++) {
    code = (code + (uint32_t)lengthCount[bits - 1]) << 1;
    next[bits] = code;
  }
  for (int i = 0; i < count; i++) {
    codes[i] = lengths[i] ? hz_zlib_reverse(next[lengths[i]]++, lengths[i]) : 0;
  }
}

typedef struct {
  uint32_t key;
  uint16_t symbol;
} hz_zlib_sym_freq_t;

static void hz_zlib_sort_by_freq(hz_zlib_sym_freq_t* a, int n)
{
  // Insertion sort: at most 286 used symbols, and nearly sorted runs are
  // common.
  for (int i = 1; i < n; i++) {
    hz_zlib_sym_freq_t item = a[i];
    int j = i - 1;
    while (j >= 0 && a[j].key > item.key) {
      a[j + 1] = a[j];
      j--;
    }
    a[j + 1] = item;
  }
}

// Optimal code lengths for `a` (sorted by frequency, ascending), computed in
// place: Moffat and Katajainen, "In-Place Calculation of Minimum-Redundancy
// Codes" (1995). Afterwards a[i].key is the code length of a[i].symbol.
static void hz_zlib_min_redundancy(hz_zlib_sym_freq_t* a, int n)
{
  if (n == 1) {
    a[0].key = 1;
    return;
  }
  // First pass: build the tree, leaving each internal node's parent index.
  a[0].key += a[1].key;
  int root = 0;
  int leaf = 2;
  for (int next = 1; next < n - 1; next++) {
    if (leaf >= n || a[root].key < a[leaf].key) {
      a[next].key = a[root].key;
      a[root++].key = (uint32_t)next;
    }
    else {
      a[next].key = a[leaf++].key;
    }
    if (leaf >= n || (root < next && a[root].key < a[leaf].key)) {
      a[next].key += a[root].key;
      a[root++].key = (uint32_t)next;
    }
    else {
      a[next].key += a[leaf++].key;
    }
  }
  // Second pass: internal node depths from the parent indices.
  a[n - 2].key = 0;
  for (int next = n - 3; next >= 0; next--) {
    a[next].key = a[a[next].key].key + 1;
  }
  // Third pass: leaf depths from the internal node depths.
  int available = 1;
  int used = 0;
  int depth = 0;
  root = n - 2;
  int next = n - 1;
  while (available > 0) {
    while (root >= 0 && (int)a[root].key == depth) {
      used++;
      root--;
    }
    while (available > used) {
      a[next--].key = (uint32_t)depth;
      available--;
    }
    available = 2 * used;
    depth++;
    used = 0;
  }
}

// Code lengths, none over maxBits, for symbols with frequencies `freq`; 0
// for a symbol that does not occur. The code is always complete: with one
// symbol in use, a second gets a length too, which decoders expect.
static void hz_zlib_build_lengths(const uint32_t* freq, int count, int maxBits, unsigned char* lengths)
{
  hz_zlib_sym_freq_t symbols[HZ_ZLIB_LITLEN_CODES + 2];
  int used = 0;
  for (int i = 0; i < count; i++) {
    lengths[i] = 0;
    if (freq[i]) {
      symbols[used].key = freq[i];
      symbols[used].symbol = (uint16_t)i;
      used++;
    }
  }
  if (used == 0) {
    return;
  }
  if (used == 1) {
    int only = symbols[0].symbol;
    lengths[only] = 1;
    lengths[only == 0 ? 1 : 0] = 1;
    return;
  }

  hz_zlib_sort_by_freq(symbols, used);
  hz_zlib_min_redundancy(symbols, used);

  // How many codes of each length; those over maxBits are shortened, and
  // other codes lengthened until the code fits again (the Kraft sum is 1).
  int lengthCount[HZ_ZLIB_LITLEN_CODES + 2] = { 0 };
  for (int i = 0; i < used; i++) {
    lengthCount[symbols[i].key]++;
  }
  for (int bits = maxBits + 1; bits <= used; bits++) {
    lengthCount[maxBits] += lengthCount[bits];
    lengthCount[bits] = 0;
  }
  uint32_t total = 0;
  for (int bits = maxBits; bits > 0; bits--) {
    total += (uint32_t)lengthCount[bits] << (maxBits - bits);
  }
  while (total != (1u << maxBits)) {
    lengthCount[maxBits]--;
    for (int bits = maxBits - 1; bits > 0; bits--) {
      if (lengthCount[bits]) {
        lengthCount[bits]--;
        lengthCount[bits + 1] += 2;
        break;
      }
    }
    total--;
  }

  // The shortest codes to the most frequent symbols (the end of `symbols`).
  int j = used;
  for (int bits = 1; bits <= maxBits; bits++) {
    for (int k = lengthCount[bits]; k > 0; k--) {
      lengths[symbols[--j].symbol] = (unsigned char)bits;
    }
  }
}

static unsigned char hz_zlib_fixed_litlen_lengths[HZ_ZLIB_LITLEN_CODES + 2];
static uint16_t hz_zlib_fixed_litlen_codes[HZ_ZLIB_LITLEN_CODES + 2];
static unsigned char hz_zlib_fixed_dist_lengths[HZ_ZLIB_DIST_CODES];
static uint16_t hz_zlib_fixed_dist_codes[HZ_ZLIB_DIST_CODES];
static int hz_zlib_fixed_ready = 0;

// The fixed code (RFC 1951, 3.2.6). Filling the tables twice from two
// threads writes the same values, so the flag needs no lock.
static void hz_zlib_init_fixed(void)
{
  if (hz_zlib_fixed_ready) {
    return;
  }
  for (int i = 0; i < HZ_ZLIB_LITLEN_CODES + 2; i++) {
    hz_zlib_fixed_litlen_lengths[i] = i <= 143 ? 8 : i <= 255 ? 9 : i <= 279 ? 7 : 8;
  }
  for (int i = 0; i < HZ_ZLIB_DIST_CODES; i++) {
    hz_zlib_fixed_dist_lengths[i] = 5;
  }
  hz_zlib_make_codes(hz_zlib_fixed_litlen_lengths, HZ_ZLIB_LITLEN_CODES + 2, hz_zlib_fixed_litlen_codes);
  hz_zlib_make_codes(hz_zlib_fixed_dist_lengths, HZ_ZLIB_DIST_CODES, hz_zlib_fixed_dist_codes);
  hz_zlib_fixed_ready = 1;
}

// ── Blocks ─────────────────────────────────────────────────────────────

static inline int hz_zlib_length_code(int length)
{
  int l = 0;
  while (hz_zlib_length_base[l + 1] <= length) {
    l++;
  }
  return l;
}

static inline int hz_zlib_dist_code(int distance)
{
  int k = 0;
  while (hz_zlib_dist_base[k + 1] <= distance) {
    k++;
  }
  return k;
}

static inline void hz_zlib_add_literal(hz_zlib_deflater_t* d, unsigned char byte)
{
  d->symDist[d->symCount] = 0;
  d->symValue[d->symCount] = byte;
  d->symCount++;
  d->litlenFreq[byte]++;
}

static inline void hz_zlib_add_match(hz_zlib_deflater_t* d, int length, int distance)
{
  d->symDist[d->symCount] = (uint16_t)distance;
  d->symValue[d->symCount] = (unsigned char)(length - HZ_ZLIB_MIN_MATCH);
  d->symCount++;
  d->litlenFreq[257 + hz_zlib_length_code(length)]++;
  d->distFreq[hz_zlib_dist_code(distance)]++;
}

// The run-length coded code lengths of a dynamic block header: symbols 0-18
// with, for 16-18, their repeat count in the extra bits.
typedef struct {
  unsigned char symbols[HZ_ZLIB_LITLEN_CODES + HZ_ZLIB_DIST_CODES];
  unsigned char extras[HZ_ZLIB_LITLEN_CODES + HZ_ZLIB_DIST_CODES];
  int count;
  uint32_t freq[HZ_ZLIB_CODELEN_CODES];
} hz_zlib_rle_t;

static void hz_zlib_rle_lengths(const unsigned char* lengths, int count, hz_zlib_rle_t* rle)
{
  memset(rle, 0, sizeof(*rle));
  int i = 0;
  while (i < count) {
    unsigned char length = lengths[i];
    int run = 1;
    while (i + run < count && lengths[i + run] == length) {
      run++;
    }
    int left = run;
    if (length == 0) {
      while (left >= 11) {
        int n = left < 138 ? left : 138;
        rle->symbols[rle->count] = 18;
        rle->extras[rle->count++] = (unsigned char)(n - 11);
        left -= n;
      }
      if (left >= 3) {
        rle->symbols[rle->count] = 17;
        rle->extras[rle->count++] = (unsigned char)(left - 3);
        left = 0;
      }
    }
    else {
      // The first is written as itself; repeats of it after that.
      rle->symbols[rle->count++] = length;
      left--;
      while (left >= 3) {
        int n = left < 6 ? left : 6;
        rle->symbols[rle->count] = 16;
        rle->extras[rle->count++] = (unsigned char)(n - 3);
        left -= n;
      }
    }
    while (left > 0) {
      rle->symbols[rle->count++] = length;
      left--;
    }
    i += run;
  }
  for (int k = 0; k < rle->count; k++) {
    rle->freq[rle->symbols[k]]++;
  }
}

// Bits the block's symbols take in a code, besides the block header.
static uint64_t hz_zlib_symbol_bits(hz_zlib_deflater_t* d, const unsigned char* litlenLengths,
                                    const unsigned char* distLengths)
{
  uint64_t bits = 0;
  for (int i = 0; i < HZ_ZLIB_LITLEN_CODES; i++) {
    uint32_t extra = i >= 257 ? hz_zlib_length_extra[i - 257] : 0;
    bits += (uint64_t)d->litlenFreq[i] * (litlenLengths[i] + extra);
  }
  for (int i = 0; i < HZ_ZLIB_DIST_CODES; i++) {
    bits += (uint64_t)d->distFreq[i] * (distLengths[i] + hz_zlib_dist_extra[i]);
  }
  return bits;
}

static void hz_zlib_put_symbols(hz_zlib_deflater_t* d, const unsigned char* litlenLengths, const uint16_t* litlenCodes,
                                const unsigned char* distLengths, const uint16_t* distCodes)
{
  for (int i = 0; i < d->symCount; i++) {
    int distance = d->symDist[i];
    if (distance == 0) {
      int byte = d->symValue[i];
      hz_zlib_put_bits(d, litlenCodes[byte], litlenLengths[byte]);
      continue;
    }
    int length = d->symValue[i] + HZ_ZLIB_MIN_MATCH;
    int l = hz_zlib_length_code(length);
    hz_zlib_put_bits(d, litlenCodes[257 + l], litlenLengths[257 + l]);
    if (hz_zlib_length_extra[l]) {
      hz_zlib_put_bits(d, (uint32_t)(length - hz_zlib_length_base[l]), hz_zlib_length_extra[l]);
    }
    int k = hz_zlib_dist_code(distance);
    hz_zlib_put_bits(d, distCodes[k], distLengths[k]);
    if (hz_zlib_dist_extra[k]) {
      hz_zlib_put_bits(d, (uint32_t)(distance - hz_zlib_dist_base[k]), hz_zlib_dist_extra[k]);
    }
  }
  hz_zlib_put_bits(d, litlenCodes[256], litlenLengths[256]);
}

// Writes the collected symbols as one block, ending at position `end`.
static void hz_zlib_flush_block(hz_zlib_deflater_t* d, int64_t end, int final)
{
  hz_zlib_init_fixed();
  d->litlenFreq[256] = 1;

  unsigned char litlenLengths[HZ_ZLIB_LITLEN_CODES + 2];
  unsigned char distLengths[HZ_ZLIB_DIST_CODES];
  hz_zlib_build_lengths(d->litlenFreq, HZ_ZLIB_LITLEN_CODES, 15, litlenLengths);
  hz_zlib_build_lengths(d->distFreq, HZ_ZLIB_DIST_CODES, 15, distLengths);

  // The header lists lengths up to the last one in use, but at least 257
  // literal/length codes and one distance code.
  int litlenCount = HZ_ZLIB_LITLEN_CODES;
  while (litlenCount > 257 && litlenLengths[litlenCount - 1] == 0) {
    litlenCount--;
  }
  int distCount = HZ_ZLIB_DIST_CODES;
  while (distCount > 1 && distLengths[distCount - 1] == 0) {
    distCount--;
  }
  unsigned char combined[HZ_ZLIB_LITLEN_CODES + HZ_ZLIB_DIST_CODES];
  memcpy(combined, litlenLengths, (size_t)litlenCount);
  memcpy(combined + litlenCount, distLengths, (size_t)distCount);
  hz_zlib_rle_t rle;
  hz_zlib_rle_lengths(combined, litlenCount + distCount, &rle);
  unsigned char codelenLengths[HZ_ZLIB_CODELEN_CODES];
  hz_zlib_build_lengths(rle.freq, HZ_ZLIB_CODELEN_CODES, 7, codelenLengths);
  int codelenCount = HZ_ZLIB_CODELEN_CODES;
  while (codelenCount > 4 && codelenLengths[hz_zlib_codelen_order[codelenCount - 1]] == 0) {
    codelenCount--;
  }

  uint64_t dynamicBits = 3 + 5 + 5 + 4 + 3 * (uint64_t)codelenCount;
  for (int i = 0; i < HZ_ZLIB_CODELEN_CODES; i++) {
    uint32_t extra = i == 16 ? 2 : i == 17 ? 3 : i == 18 ? 7 : 0;
    dynamicBits += (uint64_t)rle.freq[i] * (codelenLengths[i] + extra);
  }
  dynamicBits += hz_zlib_symbol_bits(d, litlenLengths, distLengths);
  uint64_t fixedBits = 3 + hz_zlib_symbol_bits(d, hz_zlib_fixed_litlen_lengths, hz_zlib_fixed_dist_lengths);

  // Stored needs the raw bytes, which are still in the window: a block is
  // flushed before the window slides past its start.
  int64_t raw = end - d->blockStart;
  uint64_t storedBits = UINT64_MAX;
  if (d->blockStart >= d->base) {
    int64_t pieces = raw == 0 ? 1 : (raw + 65534) / 65535;
    storedBits = (uint64_t)raw * 8 + (uint64_t)pieces * (3 + 7 + 32);
  }

  // Room for the largest a block can come out as: a symbol takes at most
  // 15 + 5 + 15 + 13 bits.
  hz_zlib_reserve(d, (int64_t)d->symCount * 6 + raw + (raw / 65535 + 1) * 5 + 512);

  if (storedBits <= dynamicBits && storedBits <= fixedBits) {
    const unsigned char* data = d->buf + (d->blockStart - d->base);
    int64_t left = raw;
    do {
      int64_t n = left < 65535 ? left : 65535;
      left -= n;
      hz_zlib_put_bits(d, (final && left == 0) ? 1 : 0, 1);
      hz_zlib_put_bits(d, 0, 2);
      hz_zlib_align(d);
      d->out[d->outLen++] = (unsigned char)n;
      d->out[d->outLen++] = (unsigned char)(n >> 8);
      d->out[d->outLen++] = (unsigned char)~n;
      d->out[d->outLen++] = (unsigned char)(~n >> 8);
      memcpy(d->out + d->outLen, data, (size_t)n);
      d->outLen += n;
      data += n;
    } while (left > 0);
  }
  else if (fixedBits <= dynamicBits) {
    hz_zlib_put_bits(d, final ? 1 : 0, 1);
    hz_zlib_put_bits(d, 1, 2);
    hz_zlib_put_symbols(d, hz_zlib_fixed_litlen_lengths, hz_zlib_fixed_litlen_codes, hz_zlib_fixed_dist_lengths,
                        hz_zlib_fixed_dist_codes);
  }
  else {
    uint16_t litlenCodes[HZ_ZLIB_LITLEN_CODES + 2];
    uint16_t distCodes[HZ_ZLIB_DIST_CODES];
    uint16_t codelenCodes[HZ_ZLIB_CODELEN_CODES];
    hz_zlib_make_codes(litlenLengths, HZ_ZLIB_LITLEN_CODES, litlenCodes);
    hz_zlib_make_codes(distLengths, HZ_ZLIB_DIST_CODES, distCodes);
    hz_zlib_make_codes(codelenLengths, HZ_ZLIB_CODELEN_CODES, codelenCodes);

    hz_zlib_put_bits(d, final ? 1 : 0, 1);
    hz_zlib_put_bits(d, 2, 2);
    hz_zlib_put_bits(d, (uint32_t)(litlenCount - 257), 5);
    hz_zlib_put_bits(d, (uint32_t)(distCount - 1), 5);
    hz_zlib_put_bits(d, (uint32_t)(codelenCount - 4), 4);
    for (int i = 0; i < codelenCount; i++) {
      hz_zlib_put_bits(d, codelenLengths[hz_zlib_codelen_order[i]], 3);
    }
    for (int i = 0; i < rle.count; i++) {
      int symbol = rle.symbols[i];
      hz_zlib_put_bits(d, codelenCodes[symbol], codelenLengths[symbol]);
      if (symbol == 16) {
        hz_zlib_put_bits(d, rle.extras[i], 2);
      }
      else if (symbol == 17) {
        hz_zlib_put_bits(d, rle.extras[i], 3);
      }
      else if (symbol == 18) {
        hz_zlib_put_bits(d, rle.extras[i], 7);
      }
    }
    hz_zlib_put_symbols(d, litlenLengths, litlenCodes, distLengths, distCodes);
  }

  d->blockStart = end;
  d->symCount = 0;
  memset(d->litlenFreq, 0, sizeof(d->litlenFreq));
  memset(d->distFreq, 0, sizeof(d->distFreq));
}

// ── LZ77 ───────────────────────────────────────────────────────────────

static void hz_zlib_adler(hz_zlib_deflater_t* d, const unsigned char* data, int64_t length)
{
  uint32_t a = d->adlerA;
  uint32_t b = d->adlerB;
  while (length > 0) {
    // The most bytes that can be summed before b could overflow 32 bits.
    int64_t n = length < 5552 ? length : 5552;
    length -= n;
    while (n--) {
      a += *data++;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  d->adlerA = a;
  d->adlerB = b;
}

static inline unsigned char* hz_zlib_at(hz_zlib_deflater_t* d, int64_t position)
{
  return d->buf + (position - d->base);
}

static inline uint32_t hz_zlib_hash(const unsigned char* p)
{
  uint32_t v = (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16);
  return (v * 2654435761u) >> (32 - HZ_ZLIB_HASH_BITS);
}

static inline void hz_zlib_insert(hz_zlib_deflater_t* d, int64_t position, uint32_t hash)
{
  uint32_t here = (uint32_t)position + 1;
  uint32_t last = d->head[hash];
  uint32_t back = last != 0 ? here - last : 0;
  d->prev[position & HZ_ZLIB_WMASK] = (uint16_t)(back <= HZ_ZLIB_WSIZE ? back : 0);
  d->head[hash] = here;
}

// How many bytes at a and b agree, up to max.
static inline int hz_zlib_common_length(const unsigned char* a, const unsigned char* b, int max)
{
  int n = 0;
#if (defined(__GNUC__) || defined(__clang__)) && defined(__BYTE_ORDER__) && __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
  while (n + 8 <= max) {
    uint64_t x;
    uint64_t y;
    memcpy(&x, a + n, 8);
    memcpy(&y, b + n, 8);
    uint64_t diff = x ^ y;
    if (diff) {
      return n + (__builtin_ctzll(diff) >> 3);
    }
    n += 8;
  }
#endif
  while (n < max && a[n] == b[n]) {
    n++;
  }
  return n;
}

// The longest earlier match for the bytes at `position`, which is not in the
// chains yet, that is longer than `previous` (the match a byte before, or
// 0): its length, or 0 if there is none, and its distance in *distance.
static int hz_zlib_longest_match(hz_zlib_deflater_t* d, int64_t position, uint32_t hash, int64_t end, int previous,
                                 int* distance)
{
  int64_t available = end - position;
  int maxLength = available < HZ_ZLIB_MAX_MATCH ? (int)available : HZ_ZLIB_MAX_MATCH;
  int best = previous > HZ_ZLIB_MIN_MATCH - 1 ? previous : HZ_ZLIB_MIN_MATCH - 1;
  if (best >= maxLength) {
    return 0;
  }
  int bestDistance = 0;
  const unsigned char* current = hz_zlib_at(d, position);
  uint32_t here = (uint32_t)position + 1;

  int chain = d->maxChain;
  if (previous >= d->goodLength) {
    chain >>= 2;
  }
  uint32_t candidate = d->head[hash];
  uint32_t lastDistance = 0;
  while (candidate != 0 && chain-- > 0) {
    uint32_t dist = here - candidate;
    // Chains only ever go further back; a nearer one is a slot a later
    // position has since taken over.
    if (dist <= lastDistance || dist > HZ_ZLIB_WSIZE) {
      break;
    }
    lastDistance = dist;
    const unsigned char* earlier = current - dist;
    // Only a candidate that beats the best so far is worth comparing whole.
    if (earlier[best] == current[best] && earlier[0] == current[0] && earlier[1] == current[1]) {
      int length = hz_zlib_common_length(earlier, current, maxLength);
      if (length > best) {
        best = length;
        bestDistance = (int)dist;
        if (length >= d->niceLength || length == maxLength) {
          break;
        }
      }
    }
    uint16_t back = d->prev[(candidate - 1) & HZ_ZLIB_WMASK];
    if (back == 0) {
      break;
    }
    candidate -= back;
  }

  if (bestDistance == 0) {
    return 0;
  }
  *distance = bestDistance;
  return best;
}

// Encodes every position before `limit`, with the input buffered up to
// `end` -- zlib's lazy matching. A match found at a position is not taken at
// once: if the next position has a longer one, the first byte goes out as a
// literal and the longer match is taken instead. So the byte at pos - 1 may
// still be pending, with the match found there, when this returns.
static void hz_zlib_encode(hz_zlib_deflater_t* d, int64_t limit, int64_t end)
{
  while (d->pos < limit) {
    if (d->symCount >= HZ_ZLIB_BLOCK_SYMBOLS) {
      // The pending byte is not in this block's symbols yet.
      hz_zlib_flush_block(d, d->pos - d->pending, 0);
    }
    int64_t p = d->pos;
    int length = 0;
    int distance = 0;
    if (end - p >= HZ_ZLIB_MIN_MATCH) {
      uint32_t hash = hz_zlib_hash(hz_zlib_at(d, p));
      // A long enough match a byte before is taken without looking here.
      if (d->pendingLength < d->lazyLength) {
        length = hz_zlib_longest_match(d, p, hash, end, d->pendingLength, &distance);
      }
      hz_zlib_insert(d, p, hash);
    }

    if (d->pendingLength > 0 && length == 0) {
      // The match at p - 1 is the better one.
      int matchLength = d->pendingLength;
      hz_zlib_add_match(d, matchLength, d->pendingDistance);
      int64_t matchEnd = p - 1 + matchLength;
      for (int64_t q = p + 1; q < matchEnd; q++) {
        if (end - q >= HZ_ZLIB_MIN_MATCH) {
          hz_zlib_insert(d, q, hz_zlib_hash(hz_zlib_at(d, q)));
        }
      }
      d->pos = matchEnd;
      d->pending = 0;
      d->pendingLength = 0;
      continue;
    }
    if (d->pending) {
      hz_zlib_add_literal(d, *hz_zlib_at(d, p - 1));
    }
    d->pending = 1;
    d->pendingLength = length;
    d->pendingDistance = distance;
    d->pos = p + 1;
  }
}

// ── The stream ─────────────────────────────────────────────────────────

static void hz_zlib_start(hz_zlib_deflater_t* d)
{
  if (d->started) {
    return;
  }
  d->started = 1;
  hz_zlib_reserve(d, 2);
  // CMF: deflate with a 32 KB window. FLG: default level, no dictionary,
  // and the check bits that make the pair a multiple of 31.
  d->out[d->outLen++] = 0x78;
  d->out[d->outLen++] = 0x9c;
}

hzstd_cptr_t hz_zlib_deflater_create(hzstd_int_t level)
{
  if (level < 1) {
    level = 1;
  }
  if (level > 9) {
    level = 9;
  }
  // Not atomic: it points at the buffers below, which the collector has to
  // see. They are atomic -- bytes and positions, no pointers.
  hz_zlib_deflater_t* d = hzstd_heap_allocate(sizeof(hz_zlib_deflater_t), NULL);
  memset(d, 0, sizeof(*d));
  d->cap = HZ_ZLIB_WSIZE + HZ_ZLIB_LOOKAHEAD + HZ_ZLIB_CHUNK;
  d->buf = hzstd_heap_allocate_atomic((size_t)d->cap, NULL);
  d->head = hzstd_heap_allocate_atomic(sizeof(uint32_t) * HZ_ZLIB_HASH_SIZE, NULL);
  d->prev = hzstd_heap_allocate_atomic(sizeof(uint16_t) * HZ_ZLIB_WSIZE, NULL);
  d->symDist = hzstd_heap_allocate_atomic(sizeof(uint16_t) * HZ_ZLIB_BLOCK_SYMBOLS, NULL);
  d->symValue = hzstd_heap_allocate_atomic(HZ_ZLIB_BLOCK_SYMBOLS, NULL);
  memset(d->head, 0, sizeof(uint32_t) * HZ_ZLIB_HASH_SIZE);
  memset(d->prev, 0, sizeof(uint16_t) * HZ_ZLIB_WSIZE);
  d->adlerA = 1;
  d->adlerB = 0;
  d->goodLength = hz_zlib_level_good[level - 1];
  d->lazyLength = hz_zlib_level_lazy[level - 1];
  d->niceLength = hz_zlib_level_nice[level - 1];
  d->maxChain = hz_zlib_level_chain[level - 1];
  return d;
}

void hz_zlib_deflater_write(hzstd_cptr_t handle, hzstd_cptr_t data, hzstd_int_t length)
{
  hz_zlib_deflater_t* d = handle;
  if (d->finished || length <= 0) {
    return;
  }
  hz_zlib_start(d);
  const unsigned char* input = (const unsigned char*)data;
  hz_zlib_adler(d, input, length);
  d->totalIn += length;

  while (length > 0) {
    if (d->cap - d->len < HZ_ZLIB_CHUNK) {
      // Slide the window: everything more than WSIZE before the next
      // position to encode is out of reach of any match. The block so far
      // goes out first, while its bytes are still here to store raw.
      int64_t keepFrom = d->pos - 1 - HZ_ZLIB_WSIZE;
      if (keepFrom > d->base) {
        if (d->blockStart < keepFrom) {
          hz_zlib_flush_block(d, d->pos - d->pending, 0);
        }
        int64_t shift = keepFrom - d->base;
        memmove(d->buf, d->buf + shift, (size_t)(d->len - shift));
        d->len -= shift;
        d->base = keepFrom;
      }
    }
    int64_t room = d->cap - d->len;
    int64_t n = length < room ? length : room;
    memcpy(d->buf + d->len, input, (size_t)n);
    d->len += n;
    input += n;
    length -= n;

    int64_t end = d->base + d->len;
    hz_zlib_encode(d, end - HZ_ZLIB_LOOKAHEAD, end);
  }
}

void hz_zlib_deflater_finish(hzstd_cptr_t handle)
{
  hz_zlib_deflater_t* d = handle;
  if (d->finished) {
    return;
  }
  hz_zlib_start(d);
  int64_t end = d->base + d->len;
  hz_zlib_encode(d, end, end);
  if (d->pending) {
    hz_zlib_add_literal(d, *hz_zlib_at(d, end - 1));
    d->pending = 0;
  }
  hz_zlib_flush_block(d, end, 1);
  hz_zlib_align(d);
  uint32_t adler = (d->adlerB << 16) | d->adlerA;
  hz_zlib_reserve(d, 4);
  d->out[d->outLen++] = (unsigned char)(adler >> 24);
  d->out[d->outLen++] = (unsigned char)(adler >> 16);
  d->out[d->outLen++] = (unsigned char)(adler >> 8);
  d->out[d->outLen++] = (unsigned char)adler;
  d->finished = 1;
  // Only the output is needed any more.
  d->buf = NULL;
  d->head = NULL;
  d->prev = NULL;
  d->symDist = NULL;
  d->symValue = NULL;
}

hzstd_int_t hz_zlib_deflater_output_length(hzstd_cptr_t handle) { return ((hz_zlib_deflater_t*)handle)->outLen; }

// Hands over the output buffer itself; the next byte starts a new one, so
// what was handed over never changes again.
hzstd_cptr_t hz_zlib_deflater_take_output(hzstd_cptr_t handle)
{
  hz_zlib_deflater_t* d = handle;
  d->totalOut += d->outLen;
  void* out = d->out;
  d->out = NULL;
  d->outLen = 0;
  d->outCap = 0;
  return out;
}

hzstd_int_t hz_zlib_deflater_total_in(hzstd_cptr_t handle) { return ((hz_zlib_deflater_t*)handle)->totalIn; }

hzstd_int_t hz_zlib_deflater_total_out(hzstd_cptr_t handle)
{
  hz_zlib_deflater_t* d = handle;
  return d->totalOut + d->outLen;
}
