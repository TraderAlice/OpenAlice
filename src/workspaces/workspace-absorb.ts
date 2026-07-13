import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'

import { exec as gitExec, type IGitStringExecutionOptions } from 'dugite'

import { gitStatus } from './git-service.js'
import type { Logger } from './logger.js'
import type { WorkspaceLifecycleManager } from './workspace-lifecycle.js'
import type { WorkspaceCatalog } from './workspace-catalog.js'
import type { WorkspaceOperationGuard } from './workspace-operation-guard.js'
import type { WorkspaceMeta, WorkspaceRegistry } from './workspace-registry.js'
import type { WorkspaceRuntimeActivity } from './workspace-runtime-activity.js'

const TRANSACTION_ROOT = '.alice/workspace-absorb/transaction'
const JOURNAL_REL = `${TRANSACTION_ROOT}/journal.json`
const BACKUP_REL = `${TRANSACTION_ROOT}/before`
const EXCLUDE_LINE = '/.alice/workspace-absorb/'
const PREVIEW_LIMIT = 8_000
const GIT_TIMEOUT_MS = 20_000
const GIT_MAX_BUFFER = 32 * 1024 * 1024

export type WorkspaceAbsorbFileStatus = 'ready' | 'duplicate' | 'conflict'
export type WorkspaceAbsorbResolution = 'target' | 'source' | 'both'

export interface WorkspaceAbsorbFilePlan {
  readonly path: string
  readonly status: WorkspaceAbsorbFileStatus
  readonly operation: 'add' | 'skip' | 'choose'
  readonly sourcePreview: string | null
  readonly targetPreview: string | null
  readonly sourceTruncated: boolean
  readonly targetTruncated: boolean
  readonly sourceSize: number
  readonly targetSize: number | null
  readonly canUseSource: boolean
  readonly keepBothPath: string
}

export interface WorkspaceAbsorbPlan {
  readonly source: { id: string; tag: string; displayName?: string }
  readonly target: { id: string; tag: string; displayName?: string }
  readonly importRoot: string
  readonly planDigest: string
  readonly blocked: boolean
  readonly blockers: readonly string[]
  readonly activity: {
    readonly source: WorkspaceRuntimeActivity
    readonly target: WorkspaceRuntimeActivity
  }
  readonly sourceInventory: {
    readonly sessions: number
    readonly resumeIds: number
    readonly openIssues: readonly string[]
    readonly scheduledIssues: readonly string[]
    readonly dirtyFiles: number
  }
  readonly files: readonly WorkspaceAbsorbFilePlan[]
  readonly summary: {
    readonly ready: number
    readonly duplicates: number
    readonly conflicts: number
    readonly excluded: number
    readonly bytes: number
  }
}

export interface WorkspaceAbsorbResult {
  readonly sourceWorkspaceId: string
  readonly targetWorkspaceId: string
  readonly commit: string
  readonly changedPaths: readonly string[]
  readonly skippedPaths: readonly string[]
  readonly departedDir: string
}

export class WorkspaceAbsorbError extends Error {
  constructor(
    public readonly code:
      | 'not_found'
      | 'same_workspace'
      | 'busy'
      | 'staged_changes'
      | 'stale_plan'
      | 'unresolved_conflict'
      | 'invalid_resolution'
      | 'offboard_failed',
    message: string,
    public readonly plan?: WorkspaceAbsorbPlan,
  ) {
    super(message)
    this.name = 'WorkspaceAbsorbError'
  }
}

interface WorkspaceAbsorbManagerDeps {
  readonly registry: WorkspaceRegistry
  readonly catalog: WorkspaceCatalog
  readonly lifecycle: WorkspaceLifecycleManager
  readonly operationGuard: WorkspaceOperationGuard
  readonly workspaceRuntimeActivity: (workspaceId: string) => WorkspaceRuntimeActivity
  readonly logger: Logger
}

interface FileSnapshot {
  readonly path: string
  readonly fingerprint: string
  readonly size: number
  readonly preview: string | null
  readonly truncated: boolean
}

interface AbsorbJournal {
  readonly version: 1
  readonly sourceWorkspaceId: string
  readonly targetWorkspaceId: string
  readonly targetHead: string
  readonly planDigest: string
  readonly touchedPaths: readonly { path: string; existed: boolean }[]
  readonly preparedAt: string
}

/** Directional source -> target consolidation with an intact departed source. */
export class WorkspaceAbsorbManager {
  constructor(private readonly deps: WorkspaceAbsorbManagerDeps) {}

  async recover(): Promise<void> {
    for (const target of this.deps.registry.list()) {
      if (!existsSync(join(target.dir, JOURNAL_REL))) continue
      await this.recoverTarget(target).catch((error) =>
        this.deps.logger.error('workspace_absorb.recovery_failed', {
          targetWorkspaceId: target.id,
          error,
        }),
      )
    }
  }

  async plan(targetWorkspaceId: string, sourceWorkspaceId: string): Promise<WorkspaceAbsorbPlan> {
    this.assertDirection(targetWorkspaceId, sourceWorkspaceId)
    const lease = await this.deps.operationGuard.acquireManyWhenAvailable(
      [sourceWorkspaceId, targetWorkspaceId],
      'workspace-absorb-preview',
    )
    try {
      return await this.buildPlan(targetWorkspaceId, sourceWorkspaceId)
    } finally {
      lease.release()
    }
  }

  async apply(input: {
    readonly targetWorkspaceId: string
    readonly sourceWorkspaceId: string
    readonly planDigest: string
    readonly resolutions?: Readonly<Record<string, WorkspaceAbsorbResolution>>
  }): Promise<WorkspaceAbsorbResult> {
    this.assertDirection(input.targetWorkspaceId, input.sourceWorkspaceId)
    const lease = this.deps.operationGuard.acquireMany(
      [input.sourceWorkspaceId, input.targetWorkspaceId],
      'workspace-absorb',
    )
    if (!lease) {
      throw new WorkspaceAbsorbError('busy', 'One of these Workspaces is busy with another directory operation.')
    }
    try {
      return await this.applyLocked(input)
    } finally {
      lease.release()
    }
  }

  private async applyLocked(input: {
    readonly targetWorkspaceId: string
    readonly sourceWorkspaceId: string
    readonly planDigest: string
    readonly resolutions?: Readonly<Record<string, WorkspaceAbsorbResolution>>
  }): Promise<WorkspaceAbsorbResult> {
    const plan = await this.buildPlan(input.targetWorkspaceId, input.sourceWorkspaceId)
    if (plan.blocked) {
      const code = plan.blockers.includes('target_staged_changes') ? 'staged_changes' : 'busy'
      throw new WorkspaceAbsorbError(code, blockerMessage(plan), plan)
    }
    if (plan.planDigest !== input.planDigest) {
      throw new WorkspaceAbsorbError(
        'stale_plan',
        'One of the Workspaces changed after preview. Review the refreshed plan before absorbing.',
        plan,
      )
    }

    const resolutions = input.resolutions ?? {}
    const transfers: { sourcePath: string; targetPath: string }[] = []
    const skippedPaths: string[] = []
    for (const file of plan.files) {
      if (file.status === 'duplicate') {
        skippedPaths.push(file.path)
        continue
      }
      if (file.status === 'ready') {
        transfers.push({ sourcePath: file.path, targetPath: file.path })
        continue
      }
      const resolution = resolutions[file.path]
      if (!resolution) {
        throw new WorkspaceAbsorbError(
          'unresolved_conflict',
          `Choose what to do with ${file.path} before absorbing.`,
          plan,
        )
      }
      if (resolution === 'target') {
        skippedPaths.push(file.path)
      } else if (resolution === 'source') {
        if (!file.canUseSource) {
          throw new WorkspaceAbsorbError(
            'invalid_resolution',
            `${file.path} cannot safely replace the target path. Keep the target or keep both.`,
            plan,
          )
        }
        transfers.push({ sourcePath: file.path, targetPath: file.path })
      } else {
        transfers.push({ sourcePath: file.path, targetPath: file.keepBothPath })
      }
    }

    const target = this.requireActive(input.targetWorkspaceId)
    const targetHead = (await runGit(target.dir, ['rev-parse', 'HEAD'])).trim()
    const touchedPaths = [...new Set(transfers.map((entry) => entry.targetPath))].sort()
    await prepareTransaction(target.dir, {
      version: 1,
      sourceWorkspaceId: input.sourceWorkspaceId,
      targetWorkspaceId: input.targetWorkspaceId,
      targetHead,
      planDigest: plan.planDigest,
      touchedPaths: await backupTargetPaths(target.dir, touchedPaths),
      preparedAt: new Date().toISOString(),
    })

    try {
      const offboarded = await this.deps.lifecycle.offboardWithinOperation({
        id: input.sourceWorkspaceId,
        reason: `Absorbed into ${plan.target.tag}`,
        notes: `User files were reviewed and copied by Workspace Absorb plan ${plan.planDigest}.`,
      })
      if (!offboarded.ok || !offboarded.workspace.departedDir) {
        throw new WorkspaceAbsorbError(
          'offboard_failed',
          offboarded.ok ? 'Source Workspace archive path is missing.' : offboarded.message,
          plan,
        )
      }
      const sourceDir = offboarded.workspace.departedDir
      for (const transfer of transfers) {
        const from = safeJoin(sourceDir, transfer.sourcePath)
        const to = safeJoin(target.dir, transfer.targetPath)
        await mkdir(dirname(to), { recursive: true })
        await cp(from, to, { force: true, errorOnExist: false })
      }

      for (let offset = 0; offset < touchedPaths.length; offset += 200) {
        await runGit(target.dir, ['add', '-A', '--', ...touchedPaths.slice(offset, offset + 200)])
      }
      const message = [
        `workspace: absorb ${plan.source.tag} into ${plan.target.tag}`,
        '',
        `OpenAlice-Absorb-Source: ${plan.source.id}`,
        `OpenAlice-Absorb-Plan: ${plan.planDigest}`,
      ].join('\n')
      await runGit(target.dir, [
        '-c', 'user.email=launcher@local',
        '-c', 'user.name=OpenAlice',
        'commit', '--allow-empty', '-q', '-m', message,
      ])
      const commit = (await runGit(target.dir, ['rev-parse', 'HEAD'])).trim()
      await this.deps.catalog.markAbsorbed({
        id: input.sourceWorkspaceId,
        targetWorkspaceId: input.targetWorkspaceId,
        commit,
      })
      await rm(join(target.dir, TRANSACTION_ROOT), { recursive: true, force: true })
      this.deps.logger.info('workspace_absorb.applied', {
        sourceWorkspaceId: input.sourceWorkspaceId,
        targetWorkspaceId: input.targetWorkspaceId,
        commit,
        changedPaths: touchedPaths,
        skippedPaths,
      })
      return {
        sourceWorkspaceId: input.sourceWorkspaceId,
        targetWorkspaceId: input.targetWorkspaceId,
        commit,
        changedPaths: touchedPaths,
        skippedPaths,
        departedDir: sourceDir,
      }
    } catch (error) {
      await restoreTargetTransaction(target.dir).catch((recoveryError) =>
        this.deps.logger.error('workspace_absorb.target_rollback_failed', { error: recoveryError }),
      )
      // Offboarding can fail after the directory move but before returning.
      // The durable Catalog, not a local boolean, is authoritative here.
      if (this.deps.catalog.get(input.sourceWorkspaceId)?.lifecycle === 'departed') {
        await this.deps.lifecycle.restore(input.sourceWorkspaceId).catch((recoveryError) =>
          this.deps.logger.error('workspace_absorb.source_restore_failed', { error: recoveryError }),
        )
      }
      throw error
    }
  }

  private async buildPlan(
    targetWorkspaceId: string,
    sourceWorkspaceId: string,
  ): Promise<WorkspaceAbsorbPlan> {
    this.assertDirection(targetWorkspaceId, sourceWorkspaceId)
    const target = this.requireActive(targetWorkspaceId)
    const source = this.requireActive(sourceWorkspaceId)
    const [sourceFiles, sourceAssessment, targetGit] = await Promise.all([
      listSourceFiles(source.dir),
      this.deps.lifecycle.assess(source.id),
      gitStatus(target.dir),
    ])
    if (!sourceAssessment) throw new WorkspaceAbsorbError('not_found', 'Source Workspace is not active.')

    const importRoot = await chooseImportRoot(target.dir, source)
    let excluded = sourceFiles.excluded
    const files: WorkspaceAbsorbFilePlan[] = []
    const targetFingerprints = new Map<string, string | null>()
    for (const path of sourceFiles.paths) {
      const sourceSnapshot = await readRegularFile(source.dir, path)
      if (!sourceSnapshot) {
        excluded += 1
        continue
      }
      const targetSnapshot = await readAnyPath(target.dir, path)
      targetFingerprints.set(
        path,
        targetSnapshot?.kind === 'file' ? targetSnapshot.file.fingerprint : targetSnapshot?.kind ?? null,
      )
      const keepBothPath = `${importRoot}/${path}`
      if (!targetSnapshot) {
        files.push(filePlan(path, 'ready', sourceSnapshot, null, keepBothPath, true))
      } else if (targetSnapshot.kind === 'file' && targetSnapshot.file.fingerprint === sourceSnapshot.fingerprint) {
        files.push(filePlan(path, 'duplicate', sourceSnapshot, targetSnapshot.file, keepBothPath, true))
      } else {
        files.push(filePlan(
          path,
          'conflict',
          sourceSnapshot,
          targetSnapshot.kind === 'file' ? targetSnapshot.file : null,
          keepBothPath,
          targetSnapshot.kind === 'file',
        ))
      }
    }

    const sourceActivity = this.deps.workspaceRuntimeActivity(source.id)
    const targetActivity = this.deps.workspaceRuntimeActivity(target.id)
    const targetStaged = targetGit.files.some((file) => file.status[0] !== ' ' && file.status[0] !== '?')
    const blockers = [
      ...(sourceActivity.busy ? ['source_active_sessions'] : []),
      ...(targetActivity.busy ? ['target_active_sessions'] : []),
      ...(targetStaged ? ['target_staged_changes'] : []),
    ]
    const digestInput = {
      source: source.id,
      target: target.id,
      importRoot,
      files: files.map((file) => ({
        path: file.path,
        status: file.status,
        source: sourceFiles.fingerprints.get(file.path),
        target: targetFingerprints.get(file.path) ?? null,
      })),
    }
    return {
      source: { id: source.id, tag: source.tag },
      target: { id: target.id, tag: target.tag },
      importRoot,
      planDigest: createHash('sha256').update(JSON.stringify(digestInput)).digest('hex'),
      blocked: blockers.length > 0,
      blockers,
      activity: { source: sourceActivity, target: targetActivity },
      sourceInventory: {
        sessions: sourceAssessment.sessionRecords,
        resumeIds: sourceAssessment.resumeIds.length,
        openIssues: sourceAssessment.openIssueIds,
        scheduledIssues: sourceAssessment.scheduledIssueIds,
        dirtyFiles: sourceAssessment.git?.files.length ?? 0,
      },
      files,
      summary: {
        ready: files.filter((file) => file.status === 'ready').length,
        duplicates: files.filter((file) => file.status === 'duplicate').length,
        conflicts: files.filter((file) => file.status === 'conflict').length,
        excluded,
        bytes: files.reduce((sum, file) => sum + file.sourceSize, 0),
      },
    }
  }

  private assertDirection(targetWorkspaceId: string, sourceWorkspaceId: string): void {
    if (targetWorkspaceId === sourceWorkspaceId) {
      throw new WorkspaceAbsorbError('same_workspace', 'A Workspace cannot absorb itself.')
    }
  }

  private requireActive(id: string): WorkspaceMeta {
    const workspace = this.deps.registry.get(id)
    if (!workspace || this.deps.catalog.get(id)?.lifecycle !== 'active') {
      throw new WorkspaceAbsorbError('not_found', `Workspace is not active: ${id}`)
    }
    return workspace
  }

  private async recoverTarget(target: WorkspaceMeta): Promise<void> {
    const journal = await readJournal(target.dir)
    const source = this.deps.catalog.get(journal.sourceWorkspaceId)
    const history = await absorbCommitsSince(target.dir, journal)
    const committed = history.at(0)
    if (committed && source?.lifecycle === 'departed') {
      await this.deps.catalog.markAbsorbed({
        id: journal.sourceWorkspaceId,
        targetWorkspaceId: journal.targetWorkspaceId,
        commit: committed,
      })
      await rm(join(target.dir, TRANSACTION_ROOT), { recursive: true, force: true })
      return
    }
    await restoreTargetTransaction(target.dir)
    const currentSource = this.deps.catalog.get(journal.sourceWorkspaceId)
    if (currentSource?.lifecycle === 'departed') await this.deps.lifecycle.restore(journal.sourceWorkspaceId)
  }
}

function filePlan(
  path: string,
  status: WorkspaceAbsorbFileStatus,
  source: FileSnapshot,
  target: FileSnapshot | null,
  keepBothPath: string,
  canUseSource: boolean,
): WorkspaceAbsorbFilePlan {
  return {
    path,
    status,
    operation: status === 'ready' ? 'add' : status === 'duplicate' ? 'skip' : 'choose',
    sourcePreview: source.preview,
    targetPreview: target?.preview ?? null,
    sourceTruncated: source.truncated,
    targetTruncated: target?.truncated ?? false,
    sourceSize: source.size,
    targetSize: target?.size ?? null,
    canUseSource,
    keepBothPath,
  }
}

async function listSourceFiles(dir: string): Promise<{
  paths: string[]
  excluded: number
  fingerprints: Map<string, string>
}> {
  const output = await runGit(dir, ['ls-files', '-co', '--exclude-standard', '-z'])
  const all = [...new Set(output.split('\0').filter(Boolean))].sort()
  const paths = all.filter(isTransferablePath)
  const fingerprints = new Map<string, string>()
  for (const path of paths) {
    const snapshot = await readRegularFile(dir, path)
    if (snapshot) fingerprints.set(path, snapshot.fingerprint)
  }
  return { paths, excluded: all.length - paths.length, fingerprints }
}

function isTransferablePath(path: string): boolean {
  if (!isSafeRelativePath(path)) return false
  const rootFiles = new Set([
    'README.md', 'AGENTS.md', 'CLAUDE.md', '.gitignore', '.gitattributes',
    'opencode.json',
  ])
  if (rootFiles.has(path)) return false
  if (path === '.env' || path.startsWith('.env.')) return false
  const blockedRoots = [
    '.git/', '.alice/', '.agents/', '.claude/', '.pi/', '.codex/', '.pi-agent/',
    'node_modules/', 'dist/', 'build/', '.next/', '.turbo/', 'coverage/',
  ]
  return !blockedRoots.some((root) => path.startsWith(root))
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.includes('\0') || path.startsWith('/') || path.startsWith('\\')) return false
  // Git always reports slash-separated paths, including on Windows. Using the
  // host path normalizer here would turn every valid Windows checkout path
  // into backslashes and make Absorb appear empty.
  const normalized = posix.normalize(path)
  return normalized === path && normalized !== '..' && !normalized.startsWith('../')
}

function safeJoin(root: string, path: string): string {
  if (!isSafeRelativePath(path)) throw new Error(`unsafe Workspace path: ${path}`)
  return join(root, ...path.split('/'))
}

async function readRegularFile(root: string, path: string): Promise<FileSnapshot | null> {
  if (await hasUnsafeAncestor(root, path)) return null
  const absolute = safeJoin(root, path)
  try {
    const stats = await lstat(absolute)
    if (!stats.isFile()) return null
    const bytes = await readFile(absolute)
    const preview = textPreview(bytes)
    return {
      path,
      fingerprint: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      preview: preview.text,
      truncated: preview.truncated,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function readAnyPath(root: string, path: string): Promise<
  | { kind: 'file'; file: FileSnapshot }
  | { kind: 'other' }
  | null
> {
  if (await hasUnsafeAncestor(root, path)) return { kind: 'other' }
  const absolute = safeJoin(root, path)
  try {
    const stats = await lstat(absolute)
    if (!stats.isFile()) return { kind: 'other' }
    return { kind: 'file', file: (await readRegularFile(root, path))! }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    // A target ancestor is a file. This is a real path collision, not a free
    // destination; the planner will allow only keep-target or keep-both.
    if (code === 'ENOTDIR') return { kind: 'other' }
    throw error
  }
}

function textPreview(bytes: Buffer): { text: string | null; truncated: boolean } {
  if (bytes.includes(0)) return { text: null, truncated: false }
  const text = bytes.toString('utf8')
  if (text.includes('\uFFFD')) return { text: null, truncated: false }
  return { text: text.slice(0, PREVIEW_LIMIT), truncated: text.length > PREVIEW_LIMIT }
}

async function chooseImportRoot(targetDir: string, source: WorkspaceMeta): Promise<string> {
  const safeTag = source.tag.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace'
  const nestedBase = `imports/${safeTag}-${source.id.slice(-6)}`
  const base = await hasUnsafeAncestor(targetDir, nestedBase)
    ? `imported-${safeTag}-${source.id.slice(-6)}`
    : nestedBase
  let candidate = base
  for (let suffix = 2; existsSync(join(targetDir, candidate)); suffix += 1) candidate = `${base}-${suffix}`
  return candidate
}

async function hasUnsafeAncestor(root: string, path: string): Promise<boolean> {
  const parts = path.split('/')
  let current = root
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    try {
      const stats = await lstat(current)
      if (stats.isSymbolicLink() || !stats.isDirectory()) return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  return false
}

async function prepareTransaction(targetDir: string, journal: AbsorbJournal): Promise<void> {
  await ensureStateExcluded(targetDir)
  await mkdir(join(targetDir, TRANSACTION_ROOT), { recursive: true })
  await atomicWriteJson(join(targetDir, JOURNAL_REL), journal)
}

async function backupTargetPaths(
  targetDir: string,
  paths: readonly string[],
): Promise<{ path: string; existed: boolean }[]> {
  const out: { path: string; existed: boolean }[] = []
  for (const path of paths) {
    const absolute = safeJoin(targetDir, path)
    const existed = existsSync(absolute)
    out.push({ path, existed })
    if (!existed) continue
    const backup = safeJoin(join(targetDir, BACKUP_REL), path)
    await mkdir(dirname(backup), { recursive: true })
    await cp(absolute, backup, { recursive: true, force: true })
  }
  return out
}

async function restoreTargetTransaction(targetDir: string): Promise<void> {
  const journal = await readJournal(targetDir)
  const head = (await runGit(targetDir, ['rev-parse', 'HEAD'])).trim()
  if (head !== journal.targetHead) {
    const absorbCommits = await absorbCommitsSince(targetDir, journal)
    if (absorbCommits[0] !== head) {
      throw new Error('Workspace changed outside the unfinished Absorb transaction; automatic rollback stopped safely.')
    }
    await runGit(targetDir, ['reset', '--mixed', journal.targetHead])
  }
  for (const entry of journal.touchedPaths) {
    const target = safeJoin(targetDir, entry.path)
    if (!entry.existed) {
      await rm(target, { recursive: true, force: true })
      continue
    }
    const backup = safeJoin(join(targetDir, BACKUP_REL), entry.path)
    await rm(target, { recursive: true, force: true })
    await mkdir(dirname(target), { recursive: true })
    await cp(backup, target, { recursive: true, force: true })
  }
  await rm(join(targetDir, TRANSACTION_ROOT), { recursive: true, force: true })
}

async function absorbCommitsSince(targetDir: string, journal: AbsorbJournal): Promise<string[]> {
  const output = await runGit(targetDir, [
    'log', `${journal.targetHead}..HEAD`, '--format=%H%x00%B%x00', '--max-count=50',
  ])
  const fields = output.split('\0')
  const commits: string[] = []
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const hash = fields[index]?.trim()
    const message = fields[index + 1] ?? ''
    if (hash && message.includes(`OpenAlice-Absorb-Plan: ${journal.planDigest}`)) commits.push(hash)
  }
  return commits
}

async function readJournal(targetDir: string): Promise<AbsorbJournal> {
  const parsed = JSON.parse(await readFile(join(targetDir, JOURNAL_REL), 'utf8')) as AbsorbJournal
  if (parsed.version !== 1 || parsed.targetWorkspaceId.length === 0 || parsed.sourceWorkspaceId.length === 0) {
    throw new Error('Workspace Absorb journal has an unsupported shape')
  }
  return parsed
}

async function ensureStateExcluded(workspaceDir: string): Promise<void> {
  const path = join(workspaceDir, '.git', 'info', 'exclude')
  let current = ''
  try {
    current = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (current.split(/\r?\n/).includes(EXCLUDE_LINE)) return
  await mkdir(dirname(path), { recursive: true })
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  await writeFile(path, `${current}${prefix}${EXCLUDE_LINE}\n`, 'utf8')
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2), 'utf8')
  await rename(temp, path)
}

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  const options: IGitStringExecutionOptions = {
    maxBuffer: GIT_MAX_BUFFER,
    signal: AbortSignal.timeout(GIT_TIMEOUT_MS),
  }
  const result = await gitExec([...args], cwd, options)
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0] ?? ''} exited ${result.exitCode}: ${String(result.stderr).slice(0, 500)}`)
  }
  return String(result.stdout)
}

function blockerMessage(plan: WorkspaceAbsorbPlan): string {
  const messages = [
    ...(plan.blockers.includes('source_active_sessions') ? ['The source Workspace still has live work.'] : []),
    ...(plan.blockers.includes('target_active_sessions') ? ['The target Workspace still has live work.'] : []),
    ...(plan.blockers.includes('target_staged_changes') ? ['The target Workspace has staged Git changes.'] : []),
  ]
  return messages.join(' ')
}
