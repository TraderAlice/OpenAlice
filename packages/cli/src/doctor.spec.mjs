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
      channel: 'stable',
      checkedAt: '2026-07-29T00:00:00.000Z',
      result: { status: 'available', channel: 'stable', latestVersion: '0.88.0' },
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
      summary: 'OpenAlice 0.88.0 is available on stable',
    })
  })

  it('reports the embedded Bun engine without implying a system Node dependency', async () => {
    const home = await makeTempDir()
    const doctor = await diagnoseRuntime({ homeRoot: home }, {
      layout: { updateCachePath: join(home, '.cli-update-check.json') },
      bunStandalone: true,
      bunVersion: '1.4.0',
      readInstallSourceImpl: async () => installSource(),
      installedContentIdentityImpl: () => '0123456789abcdef',
      inspectRuntime: async () => ({
        ...runningStatus(home, null),
        provider: { kind: 'bun', contentIdentity: '0123456789abcdef' },
      }),
      probeRuntime: async () => true,
      discoverLogs: async () => [{ name: 'server.log' }],
    })

    expect(doctor.checks.find((check) => check.id === 'runtime.engine')).toMatchObject({
      status: 'pass',
      summary: 'Bun 1.4.0 is embedded in the OpenAlice executable',
      detail: 'No system Node.js or Bun installation is required',
    })
    expect(doctor.checks.find((check) => check.id === 'runtime.node')).toBeUndefined()
  })

  it('reports package-manager provenance and update ownership as installed', async () => {
    const home = await makeTempDir()
    const source = {
      ...installSource(),
      schemaVersion: 3,
      selector: { kind: 'version', value: 'v0.90.1' },
      updateChannel: 'stable',
      method: 'brew',
      artifact: { platform: 'darwin', arch: 'arm64', sha256: 'a'.repeat(64) },
      installedAt: '2026-08-30T00:00:00Z',
    }
    const doctor = await diagnoseRuntime({ homeRoot: home }, {
      layout: null,
      bunStandalone: true,
      bunVersion: '1.4.0',
      readInstallSourceImpl: async () => source,
      installedContentIdentityImpl: () => '0123456789abcdef',
      inspectRuntime: async () => ({
        ...runningStatus(home, null),
        provider: { kind: 'bun', contentIdentity: '0123456789abcdef' },
      }),
      probeRuntime: async () => true,
      discoverLogs: async () => [{ name: 'server.log' }],
    })

    expect(doctor.cli.installed).toBe(true)
    expect(doctor.checks.find((check) => check.id === 'cli.provenance')?.summary)
      .toContain('Homebrew-managed')
    expect(doctor.checks.find((check) => check.id === 'update.metadata')).toMatchObject({
      status: 'pass',
      summary: 'Homebrew owns OpenAlice updates',
      detail: 'Use: brew upgrade traderalice/tap/openalice',
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
