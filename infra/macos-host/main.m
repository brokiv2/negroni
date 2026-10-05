#import <Foundation/Foundation.h>
#import <ApplicationServices/ApplicationServices.h>
#include <spawn.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>

extern char **environ;
static volatile sig_atomic_t childPID = 0;
static volatile sig_atomic_t stopSignal = 0;

static void forwardSignal(int signum) {
    stopSignal = signum;
    if (childPID > 0) kill(childPID, signum);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSBundle *bundle = NSBundle.mainBundle;
        NSString *node = [bundle.bundlePath stringByAppendingPathComponent:@"Contents/Helpers/node"];
        if (argc == 2 && strcmp(argv[1], "--check") == 0) {
            NSDictionary *result = @{
                @"bundleIdentifier": bundle.bundleIdentifier ?: @"",
                @"node": node,
                @"accessibility": @(AXIsProcessTrusted()),
                @"screenRecording": @(CGPreflightScreenCaptureAccess())
            };
            NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
            fwrite(data.bytes, 1, data.length, stdout);
            puts("");
            return 0;
        }
        if (argc != 3 || strcmp(argv[1], "--service") != 0) {
            fputs("Usage: NegroniHost --service backend|mac-control, or --check\n", stderr);
            return 64;
        }
        NSString *service = [NSString stringWithUTF8String:argv[2]];
        NSString *root = [bundle objectForInfoDictionaryKey:@"NegroniServiceDirectory"];
        if (!root) root = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/Negroni"];
        NSString *program;
        NSString *script;
        if ([service isEqualToString:@"backend"]) {
            program = @"/bin/zsh";
            script = [root stringByAppendingPathComponent:@"negroni-stack.sh"];
        } else if ([service isEqualToString:@"mac-control"]) {
            program = node;
            script = [root stringByAppendingPathComponent:@"mac-control/server.mjs"];
        } else {
            fputs("Unknown Negroni service\n", stderr);
            return 64;
        }
        if (![[NSFileManager defaultManager] isExecutableFileAtPath:node] ||
            ![[NSFileManager defaultManager] isReadableFileAtPath:script]) {
            fputs("Negroni service files are missing\n", stderr);
            return 66;
        }
        setenv("NEGRONI_NODE_BIN", node.fileSystemRepresentation, 1);
        NSString *oldPath = NSProcessInfo.processInfo.environment[@"PATH"] ?: @"/usr/bin:/bin:/usr/sbin:/sbin";
        NSString *newPath = [NSString stringWithFormat:@"%@:%@", node.stringByDeletingLastPathComponent, oldPath];
        setenv("PATH", newPath.UTF8String, 1);

        // Keep a native, signed app alive above the interpreter. exec() or a
        // shell CFBundleExecutable would lose the app's privacy attribution.
        struct sigaction action = {0};
        action.sa_handler = forwardSignal;
        sigemptyset(&action.sa_mask);
        sigaction(SIGTERM, &action, NULL);
        sigaction(SIGINT, &action, NULL);
        sigaction(SIGHUP, &action, NULL);
        char *args[] = {(char *)program.fileSystemRepresentation, (char *)script.fileSystemRepresentation, NULL};
        pid_t pid;
        int error = posix_spawn(&pid, program.fileSystemRepresentation, NULL, NULL, args, environ);
        if (error) {
            fprintf(stderr, "Negroni service launch failed: %s\n", strerror(error));
            return 70;
        }
        childPID = pid;
        if (stopSignal) kill(pid, stopSignal);
        int status;
        while (waitpid(pid, &status, 0) < 0) {
            if (errno != EINTR) return 70;
        }
        childPID = 0;
        return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
    }
}
