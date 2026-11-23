/* Second compilation unit of the dwarfline fixtures: a relative #line path, so the file's
 * directory is relative and is joined to the compilation directory. */
#line 5 "lib/helpers.hz"
int fixture_b_value(int x)
{
  int v = 0;
  for (int i = 0; i < x; i++) {
    v += i ^ x;
  }
  return v;
}
