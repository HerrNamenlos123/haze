/* Minimal stand-in for the UCRT/SDK declarations the fiber tests use: compile-checking only.
   Signatures follow the real headers. */
#pragma once
#include <stddef.h>
#include <stdarg.h>
typedef struct _iobuf { void *_Placeholder; } FILE;
FILE *__cdecl __acrt_iob_func(unsigned);
#define stdin (__acrt_iob_func(0))
#define stdout (__acrt_iob_func(1))
#define stderr (__acrt_iob_func(2))
#define _IONBF 0x0004
#define EOF (-1)
int __cdecl printf(const char *, ...);
int __cdecl fprintf(FILE *, const char *, ...);
int __cdecl vfprintf(FILE *, const char *, va_list);
int __cdecl puts(const char *);
int __cdecl fputs(const char *, FILE *);
int __cdecl fflush(FILE *);
int __cdecl setvbuf(FILE *, char *, int, size_t);
FILE *__cdecl fopen(const char *, const char *);
int __cdecl fclose(FILE *);
char *__cdecl fgets(char *, int, FILE *);
int __cdecl fgetc(FILE *);
int __cdecl fscanf(FILE *, const char *, ...);
int __cdecl sscanf(const char *, const char *, ...);
void *__cdecl malloc(size_t);
void *__cdecl calloc(size_t, size_t);
void __cdecl free(void *);
int __cdecl atoi(const char *);
unsigned long long __cdecl strtoull(const char *, char **, int);
__declspec(noreturn) void __cdecl _Exit(int);
__declspec(noreturn) void __cdecl exit(int);
__declspec(noreturn) void __cdecl abort(void);
void *__cdecl memset(void *, int, size_t);
void *__cdecl memcpy(void *, const void *, size_t);
int __cdecl memcmp(const void *, const void *, size_t);
int __cdecl strcmp(const char *, const char *);
int __cdecl strncmp(const char *, const char *, size_t);
char *__cdecl strstr(const char *, const char *);
size_t __cdecl strlen(const char *);
