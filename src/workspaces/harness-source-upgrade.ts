import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { exec as gitExec, type IGitStringExecutionOptions } from 'dugite'

import { compareVersions } from '@/core/version.js'

import { parseHarnessManifest } from './harness-manifest.js'
import { readHarnessSource, type HarnessSourceReceipt } from './harness-source.js'
import type { Logger } from './logger.js'
import type { TemplateMeta, TemplateRegistry, TemplateSourceVersion } from './template-registry.js'
import type { WorkspaceOperationGuard } from './workspace-operation-guard.js'
import type { WorkspaceMeta, WorkspaceRegistry } from './workspace-registry.js'
import type { WorkspaceRuntimeActivity } from './workspace-runtime-activity.js'

const GIT_TIMEOUT_MS = 15_000
const MAX_GIT_BUFFER = 4 * 1024 * 1024
const DISCOVERY_TTL_MS = 10 * 60_000
const JOURNAL_REL = join('.alice', 'transactions', 'harness-source-upgrade.json')
const RECEIPT_REL = join('.alice', 'harness-source.json')
const STABLE_SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/

export interface HarnessSourceRelease extends TemplateSourceVersion {
  readonly verified: boolean
}

export interface HarnessSourceUpgradePlan {
  readonly workspaceId: string
  readonly template: string
  readonly fromVersion: string
  readonly fromCommit: string
  readonly toVersion: string
  readonly toCommit: string
  readonly verified: boolean
  readonly strategy: 'source-merge'
  readonly protocolCompatible: boolean
  readonly manifestVersion: number | null
  readonly planDigest: string
  readonly blocked: boolean
  readonly blockers: readonly string[]
  readonly activity: WorkspaceRuntimeActivity
  readonly changedPaths: readonly string[]
  readonly conflictedPaths: readonly string[]
}

export interface HarnessSourceUpgradeResult {
  readonly workspaceId: string
  readonly fromVersion: string
  readonly toVersion: string
  readonly commit: string
  readonly verified: boolean
}

interface SourceUpgradeJournal {
  readonly schemaVersion: 1
  readonly workspaceId: string
  readonly fromReceipt: HarnessSourceReceipt
  readonly target: HarnessSourceRelease
  readonly planDigest: string
  readonly preparedAt: string
}

export class HarnessSourceUpgradeError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'unsupported'
      | 'no_update'
      | 'unknown_release'
      | 'busy'
      | 'working_tree_changes'
      | 'merge_conflicts'
      | 'incompatible'
      | 'stale_plan',
    message: string,
    readonly plan?: HarnessSourceUpgradePlan,
  ) {
    super(message)
    this.name = 'HarnessSourceUpgradeError'
  }
}

export interface HarnessSourceUpgradeManagerOptions {
  readonly registry: WorkspaceRegistry
  readonly templates: TemplateRegistry
  readonly workspaceRuntimeActivity?: (workspaceId: string) => WorkspaceRuntimeActivity
  readonly operationGuard: WorkspaceOperationGuard
  readonly logger: Logger
  readonly discoverReleases?: (repository: string) => Promise<readonly HarnessSourceRelease[]>
}

/** Shared exact-tag Git lifecycle for source-backed Harness Workspaces. */
export class HarnessSourceUpgradeManager {
  private readonly discovery = new Map<string, {
    expiresAt: number
    promise: Promise<readonly HarnessSourceRelease[]>
  }>()

  constructor(private readonly opts: HarnessSourceUpgradeManagerOptions) {}

  async recover(): Promise<void> {
    for (const workspace of this.opts.registry.list()) {
      if (!existsSync(join(workspace.dir, JOURNAL_REL))) continue
      await this.recoverWorkspace(workspace).catch((err) =>
        this.opts.logger.error('harness_source_upgrade.recovery_failed', {
          workspaceId: workspace.id,
          err,
        }),
      )
    }
  }

  async releases(templateName: string, includeUnverified: boolean): Promise<readonly HarnessSourceRelease[]> {
    const template = this.opts.templates.get(templateName)
    if (!template?.source) return []
    const verified = template.source.versions.map((release) => ({ ...release, verified: true }))
    if (!includeUnverified) return sortReleases(verified)
    const upstream = await this.discover(template.source.repository)
    const byVersion = new Map(upstream.map((release) => [release.version, release]))
    for (const release of verified) byVersion.set(release.version, release)
    return sortReleases([...byVersion.values()])
  }

  async latest(
    templateName: string,
    currentVersion: string,
    includeUnverified: boolean,
  ): Promise<HarnessSourceRelease | null> {
    const releases = await this.releases(templateName, includeUnverified)
    return releases.find((release) => compareVersions(release.version, currentVersion) > 0) ?? null
  }

  async plan(
    workspaceId: string,
    includeUnverified: boolean,
    requestedVersion?: string,
  ): Promise<HarnessSourceUpgradePlan> {
    const lease = await this.opts.operationGuard.acquireWhenAvailable(workspaceId, 'harness-source-upgrade-preview')
    try {
      const workspace = this.requireWorkspace(workspaceId)
      await this.recoverWorkspace(workspace)
      const { template, receipt } = await this.requireSource(workspace)
      const releases = await this.releases(template.name, includeUnverified)
      const target = requestedVersion
        ? releases.find((release) => release.version === requestedVersion)
        : releases.find((release) => compareVersions(release.version, receipt.version) > 0)
      if (!target) {
        throw new HarnessSourceUpgradeError(
          requestedVersion ? 'unknown_release' : 'no_update',
          requestedVersion
            ? `Harness release ${requestedVersion} is not available under the current trust policy.`
            : 'This Harness Workspace is already on the newest available release.',
        )
      }
      await fetchExactRelease(workspace.dir, template, target)
      return await this.buildPlan(workspace, receipt, target)
    } finally {
      lease.release()
    }
  }

  async apply(
    workspaceId: string,
    includeUnverified: boolean,
    input: { readonly planDigest: string; readonly targetVersion: string },
  ): Promise<HarnessSourceUpgradeResult> {
    const lease = this.opts.operationGuard.acquire(workspaceId, 'harness-source-upgrade')
    if (!lease) throw new HarnessSourceUpgradeError('busy', 'Workspace is busy with another directory operation.')
    try {
      const workspace = this.requireWorkspace(workspaceId)
      const { template, receipt } = await this.requireSource(workspace)
      await this.recoverWorkspace(workspace)
      const releases = await this.releases(template.name, includeUnverified)
      const target = releases.find((release) => release.version === input.targetVersion)
      if (!target) throw new HarnessSourceUpgradeError('unknown_release', 'The selected release is not available under the current trust policy.')
      await fetchExactRelease(workspace.dir, template, target)
      const plan = await this.buildPlan(workspace, receipt, target)
      if (plan.planDigest !== input.planDigest) {
        throw new HarnessSourceUpgradeError('stale_plan', 'The Workspace or target release changed. Review the refreshed plan before applying.', plan)
      }
      if (plan.blocked) throw blockerError(plan)

      const journal: SourceUpgradeJournal = {
        schemaVersion: 1,
        workspaceId,
        fromReceipt: receipt,
        target,
        planDigest: plan.planDigest,
        preparedAt: new Date().toISOString(),
      }
      await atomicWriteJson(join(workspace.dir, JOURNAL_REL), journal)
      try {
        await runGit(workspace.dir, [
          '-c', 'user.email=launcher@local',
          '-c', 'user.name=OpenAlice',
          'merge', '--no-ff', '--no-commit', target.commit,
        ])
        await atomicWriteJson(join(workspace.dir, RECEIPT_REL), {
          ...receipt,
          version: target.version,
          commit: target.commit,
        } satisfies HarnessSourceReceipt)
        await runGit(workspace.dir, ['add', '--', RECEIPT_REL])
        await runGit(workspace.dir, [
          '-c', 'user.email=launcher@local',
          '-c', 'user.name=OpenAlice',
          'commit', '-q', '-m', `harness(${template.name}): upgrade ${receipt.version} -> ${target.version}`,
        ])
        const commit = (await runGit(workspace.dir, ['rev-parse', 'HEAD'])).trim()
        await rm(join(workspace.dir, JOURNAL_REL), { force: true })
        this.opts.logger.info('harness_source_upgrade.applied', {
          workspaceId,
          fromVersion: receipt.version,
          toVersion: target.version,
          verified: target.verified,
          commit,
        })
        return { workspaceId, fromVersion: receipt.version, toVersion: target.version, commit, verified: target.verified }
      } catch (err) {
        await this.recoverWorkspace(workspace)
        throw err
      }
    } finally {
      lease.release()
    }
  }

  private requireWorkspace(workspaceId: string): WorkspaceMeta {
    const workspace = this.opts.registry.get(workspaceId)
    if (!workspace) throw new HarnessSourceUpgradeError('not_found', 'Workspace not found.')
    return workspace
  }

  private async requireSource(workspace: WorkspaceMeta): Promise<{ template: TemplateMeta; receipt: HarnessSourceReceipt }> {
    const template = workspace.template ? this.opts.templates.get(workspace.template) : undefined
    const receipt = await readHarnessSource(workspace.dir)
    if (!template?.source || !receipt || receipt.template !== template.name || receipt.repository !== template.source.repository) {
      throw new HarnessSourceUpgradeError('unsupported', 'This Workspace is not backed by a recognized Harness source catalog.')
    }
    return { template, receipt }
  }

  private async buildPlan(
    workspace: WorkspaceMeta,
    receipt: HarnessSourceReceipt,
    target: HarnessSourceRelease,
  ): Promise<HarnessSourceUpgradePlan> {
    const activity = this.opts.workspaceRuntimeActivity?.(workspace.id) ?? { busy: false, sessions: [], headless: [] }
    const changedPaths = parseChangedPaths(await runGit(workspace.dir, ['diff', '--name-status', `${receipt.commit}..${target.commit}`]))
    const trackedStatus = (await runGit(workspace.dir, ['status', '--porcelain=v1', '--untracked-files=no'])).trim()
    const untrackedPaths = (await runGit(workspace.dir, ['ls-files', '--others', '--exclude-standard', '-z']))
      .split('\0').filter(Boolean)
    const collidingUntrackedPaths = untrackedPaths.filter((path) => changedPaths.includes(path)).sort()
    const mergeTree = await gitExec(['merge-tree', '--write-tree', 'HEAD', target.commit], workspace.dir, gitOptions())
    const conflictedPaths = mergeTree.exitCode === 1 ? parseMergeTreeConflicts(String(mergeTree.stdout)) : []
    if (mergeTree.exitCode !== 0 && mergeTree.exitCode !== 1) {
      throw new Error(`git merge-tree exited ${mergeTree.exitCode}: ${String(mergeTree.stderr).slice(0, 800)}`)
    }
    let protocolCompatible = false
    let manifestVersion: number | null = null
    try {
      const manifest = parseHarnessManifest(await runGit(workspace.dir, ['show', `${target.commit}:harness.json`]))
      protocolCompatible = true
      manifestVersion = manifest.manifestVersion
    } catch {
      protocolCompatible = false
    }
    const blockers: string[] = []
    if (activity.busy) blockers.push('active_runtime')
    if (trackedStatus || collidingUntrackedPaths.length > 0) blockers.push('working_tree_changes')
    if (conflictedPaths.length > 0) blockers.push('merge_conflicts')
    if (!protocolCompatible) blockers.push('incompatible_manifest')
    const planDigest = createHash('sha256').update(JSON.stringify({
      workspaceId: workspace.id,
      head: (await runGit(workspace.dir, ['rev-parse', 'HEAD'])).trim(),
      receipt,
      target,
      trackedStatus,
      collidingUntrackedPaths,
      changedPaths,
      conflictedPaths,
      protocolCompatible,
    })).digest('hex')
    return {
      workspaceId: workspace.id,
      template: receipt.template,
      fromVersion: receipt.version,
      fromCommit: receipt.commit,
      toVersion: target.version,
      toCommit: target.commit,
      verified: target.verified,
      strategy: 'source-merge',
      protocolCompatible,
      manifestVersion,
      planDigest,
      blocked: blockers.length > 0,
      blockers,
      activity,
      changedPaths,
      conflictedPaths,
    }
  }

  private async discover(repository: string): Promise<readonly HarnessSourceRelease[]> {
    const now = Date.now()
    const cached = this.discovery.get(repository)
    if (cached && cached.expiresAt > now) return cached.promise
    const promise = this.opts.discoverReleases
      ? this.opts.discoverReleases(repository)
      : discoverStableReleases(repository)
    this.discovery.set(repository, { expiresAt: now + DISCOVERY_TTL_MS, promise })
    try {
      return await promise
    } catch (err) {
      this.discovery.delete(repository)
      throw err
    }
  }

  private async recoverWorkspace(workspace: WorkspaceMeta): Promise<void> {
    const path = join(workspace.dir, JOURNAL_REL)
    let journal: SourceUpgradeJournal
    try {
      journal = JSON.parse(await readFile(path, 'utf8')) as SourceUpgradeJournal
    } catch {
      return
    }
    const merging = (await gitExec(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], workspace.dir, gitOptions())).exitCode === 0
    if (merging) {
      await runGit(workspace.dir, ['merge', '--abort'])
      await atomicWriteJson(join(workspace.dir, RECEIPT_REL), journal.fromReceipt)
    }
    await rm(path, { force: true })
  }
}

async function discoverStableReleases(repository: string): Promise<readonly HarnessSourceRelease[]> {
  const result = await gitExec(['ls-remote', '--tags', repository], process.cwd(), gitOptions())
  if (result.exitCode !== 0) throw new Error(`Unable to discover Harness releases: ${String(result.stderr).slice(0, 800)}`)
  const direct = new Map<string, string>()
  const peeled = new Map<string, string>()
  for (const line of String(result.stdout).split(/\r?\n/)) {
    const match = /^([0-9a-f]{40})\s+refs\/tags\/(.+?)(\^\{\})?$/.exec(line.trim())
    if (!match || !match[1] || !match[2] || !STABLE_SEMVER.test(match[2])) continue
    ;(match[3] ? peeled : direct).set(match[2], match[1])
  }
  return sortReleases([...direct].map(([version, commit]) => ({
    version,
    commit: peeled.get(version) ?? commit,
    verified: false,
  })))
}

async function fetchExactRelease(workspaceDir: string, template: TemplateMeta, release: HarnessSourceRelease): Promise<void> {
  if (!template.source) throw new HarnessSourceUpgradeError('unsupported', 'Template has no source catalog.')
  const result = await gitExec(['fetch', '--quiet', '--no-tags', template.source.repository, release.commit], workspaceDir, gitOptions())
  if (result.exitCode !== 0) throw new Error(`Unable to fetch Harness release ${release.version}: ${String(result.stderr).slice(0, 800)}`)
  const resolved = (await runGit(workspaceDir, ['rev-parse', `${release.commit}^{commit}`])).trim().toLowerCase()
  if (resolved !== release.commit.toLowerCase()) throw new Error(`Harness release ${release.version} did not resolve to its immutable commit.`)
}

function sortReleases<T extends { version: string }>(releases: readonly T[]): T[] {
  return [...releases].sort((a, b) => compareVersions(b.version, a.version))
}

function parseChangedPaths(output: string): string[] {
  return output.split(/\r?\n/).filter(Boolean).map((line) => line.split('\t').at(-1) ?? line).sort()
}

function parseMergeTreeConflicts(output: string): string[] {
  const paths = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^CONFLICT \(.+?\): Merge conflict in (.+)$/.exec(line)
    if (match?.[1]) paths.add(match[1])
  }
  return [...paths].sort()
}

function blockerError(plan: HarnessSourceUpgradePlan): HarnessSourceUpgradeError {
  if (plan.blockers.includes('active_runtime')) return new HarnessSourceUpgradeError('busy', 'Stop this Workspace\'s Sessions, headless runs, and Studio before upgrading.', plan)
  if (plan.blockers.includes('working_tree_changes')) return new HarnessSourceUpgradeError('working_tree_changes', 'Commit or discard the Workspace working-tree changes before upgrading.', plan)
  if (plan.blockers.includes('merge_conflicts')) return new HarnessSourceUpgradeError('merge_conflicts', 'This release conflicts with Workspace commits and needs a Coding Agent to reconcile it.', plan)
  return new HarnessSourceUpgradeError('incompatible', 'The target release does not implement the supported harness.json protocol.', plan)
}

function gitOptions(): IGitStringExecutionOptions {
  return { maxBuffer: MAX_GIT_BUFFER, signal: AbortSignal.timeout(GIT_TIMEOUT_MS) }
}

async function runGit(workspaceDir: string, args: readonly string[]): Promise<string> {
  const result = await gitExec([...args], workspaceDir, gitOptions())
  if (result.exitCode !== 0) throw new Error(`git ${args[0] ?? ''} exited ${result.exitCode}: ${String(result.stderr).slice(0, 800)}`)
  return String(result.stdout)
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}
