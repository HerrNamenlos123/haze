/*
 * dwarfline-dump <elf>: prints every line table of an ELF image in the line format run.ts also
 * derives from llvm-dwarfdump --debug-line, so the two can be compared line by line:
 *
 *   unit <offset> version <v> <DWARF32|DWARF64> [address_size <n>]   (the size: version 5 only)
 *   dir <index> "<path>"
 *   file <index> "<name>" dir <index> [md5 <hex>]
 *   row <address> <line> <column> <file> <isa> <discriminator> <op_index> [flags...]
 *   path <index> "<resolved path>"        (only with --paths: dwarfline_file_path)
 *
 * Strings are printed as they are in the image, between quotes. Exit status: 0, or 1 and a line
 * "error <code> <where>" when the library reports an error.
 */
#define DWARFLINE_IMPLEMENTATION
#include "../dwarfline.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void print_str(dwarfline_str s)
{
  putchar('"');
  fwrite(s.ptr, 1, s.len, stdout);
  putchar('"');
}

static int print_row(void *user, const dwarfline_row *r)
{
  (void)user;
  printf("row 0x%016llx %u %u %u %u %u %u",
         (unsigned long long)r->address,
         (unsigned)r->line,
         (unsigned)r->column,
         (unsigned)r->file,
         (unsigned)r->isa,
         (unsigned)r->discriminator,
         (unsigned)r->op_index);
  if (r->flags & DWARFLINE_IS_STMT) {
    printf(" is_stmt");
  }
  if (r->flags & DWARFLINE_BASIC_BLOCK) {
    printf(" basic_block");
  }
  if (r->flags & DWARFLINE_PROLOGUE_END) {
    printf(" prologue_end");
  }
  if (r->flags & DWARFLINE_EPILOGUE_BEGIN) {
    printf(" epilogue_begin");
  }
  if (r->flags & DWARFLINE_END_SEQUENCE) {
    printf(" end_sequence");
  }
  putchar('\n');
  return 0;
}

int main(int argc, char **argv)
{
  bool paths = argc == 3 && strcmp(argv[2], "--paths") == 0;
  if (argc < 2 || (argc == 3 && !paths) || argc > 3) {
    fprintf(stderr, "usage: dwarfline-dump <elf> [--paths]\n");
    return 2;
  }
  FILE *f = fopen(argv[1], "rb");
  if (f == NULL) {
    fprintf(stderr, "cannot open %s\n", argv[1]);
    return 2;
  }
  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  fseek(f, 0, SEEK_SET);
  uint8_t *image = malloc(size > 0 ? (size_t)size : 1);
  if (image == NULL || fread(image, 1, (size_t)size, f) != (size_t)size) {
    fprintf(stderr, "cannot read %s\n", argv[1]);
    return 2;
  }
  fclose(f);

  dwarfline_sections s;
  int r = dwarfline_elf_sections(image, (size_t)size, &s);
  if (r != DWARFLINE_OK) {
    printf("error %d sections\n", r);
    return 1;
  }
  uint64_t offset = 0;
  for (;;) {
    dwarfline_unit u;
    r = dwarfline_unit_at(&s, offset, &u);
    if (r == DWARFLINE_END) {
      break;
    }
    if (r != DWARFLINE_OK) {
      printf("error %d unit 0x%08llx\n", r, (unsigned long long)offset);
      return 1;
    }
    printf("unit 0x%08llx version %u %s", (unsigned long long)u.offset, (unsigned)u.version,
           u.offset_size == 8 ? "DWARF64" : "DWARF32");
    if (u.version >= 5) {
      printf(" address_size %u", (unsigned)u.address_size); /* only version 5 states it */
    }
    putchar('\n');
    for (uint64_t i = u.first_dir_index; i < u.first_dir_index + u.dir_count; i++) {
      dwarfline_str d;
      r = dwarfline_dir(&s, &u, i, &d);
      if (r != DWARFLINE_OK) {
        printf("error %d dir %llu\n", r, (unsigned long long)i);
        return 1;
      }
      printf("dir %llu ", (unsigned long long)i);
      print_str(d);
      putchar('\n');
    }
    for (uint64_t i = u.first_file_index; i < u.first_file_index + u.file_count; i++) {
      dwarfline_file fe;
      r = dwarfline_file_entry(&s, &u, i, &fe);
      if (r != DWARFLINE_OK) {
        printf("error %d file %llu\n", r, (unsigned long long)i);
        return 1;
      }
      printf("file %llu ", (unsigned long long)i);
      print_str(fe.name);
      printf(" dir %llu", (unsigned long long)fe.dir_index);
      if (fe.has_md5) {
        printf(" md5 ");
        for (int k = 0; k < 16; k++) {
          printf("%02x", fe.md5[k]);
        }
      }
      putchar('\n');
      if (paths) {
        char buf[4096];
        size_t len;
        r = dwarfline_file_path(&s, &u, i, buf, sizeof(buf), &len);
        if (r != DWARFLINE_OK) {
          printf("error %d path %llu\n", r, (unsigned long long)i);
          return 1;
        }
        printf("path %llu \"%s\"\n", (unsigned long long)i, buf);
      }
    }
    r = dwarfline_run(&s, &u, print_row, NULL);
    if (r != DWARFLINE_OK) {
      printf("error %d program 0x%08llx\n", r, (unsigned long long)offset);
      return 1;
    }
    offset = u.next_offset;
  }
  free(image);
  return 0;
}
