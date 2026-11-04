# A Bytes built from `uninitialized` reads as zeros

Building a `Bytes` with `uninitialized` plus `__c__` field writes leaves its `singleByte` field as garbage, so every `b[i]` can read 0 while C code reading `basePtr + offset` sees the right data.

Verified 2026-11-04 against d35a505e.

- `Bytes` (`stdlib/core/src/memory.hz`) has a 4th field `singleByte: u8 | none`; `getAt()` returns it whenever it is set.
- Rule: any C-built `Bytes` starts from `Bytes()`, never `uninitialized` (see the comments in `stdlib/image/src/image.hz` and `stdlib/base64/src/base64.hz`).
- Symptom to recognize: "decodes fine but is blank/zero" (once looked like a renderer bug). Grep for `: Bytes = uninitialized`.
- Second instance (fixed): the compiler's synthetic `embed.binary()` filled a Bytes with a compound literal naming only basePtr/offset/length, so `singleByte` was zeroed (tag 0 = the u8 variant) and every embedded file read as one zero byte through `[]`. Regression case: `testsuite/src/cases_embed_binary.hz`.
- Related latent gap (as of the note's writing, not re-checked): functions that read `basePtr` directly ignore the singleByte form.
