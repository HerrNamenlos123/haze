#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <ucontext.h>
#include <libunwind.h>
#include <unistd.h>

void segv_handler(int sig, siginfo_t *info, void *ucontext) {
    (void)info;
    fprintf(stderr, "\nCaught signal %d (segfault / stack overflow)\n", sig);

    unw_cursor_t cursor;
    unw_context_t uc;
    unw_word_t ip, sp, off;
    char fname[256];

    // Use the actual ucontext from the kernel
    if (unw_init_local2(&cursor, (unw_context_t *)ucontext, UNW_INIT_SIGNAL_FRAME) < 0) {
        fprintf(stderr, "unw_init_local2 failed\n");
        _exit(1);
    }

    int frame = 0;
    while (unw_step(&cursor) > 0) {
        unw_get_reg(&cursor, UNW_REG_IP, &ip);
        unw_get_reg(&cursor, UNW_REG_SP, &sp);
        if (unw_get_proc_name(&cursor, fname, sizeof(fname), &off) == 0) {
            fprintf(stderr, "#%d  [ip=0x%lx sp=0x%lx] %s+0x%lx\n",
                    frame, (long)ip, (long)sp, fname, (long)off);
        } else {
            fprintf(stderr, "#%d  [ip=0x%lx sp=0x%lx] ???\n",
                    frame, (long)ip, (long)sp);
        }
        frame++;
    }

    _exit(1);
}

void setup_segv_handler() {
    // Install alternate stack so handler works after stack overflow
    stack_t ss;
    ss.ss_sp = malloc(SIGSTKSZ);
    ss.ss_size = SIGSTKSZ;
    ss.ss_flags = 0;
    sigaltstack(&ss, NULL);

    struct sigaction sa;
    sa.sa_sigaction = segv_handler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
    sigaction(SIGSEGV, &sa, NULL);
}

void recurse(int depth) {
    printf("Depth: %d\n", depth);
    char buffer[1000024]; // ~1MB to blow stack fast
    buffer[0] = depth;    // prevent optimization
    recurse(depth + 1);
}

int main(void) {
    setup_segv_handler();
    printf("Starting infinite recursion...\n");
    recurse(1);
    return 0;
}
