import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'

import { guardianControlEndpoint } from './control-server.js'
import {
  classifyGuardianRuntimeStatus,
  emptyClassifiedRuntimeStatus,
  type ClassifiedRuntimeStatus,
} from './runtime-discovery.js'
import { resolveAliceProjectIdentity } from './alice-project.js'

const MAX_RESPONSE_BYTES = 1024 * 1024

export interface ReadDiscoveredRuntimeStatusOptions {
  readonly homeRoot: string
  readonly timeoutMs?: number
  readonly platform?: NodeJS.Platform
  readonly requestControl?: (
    homeRoot: string,
    method: string,
    options?: { timeoutMs?: number; platform?: NodeJS.Platform },
  ) => Promise<unknown>
}

export async function requestGuardianControl(
  homeRoot: string,
  method: string,
  options: {
    readonly timeoutMs?: number
    readonly platform?: NodeJS.Platform
    readonly endpoint?: string
    readonly createConnectionImpl?: typeof createConnection
  } = {},
): Promise<unknown> {
  const endpoint = options.endpoint ?? guardianControlEndpoint(homeRoot, options.platform)
  const timeoutMs = options.timeoutMs ?? 2_000
  const id = randomUUID()
  const request = `${JSON.stringify({
    protocol: 1,
    id,
    method,
    params: {},
  })}\n`

  return new Promise((resolvePromise, rejectPromise) => {
    const socket = (options.createConnectionImpl ?? createConnection)(endpoint)
    let body = ''
    let settled = false
    const finish = (error: Error | null, result?: unknown) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) rejectPromise(error)
      else resolvePromise(result)
    }
    socket.setEncoding('utf8')
    socket.setTimeout(timeoutMs, () => finish(controlError(
      'ETIMEDOUT',
      `Timed out waiting for OpenAlice Guardian at ${endpoint}`,
    )))
    socket.once('error', (error) => finish(error))
    socket.once('connect', () => socket.write(request))
    socket.on('data', (chunk) => {
      if (settled) return
      body += String(chunk)
      if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
        finish(controlError('ERESPONSETOOLARGE', 'OpenAlice Guardian control response is too large'))
        return
      }
      const newline = body.indexOf('\n')
      if (newline < 0) return
      let response: {
        protocol?: unknown
        id?: unknown
        ok?: unknown
        result?: unknown
        error?: { code?: unknown; message?: unknown }
      }
      try {
        response = JSON.parse(body.slice(0, newline)) as typeof response
      } catch {
        finish(controlError('EINVALIDRESPONSE', 'OpenAlice Guardian returned invalid JSON'))
        return
      }
      if (response?.protocol !== 1 || response?.id !== id) {
        finish(controlError('EINCOMPATIBLE', 'OpenAlice Guardian control protocol is incompatible'))
        return
      }
      if (response.ok !== true) {
        finish(controlError(
          typeof response?.error?.code === 'string' ? response.error.code : 'ECONTROL',
          typeof response?.error?.message === 'string'
            ? response.error.message
            : 'OpenAlice Guardian control request failed',
        ))
        return
      }
      finish(null, response.result)
    })
    socket.once('end', () => {
      if (!settled) {
        finish(controlError(
          'EUNEXPECTEDEND',
          'OpenAlice Guardian closed the control connection without a response',
        ))
      }
    })
  })
}

export async function readDiscoveredRuntimeStatus(
  options: ReadDiscoveredRuntimeStatusOptions,
): Promise<ClassifiedRuntimeStatus | null> {
  const homeRoot = options.homeRoot
  const aliceProject = resolveAliceProjectIdentity({ home: homeRoot })
  const requestControl = options.requestControl ?? requestGuardianControl
  try {
    const runtime = await requestControl(homeRoot, 'runtime.status', {
      timeoutMs: options.timeoutMs,
      platform: options.platform,
    })
    return classifyGuardianRuntimeStatus(homeRoot, runtime, aliceProject)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    if (['ENOENT', 'ECONNREFUSED', 'ENOTSOCK', 'EPIPE'].includes(code)) return null
    if (code === 'EINCOMPATIBLE' || code === 'incompatible_protocol') {
      return emptyClassifiedRuntimeStatus(
        homeRoot,
        'incompatible',
        'unknown',
        error instanceof Error ? error.message : String(error),
        aliceProject,
      )
    }
    return emptyClassifiedRuntimeStatus(
      homeRoot,
      'unhealthy',
      'unknown',
      error instanceof Error ? error.message : String(error),
      aliceProject,
    )
  }
}

function controlError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
