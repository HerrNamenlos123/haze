#pragma once
#include <stdint.h>
uintptr_t __cdecl _beginthreadex(void *, unsigned, unsigned(__stdcall *)(void *), void *, unsigned, unsigned *);
void __cdecl _endthreadex(unsigned);
