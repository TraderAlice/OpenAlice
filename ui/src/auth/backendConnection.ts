/**
 * Client-owned description of the Runtime behind this presentation surface.
 *
 * Remote SSH identity cannot come from Alice: once the tunnel is down, the
 * remote backend is unreachable, and the remote process does not know which
 * local SSH alias opened it. The CLI therefore bootstraps this tab through a
 * client-only URL fragment. We validate it, persist it in sessionStorage, and
 * immediately scrub the fragment so it is never sent to Alice or left visible.
 */

const REMOTE_CONTEXT_MARKER = 'openalice-remote'
const REMOTE_CONTEXT_STORAGE_KEY = 'openalice.backend-connection.remote.v1'
const REMOTE_TARGET_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,255}$/

interface StoredRemoteConnection {
  version: 1
  target: string
  sshPort: number
  runtimePort: number
}

export type BackendConnection =
  | {
      kind: 'remote'
      target: string
      sshPort: number
      runtimePort: number
      localEndpoint: string
    }
  | {
      kind: 'electron'
    }
  | {
      kind: 'local'
      endpoint: string
    }

interface BootstrapEnvironment {
  href: string
  electron: boolean
  readStored: () => string | null
  writeStored: (value: string) => void
  replaceUrl: (url: string) => void
}

function validPort(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null
  const port = Number(raw)
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null
}

function parseRemoteFragment(url: URL): StoredRemoteConnection | null {
  const fragment = new URLSearchParams(url.hash.slice(1))
  if (fragment.get(REMOTE_CONTEXT_MARKER) !== '1') return null
  const target = fragment.get('target')
  const sshPort = validPort(fragment.get('ssh-port'))
  const runtimePort = validPort(fragment.get('runtime-port'))
  if (!target || !REMOTE_TARGET_PATTERN.test(target) || sshPort === null || runtimePort === null) {
    return null
  }
  return { version: 1, target, sshPort, runtimePort }
}

function parseStoredRemote(raw: string | null): StoredRemoteConnection | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<StoredRemoteConnection>
    if (
      value.version !== 1
      || typeof value.target !== 'string'
      || !REMOTE_TARGET_PATTERN.test(value.target)
      || !Number.isInteger(value.sshPort)
      || !Number.isInteger(value.runtimePort)
      || (value.sshPort ?? 0) < 1
      || (value.sshPort ?? 0) > 65_535
      || (value.runtimePort ?? 0) < 1
      || (value.runtimePort ?? 0) > 65_535
    ) {
      return null
    }
    return value as StoredRemoteConnection
  } catch {
    return null
  }
}

export function bootstrapBackendConnection(environment: BootstrapEnvironment): BackendConnection {
  const url = new URL(environment.href)
  const fragmentMarksRemote = new URLSearchParams(url.hash.slice(1)).get(REMOTE_CONTEXT_MARKER) === '1'
  const remoteFromFragment = parseRemoteFragment(url)
  if (fragmentMarksRemote) {
    environment.replaceUrl(`${url.pathname}${url.search}`)
    if (remoteFromFragment) {
      try {
        environment.writeStored(JSON.stringify(remoteFromFragment))
      } catch {
        // Storage can be unavailable in hardened or ephemeral browser contexts.
      }
      return {
        kind: 'remote',
        target: remoteFromFragment.target,
        sshPort: remoteFromFragment.sshPort,
        runtimePort: remoteFromFragment.runtimePort,
        localEndpoint: url.host,
      }
    }
    return environment.electron
      ? { kind: 'electron' }
      : { kind: 'local', endpoint: url.host }
  }

  let storedRemote: StoredRemoteConnection | null = null
  try {
    storedRemote = parseStoredRemote(environment.readStored())
  } catch {
    // Fall through to the surface-derived local context.
  }
  if (storedRemote) {
    return {
      kind: 'remote',
      target: storedRemote.target,
      sshPort: storedRemote.sshPort,
      runtimePort: storedRemote.runtimePort,
      localEndpoint: url.host,
    }
  }
  if (environment.electron) return { kind: 'electron' }
  return { kind: 'local', endpoint: url.host }
}

let currentConnection: BackendConnection | null = null

export function initializeBackendConnection(): BackendConnection {
  if (currentConnection) return currentConnection
  currentConnection = bootstrapBackendConnection({
    href: window.location.href,
    electron: window.openAlice !== undefined,
    readStored: () => window.sessionStorage.getItem(REMOTE_CONTEXT_STORAGE_KEY),
    writeStored: (value) => window.sessionStorage.setItem(REMOTE_CONTEXT_STORAGE_KEY, value),
    replaceUrl: (url) => window.history.replaceState(window.history.state, '', url),
  })
  return currentConnection
}

export function getBackendConnection(): BackendConnection {
  return currentConnection ?? initializeBackendConnection()
}
