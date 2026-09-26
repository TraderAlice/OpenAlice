/** The GUI runs either in Electron's integrated mode or on a browser origin.
 * In separated mode the client-owned relay reports the selected Machine. */
export type BackendConnection =
  | { kind: 'electron' }
  | { kind: 'local'; endpoint: string }

interface BootstrapEnvironment {
  href: string
  electron: boolean
}

export function bootstrapBackendConnection(environment: BootstrapEnvironment): BackendConnection {
  if (environment.electron) return { kind: 'electron' }
  return { kind: 'local', endpoint: new URL(environment.href).host }
}

let currentConnection: BackendConnection | null = null

export function initializeBackendConnection(): BackendConnection {
  if (currentConnection) return currentConnection
  currentConnection = bootstrapBackendConnection({
    href: window.location.href,
    electron: window.openAlice?.runtime !== undefined,
  })
  return currentConnection
}

export function getBackendConnection(): BackendConnection {
  return currentConnection ?? initializeBackendConnection()
}
