/* A frame larger than any guard. Compiled with -fstack-clash-protection on Linux, so its pages are
   probed one by one from the top as it is allocated; Windows compilers always probe (__chkstk). */
#include <stddef.h>
void fiber_test_escape(volatile char *p, size_t n, int every_page);
long fiber_test_clash_frame(void);
long fiber_test_clash_frame(void)
{
  volatile char big[256 * 1024];
  fiber_test_escape(big, sizeof(big), 0); /* keeps the whole array in the frame */
  return big[0] + big[sizeof(big) - 1];
}
