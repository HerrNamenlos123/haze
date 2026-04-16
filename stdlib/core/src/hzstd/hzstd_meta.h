
#ifndef HZSTD_META_H
#define HZSTD_META_H

#include "hzstd_string.h"

typedef struct {
  hzstd_str_t name;
} hzstd_meta_field_t;

typedef enum {
  hzstd_meta_type_category_internal = 0,
  hzstd_meta_type_category_namespace = 1,
  hzstd_meta_type_category_struct = 2,
  hzstd_meta_type_category_enum = 3,
  hzstd_meta_type_category_primitive = 4,
  hzstd_meta_type_category_function = 5,
  hzstd_meta_type_category_callable = 6,
  hzstd_meta_type_category_array = 7,
  hzstd_meta_type_category_slice = 8,
  hzstd_meta_type_category_union = 9,
  hzstd_meta_type_category_reactive = 10,
  hzstd_meta_type_category_generic = 11,
  hzstd_meta_type_category_literal = 12,
  hzstd_meta_type_category_parameter_pack = 13,
} hzstd_meta_type_category_t;

#endif // HZSTD_META_H
