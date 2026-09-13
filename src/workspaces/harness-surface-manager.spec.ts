import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { HarnessSurfaceManager, resolveSurfaceDomain } from './harness-surface-manager.js'
import type { WorkspaceRegistry } from './workspace-registry.js'

const managers: HarnessSurfaceManager[] = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('HarnessSurfaceManager', () => {
  it('injects exact ports, publishes only after readiness, and cleans up its route', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openalice-harness-surface-'))
    dirs.push(dir)
    const program = [
      "const http=require('node:http')",
      "const ports=JSON.parse(process.env.HARNESS_PORTS)",
      "if(process.env.HARNESS_CAPABILITY!=='studio'||process.env.HARNESS_NO_OPEN!=='1')process.exit(9)",
      "console.log('token=super-secret-value Bearer abcdefghijklmnop http://127.0.0.1:'+ports.http)",
      "const server=http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return}res.end(String(ports.http))})",
      "server.listen(ports.http,process.env.HARNESS_HOST)",
      "process.on('SIGTERM',()=>server.close(()=>process.exit(0)))",
    ].join(';')
    await writeFile(join(dir, 'harness.json'), JSON.stringify({
      manifestVersion: 1,
      version: 'test-1',
      capabilities: {
        studio: {
          command: [process.execPath, '-e', program],
          ports: ['http'],
          entryPort: 'http',
          readinessPath: '/health',
        },
      },
    }))
    const registry = { get: (id: string) => id === 'ws-1' ? { id, dir } : undefined } as WorkspaceRegistry
    const manager = new HarnessSurfaceManager(registry)
    managers.push(manager)

    const starting = await manager.start('ws-1', 'studio')
    expect(starting.phase).toBe('starting')
    expect(starting.routeHost).toBeUndefined()
    const ready = await waitFor(() => manager.snapshot('ws-1', 'studio'), (value) => value.phase === 'ready')
    expect(ready.routeHost).toMatch(/^oa-surface-[a-f0-9]{24}\.localhost$/)
    expect(ready.logs).toContain('token=[REDACTED]')
    expect(ready.logs).not.toContain('super-secret-value')
    expect(ready.logs).not.toContain('abcdefghijklmnop')
    expect(ready.logs).toContain('http://[HARNESS_LOOPBACK]')
    expect(ready.logs).not.toMatch(/127\.0\.0\.1:\d+/)
    const target = manager.resolveHost(`${ready.routeHost}:47331`)
    expect(target).not.toBeNull()
    await expect(fetch(`http://${target!.host}:${target!.port}/`).then((response) => response.text()))
      .resolves.toMatch(/^\d+$/)

    const same = await manager.start('ws-1', 'studio')
    expect(same.generation).toBe(ready.generation)
    const restarting = await manager.restart('ws-1', 'studio')
    expect(restarting.phase).toBe('starting')
    expect(restarting.generation).toBe(ready.generation + 1)
    expect(manager.resolveHost(ready.routeHost)).toBeNull()
    const restarted = await waitFor(() => manager.snapshot('ws-1', 'studio'), (value) => value.phase === 'ready')
    expect(restarted.routeHost).not.toBe(ready.routeHost)
    const stopped = await manager.stop('ws-1', 'studio')
    expect(stopped.phase).toBe('stopped')
    expect(manager.resolveHost(ready.routeHost)).toBeNull()
  }, 30_000)

  it('preserves the readiness timeout when terminating the child also produces an exit event', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openalice-harness-timeout-'))
    dirs.push(dir)
    const program = [
      "process.on('SIGTERM',()=>process.exit(1))",
      "setInterval(()=>{},1000)",
    ].join(';')
    await writeFile(join(dir, 'harness.json'), JSON.stringify({
      manifestVersion: 1,
      version: 'test-timeout',
      capabilities: {
        studio: {
          command: [process.execPath, '-e', program],
          ports: ['http'],
          entryPort: 'http',
          readinessPath: '/health',
        },
      },
    }))
    const registry = { get: (id: string) => id === 'ws-timeout' ? { id, dir } : undefined } as WorkspaceRegistry
    const manager = new HarnessSurfaceManager(registry, { readinessTimeoutMs: 50 })
    managers.push(manager)

    await manager.start('ws-timeout', 'studio')
    const failed = await waitFor(
      () => manager.snapshot('ws-timeout', 'studio'),
      (value) => value.phase === 'failed',
    )

    expect(failed.error).toBe('Studio readiness timed out after 50ms')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(manager.snapshot('ws-timeout', 'studio').error)
      .toBe('Studio readiness timed out after 50ms')
  })

  it('validates the configured surface domain instead of falling back to localhost', () => {
    expect(resolveSurfaceDomain(undefined)).toBe('localhost')
    expect(resolveSurfaceDomain('')).toBe('localhost')
    expect(resolveSurfaceDomain('   ')).toBe('localhost')
    expect(resolveSurfaceDomain('LOCALHOST')).toBe('localhost')
    expect(resolveSurfaceDomain('10.10.10.44.nip.io')).toBe('10.10.10.44.nip.io')
    expect(resolveSurfaceDomain('Surface.Example.COM.')).toBe('surface.example.com')
    expect(resolveSurfaceDomain('trading.lan')).toBe('trading.lan')

    const unusable = [
      '10.10.10.44',
      'http://surfaces.example',
      'surfaces.example:47331',
      'surfaces.example/studio',
      '*.surfaces.example',
      '-surfaces.example',
      'surfaces-.example',
      'a..example',
      '.',
    ]
    for (const value of unusable) {
      expect(() => resolveSurfaceDomain(value), value).toThrow(/OPENALICE_SURFACE_DOMAIN/)
    }
  })

  it('publishes and resolves only the configured surface domain', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openalice-harness-domain-'))
    dirs.push(dir)
    const program = [
      "const http=require('node:http')",
      "const ports=JSON.parse(process.env.HARNESS_PORTS)",
      "const server=http.createServer((req,res)=>{res.end('ok')})",
      "server.listen(ports.http,process.env.HARNESS_HOST)",
      "process.on('SIGTERM',()=>server.close(()=>process.exit(0)))",
    ].join(';')
    await writeFile(join(dir, 'harness.json'), JSON.stringify({
      manifestVersion: 1,
      version: 'test-domain',
      capabilities: {
        studio: {
          command: [process.execPath, '-e', program],
          ports: ['http'],
          entryPort: 'http',
          readinessPath: '/',
        },
      },
    }))
    const registry = { get: (id: string) => id === 'ws-domain' ? { id, dir } : undefined } as WorkspaceRegistry
    const manager = new HarnessSurfaceManager(registry, { surfaceDomain: '10.10.10.44.nip.io' })
    managers.push(manager)

    await manager.start('ws-domain', 'studio')
    const ready = await waitFor(() => manager.snapshot('ws-domain', 'studio'), (value) => value.phase === 'ready')
    const routeHost = ready.routeHost ?? ''
    expect(routeHost).toMatch(/^oa-surface-[a-f0-9]{24}\.10\.10\.10\.44\.nip\.io$/)

    expect(manager.resolveHost(`${routeHost}:47331`)).not.toBeNull()
    expect(manager.resolveHost(routeHost.toUpperCase())).not.toBeNull()
    // The default loopback shape and any other suffix stay unrouted.
    expect(manager.resolveHost(routeHost.replace('.10.10.10.44.nip.io', '.localhost'))).toBeNull()
    expect(manager.resolveHost('oa-surface-aabbccddeeff001122334455.localhost')).toBeNull()
    expect(manager.resolveHost('oa-surface-aabbccddeeff001122334455.surfaces.example')).toBeNull()
    expect(manager.resolveHost(null)).toBeNull()
  }, 30_000)
})

async function waitFor<T>(read: () => T, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const value = read()
    if (done(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('timed out')
}
