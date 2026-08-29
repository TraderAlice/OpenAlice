import type {
  PtyBackend,
  PtyDisposable,
  PtyExitEvent,
  PtyProcess,
} from './pty-types.js';

interface BunTerminal {
  write(data: string | Uint8Array): number;
  resize(cols: number, rows: number): void;
  close(): void;
}

interface BunPtySubprocess {
  readonly pid: number;
  readonly terminal: BunTerminal | undefined;
  kill(signal?: NodeJS.Signals): void;
}

interface BunPtyRuntime {
  spawn(
    command: string[],
    options: {
      cwd: string;
      env: Record<string, string>;
      terminal: {
        name: string;
        cols: number;
        rows: number;
        data(terminal: BunTerminal, data: Uint8Array): void;
        exit(terminal: BunTerminal): void;
      };
      onExit(
        child: BunPtySubprocess,
        exitCode: number | null,
        signalCode: number | null,
      ): void;
    },
  ): BunPtySubprocess;
}

const bunRuntime = (globalThis as typeof globalThis & { Bun: BunPtyRuntime }).Bun;

export const ptyBackend: PtyBackend = {
  name: 'bun-native',
  supportsFlowControl: true,
  spawn(file, args, options) {
    const dataListeners = new Set<(data: Buffer) => void>();
    const exitListeners = new Set<(event: PtyExitEvent) => void>();
    const pendingData: Buffer[] = [];
    let exitEvent: PtyExitEvent | undefined;
    let paused = false;

    const child = bunRuntime.spawn([file, ...args], {
      cwd: options.cwd,
      env: options.env,
      terminal: {
        name: options.name,
        cols: options.cols,
        rows: options.rows,
        data(_terminal, data) {
          const chunk = Buffer.from(data);
          if (dataListeners.size === 0) {
            pendingData.push(chunk);
            return;
          }
          for (const listener of dataListeners) listener(chunk);
        },
        exit(terminal) {
          terminal.close();
        },
      },
      onExit(_child, exitCode, signalCode) {
        paused = false;
        exitEvent = {
          exitCode: exitCode ?? 1,
          signal: signalCode ?? undefined,
        };
        for (const listener of exitListeners) listener(exitEvent);
        exitListeners.clear();
      },
    });
    const terminal = child.terminal;
    if (!terminal) {
      child.kill();
      throw new Error('Bun did not attach its native terminal to the subprocess');
    }

    const subscribe = <T>(
      listeners: Set<(event: T) => void>,
      listener: (event: T) => void,
    ): PtyDisposable => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    };

    return {
      pid: child.pid,
      onData(listener) {
        const disposable = subscribe(dataListeners, listener);
        for (const chunk of pendingData.splice(0)) listener(chunk);
        return disposable;
      },
      onExit(listener) {
        if (exitEvent) {
          listener(exitEvent);
          return { dispose() {} };
        }
        return subscribe(exitListeners, listener);
      },
      write(data) {
        terminal.write(Buffer.isBuffer(data) ? Uint8Array.from(data) : data);
      },
      resize(cols, rows) {
        terminal.resize(cols, rows);
      },
      kill(signal) {
        const requestedSignal = signal as NodeJS.Signals | undefined;
        // A graceful signal remains pending while the process group is
        // stopped. Resume first so shutdown handlers can actually run.
        if (paused && requestedSignal !== 'SIGKILL') {
          signalProcessGroup(child, 'SIGCONT');
          paused = false;
        }
        signalProcessGroup(child, requestedSignal ?? 'SIGTERM');
      },
      pause() {
        if (paused || exitEvent) return;
        if (signalProcessGroup(child, 'SIGSTOP')) paused = true;
      },
      resume() {
        if (!paused || exitEvent) return;
        if (signalProcessGroup(child, 'SIGCONT')) paused = false;
      },
    } satisfies PtyProcess;
  },
};

/**
 * Bun.Terminal is callback-only and currently has no read-side pause method.
 * A PTY child is its own POSIX session/process-group leader, so stopping that
 * group moves output pressure back to the producer without buffering an
 * unbounded copy in the Bun heap. Group signalling also covers helper
 * processes spawned by an Agent Runtime.
 */
function signalProcessGroup(
  child: BunPtySubprocess,
  signal: NodeJS.Signals,
): boolean {
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (!isMissingProcessError(error)) throw error;
  }

  // Bun's PTY contract creates a process group whose id matches the child pid.
  // Keep a direct-child fallback for an exit race or a future runtime change.
  try {
    child.kill(signal);
    return true;
  } catch (error) {
    if (isMissingProcessError(error)) return false;
    throw error;
  }
}

function isMissingProcessError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ESRCH'
  );
}
