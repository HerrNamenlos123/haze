#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#define FONTSTASH_IMPLEMENTATION
#include "fontstash.h"  // -I../src/ffi

// The FIXED layout loop, mirroring haze_fontstash_layout_text.
static int layout(FONScontext* fs, int font, float size, const char* label, const char* text, size_t len) {
  fonsSetFont(fs, font); fonsSetSize(fs, size);
  FONStextIter iter; FONSquad quad;
  memset(&quad, 0, sizeof(quad));
  fonsTextIterInit(fs, &iter, 0, 0, text, text + len);
  int emitted=0, garbage=0;
  while (fonsTextIterNext(fs, &iter, &quad)) {
    if (quad.x0==0.0f && quad.y0==0.0f && quad.x1==0.0f && quad.y1==0.0f) {
      memset(&quad,0,sizeof(quad)); continue;
    }
    emitted++;
    if (quad.x0 < -1e6f || quad.x0 > 1e6f || quad.x1-quad.x0 > 1e6f) garbage++;
    memset(&quad,0,sizeof(quad));
  }
  printf("  %-28s len=%2zu emitted=%d garbage=%d %s\n", label, len, emitted, garbage,
         garbage? "  <-- STILL BROKEN":"");
  return garbage;
}

int main(int argc, char** argv) {
  FONSparams p; memset(&p,0,sizeof(p));
  p.width=1024; p.height=1024; p.flags=FONS_ZERO_TOPLEFT;
  FONScontext* fs = fonsCreateInternal(&p);
  int font = fonsAddFont(fs, "mono", argv[1]);
  if (font==FONS_INVALID){printf("font load failed\n");return 2;}
  int total=0;
  printf("Valid text still renders:\n");
  total += layout(fs,font,16,"hello","hello",5);
  total += layout(fs,font,16,"hollo (with o-umlaut)","h\xC3\xB6llo",6);
  total += layout(fs,font,16,"u-umlaut alone","\xC3\xBC",2);
  total += layout(fs,font,16,"CJK","\xE6\x97\xA5\xE6\x9C\xAC",6);
  printf("\nBroken input no longer emits garbage:\n");
  total += layout(fs,font,16,"lone lead byte","\xC3",1);
  total += layout(fs,font,16,"a + lone lead","a\xC3",2);
  total += layout(fs,font,16,"truncated 3-byte","\xE6\x97",2);
  total += layout(fs,font,16,"truncated 4-byte","\xF0\x9F\x91",3);
  total += layout(fs,font,16,"0xFF","\xFF",1);
  total += layout(fs,font,16,"stray continuation","\x80",1);
  total += layout(fs,font,16,"a 0xFF b","a\xFF" "b",3);
  printf("\nTOTAL GARBAGE QUADS: %d %s\n", total, total? "FAIL":"PASS");
  return total!=0;
}
