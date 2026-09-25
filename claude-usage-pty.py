#!/usr/bin/env python3
import os
import pty
import select
import signal
import struct
import sys
import termios
import fcntl


def main():
    if len(sys.argv) != 2:
        raise SystemExit(2)
    binary = sys.argv[1]
    pid, master = pty.fork()
    if pid == 0:
        os.execvpe(binary, [binary, "--ax-screen-reader", "--safe-mode", "--permission-mode", "dontAsk"], os.environ)

    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))

    def answer_terminal_queries(data):
        replies = []
        if b"\x1b[c" in data:
            replies.append(b"\x1b[?1;2c")
        if b"\x1b[>0q" in data:
            replies.append(b"\x1bP>|xterm-256color\x1b\\")
        if b"\x1b[?u" in data:
            replies.append(b"\x1b[?0u")
        if b"\x1b[6n" in data:
            replies.append(b"\x1b[1;1R")
        for reply in replies:
            os.write(master, reply)

    def stop(_signal, _frame):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()
    while True:
        ready, _, _ = select.select([master, stdin_fd], [], [], 0.25)
        if master in ready:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            os.write(stdout_fd, data)
            answer_terminal_queries(data)
        if stdin_fd in ready:
            data = os.read(stdin_fd, 4096)
            if not data:
                break
            os.write(master, data)
        ended, _ = os.waitpid(pid, os.WNOHANG)
        if ended:
            break


if __name__ == "__main__":
    main()
