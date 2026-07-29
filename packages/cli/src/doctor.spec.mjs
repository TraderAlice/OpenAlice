import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { diagnoseRuntime } from './doctor.mjs'

const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('OpenAlice Doctor', () => {
  it('reports a healthy source Runtime from read-only evidence', async () => {
    const root = await sourceFixture()
    const home = await makeTempDir()
    const doctor = await diagnoseRuntime({ homeRoot: home }, {
      layout: null,
      nodeVersion: 'v22.19.0',
      readInstallSourceImpl: async () => installSource(),
      installedContentIdentityImpl: () => null,
      inspectRuntime: async () => runningStatus(home, root),
      probeRuntime: async () => true,
      discoverLogs: async () => [{ name: 'server.log' }],
    })

    expect(doctor.overall).toBe('degraded')
    expect(doctor.summary.failures).toBe(0)
    expect(doctor.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime.node', status: 'pass' }),
      expect.objectContaining({ id: 'runtime.web', status: 'pass' }),
      expect.objectContaining({ id: 'runtime.provider', status: 'pass' }),
      expect.objectContaining({ id: 'runtime.logs', status: 'pass' }),
    ]))
    expect(doctor.checks.find((check) => check.id === 'cli.provenance')?.status).toBe('warn')
  })

  it('fails incompatible ownership, unsupported Node, and an unreachable Web endpoint', async () => {
    const home = await makeTempDir()
    const doctor = await diagnoseRuntime({ homeRoot: home }, {
      layout: null,
      nodeVersion: 'v20.0.0',
      readInstallSourceImpl: async () => installSource(),
      installedContentIdentityImpl: () => null,
      inspectRuntime: async () => ({
        ...runningStatus(home, '/missing'),
        class: 'incompatible',
        detail: 'control API mismatch',
        provider: { kind: 'unknown' },
      }),
      probeRuntime: async () => false,
      discoverLogs: async () => [],
    })

    expect(doctor.overall).toBe('error')
    expect(doctor.summary.failures).toBeGreaterThanOrEqual(3)
    expect(doctor.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime.node', status: 'fail' }),
      expect.objectContaining({ id: 'runtime.ownership', status: 'fail' }),
      expect.objectContaining({ id: 'runtime.web', status: 'fail' }),
    ]))
  })

  it('reports cached installed-release update availability without a network check', async () => {
    const home = await makeTempDir()
    const cachePath = join(home, '.cli-update-check.json')
    await writeFile(cachePath, JSON.stringify({
      schemaVersion: 1,
      checkedAt: '2026-07-29T00:00:00.000Z',
      result: { status: 'available', latestVersion: '0.88.0' },
    }))
    const doctor = await diagnoseRuntime({ homeRoot: home }, {
      layout: { updateCachePath: cachePath },
      nodeVersion: 'v22.19.0',
      readInstallSourceImpl: async () => installSource(),
      installedContentIdentityImpl: () => '0123456789abcdef',
      inspectRuntime: async () => ({
        ...runningStatus(home, null),
        provider: { kind: 'bundle', contentIdentity: 'bundle-id' },
      }),
      probeRuntime: async () => true,
      discoverLogs: async () => [{ name: 'server.log' }],
    })

    expect(doctor.checks.find((check) => check.id === 'update.metadata')).toMatchObject({
      status: 'warn',
      summary: 'OpenAlice 0.88.0 is available',
    })
  })
})

function runningStatus(home, root) {
  return {
    protocol: 1,
    control: { apiVersion: 1, minClientApiVersion: 1, capabilities: ['runtime.status'] },
    class: 'running',
    productVersion: '0.87.0-beta',
    runtimeVersion: '0.87.0-beta',
    state: 'running',
    home,
    owner: {
      surface: 'cli-server',
      pid: process.pid,
      startedAt: '2026-07-29T00:00:00.000Z',
      mode: 'detached',
      ...(root ? { launchRoot: root } : {}),
    },
    endpoints: { web: 'http://127.0.0.1:47331' },
    provider: root ? { kind: 'source', root } : { kind: 'unknown' },
    pendingActivation: null,
    uptimeSeconds: 10,
    components: { alice: 'ready', uta: 'disabled', connector: 'disabled' },
    componentDetail: {},
    capabilities: ['runtime.stop'],
  }
}

function installSource() {
  return {
    schemaVersion: 1,
    repository: 'TraderAlice/OpenAlice',
    cliVersion: '0.87.0-beta',
    selector: { kind: 'branch', value: 'master' },
    installerUrl: 'https://openalice.ai/install',
  }
}

async function sourceFixture() {
  const root = await makeTempDir()
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.87.0-beta' }))
  for (const relativePath of ['dist/main.js', 'ui/dist/index.html', 'scripts/guardian/prod.mjs']) {
    const path = join(root, relativePath)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, '')
  }
  return root
}

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), 'openalice-doctor-test-'))
  temporaryPaths.push(path)
  return path
}
