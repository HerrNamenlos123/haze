/*
 * Unit tests of dwarfline.h on hand-built line tables and ELF images: every opcode, every
 * version, both offset sizes, both byte orders, every error the library reports, path joining,
 * and every truncated prefix of every image (which must give an error code, never a crash; on
 * Linux run.ts builds this under ASan and UBSan). Prints "N checks" and exits 0, or names the
 * first failing check and exits 1.
 */
#define DWARFLINE_IMPLEMENTATION
#include "../dwarfline.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int g_checks = 0;

#define CHECK(cond)                                                                                \
  do {                                                                                             \
    g_checks++;                                                                                    \
    if (!(cond)) {                                                                                 \
      printf("FAILED %s:%d: %s\n", __FILE__, __LINE__, #cond);                                     \
      exit(1);                                                                                     \
    }                                                                                              \
  } while (0)

/* ---- a byte builder ------------------------------------------------------------------------- */

typedef struct {
  uint8_t d[4096];
  size_t n;
  bool be;
} buf;

static void put(buf *b, uint64_t v, unsigned bytes)
{
  for (unsigned i = 0; i < bytes; i++) {
    unsigned shift = b->be ? 8 * (bytes - 1 - i) : 8 * i;
    b->d[b->n++] = (uint8_t)(v >> shift);
  }
}
static void u8(buf *b, uint64_t v) { put(b, v, 1); }
static void uleb(buf *b, uint64_t v)
{
  do {
    uint8_t byte = v & 0x7f;
    v >>= 7;
    b->d[b->n++] = byte | (v ? 0x80 : 0);
  } while (v);
}
static void sleb(buf *b, int64_t v)
{
  for (;;) {
    uint8_t byte = v & 0x7f;
    v >>= 7;
    bool done = (v == 0 && !(byte & 0x40)) || (v == -1 && (byte & 0x40));
    b->d[b->n++] = byte | (done ? 0 : 0x80);
    if (done) {
      return;
    }
  }
}
static void cstr(buf *b, const char *s)
{
  size_t n = strlen(s) + 1;
  memcpy(b->d + b->n, s, n);
  b->n += n;
}
/* Reserves a length field; patch() fills in the bytes written since. */
static size_t mark(buf *b, unsigned bytes)
{
  size_t at = b->n;
  b->n += bytes;
  return at;
}
static void patch(buf *b, size_t at, unsigned bytes)
{
  uint64_t len = b->n - at - bytes;
  size_t save = b->n;
  b->n = at;
  put(b, len, bytes);
  b->n = save;
}

/* ---- collecting rows ------------------------------------------------------------------------ */

typedef struct {
  dwarfline_row rows[64];
  int n;
} rows;

static int collect(void *user, const dwarfline_row *r)
{
  rows *rs = user;
  if (rs->n < 64) {
    rs->rows[rs->n] = *r;
  }
  rs->n++;
  return 0;
}

static dwarfline_sections sections(const buf *line, const buf *line_str)
{
  dwarfline_sections s = { 0 };
  s.debug_line = line->d;
  s.debug_line_size = line->n;
  if (line_str) {
    s.debug_line_str = line_str->d;
    s.debug_line_str_size = line_str->n;
  }
  s.address_size = 8;
  s.big_endian = line->be;
  return s;
}

static int run_all(const dwarfline_sections *s, rows *out)
{
  memset(out, 0, sizeof(*out));
  uint64_t off = 0;
  for (;;) {
    dwarfline_unit u;
    int r = dwarfline_unit_at(s, off, &u);
    if (r == DWARFLINE_END) {
      return DWARFLINE_OK;
    }
    if (r != DWARFLINE_OK) {
      return r;
    }
    r = dwarfline_run(s, &u, collect, out);
    if (r != DWARFLINE_OK) {
      return r;
    }
    off = u.next_offset;
  }
}

#define ROW(i, addr, ln, col, fl, f) \
  (rs.rows[i].address == (addr) && rs.rows[i].line == (ln) && rs.rows[i].column == (col) && rs.rows[i].file == (fl) && rs.rows[i].flags == (f))

/* ---- version 5: every opcode ---------------------------------------------------------------- */

/* A version 5 unit: directories "/abs" (line_strp) and "rel" (string); files "a.hz" in 0 (with
 * an MD5), "b.hz" in 1, "/x/c.hz" in 0. `dwarf64`: 64-bit DWARF; `opcode_base`: 13, or 14 with an
 * unknown standard opcode 13 that takes two operands. */
static void v5_unit(buf *b, buf *ls, bool dwarf64, uint8_t opcode_base)
{
  unsigned os = dwarf64 ? 8 : 4;
  if (dwarf64) {
    put(b, 0xffffffffu, 4);
  }
  size_t unit_len = mark(b, os);
  put(b, 5, 2);
  u8(b, 8); /* address_size */
  u8(b, 0); /* segment selector size */
  size_t header_len = mark(b, os);
  u8(b, 1);   /* min_inst_length */
  u8(b, 1);   /* max_ops */
  u8(b, 1);   /* default_is_stmt */
  u8(b, (uint8_t)-5); /* line_base */
  u8(b, 14);  /* line_range */
  u8(b, opcode_base);
  static const uint8_t std_lengths[] = { 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 2 };
  for (int i = 0; i < opcode_base - 1; i++) {
    u8(b, std_lengths[i]);
  }
  /* directories: format (path, line_strp) then (path, string) is not allowed to differ per
   * entry, so one format: path as line_strp. */
  u8(b, 1);
  uleb(b, 1);    /* DW_LNCT_path */
  uleb(b, 0x1f); /* DW_FORM_line_strp */
  uleb(b, 2);
  size_t abs_at = ls->n;
  cstr(ls, "/abs");
  size_t rel_at = ls->n;
  cstr(ls, "rel");
  put(b, abs_at, os);
  put(b, rel_at, os);
  /* files: path (string), directory_index (udata), MD5 (data16), a vendor type (data1) */
  u8(b, 4);
  uleb(b, 1);
  uleb(b, 0x08);
  uleb(b, 2);
  uleb(b, 0x0f);
  uleb(b, 5);
  uleb(b, 0x1e);
  uleb(b, 0x2001);
  uleb(b, 0x0b);
  uleb(b, 3);
  cstr(b, "a.hz");
  uleb(b, 0);
  for (int i = 0; i < 16; i++) {
    u8(b, (uint64_t)i);
  }
  u8(b, 7);
  cstr(b, "b.hz");
  uleb(b, 1);
  for (int i = 0; i < 16; i++) {
    u8(b, 0);
  }
  u8(b, 7);
  cstr(b, "/x/c.hz");
  uleb(b, 0);
  for (int i = 0; i < 16; i++) {
    u8(b, 0);
  }
  u8(b, 7);
  patch(b, header_len, os);

  /* The program. */
  u8(b, 0);
  uleb(b, 9);
  u8(b, 2); /* set_address */
  put(b, 0x1000, 8);
  u8(b, 3); /* advance_line +9 -> 10 */
  sleb(b, 9);
  u8(b, 5); /* set_column 4 */
  uleb(b, 4);
  u8(b, 10); /* prologue_end */
  u8(b, 1);  /* copy: row 0 (0x1000, 10, 4, file 1, is_stmt|prologue_end) */
  /* special opcode: address +2, line +1: adjusted = 2*14 + (1 - -5) = 34 */
  u8(b, opcode_base + 34u); /* row 1 (0x1002, 11, 4, is_stmt) */
  u8(b, 6);  /* negate_stmt */
  u8(b, 7);  /* basic_block */
  u8(b, 11); /* epilogue_begin */
  u8(b, 4);  /* set_file 2 */
  uleb(b, 2);
  u8(b, 0); /* set_discriminator 3 */
  uleb(b, 2);
  u8(b, 4);
  uleb(b, 3);
  u8(b, 12); /* set_isa 5 */
  uleb(b, 5);
  u8(b, 1); /* copy: row 2 (0x1002, 11, 4, file 2, basic_block|epilogue_begin, disc 3, isa 5) */
  u8(b, 8); /* const_add_pc: (255 - 13) / 14 = 17 */
  u8(b, 9); /* fixed_advance_pc 0x100 */
  put(b, 0x100, 2);
  u8(b, 2); /* advance_pc 3 */
  uleb(b, 3);
  u8(b, 3); /* advance_line -1 */
  sleb(b, -1);
  if (opcode_base == 14) {
    u8(b, 13); /* the unknown standard opcode: two operands, skipped */
    uleb(b, 300);
    uleb(b, 7);
  }
  u8(b, 0); /* an unknown extended opcode, skipped by its length */
  uleb(b, 4);
  u8(b, 0x80);
  u8(b, 1);
  u8(b, 2);
  u8(b, 3);
  u8(b, 1); /* copy: row 3 (0x1000+2+17+0x100+3 = 0x1116, 10, 4, file 2) */
  u8(b, 0); /* end_sequence: row 4 */
  uleb(b, 1);
  u8(b, 1);
  u8(b, 1); /* copy after the reset: row 5 (0, line 1, file 1, is_stmt) */
  patch(b, unit_len, os);
}

static void test_v5(bool dwarf64, uint8_t opcode_base)
{
  buf b = { 0 }, ls = { 0 };
  v5_unit(&b, &ls, dwarf64, opcode_base);
  dwarfline_sections s = sections(&b, &ls);
  dwarfline_unit u;
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_OK);
  CHECK(u.version == 5 && u.offset_size == (dwarf64 ? 8 : 4) && u.address_size == 8);
  CHECK(u.dir_count == 2 && u.file_count == 3 && u.first_file_index == 0);
  dwarfline_str d;
  CHECK(dwarfline_dir(&s, &u, 1, &d) == DWARFLINE_OK && d.len == 3 && memcmp(d.ptr, "rel", 3) == 0);
  CHECK(dwarfline_dir(&s, &u, 2, &d) == DWARFLINE_E_INDEX);
  dwarfline_file f;
  CHECK(dwarfline_file_entry(&s, &u, 0, &f) == DWARFLINE_OK && f.has_md5 && f.md5[15] == 15 && f.dir_index == 0);
  CHECK(dwarfline_file_entry(&s, &u, 1, &f) == DWARFLINE_OK && f.dir_index == 1 && f.name.len == 4);
  CHECK(dwarfline_file_entry(&s, &u, 3, &f) == DWARFLINE_E_INDEX);
  char path[64];
  size_t len;
  CHECK(dwarfline_file_path(&s, &u, 0, path, sizeof(path), &len) == DWARFLINE_OK && strcmp(path, "/abs/a.hz") == 0);
  CHECK(dwarfline_file_path(&s, &u, 1, path, sizeof(path), &len) == DWARFLINE_OK && strcmp(path, "/abs/rel/b.hz") == 0);
  CHECK(dwarfline_file_path(&s, &u, 2, path, sizeof(path), &len) == DWARFLINE_OK && strcmp(path, "/x/c.hz") == 0);
  CHECK(dwarfline_file_path(&s, &u, 1, path, 5, &len) == DWARFLINE_E_TRUNCATED && len == 13 && strlen(path) == 4);

  rows rs;
  CHECK(run_all(&s, &rs) == DWARFLINE_OK);
  CHECK(rs.n == 6);
  CHECK(ROW(0, 0x1000, 10, 4, 1, DWARFLINE_IS_STMT | DWARFLINE_PROLOGUE_END));
  CHECK(ROW(1, 0x1002, 11, 4, 1, DWARFLINE_IS_STMT));
  CHECK(ROW(2, 0x1002, 11, 4, 2, DWARFLINE_BASIC_BLOCK | DWARFLINE_EPILOGUE_BEGIN));
  CHECK(rs.rows[2].discriminator == 3 && rs.rows[2].isa == 5);
  CHECK(ROW(3, 0x1116, 10, 4, 2, 0));
  CHECK(rs.rows[3].discriminator == 0 && rs.rows[3].isa == 5);
  CHECK(ROW(4, 0x1116, 10, 4, 2, DWARFLINE_END_SEQUENCE));
  CHECK(ROW(5, 0, 1, 0, 1, DWARFLINE_IS_STMT) && rs.rows[5].isa == 0);
}

/* ---- versions 2 to 4 ------------------------------------------------------------------------ */

static void old_unit(buf *b, uint16_t version)
{
  size_t unit_len = mark(b, 4);
  put(b, version, 2);
  size_t header_len = mark(b, 4);
  u8(b, 4); /* min_inst_length: addresses advance in 4s */
  if (version >= 4) {
    u8(b, 1);
  }
  u8(b, 0); /* default_is_stmt false */
  u8(b, (uint8_t)-3);
  u8(b, 12);
  u8(b, 10); /* opcode_base 10: opcodes 10.. are special (no prologue_end etc. before v3) */
  static const uint8_t lengths[] = { 0, 1, 1, 1, 1, 0, 0, 0, 1 };
  for (int i = 0; i < 9; i++) {
    u8(b, lengths[i]);
  }
  cstr(b, "/inc");
  cstr(b, "");
  cstr(b, "main.c");
  uleb(b, 0);
  uleb(b, 0);
  uleb(b, 0);
  cstr(b, "util.h");
  uleb(b, 1);
  uleb(b, 123);
  uleb(b, 456);
  cstr(b, "");
  patch(b, header_len, 4);
  u8(b, 0);
  uleb(b, 9);
  u8(b, 2);
  put(b, 0x400000, 8);
  u8(b, 0); /* define_file: no row, its operands skipped */
  uleb(b, 7);
  u8(b, 3);
  cstr(b, "x.c");
  uleb(b, 0);
  uleb(b, 0);
  /* special: address +1 op (4 bytes), line +2: adjusted = 12 + (2 - -3) = 17, op = 27 */
  u8(b, 27);
  u8(b, 0);
  uleb(b, 1);
  u8(b, 1);
  patch(b, unit_len, 4);
}

static void test_old(uint16_t version)
{
  buf b = { 0 };
  old_unit(&b, version);
  dwarfline_sections s = sections(&b, NULL);
  dwarfline_unit u;
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_OK);
  CHECK(u.version == version && u.address_size == 8 && u.max_ops_per_inst == 1);
  CHECK(u.dir_count == 1 && u.file_count == 2 && u.first_dir_index == 1 && u.first_file_index == 1);
  dwarfline_str d;
  CHECK(dwarfline_dir(&s, &u, 0, &d) == DWARFLINE_E_INDEX);
  CHECK(dwarfline_dir(&s, &u, 1, &d) == DWARFLINE_OK && d.len == 4);
  char path[64];
  size_t len;
  CHECK(dwarfline_file_path(&s, &u, 1, path, sizeof(path), &len) == DWARFLINE_OK && strcmp(path, "main.c") == 0);
  CHECK(dwarfline_file_path(&s, &u, 2, path, sizeof(path), &len) == DWARFLINE_OK && strcmp(path, "/inc/util.h") == 0);
  rows rs;
  CHECK(run_all(&s, &rs) == DWARFLINE_OK);
  CHECK(rs.n == 2);
  CHECK(ROW(0, 0x400004, 3, 0, 1, 0));
  CHECK(ROW(1, 0x400004, 3, 0, 1, DWARFLINE_END_SEQUENCE));
}

/* ---- VLIW: more than one operation per instruction ------------------------------------------- */

static void test_vliw(void)
{
  buf b = { 0 };
  size_t unit_len = mark(&b, 4);
  put(&b, 4, 2);
  size_t header_len = mark(&b, 4);
  u8(&b, 16); /* min_inst_length */
  u8(&b, 3);  /* max_ops */
  u8(&b, 1);
  u8(&b, 0);
  u8(&b, 4);
  u8(&b, 13);
  static const uint8_t lengths[] = { 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1 };
  for (int i = 0; i < 12; i++) {
    u8(&b, lengths[i]);
  }
  cstr(&b, "");
  cstr(&b, "v.c");
  uleb(&b, 0);
  uleb(&b, 0);
  uleb(&b, 0);
  cstr(&b, "");
  patch(&b, header_len, 4);
  u8(&b, 2); /* advance_pc 4 ops: address += 16 * (4 / 3) = 16, op_index = 1 */
  uleb(&b, 4);
  u8(&b, 1);
  u8(&b, 2); /* advance_pc 2 ops: op_index 3 -> address += 16, op_index 0 */
  uleb(&b, 2);
  u8(&b, 1);
  u8(&b, 9); /* fixed_advance_pc: op_index 0 */
  put(&b, 5, 2);
  u8(&b, 1);
  patch(&b, unit_len, 4);
  dwarfline_sections s = sections(&b, NULL);
  rows rs;
  CHECK(run_all(&s, &rs) == DWARFLINE_OK);
  CHECK(rs.n == 3);
  CHECK(rs.rows[0].address == 16 && rs.rows[0].op_index == 1);
  CHECK(rs.rows[1].address == 32 && rs.rows[1].op_index == 0);
  CHECK(rs.rows[2].address == 37 && rs.rows[2].op_index == 0);
}

/* ---- big endian ----------------------------------------------------------------------------- */

static void test_big_endian(void)
{
  buf b = { .be = true }, ls = { .be = true };
  v5_unit(&b, &ls, false, 13);
  dwarfline_sections s = sections(&b, &ls);
  rows rs;
  CHECK(run_all(&s, &rs) == DWARFLINE_OK);
  CHECK(rs.n == 6 && ROW(3, 0x1116, 10, 4, 2, 0));
}

/* ---- errors --------------------------------------------------------------------------------- */

static void test_errors(void)
{
  buf b = { 0 }, ls = { 0 };
  v5_unit(&b, &ls, false, 13);
  dwarfline_sections s = sections(&b, &ls);
  dwarfline_unit u;
  rows rs;

  buf v = b;
  v.d[4] = 6; /* version 6 */
  s = sections(&v, &ls);
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_E_UNSUPPORTED);
  v = b;
  v.d[4] = 1;
  s = sections(&v, &ls);
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_E_UNSUPPORTED);

  v = b;
  v.d[0] = 0xf0, v.d[1] = 0xff, v.d[2] = 0xff, v.d[3] = 0xff; /* a reserved unit length */
  s = sections(&v, &ls);
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_E_MALFORMED);

  v = b; /* opcode_base 0: offset 4 version, 6 addr size, 7 seg, 8..11 header length, 12.. */
  v.d[17] = 0;
  s = sections(&v, &ls);
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_E_MALFORMED);

  v = b; /* max_ops 0 */
  v.d[13] = 0;
  s = sections(&v, &ls);
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_OK);
  CHECK(dwarfline_run(&s, &u, collect, &rs) == DWARFLINE_E_MALFORMED);

  v = b; /* line_range 0 with a special opcode in the program */
  v.d[16] = 0;
  s = sections(&v, &ls);
  memset(&rs, 0, sizeof(rs));
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_OK);
  CHECK(dwarfline_run(&s, &u, collect, &rs) == DWARFLINE_E_MALFORMED);

  /* The directory format's form: line_strp -> strx1. */
  v = b;
  for (size_t i = 0; i + 2 < v.n; i++) {
    if (v.d[i] == 1 && v.d[i + 1] == 1 && v.d[i + 2] == 0x1f) {
      v.d[i + 2] = 0x25;
      break;
    }
  }
  s = sections(&v, &ls);
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_E_UNSUPPORTED);

  /* line_strp without a .debug_line_str section */
  s = sections(&b, NULL);
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_E_MALFORMED);

  /* set_address with 3 bytes */
  buf p = { 0 };
  size_t unit_len = mark(&p, 4);
  put(&p, 4, 2);
  size_t header_len = mark(&p, 4);
  u8(&p, 1);
  u8(&p, 1);
  u8(&p, 1);
  u8(&p, 0);
  u8(&p, 1);
  u8(&p, 1); /* opcode_base 1: no standard opcodes at all */
  cstr(&p, "");
  cstr(&p, "");
  patch(&p, header_len, 4);
  u8(&p, 0);
  uleb(&p, 4);
  u8(&p, 2);
  put(&p, 0, 3);
  patch(&p, unit_len, 4);
  s = sections(&p, NULL);
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_OK);
  CHECK(dwarfline_run(&s, &u, collect, &rs) == DWARFLINE_E_MALFORMED);

  /* An extended opcode of length 0 */
  p.n -= 6;
  u8(&p, 0);
  uleb(&p, 0);
  patch(&p, unit_len, 4);
  s = sections(&p, NULL);
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_OK);
  CHECK(dwarfline_run(&s, &u, collect, &rs) == DWARFLINE_E_MALFORMED);
}

static int stop_at_two(void *user, const dwarfline_row *r)
{
  (void)r;
  int *n = user;
  return ++*n == 2 ? 42 : 0;
}

static void test_stop(void)
{
  buf b = { 0 }, ls = { 0 };
  v5_unit(&b, &ls, false, 13);
  dwarfline_sections s = sections(&b, &ls);
  dwarfline_unit u;
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_OK);
  int n = 0;
  CHECK(dwarfline_run(&s, &u, stop_at_two, &n) == 42 && n == 2);
}

/* ---- paths ---------------------------------------------------------------------------------- */

static void test_paths(void)
{
  /* Windows-style directories from a build on Windows, and a directory ending in a separator. */
  buf b = { 0 }, ls = { 0 };
  size_t unit_len = mark(&b, 4);
  put(&b, 5, 2);
  u8(&b, 8);
  u8(&b, 0);
  size_t header_len = mark(&b, 4);
  u8(&b, 1);
  u8(&b, 1);
  u8(&b, 1);
  u8(&b, 0);
  u8(&b, 1);
  u8(&b, 1);
  u8(&b, 1);
  uleb(&b, 1);
  uleb(&b, 0x08);
  uleb(&b, 3);
  cstr(&b, "C:\\build");
  cstr(&b, "/srv/");
  cstr(&b, "sub");
  u8(&b, 2);
  uleb(&b, 1);
  uleb(&b, 0x08);
  uleb(&b, 2);
  uleb(&b, 0x0b);
  uleb(&b, 3);
  cstr(&b, "a.c");
  u8(&b, 0);
  cstr(&b, "b.c");
  u8(&b, 1);
  cstr(&b, "c.c");
  u8(&b, 2);
  patch(&b, header_len, 4);
  patch(&b, unit_len, 4);
  dwarfline_sections s = sections(&b, &ls);
  dwarfline_unit u;
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_OK);
  char path[64];
  size_t len;
  CHECK(dwarfline_file_path(&s, &u, 0, path, sizeof(path), &len) == DWARFLINE_OK && strcmp(path, "C:\\build/a.c") == 0);
  CHECK(dwarfline_file_path(&s, &u, 1, path, sizeof(path), &len) == DWARFLINE_OK && strcmp(path, "/srv/b.c") == 0);
  CHECK(dwarfline_file_path(&s, &u, 2, path, sizeof(path), &len) == DWARFLINE_OK && strcmp(path, "C:\\build/sub/c.c") == 0);
  CHECK(dwarfline_file_path(&s, &u, 2, path, 1, &len) == DWARFLINE_E_TRUNCATED && path[0] == '\0');
}

/* ---- ELF images ----------------------------------------------------------------------------- */

/* A minimal ELF: header, the section contents, the section headers (null, .shstrtab,
 * .debug_line, .debug_line_str, and a SHT_NOBITS section whose range lies outside the image, as
 * .relro_padding does in a real PowerPC build: it has no bytes, so it must not matter). */
static size_t make_elf(uint8_t *out, bool is64, bool be, uint16_t type, uint64_t line_flags, const buf *line,
                       const buf *line_str)
{
  buf e = { .be = be };
  const char names[] = "\0.shstrtab\0.debug_line\0.debug_line_str\0";
  size_t ehsize = is64 ? 64 : 52;
  size_t shentsize = is64 ? 64 : 40;
  memcpy(e.d, "\177ELF", 4);
  e.d[4] = is64 ? 2 : 1;
  e.d[5] = be ? 2 : 1;
  e.d[6] = 1;
  e.n = 16;
  put(&e, type, 2);
  put(&e, 62, 2);
  put(&e, 1, 4);
  put(&e, 0, is64 ? 8 : 4);
  put(&e, 0, is64 ? 8 : 4);
  size_t names_off = ehsize;
  size_t line_off = names_off + sizeof(names);
  size_t ls_off = line_off + line->n;
  size_t sh_off = ls_off + line_str->n;
  put(&e, sh_off, is64 ? 8 : 4);
  put(&e, 0, 4);
  put(&e, ehsize, 2);
  put(&e, 0, 2);
  put(&e, 0, 2);
  put(&e, shentsize, 2);
  put(&e, 5, 2);
  put(&e, 1, 2);
  memcpy(e.d + names_off, names, sizeof(names));
  memcpy(e.d + line_off, line->d, line->n);
  memcpy(e.d + ls_off, line_str->d, line_str->n);
  e.n = sh_off;
  const struct {
    uint32_t name;
    uint64_t flags, off, size;
  } sh[5] = {
    { 0, 0, 0, 0 },
    { 1, 0, names_off, sizeof(names) },
    { 11, line_flags, line_off, line->n },
    { 23, 0x30, ls_off, line_str->n },
    { 0, 3, 0x100000, 0x100000 },
  };
  for (int i = 0; i < 5; i++) {
    size_t start = e.n;
    put(&e, sh[i].name, 4);
    put(&e, i == 1 ? 3 : i == 4 ? 8 : 1, 4);
    put(&e, sh[i].flags, is64 ? 8 : 4);
    put(&e, 0, is64 ? 8 : 4);
    put(&e, sh[i].off, is64 ? 8 : 4);
    put(&e, sh[i].size, is64 ? 8 : 4);
    e.n = start + shentsize;
  }
  memcpy(out, e.d, e.n);
  return e.n;
}

static void test_elf(void)
{
  for (int variant = 0; variant < 2; variant++) {
    bool is64 = variant == 0, be = variant == 1;
    buf line = { .be = be }, ls = { .be = be };
    v5_unit(&line, &ls, false, 13);
    static uint8_t image[4096];
    size_t n = make_elf(image, is64, be, 2, 0, &line, &ls);
    dwarfline_sections s;
    CHECK(dwarfline_elf_sections(image, n, &s) == DWARFLINE_OK);
    CHECK(s.address_size == (is64 ? 8 : 4) && s.big_endian == be);
    CHECK(s.debug_line_size == line.n && s.debug_line_str_size == ls.n && s.debug_str == NULL);
    rows rs;
    CHECK(run_all(&s, &rs) == DWARFLINE_OK && rs.n == 6);

    /* Every prefix of the image: an error code, never a read past it. */
    for (size_t k = 0; k < n; k++) {
      uint8_t *copy = malloc(k ? k : 1);
      memcpy(copy, image, k);
      if (dwarfline_elf_sections(copy, k, &s) == DWARFLINE_OK) {
        run_all(&s, &rs);
      }
      free(copy);
    }

    n = make_elf(image, is64, be, 1, 0, &line, &ls);
    CHECK(dwarfline_elf_sections(image, n, &s) == DWARFLINE_E_UNSUPPORTED); /* ET_REL */
    n = make_elf(image, is64, be, 3, 0x800, &line, &ls);
    CHECK(dwarfline_elf_sections(image, n, &s) == DWARFLINE_E_UNSUPPORTED); /* SHF_COMPRESSED */
    n = make_elf(image, is64, be, 4, 0, &line, &ls);
    CHECK(dwarfline_elf_sections(image, n, &s) == DWARFLINE_E_NOT_ELF); /* ET_CORE */
    image[0] = 'X';
    CHECK(dwarfline_elf_sections(image, n, &s) == DWARFLINE_E_NOT_ELF);
  }
  /* No .debug_line: rename it. */
  buf line = { 0 }, ls = { 0 };
  v5_unit(&line, &ls, false, 13);
  static uint8_t image[4096];
  size_t n = make_elf(image, true, false, 2, 0, &line, &ls);
  image[64 + 12] = 'X'; /* ".debug_line" -> ".Xebug_line" in the name table */
  dwarfline_sections s;
  CHECK(dwarfline_elf_sections(image, n, &s) == DWARFLINE_E_NO_LINES);
}

/* ---- every truncated prefix of every unit ---------------------------------------------------- */

static void truncations(const buf *b, const buf *ls)
{
  for (size_t k = 0; k < b->n; k++) {
    /* A heap copy of exactly k bytes, so ASan sees any read past it. */
    uint8_t *copy = malloc(k ? k : 1);
    memcpy(copy, b->d, k);
    dwarfline_sections s = { 0 };
    s.debug_line = copy;
    s.debug_line_size = k;
    if (ls) {
      s.debug_line_str = ls->d;
      s.debug_line_str_size = ls->n;
    }
    s.address_size = 8;
    s.big_endian = b->be;
    rows rs;
    int r = run_all(&s, &rs);
    CHECK(k == 0 ? r == DWARFLINE_OK : r != DWARFLINE_OK);
    free(copy);
  }
}

static void test_truncations(void)
{
  buf b = { 0 }, ls = { 0 };
  v5_unit(&b, &ls, false, 14);
  truncations(&b, &ls);
  buf b64 = { 0 }, ls64 = { 0 };
  v5_unit(&b64, &ls64, true, 13);
  truncations(&b64, &ls64);
  for (uint16_t v = 2; v <= 4; v++) {
    buf o = { 0 };
    old_unit(&o, v);
    truncations(&o, NULL);
  }
  /* A .debug_line_str cut short: the string runs off its end. */
  buf cut = ls;
  cut.n -= 1;
  dwarfline_sections s = sections(&b, &cut);
  dwarfline_unit u;
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_E_TRUNCATED);
}

/* ---- two units in one section ------------------------------------------------------------- */

static void test_two_units(void)
{
  buf b = { 0 }, ls = { 0 };
  v5_unit(&b, &ls, false, 13);
  size_t first = b.n;
  old_unit(&b, 4);
  dwarfline_sections s = sections(&b, &ls);
  dwarfline_unit u;
  CHECK(dwarfline_unit_at(&s, 0, &u) == DWARFLINE_OK && u.next_offset == first);
  CHECK(dwarfline_unit_at(&s, first, &u) == DWARFLINE_OK && u.version == 4 && u.next_offset == b.n);
  CHECK(dwarfline_unit_at(&s, b.n, &u) == DWARFLINE_END);
  CHECK(dwarfline_unit_at(&s, b.n + 1, &u) == DWARFLINE_E_TRUNCATED);
  rows rs;
  CHECK(run_all(&s, &rs) == DWARFLINE_OK && rs.n == 8);
}

int main(void)
{
  test_v5(false, 13);
  test_v5(true, 13);
  test_v5(false, 14);
  test_old(2);
  test_old(3);
  test_old(4);
  test_vliw();
  test_big_endian();
  test_errors();
  test_stop();
  test_paths();
  test_elf();
  test_truncations();
  test_two_units();
  printf("%d checks\n", g_checks);
  return 0;
}
