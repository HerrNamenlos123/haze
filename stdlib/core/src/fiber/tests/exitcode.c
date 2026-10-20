/*
 * Windows hosts only: runs a command and prints its full 32-bit exit code. Bun reports only the
 * low byte of a Windows exit code (0xC000001D arrives as 29), so the runner could not tell a trap
 * (an NTSTATUS) from exit(29) without it.
 *
 *   exitcode <exe> [args...]
 *
 * The command inherits stdin, stdout and stderr. Its exit code is printed last, on stdout, as
 * "\nexitcode: 0x%08lX\n"; the launcher's own exit code is the command's. Exit code 255 and no
 * such line mean the command could not be started.
 */
#include <stdio.h>
#include <windows.h>

int main(void)
{
  /* The command line after our own executable name, passed on verbatim (no re-quoting). */
  wchar_t *rest = GetCommandLineW();
  if (*rest == L'"') {
    rest++;
    while (*rest != L'\0' && *rest != L'"') {
      rest++;
    }
    if (*rest == L'"') {
      rest++;
    }
  }
  else {
    while (*rest != L'\0' && *rest != L' ' && *rest != L'\t') {
      rest++;
    }
  }
  while (*rest == L' ' || *rest == L'\t') {
    rest++;
  }
  if (*rest == L'\0') {
    fputs("exitcode: no command\n", stderr);
    return 255;
  }
  STARTUPINFOW si;
  ZeroMemory(&si, sizeof(si));
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  HANDLE std[3] = {si.hStdInput, si.hStdOutput, si.hStdError};
  for (int i = 0; i < 3; i++) {
    if (std[i] != NULL && std[i] != INVALID_HANDLE_VALUE) {
      SetHandleInformation(std[i], HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
    }
  }
  /* The command dies with us when the runner kills us on a timeout. */
  HANDLE job = CreateJobObjectW(NULL, NULL);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
  ZeroMemory(&limits, sizeof(limits));
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (job == NULL || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
    fprintf(stderr, "exitcode: job object: %lu\n", GetLastError());
    return 255;
  }
  PROCESS_INFORMATION pi;
  if (!CreateProcessW(NULL, rest, NULL, NULL, TRUE, CREATE_SUSPENDED, NULL, NULL, &si, &pi)) {
    fprintf(stderr, "exitcode: CreateProcess failed: %lu\n", GetLastError());
    return 255;
  }
  if (!AssignProcessToJobObject(job, pi.hProcess)) {
    fprintf(stderr, "exitcode: AssignProcessToJobObject failed: %lu\n", GetLastError());
    TerminateProcess(pi.hProcess, 255);
    return 255;
  }
  ResumeThread(pi.hThread);
  CloseHandle(pi.hThread);
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 255;
  GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(pi.hProcess);
  printf("\nexitcode: 0x%08lX\n", (unsigned long)code);
  fflush(stdout);
  return (int)code;
}
