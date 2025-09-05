#define _POSIX_C_SOURCE 199309L
#define _GNU_SOURCE
// Include section
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

// C Injection section
#include <assert.h>
typedef struct mg_mgr mg_mgr;

// Type declaration section
typedef bool _H4bool;
typedef void _H4void;
typedef int32_t _H3i32;
typedef const char* _H3str;
typedef struct GLFWmonitor GLFWmonitor;
typedef GLFWmonitor* _HPGLFWmonitor;
typedef struct GLFWwindow GLFWwindow;
typedef GLFWwindow* _HPGLFWwindow;
typedef double _H3f64;
typedef struct _HN11glfw_v1_0_06WindowE _HN11glfw_v1_0_06WindowE;
typedef _HN11glfw_v1_0_06WindowE* _HRN11glfw_v1_0_06WindowE;
typedef int64_t _H3int;
typedef struct _HN11glfw_v1_0_016WindowSizeConfigE _HN11glfw_v1_0_016WindowSizeConfigE;
typedef struct _HN11glfw_v1_0_012WindowConfigE _HN11glfw_v1_0_012WindowConfigE;
typedef double _H4real;
typedef _H4void* _HP4void;
typedef float _H3f32;
typedef struct _H5_Vec3I3f32E _H5_Vec3I3f32E;
typedef _H5_Vec3I3f32E* _HR5_Vec3I3f32E;
typedef struct _H__Callable__6 _H__Callable__6;
typedef struct _H__Callable__7 _H__Callable__7;
typedef struct _H6_ColorI3f32E _H6_ColorI3f32E;
typedef struct _H6_ColorI4realE _H6_ColorI4realE;
typedef struct _H5Arena _H5Arena;
typedef uint64_t _H5usize;
typedef uint8_t _H2u8;
typedef struct _H10ArenaChunk _H10ArenaChunk;
typedef _H10ArenaChunk* _HP10ArenaChunk;
typedef _H5Arena* _HR5Arena;
typedef _H2u8* _HP2u8;
typedef struct _H5_Vec3I4realE _H5_Vec3I4realE;
typedef _H5_Vec3I4realE* _HR5_Vec3I4realE;
typedef struct _H__Callable__8 _H__Callable__8;
typedef struct _H__Callable__9 _H__Callable__9;
typedef struct _H__Callable__10 _H__Callable__10;
typedef struct _H__Callable__11 _H__Callable__11;
typedef struct _H__Callable__12 _H__Callable__12;
typedef int16_t _H3i16;
typedef struct _H__Callable__13 _H__Callable__13;
typedef struct _H__Callable__14 _H__Callable__14;
typedef struct _H__Callable__15 _H__Callable__15;
typedef struct _H__Callable__16 _H__Callable__16;
typedef struct _H5_Vec2I4realE _H5_Vec2I4realE;
typedef _H5_Vec2I4realE* _HR5_Vec2I4realE;
typedef struct _H__Callable__17 _H__Callable__17;
typedef struct _H__Callable__18 _H__Callable__18;
typedef struct _HN9gl_v1_0_06VertexE _HN9gl_v1_0_06VertexE;
typedef int8_t _H2i8;
typedef int64_t _H3i64;
typedef uint16_t _H3u16;
typedef uint32_t _H3u32;
typedef uint64_t _H3u64;
typedef struct _H4null _H4null;

// Type definition section
typedef _H4bool (*_HFE4bool)();
typedef _H4void (*_HFE4void)();
struct GLFWmonitor { };

struct GLFWwindow { };

typedef _HPGLFWwindow (
    *_HF3i323i323strPGLFWmonitorPGLFWwindowEPGLFWwindow)(_H3i32, _H3i32, _H3str, _HPGLFWmonitor, _HPGLFWwindow);
typedef _H4bool (*_HFPGLFWwindowE4bool)(_HPGLFWwindow);
typedef _H4void (*_HFPGLFWwindowE4void)(_HPGLFWwindow);
typedef _H4void (*_HF3i32E4void)(_H3i32);
typedef _H4void (*_HF3i323i32E4void)(_H3i32, _H3i32);
typedef _H3f64 (*_HFE3f64)();
typedef _HFE4void (*_HF3strEFE4void)(_H3str);
struct _HN11glfw_v1_0_06WindowE {
  _HPGLFWwindow handle;
};

typedef _H4void (*_HFRN11glfw_v1_0_06WindowEE4void)(_HRN11glfw_v1_0_06WindowE);
typedef _H4bool (*_HFRN11glfw_v1_0_06WindowEE4bool)(_HRN11glfw_v1_0_06WindowE);
typedef _H4void (*_HFRN11glfw_v1_0_06WindowE3intE4void)(_HRN11glfw_v1_0_06WindowE, _H3int);
struct _HN11glfw_v1_0_016WindowSizeConfigE {
  _H3int width;
  _H3int height;
};

struct _HN11glfw_v1_0_012WindowConfigE {
  _H3str title;
  _HN11glfw_v1_0_016WindowSizeConfigE size;
};

typedef _HN11glfw_v1_0_06WindowE (*_HFN11glfw_v1_0_012WindowConfigEEN11glfw_v1_0_06WindowE)(
    _HN11glfw_v1_0_012WindowConfigE);
typedef _H4real (*_HFE4real)();
typedef _HP4void (*_HF3strEP4void)(_H3str);
typedef _HF3strEP4void (*_HFEF3strEP4void)();
typedef _H4real (*_HF4realE4real)(_H4real);
typedef _H4void (*_HFF3strEP4voidE4void)(_HF3strEP4void);
struct _H5_Vec3I3f32E {
  _H3f32 x;
  _H3f32 y;
  _H3f32 z;
};

typedef _H5_Vec3I3f32E (*_HF3f323f323f32E5_Vec3I3f32E)(_H3f32, _H3f32, _H3f32);
typedef _H5_Vec3I3f32E (*_HFR5_Vec3I3f32EE5_Vec3I3f32E)(_HR5_Vec3I3f32E);
typedef _H5_Vec3I3f32E (*_HFR5_Vec3I3f32E5_Vec3I3f32EE5_Vec3I3f32E)(_HR5_Vec3I3f32E, _H5_Vec3I3f32E);
typedef _H5_Vec3I3f32E (*_HFR5_Vec3I3f32E3f32E5_Vec3I3f32E)(_HR5_Vec3I3f32E, _H3f32);
typedef _H3f32 (*_HFR5_Vec3I3f32EE3f32)(_HR5_Vec3I3f32E);
typedef _H4real (*_HF4real4realE4real)(_H4real, _H4real);
struct _H__Callable__6 {
  _HR5_Vec3I3f32E thisPtr;
  _HFR5_Vec3I3f32E3f32E5_Vec3I3f32E fn;
};

struct _H__Callable__7 {
  _HR5_Vec3I3f32E thisPtr;
  _HFR5_Vec3I3f32EE3f32 fn;
};

typedef _H3f32 (*_HFR5_Vec3I3f32E5_Vec3I3f32EE3f32)(_HR5_Vec3I3f32E, _H5_Vec3I3f32E);
struct _H6_ColorI3f32E {
  _H3f32 r;
  _H3f32 g;
  _H3f32 b;
  _H3f32 a;
};

typedef _H6_ColorI3f32E (*_HF3f323f323f323f32E6_ColorI3f32E)(_H3f32, _H3f32, _H3f32, _H3f32);
typedef _H4void (*_HF3int3int3int3intE4void)(_H3int, _H3int, _H3int, _H3int);
struct _H6_ColorI4realE {
  _H4real r;
  _H4real g;
  _H4real b;
  _H4real a;
};

typedef _H6_ColorI4realE (*_HF4real4real4real4realE6_ColorI4realE)(_H4real, _H4real, _H4real, _H4real);
typedef _H4void (*_HF6_ColorI4realEE4void)(_H6_ColorI4realE);
struct _H5Arena {
  _HP10ArenaChunk first;
  _HP10ArenaChunk last;
};

struct _H10ArenaChunk {
  _HP10ArenaChunk next;
  _H5usize size;
  _H5usize used;
  _H2u8 data;
};

typedef _H5Arena (*_HFE5Arena)();
typedef _HP10ArenaChunk (*_HFR5Arena5usizeEP10ArenaChunk)(_HR5Arena, _H5usize);
typedef _HP2u8 (*_HFR5Arena5usizeEP2u8)(_HR5Arena, _H5usize);
typedef _H4void (*_HFR5ArenaE4void)(_HR5Arena);
typedef _HR5Arena (*_HF5ArenaER5Arena)(_H5Arena);
typedef _H3int (*_HFE3int)();
struct _H5_Vec3I4realE {
  _H4real x;
  _H4real y;
  _H4real z;
};

typedef _HR5_Vec3I4realE (*_HFR5Arena5_Vec3I4realEER5_Vec3I4realE)(_HR5Arena, _H5_Vec3I4realE);
struct _H__Callable__8 {
  _HR5Arena thisPtr;
  _HFR5Arena5usizeEP2u8 fn;
};

struct _H__Callable__9 {
  _HR5Arena thisPtr;
  _HFR5Arena5_Vec3I4realEER5_Vec3I4realE fn;
};

struct _H__Callable__10 {
  _HR5Arena thisPtr;
  _HFR5Arena5_Vec3I4realEER5_Vec3I4realE fn;
};

typedef _H4void (*_HF3strR5_Vec3I4realEE4void)(_H3str, _HR5_Vec3I4realE);
typedef _H4void (*_HF3strE4void)(_H3str);
typedef _H4void (*_HF3strE4void)(_H3str);
typedef _H4void (*_HFR5_Vec3I4realEE4void)(_HR5_Vec3I4realE);
struct _H__Callable__11 {
  _HRN11glfw_v1_0_06WindowE thisPtr;
  _HFRN11glfw_v1_0_06WindowE3intE4void fn;
};

struct _H__Callable__12 {
  _HRN11glfw_v1_0_06WindowE thisPtr;
  _HFRN11glfw_v1_0_06WindowEE4void fn;
};

struct _H__Callable__13 {
  _HRN11glfw_v1_0_06WindowE thisPtr;
  _HFRN11glfw_v1_0_06WindowEE4bool fn;
};

typedef _H4void (*_HF3str4realE4void)(_H3str, _H4real);
typedef _H4void (*_HF4realE4void)(_H4real);
typedef _H4void (*_HF3str3i16E4void)(_H3str, _H3i16);
typedef _H4void (*_HF3i16E4void)(_H3i16);
struct _H__Callable__14 {
  _HRN11glfw_v1_0_06WindowE thisPtr;
  _HFRN11glfw_v1_0_06WindowEE4void fn;
};

typedef _H5_Vec3I4realE (*_HF4real4real4realE5_Vec3I4realE)(_H4real, _H4real, _H4real);
typedef _H5_Vec3I4realE (*_HFR5_Vec3I4realEE5_Vec3I4realE)(_HR5_Vec3I4realE);
typedef _H5_Vec3I4realE (*_HFR5_Vec3I4realE5_Vec3I4realEE5_Vec3I4realE)(_HR5_Vec3I4realE, _H5_Vec3I4realE);
typedef _H5_Vec3I4realE (*_HFR5_Vec3I4realE4realE5_Vec3I4realE)(_HR5_Vec3I4realE, _H4real);
typedef _H4real (*_HFR5_Vec3I4realEE4real)(_HR5_Vec3I4realE);
struct _H__Callable__15 {
  _HR5_Vec3I4realE thisPtr;
  _HFR5_Vec3I4realE4realE5_Vec3I4realE fn;
};

struct _H__Callable__16 {
  _HR5_Vec3I4realE thisPtr;
  _HFR5_Vec3I4realEE4real fn;
};

typedef _H4real (*_HFR5_Vec3I4realE5_Vec3I4realEE4real)(_HR5_Vec3I4realE, _H5_Vec3I4realE);
struct _H5_Vec2I4realE {
  _H4real x;
  _H4real y;
};

typedef _H5_Vec2I4realE (*_HF4real4realE5_Vec2I4realE)(_H4real, _H4real);
typedef _H5_Vec2I4realE (*_HFR5_Vec2I4realEE5_Vec2I4realE)(_HR5_Vec2I4realE);
typedef _H5_Vec2I4realE (*_HFR5_Vec2I4realE5_Vec2I4realEE5_Vec2I4realE)(_HR5_Vec2I4realE, _H5_Vec2I4realE);
typedef _H5_Vec2I4realE (*_HFR5_Vec2I4realE4realE5_Vec2I4realE)(_HR5_Vec2I4realE, _H4real);
typedef _H4real (*_HFR5_Vec2I4realEE4real)(_HR5_Vec2I4realE);
struct _H__Callable__17 {
  _HR5_Vec2I4realE thisPtr;
  _HFR5_Vec2I4realE4realE5_Vec2I4realE fn;
};

struct _H__Callable__18 {
  _HR5_Vec2I4realE thisPtr;
  _HFR5_Vec2I4realEE4real fn;
};

typedef _H4real (*_HFR5_Vec2I4realE5_Vec2I4realEE4real)(_HR5_Vec2I4realE, _H5_Vec2I4realE);
struct _HN9gl_v1_0_06VertexE {
  _H5_Vec3I3f32E pos;
  _H6_ColorI3f32E color;
};

struct _H4null { };

// Function declaration section
_H4bool _HN11glfw_v1_0_03raw4initEv();
_H4void _HN11glfw_v1_0_03raw9terminateEv();
_HPGLFWwindow _HN11glfw_v1_0_03raw12createWindowE3i323i323strPGLFWmonitorPGLFWwindow(_H3i32 width,
                                                                                     _H3i32 height,
                                                                                     _H3str title,
                                                                                     _HPGLFWmonitor monitor,
                                                                                     _HPGLFWwindow share);
_H4bool _HN11glfw_v1_0_03raw17windowShouldCloseEPGLFWwindow(_HPGLFWwindow w);
_H4void _HN11glfw_v1_0_03raw11swapBuffersEPGLFWwindow(_HPGLFWwindow w);
_H4void _HN11glfw_v1_0_03raw12swapIntervalE3i32(_H3i32 flags);
_H4void _HN11glfw_v1_0_03raw18makeContextCurrentEPGLFWwindow(_HPGLFWwindow w);
_H4void _HN11glfw_v1_0_03raw10pollEventsEv();
_H4void _HN11glfw_v1_0_03raw8initHintE3i323i32(_H3i32 hint, _H3i32 value);
_H4void _HN11glfw_v1_0_03raw10windowHintE3i323i32(_H3i32 hint, _H3i32 value);
_H3f64 _HN11glfw_v1_0_03raw7getTimeEv();
_HFE4void _HN11glfw_v1_0_03raw14getProcAddressE3str(_H3str procname);
_H4void _HN11glfw_v1_0_06Window18makeContextCurrentERN11glfw_v1_0_06WindowE(_HRN11glfw_v1_0_06WindowE this);
_H4bool _HN11glfw_v1_0_06Window11shouldCloseERN11glfw_v1_0_06WindowE(_HRN11glfw_v1_0_06WindowE this);
_H4void _HN11glfw_v1_0_06Window11swapBuffersERN11glfw_v1_0_06WindowE(_HRN11glfw_v1_0_06WindowE this);
_H4void _HN11glfw_v1_0_06Window12swapIntervalERN11glfw_v1_0_06WindowE3int(_HRN11glfw_v1_0_06WindowE this,
                                                                          _H3int interval);
_H4bool _HN11glfw_v1_0_04initEv();
_H4void _HN11glfw_v1_0_09terminateEv();
_HN11glfw_v1_0_06WindowE
_HN11glfw_v1_0_012createWindowEN11glfw_v1_0_012WindowConfigE(_HN11glfw_v1_0_012WindowConfigE config);
_H4void _HN11glfw_v1_0_010pollEventsEv();
_H4real _HN11glfw_v1_0_07getTimeEv();
_HF3strEP4void _HN11glfw_v1_0_014getProcAddressEv();
_H4real _HN11math_v0_0_03sinE4real(_H4real v);
_H4real _HN11math_v0_0_03cosE4real(_H4real v);
_H4void _HN9gl_v1_0_04initEF3strEP4void(_HF3strEP4void proc);
static _H5_Vec3I3f32E _HN5_Vec3I3f32E11constructorE3f323f323f32(_H3f32 x, _H3f32 y, _H3f32 z);
static _H5_Vec3I3f32E _HN5_Vec3I3f32E3negER5_Vec3I3f32E(_HR5_Vec3I3f32E this);
static _H5_Vec3I3f32E _HN5_Vec3I3f32E3addER5_Vec3I3f32E5_Vec3I3f32E(_HR5_Vec3I3f32E this, _H5_Vec3I3f32E other);
static _H5_Vec3I3f32E _HN5_Vec3I3f32E3subER5_Vec3I3f32E5_Vec3I3f32E(_HR5_Vec3I3f32E this, _H5_Vec3I3f32E other);
static _H5_Vec3I3f32E _HN5_Vec3I3f32E3mulER5_Vec3I3f32E3f32(_HR5_Vec3I3f32E this, _H3f32 v);
static _H5_Vec3I3f32E _HN5_Vec3I3f32E3divER5_Vec3I3f32E3f32(_HR5_Vec3I3f32E this, _H3f32 v);
static _H3f32 _HN5_Vec3I3f32E6lengthER5_Vec3I3f32E(_HR5_Vec3I3f32E this);
_H4real sqrt(_H4real v);
_H4real pow(_H4real a, _H4real b);
_H4real sin(_H4real v);
_H4real sinh(_H4real v);
_H4real cos(_H4real v);
_H4real cosh(_H4real v);
_H4real tan(_H4real v);
_H4real atan2(_H4real y, _H4real x);
_H4real _HN4Math2PIEv();
_H4real _HN4Math8radToDegE4real(_H4real v);
_H4real _HN4Math8degToRadE4real(_H4real v);
static _H5_Vec3I3f32E _HN5_Vec3I3f32E9normalizeER5_Vec3I3f32E(_HR5_Vec3I3f32E this);
static _H3f32 _HN5_Vec3I3f32E3dotER5_Vec3I3f32E5_Vec3I3f32E(_HR5_Vec3I3f32E this, _H5_Vec3I3f32E other);
static _H6_ColorI3f32E _HN6_ColorI3f32E11constructorE3f323f323f323f32(_H3f32 r, _H3f32 g, _H3f32 b, _H3f32 a);
_H4void _HN9gl_v1_0_08viewportE3int3int3int3int(_H3int x, _H3int y, _H3int w, _H3int h);
static _H6_ColorI4realE _HN6_ColorI4realE11constructorE4real4real4real4real(_H4real r, _H4real g, _H4real b, _H4real a);
_H4void _HN9gl_v1_0_010clearColorE6_ColorI4realE(_H6_ColorI4realE color);
_H4void _HN9gl_v1_0_05clearEv();
_H4void _HN13glDraw_v1_0_04initEv();
_H4void _HN7builtin16test_assignmentsEv();
_H5Arena _HN5Arena11constructorEv();
_HP10ArenaChunk _HN5Arena10__newChunkER5Arena5usize(_HR5Arena this, _H5usize size);
_HP2u8 _HN5Arena7__allocER5Arena5usize(_HR5Arena this, _H5usize size);
_H4void _HN5Arena4freeER5Arena(_HR5Arena this);
_HR5Arena _HN11test_v0_1_03fooE5Arena(_H5Arena arena);
_H3int _HN11test_v0_1_04mainEv();
static _HR5_Vec3I4realE _HN5Arena5allocER5Arena5_Vec3I4realE(_HR5Arena this, _H5_Vec3I4realE value);
static _H4void _H7println3strR5_Vec3I4realE(_H3str __param_pack_0, _HR5_Vec3I4realE __param_pack_1);
static _H4void _H5print3str(_H3str __param_pack_0);
static _H4void _H5printR5_Vec3I4realE(_HR5_Vec3I4realE __param_pack_0);
static _H4void _H7println3str4real(_H3str __param_pack_0, _H4real __param_pack_1);
static _H4void _H5print4real(_H4real __param_pack_0);
static _H4void _H7println3str3i16(_H3str __param_pack_0, _H3i16 __param_pack_1);
static _H5_Vec3I4realE _HN5_Vec3I4realE11constructorE4real4real4real(_H4real x, _H4real y, _H4real z);
static _H5_Vec3I4realE _HN5_Vec3I4realE3negER5_Vec3I4realE(_HR5_Vec3I4realE this);
static _H5_Vec3I4realE _HN5_Vec3I4realE3addER5_Vec3I4realE5_Vec3I4realE(_HR5_Vec3I4realE this, _H5_Vec3I4realE other);
static _H5_Vec3I4realE _HN5_Vec3I4realE3subER5_Vec3I4realE5_Vec3I4realE(_HR5_Vec3I4realE this, _H5_Vec3I4realE other);
static _H5_Vec3I4realE _HN5_Vec3I4realE3mulER5_Vec3I4realE4real(_HR5_Vec3I4realE this, _H4real v);
static _H5_Vec3I4realE _HN5_Vec3I4realE3divER5_Vec3I4realE4real(_HR5_Vec3I4realE this, _H4real v);
static _H4real _HN5_Vec3I4realE6lengthER5_Vec3I4realE(_HR5_Vec3I4realE this);
static _H5_Vec3I4realE _HN5_Vec3I4realE9normalizeER5_Vec3I4realE(_HR5_Vec3I4realE this);
static _H4real _HN5_Vec3I4realE3dotER5_Vec3I4realE5_Vec3I4realE(_HR5_Vec3I4realE this, _H5_Vec3I4realE other);
static _H5_Vec2I4realE _HN5_Vec2I4realE11constructorE4real4real(_H4real x, _H4real y);
static _H5_Vec2I4realE _HN5_Vec2I4realE3negER5_Vec2I4realE(_HR5_Vec2I4realE this);
static _H5_Vec2I4realE _HN5_Vec2I4realE3addER5_Vec2I4realE5_Vec2I4realE(_HR5_Vec2I4realE this, _H5_Vec2I4realE other);
static _H5_Vec2I4realE _HN5_Vec2I4realE3subER5_Vec2I4realE5_Vec2I4realE(_HR5_Vec2I4realE this, _H5_Vec2I4realE other);
static _H5_Vec2I4realE _HN5_Vec2I4realE3mulER5_Vec2I4realE4real(_HR5_Vec2I4realE this, _H4real v);
static _H5_Vec2I4realE _HN5_Vec2I4realE3divER5_Vec2I4realE4real(_HR5_Vec2I4realE this, _H4real v);
static _H4real _HN5_Vec2I4realE6lengthER5_Vec2I4realE(_HR5_Vec2I4realE this);
static _H5_Vec2I4realE _HN5_Vec2I4realE9normalizeER5_Vec2I4realE(_HR5_Vec2I4realE this);
static _H4real _HN5_Vec2I4realE3dotER5_Vec2I4realE5_Vec2I4realE(_HR5_Vec2I4realE this, _H5_Vec2I4realE other);

// Arithmetic Function declaration section
__attribute__((noreturn, cold)) static _Noreturn void ___hz_builtin_trap(const char* msg);
_H5usize ___hz_builtin_sub_5usize5usize(_H5usize, _H5usize);

// Global Variable section

// Function definition section
int32_t main(int argc, const char* argv[]) { return _HN11test_v0_1_04mainEv(); }

_H3int _HN11test_v0_1_04mainEv()
{
  _H5Arena arena = _HN5Arena11constructorEv();
  _HR5Arena b = &arena;
  _HR5_Vec3I4realE vec1 = _HN5Arena5allocER5Arena5_Vec3I4realE(&arena,
                                                               ((_H5_Vec3I4realE) {
                                                                   .x = (double)(1.0),
                                                                   .y = (double)(2.0),
                                                                   .z = (double)(3.0),
                                                               }));

  _H5_Vec3I4realE a = ((_H5_Vec3I4realE) {
      .x = (double)(4.0),
      .y = (double)(5.0),
      .z = (double)(6.0),
  });
  _HR5_Vec3I4realE vec2 = &((_H5_Vec3I4realE) {
      .x = (double)(7.0),
      .y = (double)(8.0),
      .z = (double)(9.0),
  });
  _HN5Arena5allocER5Arena5_Vec3I4realE(&arena, a);

  (void)(_H7println3strR5_Vec3I4realE((const char*)("Vec 1: "), vec1));
  (void)(_H7println3strR5_Vec3I4realE((const char*)("Vec 2: "), vec2));
  return (int64_t)(0LL);
}

static _HR5_Vec3I4realE _HN5Arena5allocER5Arena5_Vec3I4realE(_H5Arena* this, struct _H5_Vec3I4realE value)
{
  printf("1");
  _H5_Vec3I4realE* ref = { 0 };
  printf("2");
  _HP2u8 ptr = _HN5Arena7__allocER5Arena5usize(this, sizeof(_H5_Vec3I4realE));
  ref = (void*)ptr;
  printf("A");
  (void)(*ref = value);
  printf("B");
  return ref;
}

static _H4void _H7println3strR5_Vec3I4realE(_H3str __param_pack_0, _HR5_Vec3I4realE __param_pack_1)
{
  (void)(_H5print3str(__param_pack_0));
  if (((uint64_t)(0ULL) != ___hz_builtin_sub_5usize5usize((uint64_t)(2ULL), ((_H5usize)(int64_t)(1LL))))) {
    (void)(_H5print3str((const char*)(" ")));
  }
  (void)(_H5printR5_Vec3I4realE(__param_pack_1));
  if (((uint64_t)(1ULL) != ___hz_builtin_sub_5usize5usize((uint64_t)(2ULL), ((_H5usize)(int64_t)(1LL))))) {
    (void)(_H5print3str((const char*)(" ")));
  }
  (void)(_H5print3str((const char*)("\n")));
}

static _H4void _H5print3str(_H3str __param_pack_0) { (void)(printf((const char*)("%s"), __param_pack_0)); }

static _H4void _H5printR5_Vec3I4realE(_HR5_Vec3I4realE __param_pack_0)
{
  (void)(printf((const char*)("(%f, %f, %f)"), (__param_pack_0)->x, (__param_pack_0)->y, (__param_pack_0)->z));
}

static _H4void _H7println3str4real(_H3str __param_pack_0, _H4real __param_pack_1)
{
  (void)(_H5print3str(__param_pack_0));
  if (((uint64_t)(0ULL) != ___hz_builtin_sub_5usize5usize((uint64_t)(2ULL), ((_H5usize)(int64_t)(1LL))))) {
    (void)(_H5print3str((const char*)(" ")));
  }
  (void)(_H5print4real(__param_pack_1));
  if (((uint64_t)(1ULL) != ___hz_builtin_sub_5usize5usize((uint64_t)(2ULL), ((_H5usize)(int64_t)(1LL))))) {
    (void)(_H5print3str((const char*)(" ")));
  }
  (void)(_H5print3str((const char*)("\n")));
}

static _H4void _H5print4real(_H4real __param_pack_0) { (void)(printf((const char*)("%f"), __param_pack_0)); }

// Arithmetic Function definition section
__attribute__((noreturn, cold)) static _Noreturn void ___hz_builtin_trap(const char* msg)
{
  fprintf(stderr, "Runtime error: %s\n", msg);
  abort();
}
_H5usize ___hz_builtin_sub_5usize5usize(_H5usize a, _H5usize b)
{
  _H5usize result;
  if (__builtin_expect(__builtin_sub_overflow(a, b, &result), 0)) {
    ___hz_builtin_trap("Integer overflow in sub operation");
  }
  return result;
}
#include <memory.h>

// Type declaration section
typedef void _H4void;
typedef int64_t _H3int;
typedef bool _H4bool;
typedef double _H4real;
typedef struct _H5Arena _H5Arena;
typedef uint64_t _H5usize;
typedef uint8_t _H2u8;
typedef struct _H10ArenaChunk _H10ArenaChunk;
typedef _H10ArenaChunk* _HP10ArenaChunk;
typedef _H4void* _HP4void;
typedef _H5Arena* _HR5Arena;
typedef _H2u8* _HP2u8;
typedef struct _H__Callable__1 _H__Callable__1;
typedef const char* _H3str;
typedef int8_t _H2i8;
typedef int16_t _H3i16;
typedef int32_t _H3i32;
typedef int64_t _H3i64;
typedef uint16_t _H3u16;
typedef uint32_t _H3u32;
typedef uint64_t _H3u64;
typedef struct _H4null _H4null;
typedef float _H3f32;
typedef double _H3f64;

// Type definition section
typedef _H4void (*_HFE4void)();
typedef _H4void (*_HF4boolE4void)(_H4bool);
typedef _H4real (*_HF4realE4real)(_H4real);
typedef _H4real (*_HF4real4realE4real)(_H4real, _H4real);
typedef _H4real (*_HFE4real)();

typedef _H5Arena (*_HFE5Arena)();
typedef _HP10ArenaChunk (*_HFR5Arena5usizeEP10ArenaChunk)(_HR5Arena, _H5usize);
typedef _H5usize (*_HF5usize5usizeE5usize)(_H5usize, _H5usize);
typedef _HP4void (*_HF5usizeEP4void)(_H5usize);
typedef _HP4void (*_HFP4void2u85usizeEP4void)(_HP4void, _H2u8, _H5usize);
typedef _HP2u8 (*_HFR5Arena5usizeEP2u8)(_HR5Arena, _H5usize);
struct _H__Callable__1 {
  _HR5Arena thisPtr;
  _HFR5Arena5usizeEP10ArenaChunk fn;
};

typedef _H4void (*_HFR5ArenaE4void)(_HR5Arena);
typedef _H4void (*_HFP4voidE4void)(_HP4void);

// Function declaration section
_H4void _HN7builtin16test_assignmentsEv();
_H4real sqrt(_H4real v);
_H4real pow(_H4real a, _H4real b);
_H4real sin(_H4real v);
_H4real sinh(_H4real v);
_H4real cos(_H4real v);
_H4real cosh(_H4real v);
_H4real tan(_H4real v);
_H4real atan2(_H4real y, _H4real x);
_H4real _HN4Math2PIEv();
_H4real _HN4Math8radToDegE4real(_H4real v);
_H4real _HN4Math8degToRadE4real(_H4real v);
_H5Arena _HN5Arena11constructorEv();
_HP10ArenaChunk _HN5Arena10__newChunkER5Arena5usize(_HR5Arena this, _H5usize size);
static _H5usize _H3max5usize5usize(_H5usize a, _H5usize b);
_HP2u8 _HN5Arena7__allocER5Arena5usize(_HR5Arena this, _H5usize size);
_H4void _HN5Arena4freeER5Arena(_HR5Arena this);

// Arithmetic Function declaration section
__attribute__((noreturn, cold)) static _Noreturn void ___hz_builtin_trap(const char* msg);
static inline _H3int ___hz_builtin_incr_3int(_H3int);
static inline _H3int ___hz_builtin_decr_3int(_H3int);
_H3int ___hz_builtin_add_3int3int(_H3int, _H3int);
_H3int ___hz_builtin_sub_3int3int(_H3int, _H3int);
_H3int ___hz_builtin_mul_3int3int(_H3int, _H3int);
_H3int ___hz_builtin_div_3int3int(_H3int, _H3int);
_H5usize ___hz_builtin_add_5usize5usize(_H5usize, _H5usize);

// Global Variable section

// Function definition section
_H4void _HN7builtin16test_assignmentsEv()
{
  _H3int x = (int64_t)(1LL);
  _H3int y = (int64_t)(2LL);
  _H3int z = (int64_t)(3LL);
  _H3int a = x;
  _H3int pre_inc_a = (a = ___hz_builtin_incr_3int(a));
  (void)(assert((a == (int64_t)(2LL))));
  (void)(assert((pre_inc_a == (int64_t)(2LL))));
  _H3int b = x;
  _H3int post_inc_b = ({
    _H3int __tmp = b;
    b = ___hz_builtin_incr_3int(b);
    __tmp;
  });
  (void)(assert((b == (int64_t)(2LL))));
  (void)(assert((post_inc_b == (int64_t)(1LL))));
  _H3int c = y;
  _H3int pre_dec_c = (c = ___hz_builtin_decr_3int(c));
  (void)(assert((c == (int64_t)(1LL))));
  (void)(assert((pre_dec_c == (int64_t)(1LL))));
  _H3int d = y;
  _H3int post_dec_d = ({
    _H3int __tmp = d;
    d = ___hz_builtin_decr_3int(d);
    __tmp;
  });
  (void)(assert((d == (int64_t)(1LL))));
  (void)(assert((post_dec_d == (int64_t)(2LL))));
  _H3int e = x;
  _H3int add_assign_e = e = ___hz_builtin_add_3int3int(e, y);
  (void)(assert((e == (int64_t)(3LL))));
  (void)(assert((add_assign_e == (int64_t)(3LL))));
  _H3int f = z;
  _H3int sub_assign_f = f = ___hz_builtin_sub_3int3int(f, x);
  (void)(assert((f == (int64_t)(2LL))));
  (void)(assert((sub_assign_f == (int64_t)(2LL))));
  _H3int g = (int64_t)(2LL);
  _H3int mul_assign_g = g = ___hz_builtin_mul_3int3int(g, (int64_t)(3LL));
  (void)(assert((g == (int64_t)(6LL))));
  (void)(assert((mul_assign_g == (int64_t)(6LL))));
  _H3int h = (int64_t)(6LL);
  _H3int div_assign_h = h = ___hz_builtin_div_3int3int(h, (int64_t)(2LL));
  (void)(assert((h == (int64_t)(3LL))));
  (void)(assert((div_assign_h == (int64_t)(3LL))));
  _H3int i = (int64_t)(0LL);
  _H3int j = (int64_t)(0LL);
  _H3int chain = i = j = (int64_t)(10LL);
  (void)(assert((i == (int64_t)(10LL))));
  (void)(assert((j == (int64_t)(10LL))));
  (void)(assert((chain == (int64_t)(10LL))));
  _H3int k = (int64_t)(5LL);
  _H3int l = (int64_t)(3LL);
  _H3int m = k = ___hz_builtin_add_3int3int(k, l);
  (void)(assert((k == (int64_t)(8LL))));
  (void)(assert((m == (int64_t)(8LL))));
}

_H4real _HN4Math2PIEv()
{
  _H4real PI = (double)(3.141592653589793);
  return PI;
}

_H4real _HN4Math8radToDegE4real(_H4real v) { return ((v / _HN4Math2PIEv()) * (double)(180.0)); }

_H4real _HN4Math8degToRadE4real(_H4real v) { return ((v * _HN4Math2PIEv()) / (double)(180.0)); }

_H5Arena _HN5Arena11constructorEv()
{
  return ((_H5Arena) {
      .first = ((_HP10ArenaChunk)((_HP4void)(int64_t)(0LL))),
      .last = ((_HP10ArenaChunk)((_HP4void)(int64_t)(0LL))),
  });
}

_HP10ArenaChunk _HN5Arena10__newChunkER5Arena5usize(_HR5Arena this, _H5usize size)
{
  _H5usize chunk_size = _H3max5usize5usize(size, ((_H5usize)(int64_t)(4096LL)));
  _HP10ArenaChunk chunk_mem
      = ((_HP10ArenaChunk)malloc(___hz_builtin_add_5usize5usize(sizeof(_H10ArenaChunk), chunk_size)));
  (void)(memset(((_HP4void)chunk_mem), ((_H2u8)(int64_t)(0LL)), chunk_size));
  (void)((*chunk_mem).next = ((_HP10ArenaChunk)((_HP4void)(int64_t)(0LL))));
  (void)((*chunk_mem).size = chunk_size);
  (void)((*chunk_mem).used = ((_H5usize)(int64_t)(0LL)));
  return chunk_mem;
}

static _H5usize _H3max5usize5usize(_H5usize a, _H5usize b)
{
  if ((a > b)) {
    return a;
  }
  else {
    return b;
  }
}

_HP2u8 _HN5Arena7__allocER5Arena5usize(_HR5Arena this, _H5usize size)
{
  _HP10ArenaChunk last = (this)->last;
  if (((last != ((_HP4void)(int64_t)(0LL))) && (___hz_builtin_add_5usize5usize((*last).used, size) <= (*last).size))) {
    _HP2u8 ptr = &(*last).data;
    ptr += last->used;
    (void)((*last).used = ___hz_builtin_add_5usize5usize((*last).used, size));
    return ptr;
  }
  _HP10ArenaChunk chunk = _HN5Arena10__newChunkER5Arena5usize(this, size);
  if (((this)->first == ((_HP4void)(int64_t)(0LL)))) {
    (void)((this)->first = chunk);
  }
  else {
    (void)((*(this)->last).next = chunk);
  }
  (void)((this)->last = chunk);
  (void)((*chunk).used = size);
  return &(*chunk).data;
}

_H4void _HN5Arena4freeER5Arena(_HR5Arena this)
{
  _HP10ArenaChunk chunk = (this)->first;
  while ((chunk != ((_HP4void)(int64_t)(0LL)))) {
    _HP10ArenaChunk next = (*chunk).next;
    (void)(free(((_HP4void)chunk)));
    (void)(chunk = next);
  }
  (void)((this)->first = ((_HP10ArenaChunk)((_HP4void)(int64_t)(0LL))));
  (void)((this)->last = ((_HP10ArenaChunk)((_HP4void)(int64_t)(0LL))));
}

// Arithmetic Function definition section
static inline _H3int ___hz_builtin_incr_3int(_H3int value)
{
  _H3int result;
  if (__builtin_expect(__builtin_add_overflow(value, 1, &result), 0)) {
    ___hz_builtin_trap("Integer overflow in incr operation");
  }
  return result;
}
static inline _H3int ___hz_builtin_decr_3int(_H3int value)
{
  _H3int result;
  if (__builtin_expect(__builtin_sub_overflow(value, 1, &result), 0)) {
    ___hz_builtin_trap("Integer overflow in decr operation");
  }
  return result;
}
_H3int ___hz_builtin_add_3int3int(_H3int a, _H3int b)
{
  _H3int result;
  if (__builtin_expect(__builtin_add_overflow(a, b, &result), 0)) {
    ___hz_builtin_trap("Integer overflow in add operation");
  }
  return result;
}
_H3int ___hz_builtin_sub_3int3int(_H3int a, _H3int b)
{
  _H3int result;
  if (__builtin_expect(__builtin_sub_overflow(a, b, &result), 0)) {
    ___hz_builtin_trap("Integer overflow in sub operation");
  }
  return result;
}
_H3int ___hz_builtin_mul_3int3int(_H3int a, _H3int b)
{
  _H3int result;
  if (__builtin_expect(__builtin_mul_overflow(a, b, &result), 0)) {
    ___hz_builtin_trap("Integer overflow in mul operation");
  }
  return result;
}
_H3int ___hz_builtin_div_3int3int(_H3int a, _H3int b)
{
  if (b == 0) {
    ___hz_builtin_trap("Division by zero");
  }
  return a / b;
}
_H5usize ___hz_builtin_add_5usize5usize(_H5usize a, _H5usize b)
{
  _H5usize result;
  if (__builtin_expect(__builtin_add_overflow(a, b, &result), 0)) {
    ___hz_builtin_trap("Integer overflow in add operation");
  }
  return result;
}
