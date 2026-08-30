
#include "hzstd/include/hzstd_memory.h"
#include "hzstd/include/hzstd_string.h"

#include "public/haze_claude.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(_WIN32)
#  include <windows.h>
#  include <bcrypt.h>
#  include <io.h>
#  include <process.h>
#else
#  include <fcntl.h>
#  include <signal.h>
#  include <limits.h>
#  include <sys/stat.h>
#  include <sys/utsname.h>
#  include <time.h>
#  include <unistd.h>
#endif

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Copies `length` bytes into GC memory and hands back a Haze `str`. Every
// string this file returns goes through here: a Haze str is a (data, length)
// pair with no ownership of its own, so the bytes must outlive the call and
// must be collectable, which means the allocator the caller passed in.
static hzstd_str_t haze_claude_make_str(hzstd_allocator_t allocator, const char *data, size_t length)
{
  if (length == 0) {
    return (hzstd_str_t){ .data = "", .length = 0 };
  }
  char *buffer = (char *)hzstd_allocate(allocator, length, "str");
  memcpy(buffer, data, length);
  return (hzstd_str_t){ .data = buffer, .length = (hzstd_int_t)length };
}

// Haze strings are not NUL-terminated, but every OS call here wants a C
// string. Uses the raw-malloc'd, never-freed helper the core stdlib already
// uses for exactly this (paths are short and these calls are rare).
static const char *haze_claude_cpath(hzstd_str_t path)
{
  return hzstd_raw_malloc_null_terminated_str(path);
}

static const char HAZE_CLAUDE_HEX[16] = { '0', '1', '2', '3', '4', '5', '6', '7',
                                          '8', '9', 'a', 'b', 'c', 'd', 'e', 'f' };

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4)
// ---------------------------------------------------------------------------

typedef struct {
  uint32_t state[8];
  uint64_t bitCount;
  unsigned char buffer[64];
  size_t bufferLength;
} haze_claude_sha256_ctx_t;

static const uint32_t HAZE_CLAUDE_SHA256_K[64] = {
  0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
  0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
  0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
  0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
  0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
  0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
  0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
  0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
};

#define HAZE_CLAUDE_ROTR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))

static void haze_claude_sha256_init(haze_claude_sha256_ctx_t *ctx)
{
  ctx->state[0] = 0x6a09e667u;
  ctx->state[1] = 0xbb67ae85u;
  ctx->state[2] = 0x3c6ef372u;
  ctx->state[3] = 0xa54ff53au;
  ctx->state[4] = 0x510e527fu;
  ctx->state[5] = 0x9b05688cu;
  ctx->state[6] = 0x1f83d9abu;
  ctx->state[7] = 0x5be0cd19u;
  ctx->bitCount = 0;
  ctx->bufferLength = 0;
}

static void haze_claude_sha256_block(haze_claude_sha256_ctx_t *ctx, const unsigned char *block)
{
  uint32_t w[64];
  for (int i = 0; i < 16; i++) {
    w[i] = ((uint32_t)block[i * 4] << 24) | ((uint32_t)block[i * 4 + 1] << 16) | ((uint32_t)block[i * 4 + 2] << 8)
         | ((uint32_t)block[i * 4 + 3]);
  }
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = HAZE_CLAUDE_ROTR(w[i - 15], 7) ^ HAZE_CLAUDE_ROTR(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = HAZE_CLAUDE_ROTR(w[i - 2], 17) ^ HAZE_CLAUDE_ROTR(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }

  uint32_t a = ctx->state[0], b = ctx->state[1], c = ctx->state[2], d = ctx->state[3];
  uint32_t e = ctx->state[4], f = ctx->state[5], g = ctx->state[6], h = ctx->state[7];

  for (int i = 0; i < 64; i++) {
    uint32_t S1 = HAZE_CLAUDE_ROTR(e, 6) ^ HAZE_CLAUDE_ROTR(e, 11) ^ HAZE_CLAUDE_ROTR(e, 25);
    uint32_t ch = (e & f) ^ ((~e) & g);
    uint32_t temp1 = h + S1 + ch + HAZE_CLAUDE_SHA256_K[i] + w[i];
    uint32_t S0 = HAZE_CLAUDE_ROTR(a, 2) ^ HAZE_CLAUDE_ROTR(a, 13) ^ HAZE_CLAUDE_ROTR(a, 22);
    uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    uint32_t temp2 = S0 + maj;

    h = g;
    g = f;
    f = e;
    e = d + temp1;
    d = c;
    c = b;
    b = a;
    a = temp1 + temp2;
  }

  ctx->state[0] += a;
  ctx->state[1] += b;
  ctx->state[2] += c;
  ctx->state[3] += d;
  ctx->state[4] += e;
  ctx->state[5] += f;
  ctx->state[6] += g;
  ctx->state[7] += h;
}

static void haze_claude_sha256_update(haze_claude_sha256_ctx_t *ctx, const unsigned char *data, size_t length)
{
  ctx->bitCount += (uint64_t)length * 8u;
  while (length > 0) {
    size_t space = 64 - ctx->bufferLength;
    size_t take = length < space ? length : space;
    memcpy(ctx->buffer + ctx->bufferLength, data, take);
    ctx->bufferLength += take;
    data += take;
    length -= take;
    if (ctx->bufferLength == 64) {
      haze_claude_sha256_block(ctx, ctx->buffer);
      ctx->bufferLength = 0;
    }
  }
}

static void haze_claude_sha256_final(haze_claude_sha256_ctx_t *ctx, unsigned char out[32])
{
  uint64_t bitCount = ctx->bitCount;
  unsigned char pad = 0x80;
  haze_claude_sha256_update(ctx, &pad, 1);
  // update() advanced bitCount for the padding bytes too, so the length that
  // goes into the final block is the one captured above, not ctx->bitCount.
  unsigned char zero = 0x00;
  while (ctx->bufferLength != 56) {
    haze_claude_sha256_update(ctx, &zero, 1);
  }
  unsigned char lengthBytes[8];
  for (int i = 0; i < 8; i++) {
    lengthBytes[i] = (unsigned char)((bitCount >> (56 - i * 8)) & 0xff);
  }
  haze_claude_sha256_update(ctx, lengthBytes, 8);

  for (int i = 0; i < 8; i++) {
    out[i * 4] = (unsigned char)((ctx->state[i] >> 24) & 0xff);
    out[i * 4 + 1] = (unsigned char)((ctx->state[i] >> 16) & 0xff);
    out[i * 4 + 2] = (unsigned char)((ctx->state[i] >> 8) & 0xff);
    out[i * 4 + 3] = (unsigned char)(ctx->state[i] & 0xff);
  }
}

static hzstd_str_t haze_claude_hex_digest(hzstd_allocator_t allocator, const unsigned char *digest, size_t length)
{
  char *buffer = (char *)hzstd_allocate(allocator, length * 2, "str");
  for (size_t i = 0; i < length; i++) {
    buffer[i * 2] = HAZE_CLAUDE_HEX[(digest[i] >> 4) & 0xf];
    buffer[i * 2 + 1] = HAZE_CLAUDE_HEX[digest[i] & 0xf];
  }
  return (hzstd_str_t){ .data = buffer, .length = (hzstd_int_t)(length * 2) };
}

// Lowercase hex SHA-256 of an in-memory string.
hzstd_str_t haze_claude_sha256_str(hzstd_allocator_t allocator, hzstd_str_t data)
{
  haze_claude_sha256_ctx_t ctx;
  haze_claude_sha256_init(&ctx);
  if (data.length > 0) {
    haze_claude_sha256_update(&ctx, (const unsigned char *)data.data, (size_t)data.length);
  }
  unsigned char digest[32];
  haze_claude_sha256_final(&ctx, digest);
  return haze_claude_hex_digest(allocator, digest, 32);
}

// Lowercase hex SHA-256 of a file, streamed in 1 MiB chunks. `ok` is false if
// the file cannot be opened or read -- a released `claude` binary is ~340 MB,
// so this never loads the file into memory.
haze_claude_str_result_t haze_claude_sha256_file(hzstd_allocator_t allocator, hzstd_str_t path)
{
  haze_claude_str_result_t result = { .ok = false, .value = { .data = "", .length = 0 } };

  FILE *file = fopen(haze_claude_cpath(path), "rb");
  if (file == NULL) {
    return result;
  }

  enum { CHUNK = 1024 * 1024 };
  unsigned char *chunk = (unsigned char *)malloc(CHUNK);
  if (chunk == NULL) {
    fclose(file);
    return result;
  }

  haze_claude_sha256_ctx_t ctx;
  haze_claude_sha256_init(&ctx);

  size_t read = 0;
  while ((read = fread(chunk, 1, CHUNK, file)) > 0) {
    haze_claude_sha256_update(&ctx, chunk, read);
  }
  int failed = ferror(file);
  free(chunk);
  fclose(file);
  if (failed) {
    return result;
  }

  unsigned char digest[32];
  haze_claude_sha256_final(&ctx, digest);
  result.ok = true;
  result.value = haze_claude_hex_digest(allocator, digest, 32);
  return result;
}

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

// `count` cryptographically strong random bytes as lowercase hex (2*count
// chars). Used for UUIDv4 session ids, control-request ids and OAuth PKCE
// state, so a predictable fallback would be a real weakness -- if the OS
// source is unavailable this returns an empty string and the caller must
// treat that as an error rather than substituting something guessable.
hzstd_str_t haze_claude_random_hex(hzstd_allocator_t allocator, hzstd_int_t count)
{
  if (count <= 0 || count > 256) {
    return (hzstd_str_t){ .data = "", .length = 0 };
  }
  unsigned char buffer[256];

#if defined(_WIN32)
  if (BCryptGenRandom(NULL, buffer, (ULONG)count, BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) {
    return (hzstd_str_t){ .data = "", .length = 0 };
  }
#else
  int fd = open("/dev/urandom", O_RDONLY);
  if (fd < 0) {
    return (hzstd_str_t){ .data = "", .length = 0 };
  }
  size_t filled = 0;
  while (filled < (size_t)count) {
    ssize_t got = read(fd, buffer + filled, (size_t)count - filled);
    if (got <= 0) {
      close(fd);
      return (hzstd_str_t){ .data = "", .length = 0 };
    }
    filled += (size_t)got;
  }
  close(fd);
#endif

  return haze_claude_hex_digest(allocator, buffer, (size_t)count);
}

// ---------------------------------------------------------------------------
// Filesystem bits the core `fs` namespace does not cover
// ---------------------------------------------------------------------------

// chmod 0755. Needed exactly once: a freshly downloaded release arrives
// without the executable bit. No-op (returns true) on Windows, where
// executability is decided by the file extension.
hzstd_bool_t haze_claude_make_executable(hzstd_str_t path)
{
#if defined(_WIN32)
  (void)path;
  return true;
#else
  return chmod(haze_claude_cpath(path), S_IRWXU | S_IRGRP | S_IXGRP | S_IROTH | S_IXOTH) == 0;
#endif
}

// True if the path exists and the current user may execute it.
hzstd_bool_t haze_claude_is_executable(hzstd_str_t path)
{
#if defined(_WIN32)
  return _access(haze_claude_cpath(path), 0) == 0;
#else
  return access(haze_claude_cpath(path), X_OK) == 0;
#endif
}

// Deletes a single file. Used for partial downloads and for revoking stored
// credentials -- both cases where leaving the file behind is worse than
// failing loudly, so the boolean result is always checked by the caller.
hzstd_bool_t haze_claude_remove_file(hzstd_str_t path)
{
#if defined(_WIN32)
  return DeleteFileA(haze_claude_cpath(path)) != 0;
#else
  return unlink(haze_claude_cpath(path)) == 0;
#endif
}

// Canonical absolute path with symlinks resolved, or `ok:false` when the path
// does not exist. The transcript directory name is derived from
// `realpath(cwd)` (see transcript.hz), so this has to agree with what the CLI
// itself computes.
haze_claude_str_result_t haze_claude_realpath(hzstd_allocator_t allocator, hzstd_str_t path)
{
  haze_claude_str_result_t result = { .ok = false, .value = { .data = "", .length = 0 } };

#if defined(_WIN32)
  char buffer[MAX_PATH];
  DWORD length = GetFullPathNameA(haze_claude_cpath(path), MAX_PATH, buffer, NULL);
  if (length == 0 || length >= MAX_PATH) {
    return result;
  }
  result.ok = true;
  result.value = haze_claude_make_str(allocator, buffer, (size_t)length);
#else
  char buffer[PATH_MAX];
  if (realpath(haze_claude_cpath(path), buffer) == NULL) {
    return result;
  }
  result.ok = true;
  result.value = haze_claude_make_str(allocator, buffer, strlen(buffer));
#endif
  return result;
}

// Restricts a file to owner-only read/write (0600). Credential files must not
// be world-readable; the CLI writes its own with that mode and anything this
// client copies has to match.
hzstd_bool_t haze_claude_make_private(hzstd_str_t path)
{
#if defined(_WIN32)
  (void)path;
  return true;
#else
  return chmod(haze_claude_cpath(path), S_IRUSR | S_IWUSR) == 0;
#endif
}

// ---------------------------------------------------------------------------
// Platform identity
// ---------------------------------------------------------------------------

// The machine architecture as the kernel reports it ("x86_64", "aarch64",
// "arm64", ...). Mapped to the release channel's naming in binary.hz.
hzstd_str_t haze_claude_arch(hzstd_allocator_t allocator)
{
#if defined(_WIN32)
  SYSTEM_INFO info;
  GetNativeSystemInfo(&info);
  const char *name = "x86_64";
  if (info.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_ARM64) {
    name = "arm64";
  }
  return haze_claude_make_str(allocator, name, strlen(name));
#else
  struct utsname info;
  if (uname(&info) != 0) {
    return (hzstd_str_t){ .data = "", .length = 0 };
  }
  return haze_claude_make_str(allocator, info.machine, strlen(info.machine));
#endif
}

// This process's pid. Written into the IDE lockfile so a terminal-launched
// CLI can verify the editor is one of its ancestors.
hzstd_int_t haze_claude_pid(void)
{
#if defined(_WIN32)
  return (hzstd_int_t)_getpid();
#else
  return (hzstd_int_t)getpid();
#endif
}

// Asks a process to exit (SIGTERM) or kills it outright (SIGKILL). The Haze
// `process` API can close a child's stdin and block on join(), but has no way
// to signal one -- and closing stdin is not enough for a CLI that is midway
// through a turn, which is exactly when a user closes the chat. Returns false
// if the process is already gone or is not ours to signal.
hzstd_bool_t haze_claude_signal_process(hzstd_int_t pid, hzstd_bool_t force)
{
  if (pid <= 0) {
    return false;
  }
#if defined(_WIN32)
  (void)force;
  HANDLE handle = OpenProcess(PROCESS_TERMINATE, FALSE, (DWORD)pid);
  if (handle == NULL) {
    return false;
  }
  BOOL ok = TerminateProcess(handle, 1);
  CloseHandle(handle);
  return ok != 0;
#else
  return kill((pid_t)pid, force ? SIGKILL : SIGTERM) == 0;
#endif
}

// The current process environment, exposed by index. `process.spawn` REPLACES
// the child's environment with whatever it is given rather than adding to it,
// so a client that wants to override one variable has to hand over the whole
// set -- and core's `env` namespace can only look a variable up by name.
//
// Two calls rather than one array-returning call: marshalling a Haze []str
// across the FFI boundary means building an hzstd dynamic array by hand, and
// an environment is read once per spawn.

#if !defined(_WIN32)
extern char **environ;
#endif

hzstd_int_t haze_claude_environ_count(void)
{
#if defined(_WIN32)
  LPCH block = GetEnvironmentStringsA();
  if (block == NULL) {
    return 0;
  }
  hzstd_int_t count = 0;
  for (LPCH entry = block; *entry != '\0'; entry += strlen(entry) + 1) {
    // Windows exposes internal "=C:=..." drive-cwd entries; they are not
    // inheritable settings and confuse anything that parses NAME=value.
    if (entry[0] != '=') {
      count++;
    }
  }
  FreeEnvironmentStringsA(block);
  return count;
#else
  hzstd_int_t count = 0;
  for (char **entry = environ; *entry != NULL; entry++) {
    count++;
  }
  return count;
#endif
}

hzstd_str_t haze_claude_environ_at(hzstd_allocator_t allocator, hzstd_int_t index)
{
#if defined(_WIN32)
  LPCH block = GetEnvironmentStringsA();
  if (block == NULL) {
    return (hzstd_str_t){ .data = "", .length = 0 };
  }
  hzstd_int_t seen = 0;
  hzstd_str_t result = { .data = "", .length = 0 };
  for (LPCH entry = block; *entry != '\0'; entry += strlen(entry) + 1) {
    if (entry[0] == '=') {
      continue;
    }
    if (seen == index) {
      result = haze_claude_make_str(allocator, entry, strlen(entry));
      break;
    }
    seen++;
  }
  FreeEnvironmentStringsA(block);
  return result;
#else
  hzstd_int_t seen = 0;
  for (char **entry = environ; *entry != NULL; entry++) {
    if (seen == index) {
      return haze_claude_make_str(allocator, *entry, strlen(*entry));
    }
    seen++;
  }
  return (hzstd_str_t){ .data = "", .length = 0 };
#endif
}

// Reads the first and last `limit` bytes of a file without loading the middle.
//
// Session listing scans every transcript in a project directory, and a
// transcript is an append-only JSONL that can reach tens of megabytes. Reading
// them whole to find a title would make opening a session list cost hundreds of
// megabytes of I/O; the records that matter (the first prompt at the head, the
// latest title and branch at the tail) are always at one end or the other.
// Core's `fs` has no partial read -- `fs.open` is a stub -- so this is it.
//
// When the file is smaller than 2*limit, `head` holds all of it and `tail` is
// empty, so a caller can scan both without seeing any byte twice.
haze_claude_head_tail_t haze_claude_read_head_tail(hzstd_allocator_t allocator, hzstd_str_t path,
                                                   hzstd_int_t limit)
{
  haze_claude_head_tail_t result = { .ok = false,
                                     .head = { .data = "", .length = 0 },
                                     .tail = { .data = "", .length = 0 },
                                     .size = 0 };
  if (limit <= 0) {
    return result;
  }

  FILE *file = fopen(haze_claude_cpath(path), "rb");
  if (file == NULL) {
    return result;
  }

  if (fseek(file, 0, SEEK_END) != 0) {
    fclose(file);
    return result;
  }
  long size = ftell(file);
  if (size < 0) {
    fclose(file);
    return result;
  }
  result.size = (hzstd_int_t)size;

  size_t headLength = (size_t)size;
  if (headLength > (size_t)limit) {
    headLength = (size_t)limit;
  }

  char *headBuffer = (char *)hzstd_allocate(allocator, headLength ? headLength : 1, "str");
  if (fseek(file, 0, SEEK_SET) != 0 || fread(headBuffer, 1, headLength, file) != headLength) {
    fclose(file);
    return result;
  }
  result.head = (hzstd_str_t){ .data = headBuffer, .length = (hzstd_int_t)headLength };

  if ((size_t)size > headLength) {
    size_t tailLength = (size_t)size - headLength;
    if (tailLength > (size_t)limit) {
      tailLength = (size_t)limit;
    }
    char *tailBuffer = (char *)hzstd_allocate(allocator, tailLength, "str");
    if (fseek(file, (long)((size_t)size - tailLength), SEEK_SET) != 0
        || fread(tailBuffer, 1, tailLength, file) != tailLength) {
      fclose(file);
      return result;
    }
    result.tail = (hzstd_str_t){ .data = tailBuffer, .length = (hzstd_int_t)tailLength };
  }

  fclose(file);
  result.ok = true;
  return result;
}

// Appends text to a file, creating it if needed. Transcripts are append-only
// logs -- renaming a session means appending a `custom-title` record, never
// rewriting the file -- and core's `fs.openWrite` truncates.
hzstd_bool_t haze_claude_append_text(hzstd_str_t path, hzstd_str_t text)
{
  FILE *file = fopen(haze_claude_cpath(path), "ab");
  if (file == NULL) {
    return false;
  }
  hzstd_bool_t ok = true;
  if (text.length > 0) {
    ok = fwrite(text.data, 1, (size_t)text.length, file) == (size_t)text.length;
  }
  if (fclose(file) != 0) {
    ok = false;
  }
  return ok;
}

#include <gc/gc.h>

// Cumulative bytes the garbage collector has handed out since the process
// started. Strictly a diagnostic: it exists so this module's own test suite can
// assert that an idle poll() allocates nothing at all, which is a guarantee
// worth defending with a test rather than a comment.
hzstd_int_t haze_claude_total_allocated_bytes(void)
{
  return (hzstd_int_t)GC_get_total_bytes();
}

// ---------------------------------------------------------------------------
// JSON object key removal
// ---------------------------------------------------------------------------

// cJSON's AddItemToObject APPENDS unconditionally, and its lookup returns the
// FIRST match -- so setting a key that already exists silently leaves the old
// value in place behind a duplicate. Core's `json` namespace exposes add but
// no delete, so this reaches the vendored cJSON directly to remove a key
// before it is re-added.
//
// `hzstd_json_node_t*` IS a `cJSON*` (see hzstd_json.c), and cJSON's free hook
// in this build is a no-op because every node is GC-owned -- so unlinking an
// item can never leave a dangling pointer, even if something else still refers
// to it.
typedef struct cJSON cJSON;
extern void cJSON_DeleteItemFromObjectCaseSensitive(cJSON *object, const char *string);

void haze_claude_json_delete_key(void *object, hzstd_str_t name)
{
  if (object == NULL) {
    return;
  }
  cJSON_DeleteItemFromObjectCaseSensitive((cJSON *)object, haze_claude_cpath(name));
}

// ---------------------------------------------------------------------------
// Wall-clock time
// ---------------------------------------------------------------------------

// Milliseconds since the Unix epoch.
//
// Core's `time.now()` is deliberately MONOTONIC-since-process-start, which is
// the right clock for measuring an interval but the wrong one for anything
// compared against a timestamp from outside this process -- an OAuth token's
// `expiresAt`, or a message time a UI renders as a wall clock.
hzstd_int_t haze_claude_unix_millis(void)
{
#if defined(_WIN32)
  FILETIME ft;
  GetSystemTimeAsFileTime(&ft);
  unsigned long long ticks = ((unsigned long long)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
  // FILETIME counts 100 ns intervals since 1601-01-01.
  return (hzstd_int_t)((ticks - 116444736000000000ULL) / 10000ULL);
#else
  struct timespec ts;
  if (clock_gettime(CLOCK_REALTIME, &ts) != 0) {
    return 0;
  }
  return (hzstd_int_t)ts.tv_sec * 1000 + (hzstd_int_t)(ts.tv_nsec / 1000000);
#endif
}
