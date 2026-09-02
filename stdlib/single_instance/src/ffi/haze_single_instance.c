#define GC_THREADS
#include <gc/gc.h>

#include <stdio.h>
#include <string.h>

#include "hzstd/include/hzstd_memory.h"
#include "hzstd/include/hzstd_string.h"

#include "public/haze_single_instance.h"

#if defined(HAZE_PLATFORM_WIN32)
  #include <windows.h>
  #include <sddl.h>
  #include <aclapi.h>
  typedef HANDLE haze_si_conn_t;
  #define HAZE_SI_BAD_CONN INVALID_HANDLE_VALUE
#else
  #include <errno.h>
  #include <poll.h>
  #include <pthread.h>
  #include <signal.h>
  #include <stddef.h>
  #include <stdlib.h>
  #include <sys/eventfd.h>
  #include <sys/socket.h>
  #include <sys/un.h>
  #include <unistd.h>
  typedef int haze_si_conn_t;
  #define HAZE_SI_BAD_CONN (-1)
#endif

#define HAZE_SI_MAGIC 0x495A4831u
#define HAZE_SI_VERSION 1u

#define HAZE_SI_FRAME_HELLO 1u
#define HAZE_SI_FRAME_REQUEST 2u
#define HAZE_SI_FRAME_RESULT 3u
#define HAZE_SI_FRAME_ACK 4u

#define HAZE_SI_MAX_PAYLOAD (16u * 1024u * 1024u)
#define HAZE_SI_FRAME_TIMEOUT_MS 5000
#define HAZE_SI_ACTIVATE_TIMEOUT_MS 2000
#define HAZE_SI_MAX_ATTEMPTS 20

typedef struct {
  void *value;
  int pending;
  int answered;
  int exitCode;
} haze_si_mailbox_t;

static haze_si_mailbox_t *g_mailbox = 0;

static void *(*g_parser)(hzstd_str_t) = 0;

static int g_initialized = 0;
static int g_isPrimary = 0;
static int g_running = 0;

static char *g_mangledName = 0;
static hzstd_int_t g_mangledLen = 0;
static char *g_prettyName = 0;
static hzstd_int_t g_prettyLen = 0;
static hzstd_i64_t g_fingerprint = 0;

static haze_si_conn_t g_clientConn = HAZE_SI_BAD_CONN;
static hzstd_i32_t g_primaryPid = 0;

#if defined(HAZE_PLATFORM_WIN32)
static wchar_t g_pipeName[256];
static HANDLE g_listener = INVALID_HANDLE_VALUE;
static HANDLE g_shutdownEvent = NULL;
static HANDLE g_readyEvent = NULL;
static HANDLE g_thread = NULL;
static CRITICAL_SECTION g_lock;
static CONDITION_VARIABLE g_cond;
static wchar_t *g_userSid = 0;
#else
static char g_socketName[108];
static hzstd_int_t g_socketNameLen = 0;
static int g_listener = -1;
static int g_shutdownFd = -1;
static int g_readyFd = -1;
static pthread_t g_thread;
static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t g_cond = PTHREAD_COND_INITIALIZER;
#endif

static void haze_si_lock(void)
{
#if defined(HAZE_PLATFORM_WIN32)
  EnterCriticalSection(&g_lock);
#else
  pthread_mutex_lock(&g_lock);
#endif
}

static void haze_si_unlock(void)
{
#if defined(HAZE_PLATFORM_WIN32)
  LeaveCriticalSection(&g_lock);
#else
  pthread_mutex_unlock(&g_lock);
#endif
}

static void haze_si_signal_ready(void)
{
#if defined(HAZE_PLATFORM_WIN32)
  if (g_readyEvent) {
    SetEvent(g_readyEvent);
  }
#else
  if (g_readyFd >= 0) {
    hzstd_u64_t one = 1;
    ssize_t ignored = write(g_readyFd, &one, sizeof(one));
    (void)ignored;
  }
#endif
}

static hzstd_str_t haze_si_static_str(const char *text)
{
  return HZSTD_STRING_FROM_CSTR(text);
}

static char *haze_si_dup(hzstd_str_t value, hzstd_int_t *outLength)
{
  char *copy = (char *)hzstd_heap_allocate_atomic((size_t)value.length + 1, NULL);
  if (value.length > 0) {
    memcpy(copy, value.data, (size_t)value.length);
  }
  copy[value.length] = 0;
  if (outLength) {
    *outLength = value.length;
  }
  return copy;
}

static void haze_si_put_u32(unsigned char *buffer, hzstd_int_t offset, hzstd_u32_t value)
{
  buffer[offset + 0] = (unsigned char)(value & 0xFFu);
  buffer[offset + 1] = (unsigned char)((value >> 8) & 0xFFu);
  buffer[offset + 2] = (unsigned char)((value >> 16) & 0xFFu);
  buffer[offset + 3] = (unsigned char)((value >> 24) & 0xFFu);
}

static hzstd_u32_t haze_si_get_u32(const unsigned char *buffer, hzstd_int_t offset)
{
  return (hzstd_u32_t)buffer[offset + 0] | ((hzstd_u32_t)buffer[offset + 1] << 8) |
         ((hzstd_u32_t)buffer[offset + 2] << 16) | ((hzstd_u32_t)buffer[offset + 3] << 24);
}

static void haze_si_put_i64(unsigned char *buffer, hzstd_int_t offset, hzstd_i64_t value)
{
  hzstd_u64_t raw = (hzstd_u64_t)value;
  for (int i = 0; i < 8; i++) {
    buffer[offset + i] = (unsigned char)((raw >> (8 * i)) & 0xFFu);
  }
}

static hzstd_i64_t haze_si_get_i64(const unsigned char *buffer, hzstd_int_t offset)
{
  hzstd_u64_t raw = 0;
  for (int i = 0; i < 8; i++) {
    raw |= ((hzstd_u64_t)buffer[offset + i]) << (8 * i);
  }
  return (hzstd_i64_t)raw;
}

static int haze_si_io(haze_si_conn_t conn, void *buffer, hzstd_int_t length, int isRead)
{
  if (length == 0) {
    return 1;
  }

#if defined(HAZE_PLATFORM_WIN32)
  OVERLAPPED overlapped;
  memset(&overlapped, 0, sizeof(overlapped));
  overlapped.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
  if (!overlapped.hEvent) {
    return 0;
  }

  BOOL ok;
  if (isRead) {
    ok = ReadFile(conn, buffer, (DWORD)length, NULL, &overlapped);
  }
  else {
    ok = WriteFile(conn, buffer, (DWORD)length, NULL, &overlapped);
  }

  if (!ok && GetLastError() == ERROR_IO_PENDING) {
    DWORD waited = WaitForSingleObject(overlapped.hEvent, HAZE_SI_FRAME_TIMEOUT_MS);
    if (waited != WAIT_OBJECT_0) {
      CancelIo(conn);
      CloseHandle(overlapped.hEvent);
      return 0;
    }
    ok = TRUE;
  }
  else if (!ok) {
    CloseHandle(overlapped.hEvent);
    return 0;
  }

  DWORD transferred = 0;
  ok = GetOverlappedResult(conn, &overlapped, &transferred, FALSE);
  CloseHandle(overlapped.hEvent);
  return ok && (hzstd_int_t)transferred == length;
#else
  hzstd_int_t done = 0;
  while (done < length) {
    struct pollfd entry;
    entry.fd = conn;
    entry.events = isRead ? POLLIN : POLLOUT;
    entry.revents = 0;

    int ready = poll(&entry, 1, HAZE_SI_FRAME_TIMEOUT_MS);
    if (ready <= 0) {
      return 0;
    }

    ssize_t moved;
    if (isRead) {
      moved = read(conn, (char *)buffer + done, (size_t)(length - done));
    }
    else {
      moved = send(conn, (const char *)buffer + done, (size_t)(length - done), MSG_NOSIGNAL);
    }

    if (moved < 0) {
      if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) {
        continue;
      }
      return 0;
    }
    if (moved == 0) {
      return 0;
    }
    done += (hzstd_int_t)moved;
  }
  return 1;
#endif
}

static int haze_si_write_frame(haze_si_conn_t conn, hzstd_u32_t type, const unsigned char *payload,
                               hzstd_int_t payloadLength)
{
  unsigned char header[12];
  haze_si_put_u32(header, 0, HAZE_SI_MAGIC);
  haze_si_put_u32(header, 4, type);
  haze_si_put_u32(header, 8, (hzstd_u32_t)payloadLength);

  if (!haze_si_io(conn, header, 12, 0)) {
    return 0;
  }
  return haze_si_io(conn, (void *)payload, payloadLength, 0);
}

static int haze_si_read_frame(haze_si_conn_t conn, hzstd_u32_t expectedType, unsigned char **outPayload,
                              hzstd_int_t *outLength)
{
  unsigned char header[12];
  if (!haze_si_io(conn, header, 12, 1)) {
    return 0;
  }

  if (haze_si_get_u32(header, 0) != HAZE_SI_MAGIC) {
    return 0;
  }
  if (haze_si_get_u32(header, 4) != expectedType) {
    return 0;
  }

  hzstd_u32_t length = haze_si_get_u32(header, 8);
  if (length > HAZE_SI_MAX_PAYLOAD) {
    return 0;
  }

  unsigned char *payload = 0;
  if (length > 0) {
    payload = (unsigned char *)hzstd_heap_allocate_atomic((size_t)length, NULL);
    if (!haze_si_io(conn, payload, (hzstd_int_t)length, 1)) {
      return 0;
    }
  }

  *outPayload = payload;
  *outLength = (hzstd_int_t)length;
  return 1;
}

static void haze_si_close_conn(haze_si_conn_t conn)
{
#if defined(HAZE_PLATFORM_WIN32)
  if (conn != INVALID_HANDLE_VALUE) {
    CloseHandle(conn);
  }
#else
  if (conn >= 0) {
    close(conn);
  }
#endif
}

static hzstd_i32_t haze_si_current_pid(void)
{
#if defined(HAZE_PLATFORM_WIN32)
  return (hzstd_i32_t)GetCurrentProcessId();
#else
  return (hzstd_i32_t)getpid();
#endif
}

static int haze_si_build_hello(unsigned char **outPayload, hzstd_int_t *outLength)
{
  hzstd_int_t total = 4 + 4 + 8 + 4 + g_mangledLen + 4 + g_prettyLen;
  unsigned char *payload = (unsigned char *)hzstd_heap_allocate_atomic((size_t)total, NULL);

  hzstd_int_t offset = 0;
  haze_si_put_u32(payload, offset, HAZE_SI_VERSION);
  offset += 4;
  haze_si_put_u32(payload, offset, (hzstd_u32_t)haze_si_current_pid());
  offset += 4;
  haze_si_put_i64(payload, offset, g_fingerprint);
  offset += 8;
  haze_si_put_u32(payload, offset, (hzstd_u32_t)g_mangledLen);
  offset += 4;
  memcpy(payload + offset, g_mangledName, (size_t)g_mangledLen);
  offset += g_mangledLen;
  haze_si_put_u32(payload, offset, (hzstd_u32_t)g_prettyLen);
  offset += 4;
  memcpy(payload + offset, g_prettyName, (size_t)g_prettyLen);

  *outPayload = payload;
  *outLength = total;
  return 1;
}

static int haze_si_authenticate_peer(haze_si_conn_t conn);

static void haze_si_serve_connection(haze_si_conn_t conn)
{
  unsigned char *payload = 0;
  hzstd_int_t payloadLength = 0;

  if (!haze_si_authenticate_peer(conn)) {
    return;
  }

  unsigned char *hello = 0;
  hzstd_int_t helloLength = 0;
  haze_si_build_hello(&hello, &helloLength);
  if (!haze_si_write_frame(conn, HAZE_SI_FRAME_HELLO, hello, helloLength)) {
    return;
  }

  if (!haze_si_read_frame(conn, HAZE_SI_FRAME_REQUEST, &payload, &payloadLength)) {
    return;
  }

  hzstd_i32_t status = HZ_SI_SEND_REJECTED;
  hzstd_i32_t exitCode = 1;
  const char *message = "protocol error";

  hzstd_int_t offset = 0;
  if (payloadLength < 4) {
    goto respond;
  }

  hzstd_u32_t mangledLength = haze_si_get_u32(payload, offset);
  offset += 4;
  if (mangledLength > (hzstd_u32_t)(payloadLength - offset)) {
    goto respond;
  }

  int identityMatches = ((hzstd_int_t)mangledLength == g_mangledLen) &&
                        (memcmp(payload + offset, g_mangledName, (size_t)mangledLength) == 0);
  offset += (hzstd_int_t)mangledLength;

  if (payloadLength - offset < 12) {
    goto respond;
  }

  hzstd_i64_t fingerprint = haze_si_get_i64(payload, offset);
  offset += 8;

  hzstd_u32_t jsonLength = haze_si_get_u32(payload, offset);
  offset += 4;
  if (jsonLength > (hzstd_u32_t)(payloadLength - offset)) {
    goto respond;
  }

  if (!identityMatches || fingerprint != g_fingerprint) {
    message = "the running instance uses a different payload type";
    goto respond;
  }

  if (!g_parser) {
    message = "no payload parser registered";
    goto respond;
  }

  {
    hzstd_str_t json;
    json.data = (const char *)(payload + offset);
    json.length = (hzstd_int_t)jsonLength;

    void *value = g_parser(json);
    if (!value) {
      message = "the running instance could not decode the payload";
      goto respond;
    }

    haze_si_lock();
    if (g_mailbox->pending) {
      haze_si_unlock();
      status = HZ_SI_SEND_FAILED;
      message = "the running instance is busy";
      goto respond;
    }

    g_mailbox->value = value;
    g_mailbox->pending = 1;
    g_mailbox->answered = 0;
    g_mailbox->exitCode = 0;
    haze_si_unlock();

    haze_si_signal_ready();

    int answered = 0;
#if defined(HAZE_PLATFORM_WIN32)
    haze_si_lock();
    ULONGLONG deadline = GetTickCount64() + HAZE_SI_ACTIVATE_TIMEOUT_MS;
    while (!g_mailbox->answered) {
      ULONGLONG now = GetTickCount64();
      if (now >= deadline) {
        break;
      }
      SleepConditionVariableCS(&g_cond, &g_lock, (DWORD)(deadline - now));
    }
    answered = g_mailbox->answered;
    exitCode = g_mailbox->exitCode;
    haze_si_unlock();
#else
    haze_si_lock();
    struct timespec deadline;
    clock_gettime(CLOCK_REALTIME, &deadline);
    deadline.tv_sec += HAZE_SI_ACTIVATE_TIMEOUT_MS / 1000;
    while (!g_mailbox->answered) {
      if (pthread_cond_timedwait(&g_cond, &g_lock, &deadline) != 0) {
        break;
      }
    }
    answered = g_mailbox->answered;
    exitCode = g_mailbox->exitCode;
    haze_si_unlock();
#endif

    if (answered) {
      status = HZ_SI_SEND_DELIVERED;
      message = "";
    }
    else {
      haze_si_lock();
      g_mailbox->pending = 0;
      g_mailbox->value = 0;
      haze_si_unlock();
      status = HZ_SI_SEND_FAILED;
      message = "the running instance did not respond in time";
    }
  }

respond : {
  if (status != HZ_SI_SEND_DELIVERED && exitCode == 0) {
    exitCode = 1;
  }

  hzstd_int_t messageLength = (hzstd_int_t)strlen(message);
  hzstd_int_t total = 4 + 4 + 4 + messageLength;
  unsigned char *result = (unsigned char *)hzstd_heap_allocate_atomic((size_t)total, NULL);
  haze_si_put_u32(result, 0, (hzstd_u32_t)status);
  haze_si_put_u32(result, 4, (hzstd_u32_t)exitCode);
  haze_si_put_u32(result, 8, (hzstd_u32_t)messageLength);
  if (messageLength > 0) {
    memcpy(result + 12, message, (size_t)messageLength);
  }

  if (haze_si_write_frame(conn, HAZE_SI_FRAME_RESULT, result, total)) {
    unsigned char *ack = 0;
    hzstd_int_t ackLength = 0;
    haze_si_read_frame(conn, HAZE_SI_FRAME_ACK, &ack, &ackLength);
  }
}
}

static void haze_si_register_thread(void)
{
  struct GC_stack_base base;
  if (GC_get_stack_base(&base) == GC_SUCCESS) {
    GC_register_my_thread(&base);
  }
}

hzstd_str_t haze_si_user_key(void)
{
#if defined(HAZE_PLATFORM_WIN32)
  HANDLE token = NULL;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
    return haze_si_static_str("unknown");
  }

  DWORD needed = 0;
  GetTokenInformation(token, TokenUser, NULL, 0, &needed);
  if (needed == 0) {
    CloseHandle(token);
    return haze_si_static_str("unknown");
  }

  TOKEN_USER *info = (TOKEN_USER *)hzstd_heap_allocate_atomic((size_t)needed, NULL);
  if (!GetTokenInformation(token, TokenUser, info, needed, &needed)) {
    CloseHandle(token);
    return haze_si_static_str("unknown");
  }
  CloseHandle(token);

  LPWSTR sidText = NULL;
  if (!ConvertSidToStringSidW(info->User.Sid, &sidText)) {
    return haze_si_static_str("unknown");
  }

  int wide = (int)wcslen(sidText);
  int bytes = WideCharToMultiByte(CP_UTF8, 0, sidText, wide, NULL, 0, NULL, NULL);
  char *out = (char *)hzstd_heap_allocate_atomic((size_t)bytes + 1, NULL);
  WideCharToMultiByte(CP_UTF8, 0, sidText, wide, out, bytes, NULL, NULL);
  out[bytes] = 0;

  if (!g_userSid) {
    g_userSid = (wchar_t *)hzstd_heap_allocate_atomic(((size_t)wide + 1) * sizeof(wchar_t), NULL);
    memcpy(g_userSid, sidText, ((size_t)wide + 1) * sizeof(wchar_t));
  }
  LocalFree(sidText);

  return HZSTD_STRING(out, bytes);
#else
  char *out = (char *)hzstd_heap_allocate_atomic(32, NULL);
  int written = snprintf(out, 32, "%lu", (unsigned long)getuid());
  return HZSTD_STRING(out, written);
#endif
}

#if defined(HAZE_PLATFORM_WIN32)

static void haze_si_build_pipe_name(hzstd_str_t key)
{
  char narrow[256];
  int written = snprintf(narrow, sizeof(narrow), "\\\\.\\pipe\\hz.%.*s", (int)key.length, key.data);
  MultiByteToWideChar(CP_UTF8, 0, narrow, written + 1, g_pipeName, 256);
}

static SECURITY_ATTRIBUTES *haze_si_security(SECURITY_ATTRIBUTES *attributes)
{
  if (!g_userSid) {
    haze_si_user_key();
  }
  if (!g_userSid) {
    return NULL;
  }

  wchar_t sddl[256];
  _snwprintf(sddl, 256, L"D:P(A;;GA;;;%s)", g_userSid);

  PSECURITY_DESCRIPTOR descriptor = NULL;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, &descriptor, NULL)) {
    return NULL;
  }

  attributes->nLength = sizeof(SECURITY_ATTRIBUTES);
  attributes->lpSecurityDescriptor = descriptor;
  attributes->bInheritHandle = FALSE;
  return attributes;
}

static HANDLE haze_si_create_instance(int first)
{
  SECURITY_ATTRIBUTES attributes;
  SECURITY_ATTRIBUTES *security = haze_si_security(&attributes);

  DWORD openMode = PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED;
  if (first) {
    openMode |= FILE_FLAG_FIRST_PIPE_INSTANCE;
  }

  HANDLE handle = CreateNamedPipeW(g_pipeName, openMode,
                                   PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                                   PIPE_UNLIMITED_INSTANCES, 8192, 8192, 0, security);

  if (security && security->lpSecurityDescriptor) {
    LocalFree(security->lpSecurityDescriptor);
  }
  return handle;
}

static int haze_si_authenticate_peer(haze_si_conn_t conn)
{
  (void)conn;
  return 1;
}

static DWORD WINAPI haze_si_thread_main(LPVOID parameter)
{
  (void)parameter;
  haze_si_register_thread();

  while (g_running) {
    OVERLAPPED overlapped;
    memset(&overlapped, 0, sizeof(overlapped));
    overlapped.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (!overlapped.hEvent) {
      break;
    }

    BOOL connected = ConnectNamedPipe(g_listener, &overlapped);
    DWORD error = GetLastError();

    if (!connected && error == ERROR_PIPE_CONNECTED) {
      connected = TRUE;
    }
    else if (!connected && error == ERROR_IO_PENDING) {
      HANDLE waits[2];
      waits[0] = overlapped.hEvent;
      waits[1] = g_shutdownEvent;
      DWORD signaled = WaitForMultipleObjects(2, waits, FALSE, INFINITE);
      if (signaled == WAIT_OBJECT_0) {
        DWORD transferred = 0;
        connected = GetOverlappedResult(g_listener, &overlapped, &transferred, FALSE);
      }
      else {
        CancelIo(g_listener);
        CloseHandle(overlapped.hEvent);
        break;
      }
    }

    CloseHandle(overlapped.hEvent);

    if (!g_running) {
      break;
    }

    if (connected) {
      haze_si_serve_connection(g_listener);
      DisconnectNamedPipe(g_listener);
    }
  }

  return 0;
}

#else

static void haze_si_build_socket_name(hzstd_str_t key)
{
  g_socketName[0] = 0;
  int written = snprintf(g_socketName + 1, sizeof(g_socketName) - 1, "hz.%.*s", (int)key.length, key.data);
  g_socketNameLen = 1 + written;
}

static int haze_si_authenticate_peer(haze_si_conn_t conn)
{
  struct ucred credentials;
  socklen_t length = sizeof(credentials);
  if (getsockopt(conn, SOL_SOCKET, SO_PEERCRED, &credentials, &length) != 0) {
    return 0;
  }
  return credentials.uid == getuid();
}

static void haze_si_fill_address(struct sockaddr_un *address, socklen_t *length)
{
  memset(address, 0, sizeof(*address));
  address->sun_family = AF_UNIX;
  memcpy(address->sun_path, g_socketName, (size_t)g_socketNameLen);
  *length = (socklen_t)(offsetof(struct sockaddr_un, sun_path) + g_socketNameLen);
}

static void *haze_si_thread_main(void *parameter)
{
  (void)parameter;
  haze_si_register_thread();

  while (g_running) {
    struct pollfd entries[2];
    entries[0].fd = g_listener;
    entries[0].events = POLLIN;
    entries[0].revents = 0;
    entries[1].fd = g_shutdownFd;
    entries[1].events = POLLIN;
    entries[1].revents = 0;

    int ready = poll(entries, 2, -1);
    if (ready < 0) {
      if (errno == EINTR) {
        continue;
      }
      break;
    }

    if (entries[1].revents & POLLIN) {
      break;
    }

    if (entries[0].revents & POLLIN) {
      int conn = accept4(g_listener, NULL, NULL, SOCK_CLOEXEC);
      if (conn < 0) {
        continue;
      }
      haze_si_serve_connection(conn);
      close(conn);
    }
  }

  return 0;
}

#endif

static void haze_si_sleep_ms(int milliseconds)
{
#if defined(HAZE_PLATFORM_WIN32)
  Sleep((DWORD)milliseconds);
#else
  struct timespec duration;
  duration.tv_sec = milliseconds / 1000;
  duration.tv_nsec = (long)(milliseconds % 1000) * 1000000L;
  nanosleep(&duration, NULL);
#endif
}

void haze_si_set_parser(void *(*parser)(hzstd_str_t))
{
  g_parser = parser;
}

static int haze_si_client_handshake(const char **outError)
{
  unsigned char *payload = 0;
  hzstd_int_t payloadLength = 0;

  if (!haze_si_read_frame(g_clientConn, HAZE_SI_FRAME_HELLO, &payload, &payloadLength)) {
    *outError = "the running instance did not respond to the handshake";
    return 0;
  }

  if (payloadLength < 20) {
    *outError = "the running instance sent a malformed handshake";
    return 0;
  }

  hzstd_int_t offset = 0;
  hzstd_u32_t version = haze_si_get_u32(payload, offset);
  offset += 4;
  if (version != HAZE_SI_VERSION) {
    *outError = "a different version of this application is already running";
    return 0;
  }

  g_primaryPid = (hzstd_i32_t)haze_si_get_u32(payload, offset);
  offset += 4;

  hzstd_i64_t fingerprint = haze_si_get_i64(payload, offset);
  offset += 8;

  hzstd_u32_t mangledLength = haze_si_get_u32(payload, offset);
  offset += 4;
  if (mangledLength > (hzstd_u32_t)(payloadLength - offset)) {
    *outError = "the running instance sent a malformed handshake";
    return 0;
  }

  int identityMatches = ((hzstd_int_t)mangledLength == g_mangledLen) &&
                        (memcmp(payload + offset, g_mangledName, (size_t)mangledLength) == 0);

  if (!identityMatches || fingerprint != g_fingerprint) {
    *outError = "a different version of this application is already running";
    return 0;
  }

  return 1;
}

#if defined(HAZE_PLATFORM_WIN32)
static int haze_si_verify_pipe_owner(HANDLE pipe)
{
  if (!g_userSid) {
    haze_si_user_key();
  }
  if (!g_userSid) {
    return 0;
  }

  PSID owner = NULL;
  PSECURITY_DESCRIPTOR descriptor = NULL;
  if (GetSecurityInfo(pipe, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION, &owner, NULL, NULL, NULL, &descriptor) !=
      ERROR_SUCCESS) {
    return 0;
  }

  LPWSTR ownerText = NULL;
  int matches = 0;
  if (ConvertSidToStringSidW(owner, &ownerText)) {
    matches = (wcscmp(ownerText, g_userSid) == 0);
    LocalFree(ownerText);
  }

  if (descriptor) {
    LocalFree(descriptor);
  }
  return matches;
}
#endif

haze_si_acquire_result_t haze_si_acquire(hzstd_str_t key, hzstd_str_t mangledName, hzstd_i64_t fingerprint,
                                         hzstd_str_t prettyName)
{
  haze_si_acquire_result_t result;
  result.role = HZ_SI_ROLE_ERROR;
  result.error = haze_si_static_str("");

  if (g_initialized) {
    result.error = haze_si_static_str("single_instance was already initialised in this process");
    return result;
  }
  g_initialized = 1;

  g_mangledName = haze_si_dup(mangledName, &g_mangledLen);
  g_prettyName = haze_si_dup(prettyName, &g_prettyLen);
  g_fingerprint = fingerprint;

  g_mailbox = (haze_si_mailbox_t *)GC_MALLOC_UNCOLLECTABLE(sizeof(haze_si_mailbox_t));
  memset(g_mailbox, 0, sizeof(haze_si_mailbox_t));

#if defined(HAZE_PLATFORM_WIN32)
  InitializeCriticalSection(&g_lock);
  InitializeConditionVariable(&g_cond);
  haze_si_build_pipe_name(key);
#else
  signal(SIGPIPE, SIG_IGN);
  haze_si_build_socket_name(key);
  if (g_socketNameLen > (hzstd_int_t)sizeof(((struct sockaddr_un *)0)->sun_path)) {
    result.error = haze_si_static_str("the generated endpoint name does not fit in sun_path");
    return result;
  }
#endif

  for (int attempt = 0; attempt < HAZE_SI_MAX_ATTEMPTS; attempt++) {
#if defined(HAZE_PLATFORM_WIN32)
    HANDLE listener = haze_si_create_instance(1);
    if (listener != INVALID_HANDLE_VALUE) {
      g_listener = listener;
      g_isPrimary = 1;
      g_running = 1;
      g_shutdownEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
      g_readyEvent = CreateEventW(NULL, FALSE, FALSE, NULL);
      g_thread = CreateThread(NULL, 0, haze_si_thread_main, NULL, 0, NULL);
      result.role = HZ_SI_ROLE_PRIMARY;
      return result;
    }

    DWORD createError = GetLastError();
    if (createError != ERROR_ACCESS_DENIED && createError != ERROR_PIPE_BUSY) {
      result.error = haze_si_static_str("could not create the single-instance endpoint");
      return result;
    }

    HANDLE conn = CreateFileW(g_pipeName, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING,
                              FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, NULL);

    if (conn == INVALID_HANDLE_VALUE) {
      DWORD connectError = GetLastError();
      if (connectError == ERROR_FILE_NOT_FOUND) {
        haze_si_sleep_ms(10 + 5 * attempt);
        continue;
      }
      if (connectError == ERROR_PIPE_BUSY) {
        WaitNamedPipeW(g_pipeName, 200);
        continue;
      }
      result.error = haze_si_static_str("could not connect to the running instance");
      return result;
    }

    if (!haze_si_verify_pipe_owner(conn)) {
      CloseHandle(conn);
      result.error = haze_si_static_str("the existing endpoint is owned by a different user");
      return result;
    }

    g_clientConn = conn;
#else
    int listener = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (listener < 0) {
      result.error = haze_si_static_str("could not create the single-instance endpoint");
      return result;
    }

    struct sockaddr_un address;
    socklen_t addressLength;
    haze_si_fill_address(&address, &addressLength);

    if (bind(listener, (struct sockaddr *)&address, addressLength) == 0) {
      if (listen(listener, 16) != 0) {
        close(listener);
        result.error = haze_si_static_str("could not listen on the single-instance endpoint");
        return result;
      }
      g_listener = listener;
      g_isPrimary = 1;
      g_running = 1;
      g_shutdownFd = eventfd(0, EFD_CLOEXEC);
      g_readyFd = eventfd(0, EFD_CLOEXEC | EFD_NONBLOCK);
      pthread_create(&g_thread, NULL, haze_si_thread_main, NULL);
      result.role = HZ_SI_ROLE_PRIMARY;
      return result;
    }

    int bindError = errno;
    close(listener);

    if (bindError != EADDRINUSE) {
      result.error = haze_si_static_str("could not create the single-instance endpoint");
      return result;
    }

    int conn = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (conn < 0) {
      result.error = haze_si_static_str("could not create a client socket");
      return result;
    }

    if (connect(conn, (struct sockaddr *)&address, addressLength) != 0) {
      int connectError = errno;
      close(conn);
      if (connectError == ECONNREFUSED || connectError == ENOENT) {
        haze_si_sleep_ms(10 + 5 * attempt);
        continue;
      }
      result.error = haze_si_static_str("could not connect to the running instance");
      return result;
    }

    g_clientConn = conn;
#endif

    const char *handshakeError = "";
    if (!haze_si_client_handshake(&handshakeError)) {
      haze_si_close_conn(g_clientConn);
      g_clientConn = HAZE_SI_BAD_CONN;
      result.error = haze_si_static_str(handshakeError);
      return result;
    }

    result.role = HZ_SI_ROLE_SECONDARY;
    return result;
  }

  result.error = haze_si_static_str("could not acquire or reach the single instance after repeated attempts");
  return result;
}

haze_si_send_result_t haze_si_send(hzstd_str_t json)
{
  haze_si_send_result_t result;
  result.status = HZ_SI_SEND_FAILED;
  result.exitCode = 1;
  result.message = haze_si_static_str("no connection to the running instance");

  if (g_clientConn == HAZE_SI_BAD_CONN) {
    return result;
  }

#if defined(HAZE_PLATFORM_WIN32)
  if (g_primaryPid != 0) {
    AllowSetForegroundWindow((DWORD)g_primaryPid);
  }
#endif

  hzstd_int_t total = 4 + g_mangledLen + 8 + 4 + json.length;
  unsigned char *payload = (unsigned char *)hzstd_heap_allocate_atomic((size_t)total, NULL);

  hzstd_int_t offset = 0;
  haze_si_put_u32(payload, offset, (hzstd_u32_t)g_mangledLen);
  offset += 4;
  memcpy(payload + offset, g_mangledName, (size_t)g_mangledLen);
  offset += g_mangledLen;
  haze_si_put_i64(payload, offset, g_fingerprint);
  offset += 8;
  haze_si_put_u32(payload, offset, (hzstd_u32_t)json.length);
  offset += 4;
  if (json.length > 0) {
    memcpy(payload + offset, json.data, (size_t)json.length);
  }

  if (!haze_si_write_frame(g_clientConn, HAZE_SI_FRAME_REQUEST, payload, total)) {
    result.message = haze_si_static_str("could not send the request to the running instance");
    haze_si_close_conn(g_clientConn);
    g_clientConn = HAZE_SI_BAD_CONN;
    return result;
  }

  unsigned char *response = 0;
  hzstd_int_t responseLength = 0;
  if (!haze_si_read_frame(g_clientConn, HAZE_SI_FRAME_RESULT, &response, &responseLength) || responseLength < 12) {
    result.message = haze_si_static_str("the running instance did not return a result");
    haze_si_close_conn(g_clientConn);
    g_clientConn = HAZE_SI_BAD_CONN;
    return result;
  }

  result.status = (hzstd_i32_t)haze_si_get_u32(response, 0);
  result.exitCode = (hzstd_i32_t)haze_si_get_u32(response, 4);

  hzstd_u32_t messageLength = haze_si_get_u32(response, 8);
  if (messageLength > (hzstd_u32_t)(responseLength - 12)) {
    messageLength = (hzstd_u32_t)(responseLength - 12);
  }
  result.message = HZSTD_STRING((const char *)(response + 12), (hzstd_int_t)messageLength);

  haze_si_write_frame(g_clientConn, HAZE_SI_FRAME_ACK, 0, 0);

#if !defined(HAZE_PLATFORM_WIN32)
  shutdown(g_clientConn, SHUT_WR);
#endif

  haze_si_close_conn(g_clientConn);
  g_clientConn = HAZE_SI_BAD_CONN;
  return result;
}

haze_si_take_result_t haze_si_take(void)
{
  haze_si_take_result_t result;
  result.hasRequest = false;
  result.value = 0;

  if (!g_isPrimary || !g_mailbox) {
    return result;
  }

  haze_si_lock();
  if (g_mailbox->pending && !g_mailbox->answered) {
    result.hasRequest = true;
    result.value = g_mailbox->value;
  }
  haze_si_unlock();

  return result;
}

void haze_si_respond(hzstd_int_t exitCode)
{
  if (!g_isPrimary || !g_mailbox) {
    return;
  }

  haze_si_lock();
  g_mailbox->value = 0;
  g_mailbox->pending = 0;
  g_mailbox->answered = 1;
  g_mailbox->exitCode = (int)exitCode;
#if defined(HAZE_PLATFORM_WIN32)
  WakeAllConditionVariable(&g_cond);
#else
  pthread_cond_broadcast(&g_cond);
#endif
  haze_si_unlock();
}

void haze_si_release(void)
{
  if (!g_isPrimary || !g_running) {
    return;
  }
  g_running = 0;

#if defined(HAZE_PLATFORM_WIN32)
  if (g_shutdownEvent) {
    SetEvent(g_shutdownEvent);
  }
  if (g_listener != INVALID_HANDLE_VALUE) {
    HANDLE waker = CreateFileW(g_pipeName, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
    if (waker != INVALID_HANDLE_VALUE) {
      CloseHandle(waker);
    }
  }
  if (g_thread) {
    WaitForSingleObject(g_thread, 2000);
    CloseHandle(g_thread);
    g_thread = NULL;
  }
  if (g_listener != INVALID_HANDLE_VALUE) {
    CloseHandle(g_listener);
    g_listener = INVALID_HANDLE_VALUE;
  }
#else
  if (g_shutdownFd >= 0) {
    hzstd_u64_t one = 1;
    ssize_t ignored = write(g_shutdownFd, &one, sizeof(one));
    (void)ignored;
  }
  pthread_join(g_thread, NULL);
  if (g_listener >= 0) {
    close(g_listener);
    g_listener = -1;
  }
#endif

  g_isPrimary = 0;
}
