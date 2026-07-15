import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, rm } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

export const GUARDIAN_CONTROL_PROTOCOL = 1
export const GUARDIAN_CONTROL_MAX_REQUEST_BYTES = 64 * 1024

export function guardianControlEndpoint(homeRoot, platform = process.platform) {
  const canonicalHome = resolve(homeRoot)
  const homeId = createHash('sha256').update(canonicalHome).digest('hex').slice(0, 20)
  if (platform === 'win32') {
    return `\\\\.\\pipe\\openalice-guardian-${homeId}`
  }
  const homeEndpoint = resolve(canonicalHome, 'state', 'guardian-control.sock')
  if (Buffer.byteLength(homeEndpoint, 'utf8') <= 96) return homeEndpoint
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user'
  return resolve(tmpdir(), `openalice-guardian-${uid}`, `${homeId}.sock`)
}

export async function startGuardianControlServer(options) {
  const platform = options.platform ?? process.platform
  const endpoint = options.endpoint ?? guardianControlEndpoint(options.homeRoot, platform)
  if (platform !== 'win32') {
    await mkdir(dirname(endpoint), { recursive: true })
    const directEndpoint = resolve(options.homeRoot, 'state', 'guardian-control.sock')
    if (endpoint !== directEndpoint) await secureFallbackDirectory(dirname(endpoint))
    await prepareUnixEndpoint(endpoint)
  }

  const sockets = new Set()
  let closed = false
  let socketIdentity = null
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.setEncoding('utf8')
    socket.setTimeout(options.requestTimeoutMs ?? 5_000)
    let body = ''
    let handled = false

    const finish = (response, afterWrite) => {
      if (handled) return
      handled = true
      socket.end(`${JSON.stringify(response)}\n`, afterWrite)
    }
    const fail = (id, code, message) => finish({
      protocol: GUARDIAN_CONTROL_PROTOCOL,
      id,
      ok: false,
      error: { code, message },
    })

    socket.on('data', (chunk) => {
      if (handled) return
      body += chunk
      if (Buffer.byteLength(body, 'utf8') > GUARDIAN_CONTROL_MAX_REQUEST_BYTES) {
        fail(null, 'request_too_large', 'Guardian control request is too large')
        return
      }
      const newline = body.indexOf('\n')
      if (newline < 0) return

      let request
      try {
        request = JSON.parse(body.slice(0, newline))
      } catch {
        fail(null, 'invalid_json', 'Guardian control request must be one JSON line')
        return
      }
      const id = typeof request?.id === 'string' ? request.id : null
      if (request?.protocol !== GUARDIAN_CONTROL_PROTOCOL) {
        fail(id, 'incompatible_protocol', `Guardian control protocol ${GUARDIAN_CONTROL_PROTOCOL} is required`)
        return
      }
      if (!id) {
        fail(null, 'invalid_request', 'Guardian control request id is required')
        return
      }
      if (request.method === 'runtime.status') {
        finish({
          protocol: GUARDIAN_CONTROL_PROTOCOL,
          id,
          ok: true,
          result: options.getStatus(),
        })
        return
      }
      if (request.method === 'runtime.stop') {
        if (!options.allowStop) {
          fail(id, 'stop_not_supported', 'This OpenAlice owner does not accept server stop requests')
          return
        }
        finish({
          protocol: GUARDIAN_CONTROL_PROTOCOL,
          id,
          ok: true,
          result: { accepted: true, state: 'stopping' },
        }, () => setImmediate(options.onStop))
        return
      }
      fail(id, 'method_not_found', `Unknown Guardian control method: ${String(request.method)}`)
    })
    socket.on('timeout', () => socket.destroy())
    socket.on('error', () => undefined)
    socket.on('close', () => sockets.delete(socket))
  })

  await new Promise((resolvePromise, rejectPromise) => {
    const onError = (error) => {
      server.off('listening', onListening)
      rejectPromise(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolvePromise()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(endpoint)
  })

  if (platform !== 'win32') {
    await waitForEndpointPath(endpoint)
    await chmod(endpoint, 0o600)
    socketIdentity = await endpointIdentity(endpoint)
  }

  return {
    endpoint,
    close: async () => {
      if (closed) return
      closed = true
      const serverClosed = new Promise((resolvePromise) => server.close(() => resolvePromise()))
      for (const socket of sockets) socket.destroy()
      await serverClosed
      if (platform !== 'win32' && socketIdentity !== null) {
        const currentIdentity = await endpointIdentity(endpoint).catch(() => null)
        if (currentIdentity === socketIdentity) await rm(endpoint, { force: true })
      }
    },
  }
}

async function prepareUnixEndpoint(endpoint) {
  try {
    await probeEndpoint(endpoint, 250)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ECONNREFUSED') {
      await rm(endpoint, { force: true })
      return
    }
    throw error
  }
  throw new Error(`OpenAlice Guardian control endpoint is already active at ${endpoint}`)
}

function probeEndpoint(endpoint, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = createConnection(endpoint)
    const done = (error) => {
      socket.destroy()
      if (error) rejectPromise(error)
      else resolvePromise()
    }
    socket.setTimeout(timeoutMs, () => {
      const error = new Error(`Timed out connecting to ${endpoint}`)
      error.code = 'ETIMEDOUT'
      done(error)
    })
    socket.once('connect', () => done())
    socket.once('error', done)
  })
}

async function endpointIdentity(endpoint) {
  const stats = await lstat(endpoint)
  return `${stats.dev}:${stats.ino}:${stats.birthtimeMs}`
}

async function secureFallbackDirectory(directory) {
  const stats = await lstat(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`OpenAlice Guardian control directory is not a private directory: ${directory}`)
  }
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    throw new Error(`OpenAlice Guardian control directory is owned by another user: ${directory}`)
  }
  await chmod(directory, 0o700)
}

async function waitForEndpointPath(endpoint) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await lstat(endpoint)
      return
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
  }
  throw new Error(`OpenAlice Guardian control endpoint was not published at ${endpoint}`)
}
