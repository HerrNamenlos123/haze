# haze-notes PDF export and stroke fidelity

PDF export with real-size pages and drawing matching technicalsketcher.web's pdf-lib export; `perfect_freehand` is a bit-exact C port of the JS library.

Verified 2026-11-04 against d35a505e. (components exist; bit-exactness and pixel-identity were verified in the original session and not re-run)

- Pieces: `stdlib/zlib` (streaming deflate), `stdlib/pdf` (Writer, Page operators, addJpeg as DCT, stepped ImageEncoder), `fs.FileWriter.write(Bytes)`, `filedialog.*Async` + `PendingDialog`, `haze-notes/src/pdfexport.hz` `PdfExport` (stepped, `.exporting` temp + move, 8 decimals, zlib level 1, pages scaled mm to pt so A4 is 595.28 x 841.89 pt), `controls.hz` exportPdf/stepExport.
- Kept from the old export: texture stretched + upside down; grid every 10 mm from y=0, 0.2 thick; strokes as "M, Q p mid, Z" (pdf-lib writes `v`); empty pages skipped; text blocks not drawn.
- Strokes: technicalsketcher.web's getPath = perfect-freehand 1.2.2 JS, size penThickness*10, smoothing 0, streamline 0.6, thinning 0.1, simulatePressure default true, last false, point pressures, /10. The old Rust crate (0.1.1) was not faithful (cap loops use i/13 vs JS accumulating; `sqrt` vs `Math.hypot`). Replaced by `stdlib/perfect_freehand/src/ffi/perfect_freehand.c`, a line-by-line port with V8's sin/cos for the fixed cap angles tabulated and fp-contract off; bit-exact vs node on 34k vault strokes + 4k synthetic edge cases.
- Outlines are never stored (2026-11-11): `LineShape.bbox` and `cachedOutline` are `[[hznote.skip]]` caches, computed from the points on first use; the old `forgetStoredOutline` is gone with the .tsk loader.
- Verification that worked: a CLI harness copying the real source files verbatim; an FNV hash over outline bits in Haze vs node; a node script with the old drawing code + pdf-lib as reference; `pdftoppm -scale-to-x/-y` to equal pixel sizes. Keep heavy temp files in the repo (`.pdfbuild_tmp`, ignored), not in /tmp (a RAM disk filled once).
- json.stringify writes the shortest exact decimal for reals (cJSON's "%1.15g" did not round-trip ~11% of reals).
- Related: [[bytes-from-uninitialized-reads-zero]] (embedded JPEG read as zeros).
