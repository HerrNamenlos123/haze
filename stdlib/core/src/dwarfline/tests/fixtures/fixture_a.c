/* Fixture for the dwarfline tests (run.ts): line tables like the ones Haze generates, with
 * #line directives into .hz sources at absolute paths, loops, inlining and several functions.
 * Freestanding: it links without a C library for every target the tests build. */
int fixture_b_value(int x);

static inline int square(int x) { return x * x; }

#line 10 "/home/user/project/src/main.hz"
int fixture_sum(int n)
{
  int s = 0;
  for (int i = 0; i < n; i++) {
    s += square(i) + fixture_b_value(i);
  }
  return s;
}

#line 30 "/home/user/project/src/other.hz"
static int fixture_branch(int x)
{
  if (x & 1) {
    return x * 3 + 1;
  }
  return x / 2;
}

#line 50 "/home/user/project/src/main.hz"
int fixture_collatz(int x)
{
  int steps = 0;
  while (x != 1 && steps < 1000) {
    x = fixture_branch(x);
    steps++;
  }
  return steps;
}

#line 70 "fixture_a.c"
void fixture_start(void)
{
  volatile int r = fixture_sum(10) + fixture_collatz(27);
  (void)r;
  for (;;) {
  }
}
