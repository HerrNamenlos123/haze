#pragma once
#if defined(__x86_64__)
typedef struct __declspec(align(16)) _SETJMP_FLOAT128 { unsigned long long Part[2]; } SETJMP_FLOAT128;
#define _JBLEN 16
typedef SETJMP_FLOAT128 _JBTYPE;
#else
#define _JBLEN 24
typedef unsigned long long _JBTYPE;
#endif
typedef _JBTYPE jmp_buf[_JBLEN];
#define setjmp _setjmp
int __cdecl _setjmp(jmp_buf _Buf);
__declspec(noreturn) void __cdecl longjmp(jmp_buf _Buf, int _Value);
