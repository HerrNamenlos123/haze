
#include "hzstd_regex.h"
#include "hzstd/hzstd_runtime.h"

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

int hzstd_regex_match(hzstd_regex_t regex, hzstd_str_t text)
{
  // Defensive: regex must be initialized
  if (!regex.blob || !regex.blob->code) {
    return 0;
  }

  pcre2_code* code = (pcre2_code*)regex.blob->code;

  pcre2_match_data* md = pcre2_match_data_create_from_pattern(code, NULL);

  int rc = pcre2_match(code,
                       (PCRE2_SPTR)text.data,
                       text.length,
                       0, // start offset
                       0, // options
                       md,
                       NULL);

  pcre2_match_data_free(md);
  return rc >= 0;
}

// int hzstd_regex_find(hzstd_regex_t regex, hzstd_str_t text, size_t* out_start, size_t* out_end)
// {
//   if (!regex.blob || !regex.blob->code) {
//     return 0;
//   }

//   pcre2_code* code = (pcre2_code*)regex.blob->code;

//   pcre2_match_data* md = pcre2_match_data_create_from_pattern(code, NULL);

//   int rc = pcre2_match(code, (PCRE2_SPTR)text.data, text.length, 0, 0, md, NULL);

//   if (rc < 0) {
//     pcre2_match_data_free(md);
//     return 0;
//   }

//   PCRE2_SIZE* ovec = pcre2_get_ovector_pointer(md);
//   *out_start = (size_t)ovec[0];
//   *out_end = (size_t)ovec[1];

//   pcre2_match_data_free(md);
//   return 1;
// }