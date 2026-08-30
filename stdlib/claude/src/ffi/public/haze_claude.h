
#ifndef HAZE_CLAUDE_H
#define HAZE_CLAUDE_H

#include "hzstd/hzstd_types.h"
#include "hzstd/include/hzstd_string.h"

// Small OS/crypto primitives the Claude client needs and the Haze core
// standard library does not provide: cryptographically strong randomness
// (session/request UUIDs), SHA-256 (verifying a downloaded release against
// its published checksum), and the three filesystem operations missing from
// `fs` -- chmod, unlink, realpath.
//
// Everything here is either a thin syscall wrapper or a self-contained
// implementation; there are no third-party dependencies and no global state.

typedef struct {
  hzstd_bool_t ok;
  hzstd_str_t value; // valid only when ok == true
} haze_claude_str_result_t;

// The two ends of a file, read without loading the middle. See
// haze_claude_read_head_tail: transcripts are append-only JSONL logs whose
// interesting records sit at one end or the other, and they can be tens of
// megabytes.
typedef struct {
  hzstd_bool_t ok;
  hzstd_str_t head;
  hzstd_str_t tail;
  hzstd_int_t size;
} haze_claude_head_tail_t;

#endif // HAZE_CLAUDE_H
