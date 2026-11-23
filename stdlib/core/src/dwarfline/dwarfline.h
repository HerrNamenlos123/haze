/*
 * dwarfline.h: reads DWARF line tables (.debug_line) out of an ELF image in memory.
 *
 * What it is for: turning an instruction address of a Haze program into its source file and line
 * (hzstd's profiler, on Linux). It replaces libdwarf, which came from the system and changed its
 * API between distributions. See README.md for the contract, the tests and what is not covered.
 *
 * Single header, like fiber.h: include it anywhere for the declarations; define
 * DWARFLINE_IMPLEMENTATION in exactly one translation unit before including it for the code.
 * Freestanding C11: <stdint.h>, <stddef.h>, <stdbool.h>, <string.h>. It never allocates, never
 * writes outside what the caller passes, and only reads inside the image it is given: every read
 * is bounds checked, so a truncated or corrupt image gives an error code, never a crash.
 *
 * Covered: ELF64 and ELF32, little and big endian; .debug_line versions 2 to 5, 32- and 64-bit
 * DWARF; every standard and extended opcode of DWARF 5 (unknown standard opcodes are skipped by
 * their declared operand count, unknown extended ones by their length, as the standard says);
 * DWARF 5 entry formats with the string forms string, line_strp and strp, and the data forms.
 * Not covered, reported as DWARFLINE_E_UNSUPPORTED: compressed sections (SHF_COMPRESSED), the
 * strx forms (they need .debug_str_offsets), relocatable objects (their addresses are not final).
 *
 * The rows are exactly what the line-number program states, in program order, with the register
 * widths LLVM uses (DWARFDebugLine::Row): line 32 bits, column and file 16, ISA and op index 8.
 * The tests compare every row and table entry with llvm-dwarfdump on every executable they find.
 */
#ifndef DWARFLINE_H
#define DWARFLINE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef DWARFLINE_API
#define DWARFLINE_API
#endif

/* Results. Errors are negative; DWARFLINE_END is "no more units". */
enum {
  DWARFLINE_OK = 0,
  DWARFLINE_END = 1,
  DWARFLINE_E_TRUNCATED = -1,   /* a read would go past the end of the data */
  DWARFLINE_E_MALFORMED = -2,   /* a value the format does not allow */
  DWARFLINE_E_UNSUPPORTED = -3, /* valid, but not covered here (see above) */
  DWARFLINE_E_NOT_ELF = -4,     /* not an ELF image, or not an executable or shared object */
  DWARFLINE_E_NO_LINES = -5,    /* an ELF image without .debug_line */
  DWARFLINE_E_INDEX = -6        /* a directory or file index the unit does not have */
};

/* A string inside the image: not NUL-terminated as far as the caller is concerned. */
typedef struct {
  const char *ptr;
  size_t len;
} dwarfline_str;

/* The sections a line table needs, as found by dwarfline_elf_sections (or set by hand). */
typedef struct {
  const uint8_t *debug_line;
  size_t debug_line_size;
  const uint8_t *debug_line_str; /* may be NULL */
  size_t debug_line_str_size;
  const uint8_t *debug_str; /* may be NULL */
  size_t debug_str_size;
  uint8_t address_size; /* the image's: 4 or 8; versions before 5 do not state their own */
  bool big_endian;
} dwarfline_sections;

/* One line table: its header, as read; the tables and the program stay in the image. */
typedef struct {
  uint64_t offset;      /* of the unit in .debug_line */
  uint64_t next_offset; /* where the next unit starts */
  uint16_t version;
  uint8_t offset_size; /* 4 (DWARF32) or 8 (DWARF64) */
  uint8_t address_size;
  uint8_t segment_selector_size;
  uint8_t min_inst_length;
  uint8_t max_ops_per_inst;
  bool default_is_stmt;
  int8_t line_base;
  uint8_t line_range;
  uint8_t opcode_base;
  const uint8_t *standard_opcode_lengths; /* opcode_base - 1 entries */
  /* Version 5: the entry formats (pairs of ULEB content type and form) and the tables. */
  const uint8_t *dir_format;
  uint8_t dir_format_count;
  const uint8_t *file_format;
  uint8_t file_format_count;
  const uint8_t *dir_table; /* the first entry */
  uint64_t dir_count;
  const uint8_t *file_table;
  uint64_t file_count;
  /* The indices the tables start with: 0 in version 5; before it, directory 0 and file 0 are
   * implied (the compilation directory and the primary file) and the tables start at 1. */
  uint64_t first_dir_index;
  uint64_t first_file_index;
  const uint8_t *program;
  const uint8_t *end;
} dwarfline_unit;

typedef struct {
  dwarfline_str name;
  uint64_t dir_index;
  bool has_md5;
  uint8_t md5[16];
} dwarfline_file;

enum {
  DWARFLINE_IS_STMT = 1,
  DWARFLINE_BASIC_BLOCK = 2,
  DWARFLINE_END_SEQUENCE = 4,
  DWARFLINE_PROLOGUE_END = 8,
  DWARFLINE_EPILOGUE_BEGIN = 16
};

typedef struct {
  uint64_t address;
  uint32_t line;
  uint16_t column;
  uint16_t file;
  uint32_t discriminator;
  uint8_t isa;
  uint8_t op_index;
  uint8_t flags; /* DWARFLINE_IS_STMT | ... */
} dwarfline_row;

/* Called for every row the program appends; a nonzero return stops the run (it is returned). */
typedef int (*dwarfline_row_fn)(void *user, const dwarfline_row *row);

/* Finds .debug_line, .debug_line_str and .debug_str in an ELF image of `size` bytes. */
DWARFLINE_API int dwarfline_elf_sections(const void *image, size_t size, dwarfline_sections *out);

/* Reads the header of the unit at `offset` (0 for the first, then unit.next_offset).
 * DWARFLINE_END once `offset` is the end of the section. */
DWARFLINE_API int dwarfline_unit_at(const dwarfline_sections *s, uint64_t offset, dwarfline_unit *unit);

/* A directory or file of the unit, by its index in the line program. */
DWARFLINE_API int dwarfline_dir(const dwarfline_sections *s, const dwarfline_unit *unit, uint64_t index,
                                dwarfline_str *out);
DWARFLINE_API int dwarfline_file_entry(const dwarfline_sections *s, const dwarfline_unit *unit, uint64_t index,
                                       dwarfline_file *out);

/* The file's path as the program refers to it: its name if that is absolute, else its directory
 * joined with it (a relative directory other than 0 is itself joined to directory 0, which in
 * version 5 is the compilation directory). Before version 5 directory 0 is not in the table: a
 * file in it comes back as its bare name. Joins with '/' unless the part before already ends in a
 * separator. Writes at most `cap` bytes, always NUL-terminated (cap > 0); *len is the full
 * length, and a path that does not fit gives DWARFLINE_E_TRUNCATED. */
DWARFLINE_API int dwarfline_file_path(const dwarfline_sections *s, const dwarfline_unit *unit, uint64_t index,
                                      char *buf, size_t cap, size_t *len);

/* Runs the unit's line-number program and calls `fn` for every row it appends, in order. */
DWARFLINE_API int dwarfline_run(const dwarfline_sections *s, const dwarfline_unit *unit, dwarfline_row_fn fn,
                                void *user);

#endif /* DWARFLINE_H */

/* ============================================================================================ */

#ifdef DWARFLINE_IMPLEMENTATION
#ifndef DWARFLINE_IMPLEMENTED
#define DWARFLINE_IMPLEMENTED

#include <string.h>

/* A cursor over [p, end): every read checks its bounds and clears `ok` instead of reading past. */
typedef struct {
  const uint8_t *p;
  const uint8_t *end;
  bool big_endian;
  bool ok;
} dwarfline__cur;

static uint64_t dwarfline__fixed(dwarfline__cur *c, unsigned bytes)
{
  if (!c->ok || (size_t)(c->end - c->p) < bytes) {
    c->ok = false;
    return 0;
  }
  uint64_t v = 0;
  for (unsigned i = 0; i < bytes; i++) {
    unsigned shift = c->big_endian ? 8 * (bytes - 1 - i) : 8 * i;
    v |= (uint64_t)c->p[i] << shift;
  }
  c->p += bytes;
  return v;
}

static uint64_t dwarfline__uleb(dwarfline__cur *c)
{
  uint64_t v = 0;
  unsigned shift = 0;
  for (;;) {
    if (!c->ok || c->p >= c->end) {
      c->ok = false;
      return 0;
    }
    uint8_t b = *c->p++;
    if (shift < 64) {
      v |= (uint64_t)(b & 0x7f) << shift;
    }
    shift += 7;
    if ((b & 0x80) == 0) {
      return v;
    }
  }
}

static int64_t dwarfline__sleb(dwarfline__cur *c)
{
  uint64_t v = 0;
  unsigned shift = 0;
  uint8_t b;
  do {
    if (!c->ok || c->p >= c->end) {
      c->ok = false;
      return 0;
    }
    b = *c->p++;
    if (shift < 64) {
      v |= (uint64_t)(b & 0x7f) << shift;
    }
    shift += 7;
  } while (b & 0x80);
  if (shift < 64 && (b & 0x40)) {
    v |= ~(uint64_t)0 << shift;
  }
  return (int64_t)v;
}

/* A NUL-terminated string at the cursor; the cursor moves past the NUL. */
static dwarfline_str dwarfline__cstr(dwarfline__cur *c)
{
  dwarfline_str s = { 0 };
  if (!c->ok) {
    return s;
  }
  const uint8_t *nul = memchr(c->p, 0, (size_t)(c->end - c->p));
  if (nul == NULL) {
    c->ok = false;
    return s;
  }
  s.ptr = (const char *)c->p;
  s.len = (size_t)(nul - c->p);
  c->p = nul + 1;
  return s;
}

static void dwarfline__skip(dwarfline__cur *c, uint64_t n)
{
  if (!c->ok || (uint64_t)(c->end - c->p) < n) {
    c->ok = false;
    return;
  }
  c->p += n;
}

/* A string in .debug_line_str or .debug_str at `offset`. */
static int dwarfline__section_str(const uint8_t *data, size_t size, uint64_t offset, dwarfline_str *out)
{
  if (data == NULL) {
    return DWARFLINE_E_MALFORMED; /* a form that points into a section the image does not have */
  }
  if (offset >= size) {
    return DWARFLINE_E_TRUNCATED;
  }
  const uint8_t *nul = memchr(data + offset, 0, size - (size_t)offset);
  if (nul == NULL) {
    return DWARFLINE_E_TRUNCATED;
  }
  out->ptr = (const char *)(data + offset);
  out->len = (size_t)(nul - (data + offset));
  return DWARFLINE_OK;
}

/* ---- ELF ---------------------------------------------------------------------------------- */

DWARFLINE_API int dwarfline_elf_sections(const void *image, size_t size, dwarfline_sections *out)
{
  memset(out, 0, sizeof(*out));
  const uint8_t *b = image;
  if (size < 16 || memcmp(b, "\177ELF", 4) != 0) {
    return DWARFLINE_E_NOT_ELF;
  }
  bool is64 = b[4] == 2;
  if ((b[4] != 1 && b[4] != 2) || (b[5] != 1 && b[5] != 2)) {
    return DWARFLINE_E_NOT_ELF;
  }
  bool be = b[5] == 2;
  dwarfline__cur c = { .p = b + 16, .end = b + size, .big_endian = be, .ok = true };
  uint64_t type = dwarfline__fixed(&c, 2);
  dwarfline__fixed(&c, 2); /* machine */
  dwarfline__fixed(&c, 4); /* version */
  dwarfline__fixed(&c, is64 ? 8 : 4); /* entry */
  dwarfline__fixed(&c, is64 ? 8 : 4); /* program headers */
  uint64_t shoff = dwarfline__fixed(&c, is64 ? 8 : 4);
  dwarfline__fixed(&c, 4); /* flags */
  dwarfline__fixed(&c, 2); /* header size */
  dwarfline__fixed(&c, 2); /* program header entry size */
  dwarfline__fixed(&c, 2); /* program header count */
  uint64_t shentsize = dwarfline__fixed(&c, 2);
  uint64_t shnum = dwarfline__fixed(&c, 2);
  uint64_t shstrndx = dwarfline__fixed(&c, 2);
  if (!c.ok) {
    return DWARFLINE_E_NOT_ELF;
  }
  if (type == 1) {
    return DWARFLINE_E_UNSUPPORTED; /* ET_REL: addresses and string offsets wait for relocation */
  }
  if (type != 2 && type != 3) {
    return DWARFLINE_E_NOT_ELF;
  }
  if (shentsize < (is64 ? 64u : 40u) || shoff > size || shnum > (size - shoff) / shentsize ||
      shstrndx >= shnum) {
    return shnum == 0 ? DWARFLINE_E_NO_LINES : DWARFLINE_E_MALFORMED;
  }
  out->address_size = is64 ? 8 : 4;
  out->big_endian = be;

  /* The section name table first. */
  uint64_t names_off = 0, names_size = 0;
  for (int pass = 0; pass < 2; pass++) {
    for (uint64_t i = 0; i < shnum; i++) {
      if (pass == 0 && i != shstrndx) {
        continue;
      }
      dwarfline__cur h = { .p = b + shoff + i * shentsize, .end = b + size, .big_endian = be, .ok = true };
      uint64_t name = dwarfline__fixed(&h, 4);
      dwarfline__fixed(&h, 4); /* type */
      uint64_t flags = dwarfline__fixed(&h, is64 ? 8 : 4);
      dwarfline__fixed(&h, is64 ? 8 : 4); /* address */
      uint64_t off = dwarfline__fixed(&h, is64 ? 8 : 4);
      uint64_t sz = dwarfline__fixed(&h, is64 ? 8 : 4);
      if (!h.ok) {
        return DWARFLINE_E_MALFORMED;
      }
      /* Only the sections read here must lie inside the image: others may not (SHT_NOBITS
       * sections such as .bss or .relro_padding have an offset and size but no bytes). */
      bool in_image = off <= size && sz <= size - off;
      if (pass == 0) {
        if (!in_image) {
          return DWARFLINE_E_MALFORMED;
        }
        names_off = off;
        names_size = sz;
        continue;
      }
      if (name >= names_size) {
        return DWARFLINE_E_MALFORMED;
      }
      const char *n = (const char *)(b + names_off + name);
      const char *nul = memchr(n, 0, (size_t)(names_size - name));
      if (nul == NULL) {
        return DWARFLINE_E_MALFORMED;
      }
      size_t n_len = (size_t)(nul - n);
      const uint8_t **slot = NULL;
      size_t *slot_size = NULL;
      if (n_len == 11 && memcmp(n, ".debug_line", 11) == 0) {
        slot = &out->debug_line;
        slot_size = &out->debug_line_size;
      }
      else if (n_len == 15 && memcmp(n, ".debug_line_str", 15) == 0) {
        slot = &out->debug_line_str;
        slot_size = &out->debug_line_str_size;
      }
      else if (n_len == 10 && memcmp(n, ".debug_str", 10) == 0) {
        slot = &out->debug_str;
        slot_size = &out->debug_str_size;
      }
      if (slot == NULL) {
        continue;
      }
      if (flags & 0x800) { /* SHF_COMPRESSED */
        return DWARFLINE_E_UNSUPPORTED;
      }
      if (!in_image) {
        return DWARFLINE_E_MALFORMED;
      }
      *slot = b + off;
      *slot_size = (size_t)sz;
    }
  }
  return out->debug_line == NULL ? DWARFLINE_E_NO_LINES : DWARFLINE_OK;
}

/* ---- the unit header ---------------------------------------------------------------------- */

/* DW_FORM codes and DW_LNCT content types used by version 5 entry formats. */
enum {
  DWARFLINE__FORM_block = 0x09,
  DWARFLINE__FORM_block1 = 0x0a,
  DWARFLINE__FORM_block2 = 0x03,
  DWARFLINE__FORM_block4 = 0x04,
  DWARFLINE__FORM_data1 = 0x0b,
  DWARFLINE__FORM_data2 = 0x05,
  DWARFLINE__FORM_data4 = 0x06,
  DWARFLINE__FORM_data8 = 0x07,
  DWARFLINE__FORM_data16 = 0x1e,
  DWARFLINE__FORM_sdata = 0x0d,
  DWARFLINE__FORM_udata = 0x0f,
  DWARFLINE__FORM_string = 0x08,
  DWARFLINE__FORM_strp = 0x0e,
  DWARFLINE__FORM_line_strp = 0x1f,
  DWARFLINE__FORM_strx = 0x1a,
  DWARFLINE__FORM_strx1 = 0x25,
  DWARFLINE__FORM_strx2 = 0x26,
  DWARFLINE__FORM_strx3 = 0x27,
  DWARFLINE__FORM_strx4 = 0x28,
  DWARFLINE__LNCT_path = 1,
  DWARFLINE__LNCT_directory_index = 2,
  DWARFLINE__LNCT_MD5 = 5
};

/* What one attribute of an entry holds: a string, a number, 16 bytes, or nothing we keep. */
typedef struct {
  dwarfline_str str;
  uint64_t num;
  const uint8_t *data16;
  bool is_str;
  bool is_num;
} dwarfline__value;

static int dwarfline__form(const dwarfline_sections *s, const dwarfline_unit *u, dwarfline__cur *c, uint64_t form,
                           dwarfline__value *v)
{
  memset(v, 0, sizeof(*v));
  switch (form) {
  case DWARFLINE__FORM_string:
    v->str = dwarfline__cstr(c);
    v->is_str = true;
    break;
  case DWARFLINE__FORM_line_strp:
  case DWARFLINE__FORM_strp: {
    uint64_t off = dwarfline__fixed(c, u->offset_size);
    if (!c->ok) {
      return DWARFLINE_E_TRUNCATED;
    }
    int r = form == DWARFLINE__FORM_line_strp
                ? dwarfline__section_str(s->debug_line_str, s->debug_line_str_size, off, &v->str)
                : dwarfline__section_str(s->debug_str, s->debug_str_size, off, &v->str);
    if (r != DWARFLINE_OK) {
      return r;
    }
    v->is_str = true;
    break;
  }
  case DWARFLINE__FORM_data1:
    v->num = dwarfline__fixed(c, 1);
    v->is_num = true;
    break;
  case DWARFLINE__FORM_data2:
    v->num = dwarfline__fixed(c, 2);
    v->is_num = true;
    break;
  case DWARFLINE__FORM_data4:
    v->num = dwarfline__fixed(c, 4);
    v->is_num = true;
    break;
  case DWARFLINE__FORM_data8:
    v->num = dwarfline__fixed(c, 8);
    v->is_num = true;
    break;
  case DWARFLINE__FORM_udata:
    v->num = dwarfline__uleb(c);
    v->is_num = true;
    break;
  case DWARFLINE__FORM_sdata:
    v->num = (uint64_t)dwarfline__sleb(c);
    v->is_num = true;
    break;
  case DWARFLINE__FORM_data16:
    v->data16 = c->p;
    dwarfline__skip(c, 16);
    break;
  case DWARFLINE__FORM_block:
    dwarfline__skip(c, dwarfline__uleb(c));
    break;
  case DWARFLINE__FORM_block1:
    dwarfline__skip(c, dwarfline__fixed(c, 1));
    break;
  case DWARFLINE__FORM_block2:
    dwarfline__skip(c, dwarfline__fixed(c, 2));
    break;
  case DWARFLINE__FORM_block4:
    dwarfline__skip(c, dwarfline__fixed(c, 4));
    break;
  case DWARFLINE__FORM_strx:
  case DWARFLINE__FORM_strx1:
  case DWARFLINE__FORM_strx2:
  case DWARFLINE__FORM_strx3:
  case DWARFLINE__FORM_strx4:
    return DWARFLINE_E_UNSUPPORTED;
  default:
    return DWARFLINE_E_UNSUPPORTED; /* a form an entry format may not use, or an unknown one */
  }
  return c->ok ? DWARFLINE_OK : DWARFLINE_E_TRUNCATED;
}

/* Skips (or reads into *file / *dir) one version 5 entry described by `format`. */
static int dwarfline__entry(const dwarfline_sections *s, const dwarfline_unit *u, dwarfline__cur *c,
                            const uint8_t *format, uint8_t format_count, dwarfline_file *file, dwarfline_str *dir)
{
  dwarfline__cur f = { .p = format, .end = u->end, .big_endian = s->big_endian, .ok = true };
  for (uint8_t i = 0; i < format_count; i++) {
    uint64_t type = dwarfline__uleb(&f);
    uint64_t form = dwarfline__uleb(&f);
    if (!f.ok) {
      return DWARFLINE_E_TRUNCATED;
    }
    dwarfline__value v;
    int r = dwarfline__form(s, u, c, form, &v);
    if (r != DWARFLINE_OK) {
      return r;
    }
    if (type == DWARFLINE__LNCT_path) {
      if (!v.is_str) {
        return DWARFLINE_E_MALFORMED;
      }
      if (file) {
        file->name = v.str;
      }
      if (dir) {
        *dir = v.str;
      }
    }
    else if (type == DWARFLINE__LNCT_directory_index) {
      if (!v.is_num) {
        return DWARFLINE_E_MALFORMED;
      }
      if (file) {
        file->dir_index = v.num;
      }
    }
    else if (type == DWARFLINE__LNCT_MD5) {
      if (v.data16 == NULL) {
        return DWARFLINE_E_MALFORMED;
      }
      if (file) {
        file->has_md5 = true;
        memcpy(file->md5, v.data16, 16);
      }
    }
    /* Other content types (timestamp, size, vendor ones) are read past by their form. */
  }
  return DWARFLINE_OK;
}

/* Reads past a version 5 entry format and its table; returns the table's first entry. */
static int dwarfline__v5_table(const dwarfline_sections *s, const dwarfline_unit *u, dwarfline__cur *c,
                               const uint8_t **format, uint8_t *format_count, const uint8_t **table, uint64_t *count)
{
  *format_count = (uint8_t)dwarfline__fixed(c, 1);
  *format = c->p;
  for (uint8_t i = 0; i < *format_count; i++) {
    dwarfline__uleb(c);
    dwarfline__uleb(c);
  }
  *count = dwarfline__uleb(c);
  if (!c->ok) {
    return DWARFLINE_E_TRUNCATED;
  }
  *table = c->p;
  for (uint64_t i = 0; i < *count; i++) {
    int r = dwarfline__entry(s, u, c, *format, *format_count, NULL, NULL);
    if (r != DWARFLINE_OK) {
      return r;
    }
  }
  return DWARFLINE_OK;
}

DWARFLINE_API int dwarfline_unit_at(const dwarfline_sections *s, uint64_t offset, dwarfline_unit *u)
{
  memset(u, 0, sizeof(*u));
  if (offset == s->debug_line_size) {
    return DWARFLINE_END;
  }
  if (offset > s->debug_line_size) {
    return DWARFLINE_E_TRUNCATED;
  }
  const uint8_t *section_end = s->debug_line + s->debug_line_size;
  dwarfline__cur c = { .p = s->debug_line + offset, .end = section_end, .big_endian = s->big_endian, .ok = true };
  u->offset = offset;
  uint64_t length = dwarfline__fixed(&c, 4);
  u->offset_size = 4;
  if (length == 0xffffffffu) {
    length = dwarfline__fixed(&c, 8);
    u->offset_size = 8;
  }
  else if (length >= 0xfffffff0u) {
    return DWARFLINE_E_MALFORMED; /* reserved unit lengths */
  }
  if (!c.ok) {
    return DWARFLINE_E_TRUNCATED;
  }
  if (length > (uint64_t)(section_end - c.p)) {
    return DWARFLINE_E_TRUNCATED;
  }
  u->end = c.p + length;
  u->next_offset = (uint64_t)(u->end - s->debug_line);
  c.end = u->end;
  u->version = (uint16_t)dwarfline__fixed(&c, 2);
  if (!c.ok) {
    return DWARFLINE_E_TRUNCATED;
  }
  if (u->version < 2 || u->version > 5) {
    return DWARFLINE_E_UNSUPPORTED;
  }
  u->address_size = s->address_size;
  if (u->version >= 5) {
    u->address_size = (uint8_t)dwarfline__fixed(&c, 1);
    u->segment_selector_size = (uint8_t)dwarfline__fixed(&c, 1);
  }
  uint64_t header_length = dwarfline__fixed(&c, u->offset_size);
  if (!c.ok) {
    return DWARFLINE_E_TRUNCATED;
  }
  if (header_length > (uint64_t)(u->end - c.p)) {
    return DWARFLINE_E_TRUNCATED;
  }
  u->program = c.p + header_length;
  u->min_inst_length = (uint8_t)dwarfline__fixed(&c, 1);
  u->max_ops_per_inst = u->version >= 4 ? (uint8_t)dwarfline__fixed(&c, 1) : 1;
  u->default_is_stmt = dwarfline__fixed(&c, 1) != 0;
  u->line_base = (int8_t)(uint8_t)dwarfline__fixed(&c, 1);
  u->line_range = (uint8_t)dwarfline__fixed(&c, 1);
  u->opcode_base = (uint8_t)dwarfline__fixed(&c, 1);
  if (!c.ok) {
    return DWARFLINE_E_TRUNCATED;
  }
  if (u->opcode_base == 0) {
    return DWARFLINE_E_MALFORMED;
  }
  u->standard_opcode_lengths = c.p;
  dwarfline__skip(&c, (uint64_t)u->opcode_base - 1);
  /* The tables lie inside the header; nothing past it belongs to them. */
  c.end = u->program;
  if (!c.ok) {
    return DWARFLINE_E_TRUNCATED;
  }
  if (u->version >= 5) {
    u->first_dir_index = 0;
    u->first_file_index = 0;
    int r = dwarfline__v5_table(s, u, &c, &u->dir_format, &u->dir_format_count, &u->dir_table, &u->dir_count);
    if (r != DWARFLINE_OK) {
      return r;
    }
    r = dwarfline__v5_table(s, u, &c, &u->file_format, &u->file_format_count, &u->file_table, &u->file_count);
    if (r != DWARFLINE_OK) {
      return r;
    }
  }
  else {
    u->first_dir_index = 1;
    u->first_file_index = 1;
    u->dir_table = c.p;
    for (;;) {
      dwarfline_str d = dwarfline__cstr(&c);
      if (!c.ok) {
        return DWARFLINE_E_TRUNCATED;
      }
      if (d.len == 0) {
        break;
      }
      u->dir_count++;
    }
    u->file_table = c.p;
    for (;;) {
      dwarfline_str f = dwarfline__cstr(&c);
      if (!c.ok) {
        return DWARFLINE_E_TRUNCATED;
      }
      if (f.len == 0) {
        break;
      }
      dwarfline__uleb(&c);
      dwarfline__uleb(&c);
      dwarfline__uleb(&c);
      if (!c.ok) {
        return DWARFLINE_E_TRUNCATED;
      }
      u->file_count++;
    }
  }
  return DWARFLINE_OK;
}

DWARFLINE_API int dwarfline_dir(const dwarfline_sections *s, const dwarfline_unit *u, uint64_t index,
                                dwarfline_str *out)
{
  memset(out, 0, sizeof(*out));
  if (index < u->first_dir_index || index - u->first_dir_index >= u->dir_count) {
    return DWARFLINE_E_INDEX;
  }
  uint64_t n = index - u->first_dir_index;
  dwarfline__cur c = { .p = u->dir_table, .end = u->program, .big_endian = s->big_endian, .ok = true };
  for (uint64_t i = 0;; i++) {
    dwarfline_str d = { 0 };
    if (u->version >= 5) {
      int r = dwarfline__entry(s, u, &c, u->dir_format, u->dir_format_count, NULL, &d);
      if (r != DWARFLINE_OK) {
        return r;
      }
    }
    else {
      d = dwarfline__cstr(&c);
      if (!c.ok) {
        return DWARFLINE_E_TRUNCATED;
      }
    }
    if (i == n) {
      *out = d;
      return DWARFLINE_OK;
    }
  }
}

DWARFLINE_API int dwarfline_file_entry(const dwarfline_sections *s, const dwarfline_unit *u, uint64_t index,
                                       dwarfline_file *out)
{
  memset(out, 0, sizeof(*out));
  if (index < u->first_file_index || index - u->first_file_index >= u->file_count) {
    return DWARFLINE_E_INDEX;
  }
  uint64_t n = index - u->first_file_index;
  dwarfline__cur c = { .p = u->file_table, .end = u->program, .big_endian = s->big_endian, .ok = true };
  for (uint64_t i = 0;; i++) {
    dwarfline_file f = { 0 };
    if (u->version >= 5) {
      int r = dwarfline__entry(s, u, &c, u->file_format, u->file_format_count, &f, NULL);
      if (r != DWARFLINE_OK) {
        return r;
      }
    }
    else {
      f.name = dwarfline__cstr(&c);
      f.dir_index = dwarfline__uleb(&c);
      dwarfline__uleb(&c); /* modification time */
      dwarfline__uleb(&c); /* length */
      if (!c.ok) {
        return DWARFLINE_E_TRUNCATED;
      }
    }
    if (i == n) {
      *out = f;
      return DWARFLINE_OK;
    }
  }
}

/* An absolute path: "/..." on Linux, "C:\..." or "C:/..." or "\\..." from a Windows build. */
static bool dwarfline__absolute(dwarfline_str p)
{
  if (p.len >= 1 && (p.ptr[0] == '/' || p.ptr[0] == '\\')) {
    return true;
  }
  return p.len >= 3 && p.ptr[1] == ':' && (p.ptr[2] == '/' || p.ptr[2] == '\\');
}

/* Appends `part` (and a separator before it unless it is the first) to buf[*len...). */
static void dwarfline__append(char *buf, size_t cap, size_t *len, dwarfline_str part)
{
  if (*len > 0 && part.len > 0) {
    char last = *len - 1 < cap ? buf[*len - 1] : 0; /* 0 if it did not fit: then the result fails anyway */
    if (last != '/' && last != '\\') {
      if (*len < cap) {
        buf[*len] = '/';
      }
      (*len)++;
    }
  }
  for (size_t i = 0; i < part.len; i++, (*len)++) {
    if (*len < cap) {
      buf[*len] = part.ptr[i];
    }
  }
}

DWARFLINE_API int dwarfline_file_path(const dwarfline_sections *s, const dwarfline_unit *u, uint64_t index, char *buf,
                                      size_t cap, size_t *len)
{
  *len = 0;
  dwarfline_file f;
  int r = dwarfline_file_entry(s, u, index, &f);
  if (r != DWARFLINE_OK) {
    return r;
  }
  if (!dwarfline__absolute(f.name)) {
    dwarfline_str dir = { 0 };
    if (u->version >= 5 || f.dir_index != 0) {
      r = dwarfline_dir(s, u, f.dir_index, &dir);
      if (r != DWARFLINE_OK) {
        return r;
      }
    }
    if (dir.len > 0 && !dwarfline__absolute(dir) && f.dir_index != 0 && u->version >= 5) {
      dwarfline_str base;
      r = dwarfline_dir(s, u, 0, &base);
      if (r != DWARFLINE_OK) {
        return r;
      }
      dwarfline__append(buf, cap, len, base);
    }
    dwarfline__append(buf, cap, len, dir);
  }
  dwarfline__append(buf, cap, len, f.name);
  if (cap > 0) {
    buf[*len < cap ? *len : cap - 1] = '\0';
  }
  return *len < cap ? DWARFLINE_OK : DWARFLINE_E_TRUNCATED;
}

/* ---- the line-number program -------------------------------------------------------------- */

enum {
  DWARFLINE__LNS_copy = 1,
  DWARFLINE__LNS_advance_pc,
  DWARFLINE__LNS_advance_line,
  DWARFLINE__LNS_set_file,
  DWARFLINE__LNS_set_column,
  DWARFLINE__LNS_negate_stmt,
  DWARFLINE__LNS_set_basic_block,
  DWARFLINE__LNS_const_add_pc,
  DWARFLINE__LNS_fixed_advance_pc,
  DWARFLINE__LNS_set_prologue_end,
  DWARFLINE__LNS_set_epilogue_begin,
  DWARFLINE__LNS_set_isa,
  DWARFLINE__LNE_end_sequence = 1,
  DWARFLINE__LNE_set_address = 2,
  DWARFLINE__LNE_define_file = 3,
  DWARFLINE__LNE_set_discriminator = 4
};

static void dwarfline__reset(const dwarfline_unit *u, dwarfline_row *r)
{
  memset(r, 0, sizeof(*r));
  r->file = 1;
  r->line = 1;
  r->flags = u->default_is_stmt ? DWARFLINE_IS_STMT : 0;
}

/* Advances the address by `operation_advance` operations (DWARF 5, 6.2.5.1). */
static void dwarfline__advance(const dwarfline_unit *u, dwarfline_row *r, uint64_t operation_advance)
{
  if (u->max_ops_per_inst == 1) {
    r->address += (uint64_t)u->min_inst_length * operation_advance;
    return;
  }
  uint64_t ops = (uint64_t)r->op_index + operation_advance;
  r->address += (uint64_t)u->min_inst_length * (ops / u->max_ops_per_inst);
  r->op_index = (uint8_t)(ops % u->max_ops_per_inst);
}

DWARFLINE_API int dwarfline_run(const dwarfline_sections *s, const dwarfline_unit *u, dwarfline_row_fn fn, void *user)
{
  if (u->max_ops_per_inst == 0) {
    return DWARFLINE_E_MALFORMED;
  }
  dwarfline__cur c = { .p = u->program, .end = u->end, .big_endian = s->big_endian, .ok = true };
  dwarfline_row r;
  dwarfline__reset(u, &r);
  while (c.p < c.end) {
    uint8_t op = (uint8_t)dwarfline__fixed(&c, 1);
    if (op >= u->opcode_base) {
      if (u->line_range == 0) {
        return DWARFLINE_E_MALFORMED;
      }
      uint8_t adjusted = (uint8_t)(op - u->opcode_base);
      dwarfline__advance(u, &r, adjusted / u->line_range);
      r.line += (uint32_t)(int32_t)(u->line_base + (int)(adjusted % u->line_range));
      int stop = fn(user, &r);
      if (stop) {
        return stop;
      }
      r.flags &= (uint8_t)~(DWARFLINE_BASIC_BLOCK | DWARFLINE_PROLOGUE_END | DWARFLINE_EPILOGUE_BEGIN);
      r.discriminator = 0;
      continue;
    }
    if (op == 0) {
      uint64_t len = dwarfline__uleb(&c);
      if (!c.ok) {
        return DWARFLINE_E_TRUNCATED;
      }
      if (len == 0 || len > (uint64_t)(c.end - c.p)) {
        return len == 0 ? DWARFLINE_E_MALFORMED : DWARFLINE_E_TRUNCATED;
      }
      const uint8_t *next = c.p + len;
      uint8_t sub = (uint8_t)dwarfline__fixed(&c, 1);
      switch (sub) {
      case DWARFLINE__LNE_end_sequence: {
        r.flags |= DWARFLINE_END_SEQUENCE;
        int stop = fn(user, &r);
        if (stop) {
          return stop;
        }
        dwarfline__reset(u, &r);
        break;
      }
      case DWARFLINE__LNE_set_address: {
        uint64_t size = len - 1;
        if (size != 1 && size != 2 && size != 4 && size != 8) {
          return DWARFLINE_E_MALFORMED;
        }
        r.address = dwarfline__fixed(&c, (unsigned)size);
        r.op_index = 0;
        break;
      }
      case DWARFLINE__LNE_set_discriminator:
        r.discriminator = (uint32_t)dwarfline__uleb(&c);
        break;
      case DWARFLINE__LNE_define_file:
      default:
        break; /* define_file (before version 5) adds no row; unknown ones are skipped by length */
      }
      if (!c.ok || c.p > next) {
        return DWARFLINE_E_TRUNCATED;
      }
      c.p = next;
      continue;
    }
    switch (op) {
    case DWARFLINE__LNS_copy: {
      int stop = fn(user, &r);
      if (stop) {
        return stop;
      }
      r.flags &= (uint8_t)~(DWARFLINE_BASIC_BLOCK | DWARFLINE_PROLOGUE_END | DWARFLINE_EPILOGUE_BEGIN);
      r.discriminator = 0;
      break;
    }
    case DWARFLINE__LNS_advance_pc:
      dwarfline__advance(u, &r, dwarfline__uleb(&c));
      break;
    case DWARFLINE__LNS_advance_line:
      r.line += (uint32_t)dwarfline__sleb(&c);
      break;
    case DWARFLINE__LNS_set_file:
      r.file = (uint16_t)dwarfline__uleb(&c);
      break;
    case DWARFLINE__LNS_set_column:
      r.column = (uint16_t)dwarfline__uleb(&c);
      break;
    case DWARFLINE__LNS_negate_stmt:
      r.flags ^= DWARFLINE_IS_STMT;
      break;
    case DWARFLINE__LNS_set_basic_block:
      r.flags |= DWARFLINE_BASIC_BLOCK;
      break;
    case DWARFLINE__LNS_const_add_pc:
      if (u->line_range == 0) {
        return DWARFLINE_E_MALFORMED;
      }
      dwarfline__advance(u, &r, (uint8_t)(255 - u->opcode_base) / u->line_range);
      break;
    case DWARFLINE__LNS_fixed_advance_pc:
      r.address += dwarfline__fixed(&c, 2);
      r.op_index = 0;
      break;
    case DWARFLINE__LNS_set_prologue_end:
      r.flags |= DWARFLINE_PROLOGUE_END;
      break;
    case DWARFLINE__LNS_set_epilogue_begin:
      r.flags |= DWARFLINE_EPILOGUE_BEGIN;
      break;
    case DWARFLINE__LNS_set_isa:
      r.isa = (uint8_t)dwarfline__uleb(&c);
      break;
    default: {
      /* A standard opcode this reader does not know: skip its declared ULEB operands. */
      uint8_t n = u->standard_opcode_lengths[op - 1];
      for (uint8_t i = 0; i < n; i++) {
        dwarfline__uleb(&c);
      }
      break;
    }
    }
    if (!c.ok) {
      return DWARFLINE_E_TRUNCATED;
    }
  }
  return DWARFLINE_OK;
}

#endif /* DWARFLINE_IMPLEMENTED */
#endif /* DWARFLINE_IMPLEMENTATION */
