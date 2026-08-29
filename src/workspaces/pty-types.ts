export interface PtyDisposable {
  dispose(): void;
}

export interface PtyExitEvent {
  readonly exitCode: number;
  readonly signal?: number;
}

export interface PtySpawnOptions {
  readonly name: string;
  readonly cols: number;
  readonly rows: number;
  readonly cwd: string;
  readonly env: Record<string, string>;
}

export interface PtyProcess {
  readonly pid: number;
  onData(listener: (data: Buffer | string) => void): PtyDisposable;
  onExit(listener: (event: PtyExitEvent) => void): PtyDisposable;
  write(data: Buffer | string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pause?(): void;
  resume?(): void;
}

export interface PtyBackend {
  readonly name: 'node-pty' | 'bun-native';
  readonly supportsFlowControl: boolean;
  spawn(file: string, args: string[], options: PtySpawnOptions): PtyProcess;
}
