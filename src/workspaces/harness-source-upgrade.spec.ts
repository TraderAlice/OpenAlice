import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { exec as gitExec } from 'dugite'
import { afterEach, describe, expect, it } from 'vitest'

import { HarnessSourceUpgradeManager } from './harness-source-upgrade.js'
import type { Logger } from './logger.js'
import { TemplateRegistry } from './template-registry.js'
import { WorkspaceOperationGuard } from './workspace-operation-guard.js'
import { WorkspaceRegistry } from './workspace-registry.js'

const roots: string[] = []
const logger = {
  debug() {}, info() {}, warn() {}, error() {}, event() {}, child() { return this },
} as unknown as Logger

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('HarnessSourceUpgradeManager', () => {
  it('uses one verified merge transaction for a source-backed Harness', async () => {
    const fixture = await createFixture()
    const manager = new HarnessSourceUpgradeManager({
      registry: fixture.registry,
      templates: fixture.templates,
      operationGuard: new WorkspaceOperationGuard(),
      logger,
    })

    const plan = await manager.plan('desk-1', false)
    expect(plan).toMatchObject({
      fromVersion: 'v1.0.0',
      toVersion: 'v1.1.0',
      verified: true,
      protocolCompatible: true,
      blocked: false,
    })
    expect(plan.changedPaths).toContain('feature.txt')

    const result = await manager.apply('desk-1', false, {
      planDigest: plan.planDigest,
      targetVersion: plan.toVersion,
    })
    expect(result).toMatchObject({ fromVersion: 'v1.0.0', toVersion: 'v1.1.0', verified: true })
    expect(normalizeLineEndings(await readFile(join(fixture.workspace, 'local.txt'), 'utf8'))).toBe('local work\n')
    expect(normalizeLineEndings(await readFile(join(fixture.workspace, 'feature.txt'), 'utf8'))).toBe('new upstream feature\n')
    expect(JSON.parse(await readFile(join(fixture.workspace, '.alice/harness-source.json'), 'utf8'))).toMatchObject({
      version: 'v1.1.0',
      commit: fixture.v2,
    })
  })

  it('keeps unverified stable releases behind the opt-in policy', async () => {
    const fixture = await createFixture({ catalogV2: false })
    const manager = new HarnessSourceUpgradeManager({
      registry: fixture.registry,
      templates: fixture.templates,
      operationGuard: new WorkspaceOperationGuard(),
      logger,
      discoverReleases: async () => [
        { version: 'v1.1.0', commit: fixture.v2, verified: false },
      ],
    })

    await expect(manager.plan('desk-1', false)).rejects.toMatchObject({ code: 'no_update' })
    await expect(manager.plan('desk-1', true)).resolves.toMatchObject({
      toVersion: 'v1.1.0',
      verified: false,
    })
  })

  it('blocks a dirty Workspace before any merge is applied', async () => {
    const fixture = await createFixture()
    await writeFile(join(fixture.workspace, 'local.txt'), 'not committed\n')
    const manager = new HarnessSourceUpgradeManager({
      registry: fixture.registry,
      templates: fixture.templates,
      operationGuard: new WorkspaceOperationGuard(),
      logger,
    })
    const plan = await manager.plan('desk-1', false)
    expect(plan.blockers).toContain('working_tree_changes')
    await expect(manager.apply('desk-1', false, {
      planDigest: plan.planDigest,
      targetVersion: plan.toVersion,
    })).rejects.toMatchObject({ code: 'working_tree_changes' })
  })
})

function normalizeLineEndings(value: string): string {
  return value.replaceAll('\r\n', '\n')
}

async function createFixture(options: { catalogV2?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'harness-source-upgrade-'))
  roots.push(root)
  const upstream = join(root, 'upstream')
  await mkdir(upstream)
  await git(upstream, ['init', '-q'])
  await writeFile(join(upstream, 'harness.json'), manifest('1.0.0'))
  await writeFile(join(upstream, 'base.txt'), 'base\n')
  await commit(upstream, 'v1')
  const v1 = await rev(upstream)
  await git(upstream, ['tag', 'v1.0.0'])
  await writeFile(join(upstream, 'harness.json'), manifest('1.1.0'))
  await writeFile(join(upstream, 'feature.txt'), 'new upstream feature\n')
  await commit(upstream, 'v2')
  const v2 = await rev(upstream)
  await git(upstream, ['tag', 'v1.1.0'])

  const workspace = join(root, 'workspace')
  await git(root, ['clone', '-q', upstream, workspace])
  await git(workspace, ['checkout', '-q', '-b', 'research/test', v1])
  await mkdir(join(workspace, '.alice'), { recursive: true })
  await writeFile(join(workspace, '.alice/harness-source.json'), `${JSON.stringify({
    schemaVersion: 1,
    template: 'fixture-harness',
    repository: upstream,
    version: 'v1.0.0',
    commit: v1,
  }, null, 2)}\n`)
  await writeFile(join(workspace, 'local.txt'), 'local work\n')
  await commit(workspace, 'workspace baseline')

  const templateRoot = join(root, 'templates')
  const templateDir = join(templateRoot, 'fixture-harness')
  await mkdir(templateDir, { recursive: true })
  await writeFile(join(templateDir, 'bootstrap.mjs'), 'export {}\n')
  await writeFile(join(templateDir, 'template.json'), JSON.stringify({
    source: {
      repository: upstream,
      defaultVersion: options.catalogV2 === false ? 'v1.0.0' : 'v1.1.0',
      versions: options.catalogV2 === false
        ? [{ version: 'v1.0.0', commit: v1 }]
        : [{ version: 'v1.1.0', commit: v2 }, { version: 'v1.0.0', commit: v1 }],
    },
  }))
  const templates = await TemplateRegistry.load(templateRoot, logger)
  const registry = await WorkspaceRegistry.load(join(root, 'workspaces.json'), logger)
  await registry.add({
    id: 'desk-1', tag: 'desk', dir: workspace, createdAt: new Date().toISOString(), template: 'fixture-harness',
  })
  return { root, upstream, workspace, templates, registry, v1, v2 }
}

function manifest(version: string): string {
  return `${JSON.stringify({
    manifestVersion: 1,
    version,
    capabilities: {
      studio: { command: ['node', 'studio.js'], ports: ['http'], entryPort: 'http', readinessPath: '/health' },
    },
  }, null, 2)}\n`
}

async function commit(dir: string, message: string): Promise<void> {
  await git(dir, ['add', '-A'])
  await git(dir, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '-m', message])
}

async function rev(dir: string): Promise<string> {
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}

async function git(dir: string, args: string[]): Promise<string> {
  const result = await gitExec(args, dir)
  if (result.exitCode !== 0) throw new Error(String(result.stderr))
  return String(result.stdout)
}
