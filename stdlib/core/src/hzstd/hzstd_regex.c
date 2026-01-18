
#include "hzstd_regex.h"
#include "gc/gc.h"
#include "hzstd/hzstd_array.h"
#include "hzstd/hzstd_common.h"
#include "hzstd/hzstd_memory.h"
#include "hzstd/hzstd_runtime.h"
#include "hzstd/hzstd_string.h"

#define PCRE2_CODE_UNIT_WIDTH 8
#include <pcre2.h>

static pcre2_code** __hz_compiled_regexes;

void hzstd_regex_init_table(hzstd_regex_blob_t* table, size_t table_count)
{
  /* index 0 may be unused, but we don't assume anything */
  for (size_t i = 0; i < table_count; ++i) {
    /* Skip empty entries defensively */
    if (table[i].data == NULL || table[i].size == 0) {
      table[i].code = NULL;
      continue;
    }

    /* Already initialized? (defensive, supports reload) */
    if (table[i].code != NULL) {
      continue;
    }

    int rc = pcre2_serialize_decode((pcre2_code**)&table[i].code, 1, table[i].data, NULL);

    if (rc != 1 || table[i].code == NULL) {
      /* Static regex deserialization must never fail */
      HZSTD_PANIC_FMT("Regex decoding failed. This should never happen. This is purely a runtime bug and definitely "
                      "not user error, so please report this incident.");
    }
  }
}

hzstd_regex_blob_t* hzstd_regex_runtime_compile(hzstd_str_t pattern, hzstd_str_t flags, hzstd_str_ref_t* error_message)
{
  assert(error_message);
  uint32_t options = 0;

  /* ---- flag parsing ---- */
  for (size_t i = 0; i < flags.length; ++i) {
    switch (flags.data[i]) {
    case 'i':
      options |= PCRE2_CASELESS;
      break;
    case 'm':
      options |= PCRE2_MULTILINE;
      break;
    case 's':
      options |= PCRE2_DOTALL;
      break;
    case 'u':
      options |= PCRE2_UTF;
      break;
    case 'g': /* iteration semantics, ignored */
      break;

    default:
      error_message->data = HZSTD_STRING_FROM_CSTR("invalid regex flag");
      return NULL;
    }
  }

  /* ---- compile ---- */
  int error_code = 0;
  PCRE2_SIZE error_offset = 0;

  pcre2_code* code = pcre2_compile((PCRE2_SPTR)pattern.data, pattern.length, options, &error_code, &error_offset, NULL);

  if (!code) {
    if (error_message) {
      /* Translate PCRE2 error to string */
      PCRE2_UCHAR buffer[256];
      int len = pcre2_get_error_message(error_code, buffer, sizeof(buffer));

      if (len > 0) {
        error_message->data = HZSTD_STRING((const char*)buffer, (size_t)len);
      }
      else {
        error_message->data = HZSTD_STRING_FROM_CSTR("regex compilation failed");
      }
    }
    return NULL;
  }

  /* ---- allocate blob ---- */
  hzstd_regex_blob_t* blob
      = (hzstd_regex_blob_t*)hzstd_allocate(hzstd_make_heap_allocator(), sizeof(hzstd_regex_blob_t));

  if (!blob) {
    pcre2_code_free(code);
    error_message->data = HZSTD_STRING_FROM_CSTR("out of memory while allocating regex");
    return NULL;
  }

  blob->data = NULL;
  blob->size = 0;
  blob->code = code;

  return blob;
}

hzstd_bool_t hzstd_regex_match(hzstd_regex_t regex, hzstd_str_t text)
{
  if (!regex.blob || !regex.blob->code) {
    return false;
  }

  pcre2_code* code = (pcre2_code*)regex.blob->code;

  pcre2_match_data* md = pcre2_match_data_create_from_pattern(code, NULL);

  int rc = pcre2_match(code, (PCRE2_SPTR)text.data, text.length, 0, 0, md, NULL);

  pcre2_match_data_free(md);
  return rc >= 0;
}

hzstd_regex_find_result_t hzstd_regex_find(hzstd_regex_t regex, hzstd_str_t text)
{
  hzstd_regex_find_result_t result = { 0 };

  if (!regex.blob || !regex.blob->code) {
    return result;
  }

  pcre2_code* code = (pcre2_code*)regex.blob->code;

  pcre2_match_data* md = pcre2_match_data_create_from_pattern(code, NULL);

  int rc = pcre2_match(code, (PCRE2_SPTR)text.data, text.length, 0, 0, md, NULL);

  if (rc >= 0) {
    PCRE2_SIZE* ovec = pcre2_get_ovector_pointer(md);
    result.found = 1;
    result.match.start = (size_t)ovec[0];
    result.match.end = (size_t)ovec[1];
  }

  pcre2_match_data_free(md);
  return result;
}

// String builder helper for replacement
typedef struct {
  char* data;
  size_t len;
  size_t cap;
} hzstd_sb_t;

static void sb_init(hzstd_sb_t* sb)
{
  sb->data = NULL;
  sb->len = 0;
  sb->cap = 0;
}

static void sb_append(hzstd_sb_t* sb, const char* data, size_t len)
{
  if (sb->len + len + 1 > sb->cap) {
    size_t new_cap = (sb->cap ? sb->cap * 2 : 64);
    while (new_cap < sb->len + len + 1) {
      new_cap *= 2;
    }
    sb->data = GC_realloc(sb->data, new_cap);
    if (!sb->data) {
      HZSTD_PANIC_FMT("System out of memory error while allocating buffer for Regex replacement");
    }
    sb->cap = new_cap;
  }
  memcpy(sb->data + sb->len, data, len);
  sb->len += len;
  sb->data[sb->len] = '\0';
}

hzstd_str_t hzstd_regex_replace(hzstd_regex_t regex, hzstd_str_t text, hzstd_str_t replacement)
{
  if (!regex.blob || !regex.blob->code) {
    return text;
  }

  pcre2_code* code = (pcre2_code*)regex.blob->code;

  pcre2_match_data* md = pcre2_match_data_create_from_pattern(code, NULL);

  hzstd_sb_t sb;
  sb_init(&sb);

  size_t offset = 0;
  size_t last_end = 0;

  while (1) {
    int rc = pcre2_match(code, (PCRE2_SPTR)text.data, text.length, offset, 0, md, NULL);

    if (rc < 0) {
      break;
    }

    PCRE2_SIZE* ovec = pcre2_get_ovector_pointer(md);
    size_t start = (size_t)ovec[0];
    size_t end = (size_t)ovec[1];

    // text before match
    sb_append(&sb, text.data + last_end, start - last_end);

    // replacement
    sb_append(&sb, replacement.data, replacement.length);

    last_end = end;
    offset = end;

    // Prevent infinite loop on zero-length matches
    if (start == end) {
      if (offset < text.length) {
        offset++;
      }
      else {
        break;
      }
    }
    if (offset > text.length) {
      break;
    }
  }

  // trailing text
  sb_append(&sb, text.data + last_end, text.length - last_end);

  pcre2_match_data_free(md);

  hzstd_str_t result = { .data = sb.data, .length = sb.len };
  return result;
}

hzstd_dynamic_array_t* hzstd_regex_find_all(hzstd_allocator_t allocator, hzstd_regex_t regex, hzstd_str_t text)
{
  hzstd_dynamic_array_t* result
      = HZSTD_DYNAMIC_ARRAY_CREATE(allocator, hzstd_regex_match_result_t, HZSTD_DEFAULT_DYNAMIC_ARRAY_CAPACITY);

  if (!regex.blob || !regex.blob->code) {
    return result;
  }

  pcre2_code* code = (pcre2_code*)regex.blob->code;

  pcre2_match_data* md = pcre2_match_data_create_from_pattern(code, NULL);

  size_t offset = 0;

  while (offset <= text.length) {
    int rc = pcre2_match(code, (PCRE2_SPTR)text.data, text.length, offset, 0, md, NULL);

    if (rc < 0) {
      break; // no more matches
    }

    PCRE2_SIZE* ovec = pcre2_get_ovector_pointer(md);
    size_t start = (size_t)ovec[0];
    size_t end = (size_t)ovec[1];

    hzstd_regex_match_result_t findResult = {
      .start = start,
      .end = end,
    };
    HZSTD_DYNAMIC_ARRAY_PUSH(result, findResult);

    // Advance offset
    if (start == end) {
      // zero-length match: advance by one code unit
      if (offset < text.length) {
        offset++;
      }
      else {
        break;
      }
    }
    else {
      offset = end;
    }
  }

  pcre2_match_data_free(md);
  return result;
}