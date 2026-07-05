/// <reference types="vite/client" />

/**
 * Backend port injected by vite.config.ts `define` (dev only). The PTY
 * WebSocket connects directly to this port to skip the dev proxy. Replaced at
 * build time with a numeric literal; declared via `typeof` guard at the call
 * site so production builds (where it's undefined) don't ReferenceError.
 */
declare const __OPENALICE_DEV_BACKEND_PORT__: number

interface ImportMetaEnv {
  readonly VITE_DEMO_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  /**
   * Electron preload bridge. Undefined in browser/dev/Docker surfaces, where
   * the app keeps using HTTP + WebSocket. Keep this declaration narrow and in
   * sync with apps/desktop/src/preload.ts; never expose raw ipcRenderer.
   */
  readonly openAlice?: {
    readonly runtime: {
      info(): Promise<{
        mode: 'electron-dev' | 'electron-packaged'
        transport: 'electron-ipc'
        ports: { web: number | null; mcp: number | null; uta: number }
        userDataHome: string
        appHome: string
      }>
    }
    readonly workspace: {
      listFiles(input: { id: string; path: string }): Promise<{
        path: string
        entries: ReadonlyArray<{
          name: string
          kind: 'file' | 'dir' | 'symlink' | 'other'
          sizeBytes: number | null
          mtime: string
        }>
      }>
      readFile(input: { id: string; path: string }): Promise<
        | { kind: 'ok'; content: string }
        | { kind: 'workspace_missing' }
        | { kind: 'file_missing' }
        | { kind: 'too_large'; sizeBytes: number }
        | { kind: 'invalid_path' }
        | { kind: 'error'; message: string }
      >
    }
    readonly pty: {
      connect(input: {
        sessionId: string
        cols: number
        rows: number
        since?: number
        controllerId?: string
        controllerKind?: string
        takeover?: boolean
      }): string
      send(connectionId: string, data: Uint8Array): void
      resize(connectionId: string, cols: number, rows: number): void
      close(connectionId: string): void
      onMessage(
        connectionId: string,
        cb: (msg: { type: 'data' | 'control'; data: unknown }) => void,
      ): () => void
      onClose(
        connectionId: string,
        cb: (msg: { code: number; reason: string }) => void,
      ): () => void
    }
  }
}
