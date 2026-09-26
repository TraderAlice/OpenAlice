/** Types for the CLI relay bundled into dist/electron/web-relay.js. */
export declare class WebRelay {
  constructor(options?: { port?: number; uiRoot?: string })
  readonly originUrl: string
  readonly status: {
    schemaVersion: 1
    generation: number
    target: { machine: string; machineName: string; project: string; projectName: string } | null
    switching: boolean
  }
  listen(): Promise<string>
  connect(machine: string, project: string): Promise<void>
  planMachine(input: { mode: 'add' | 'upgrade'; sshTarget?: string; label?: string; sshPort?: number; identityFile?: string; machineKey?: string }): Promise<unknown>
  applyMachine(id: string): Promise<unknown>
  readonly machineOperation: unknown
  disconnect(): void
  close(): Promise<void>
}
