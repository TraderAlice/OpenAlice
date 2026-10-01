/** Types for the CLI relay bundled into dist/electron/web-relay.js. */
export declare class WebRelay {
  constructor(options?: { port?: number; uiRoot?: string; clientUpdates?: ClientUpdateService })
  readonly originUrl: string
  readonly status: {
    schemaVersion: 1
    generation: number
    target: { machine: string; machineName: string; project: string; projectName: string } | null
    switching: boolean
  }
  listen(): Promise<string>
  connect(machine: string, project: string, options?: { remember?: boolean; present?: () => Promise<void>; current?: () => boolean }): Promise<void>
  planMachine(input: { mode: 'add' | 'upgrade'; sshTarget?: string; label?: string; sshPort?: number; identityFile?: string; projectKey?: string; machineKey?: string }): Promise<unknown>
  applyMachine(id: string): Promise<unknown>
  readonly machineOperation: unknown
  startupPreference(): Promise<{ target: { machine: string; project: string } | null; error: string | null }>
  setStartupError(error: unknown): void
  controlProject(input: unknown): Promise<void>
  disconnect(): void
  close(): Promise<void>
}

export declare function inspectLocalMachine(): Promise<{ machine: { projects: Array<{ key: string; available: boolean; runtime: { webEndpoint: string | null } }> } }>

export declare function resolveLocalStartupHome(project: string): Promise<string>

export declare function readStartupTarget(options?: { legacyDesktopPreferencePath?: string }): Promise<{ machine: string; project: string } | null>
export declare function writeStartupTarget(target: { machine: string; project: string } | null, options?: { current?: () => boolean }): Promise<void>

export declare class ClientUpdateService {
  readonly currentVersion: string
  constructor(options?: { path?: string; kind?: 'cli' | 'desktop'; discover?: (currentVersion: string) => Promise<Omit<import('@traderalice/update-lifecycle').ClientReleaseObservation, 'currentVersion'>> })
  snapshot(): Promise<import('@traderalice/update-lifecycle').ClientUpdateSnapshot>
  check(): Promise<import('@traderalice/update-lifecycle').ClientUpdateSnapshot>
  activate(): void
  stop(): void
  savePreferences(input: unknown): Promise<import('@traderalice/update-lifecycle').ClientUpdateSnapshot>
}

export declare const CLI_VERSION: string

export declare class UpdateControlService {
  constructor(options: {
    root?: string
    scope(): string
    project(path: string, body?: unknown): Promise<unknown>
    backend?: { plan(): Promise<unknown>; apply(id: string): Promise<unknown> }
    client?: {
      current(): string; downloaded(): string | null; install(version: string, parentOperationId: string): Promise<unknown>; ready(): Promise<boolean>
      recovery?: {
        status(): Promise<import('@traderalice/update-lifecycle').UpdateOperation | null>
        resume(): Promise<import('@traderalice/update-lifecycle').UpdateOperation | null>
        abandon(): Promise<void>
      }
    }
  })
  status(): Promise<import('@traderalice/update-lifecycle').UpdateOperation | null>
  review(selection: { client: boolean; backend: boolean; projectUnits: string[] }): Promise<import('@traderalice/update-lifecycle').UpdatePlan>
  approve(plan: import('@traderalice/update-lifecycle').UpdatePlan, fingerprint: string): Promise<import('@traderalice/update-lifecycle').UpdateOperation>
  abandon(): Promise<void>
  resume(): Promise<import('@traderalice/update-lifecycle').UpdateOperation>
}
