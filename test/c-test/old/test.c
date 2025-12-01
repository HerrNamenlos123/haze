
#include <stdio.h>
#include <time.h>

const long REPEAT = 100;
const long MAX_COUNTER = 10000000;

int foo_direct(volatile long* counter)
{
  (*counter)++;
  return 0;
}

typedef struct {
  volatile long counter;
} Foo;

typedef struct {
  Foo* thisPtr;
  int (*fn)(Foo* this);
} Callable;

int foo_callable(Foo* this)
{
  this->counter++;
  return 0;
}

void run_direct()
{
  for (size_t i = 0; i < REPEAT; i++) {
    volatile long counter = 0;
    while (counter < MAX_COUNTER) {
      foo_direct(&counter);
    }
  }
}

void run_callable()
{
  for (size_t i = 0; i < REPEAT; i++) {
    Foo foo = (Foo) { .counter = 0 };
    while (foo.counter < MAX_COUNTER) {
      Callable temp = (Callable) { .thisPtr = &foo, foo_callable };
      temp.fn(temp.thisPtr);
    }
  }
}

int main(int argc, const char* argv[])
{
  // Run both to warm up
  run_direct();
  run_callable();

  // Now do the test
  clock_t start1 = clock();
  run_direct();
  clock_t end1 = clock();

  clock_t start2 = clock();
  //   run_direct();
  run_callable();
  clock_t end2 = clock();

  printf("Function call direct took in total %ld cycles\n", end1 - start1);
  printf("Function call with callable took in total %ld cycles\n", end2 - start2);
  printf("Callable took %f%% as long\n", (end2 - start2) / (double)(end1 - start1) * 100);
}