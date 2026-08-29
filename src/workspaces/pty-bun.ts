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
  supportsFlowControl: false,
  spawn(file, args, options) {
    const dataListeners = new Set<(data: Buffer) => void>();
    const exitListeners = new Set<(event: PtyExitEvent) => void>();
    const pendingData: Buffer[] = [];
    let exitEvent: PtyExitEvent | undefined;

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
        child.kill(signal as NodeJS.Signals | undefined);
      },
    } satisfies PtyProcess;
  },
};
