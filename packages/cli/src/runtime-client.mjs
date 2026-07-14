import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

export const LOOPBACK = '127.0.0.1'

export async function allocateLoopbackPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: LOOPBACK, port: 0, exclusive: true }, resolve)
  })
  const address = server.address()
  const port = address && typeof address === 'object' ? address.port : 0
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (!port) throw new Error('Could not reserve a local loopback port')
  return port
}

export async function probeOpenAlice(baseUrl, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(`${baseUrl}/api/auth/status`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 750),
    })
    if (!response.ok) return false
    const body = await response.json()
    return typeof body?.authed === 'boolean' && typeof body?.tokenConfigured === 'boolean'
  } catch {
    return false
  }
}

export async function waitForOpenAlice(baseUrl, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 60_000
  const pollMs = options.pollMs ?? 250
  const deadline = Date.now() + timeoutMs
  let lastError = 'connection refused'

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`${baseUrl}/api/auth/status`, {
        signal: AbortSignal.timeout(Math.min(2_000, Math.max(250, deadline - Date.now()))),
      })
      if (response.ok) {
        const body = await response.json()
        if (typeof body?.authed === 'boolean' && typeof body?.tokenConfigured === 'boolean') return body
        lastError = 'unexpected response from /api/auth/status'
      } else {
        lastError = `HTTP ${response.status}`
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  throw new Error(`OpenAlice did not become ready at ${baseUrl} within ${Math.ceil(timeoutMs / 1_000)}s (${lastError})`)
}

export async function openBrowser(url, options = {}) {
  const platform = options.platform ?? process.platform
  const spawnProcess = options.spawnProcess ?? spawn
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd.exe' : 'xdg-open'
  const args = platform === 'win32' ? ['/d', '/s', '/c', 'start', '', url] : [url]
  const child = spawnProcess(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.once?.('error', () => undefined)
  child.unref()
}
