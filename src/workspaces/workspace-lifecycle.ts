import { existsSync } from 'node:fs'
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { gitStatus, type GitStatus } from './git-service.js'
import type { HeadlessTaskRecord, HeadlessTaskRegistry } from './headless-task-registry.js'
import { isTerminalStatus, readWorkspaceIssues } from './issues/declaration.js'
import type { Logger } from './logger.js'
import type { ResumeRegistry } from './resume-registry.js'
import type { ScrollbackStore } from './scrollback-store.js'
import type { SessionPool } from './session-pool.js'
import type { SessionRecord, SessionRegistry } from './session-registry.js'
import {
  catalogRecordToMeta,
  type WorkspaceCatalog,
  type WorkspaceCatalogRecord,
  type WorkspaceHandoffSnapshot,
} from './workspace-catalog.js'
import type { WorkspaceMeta, WorkspaceRegistry } from './workspace-registry.js'

export interface WorkspaceOffboardingAssessment {
  workspace: { id: string; tag: string; dir: string }
  canOffboard: boolean
  blockers: readonly string[]
  runningHeadless: readonly { taskId: string; resumeId: string; agent: string }[]
  untrackedHeadlessActive: boolean
  runningSessions: number
  sessionRecords: number
  resumeIds: readonly string[]
  openIssueIds: readonly string[]
  scheduledIssueIds: readonly string[]
  git: GitStatus | null
}

export type WorkspaceOffboardingResult =
  | { ok: true; workspace: WorkspaceCatalogRecord; assessment: WorkspaceOffboardingAssessment }
  | { ok: false; code: 'not_found' | 'already_purged' | 'blocked' | 'conflict'; message: string; assessment?: WorkspaceOffboardingAssessment }

export interface WorkspaceLifecycleManagerDeps {
  launcherRoot: string
  registry: WorkspaceRegistry
  catalog: WorkspaceCatalog
  resumeRegistry: ResumeRegistry
  sessionRegistry: SessionRegistry
  scrollbackStore: ScrollbackStore
  headlessTasks: HeadlessTaskRegistry
  pool: SessionPool
  /** Includes synchronous wait:true/probe-style runs not yet in HeadlessTaskRegistry. */
  isWorkspaceHeadlessActive?: (workspaceId: string) => boolean
  logger: Logger
}

/**
 * Moves Workspaces between the active desk floor and the departed archive.
 * Catalog transition states are written before filesystem/registry mutations,
 * so `recover()` can finish an interrupted move on the next launch.
 */
export class WorkspaceLifecycleManager {
  private readonly departedRoot: string

  constructor(private readonly deps: WorkspaceLifecycleManagerDeps) {
    this.departedRoot = join(deps.launcherRoot, 'departed-workspaces')
  }

  isActive(id: string): boolean {
    return this.deps.catalog.get(id)?.lifecycle === 'active'
  }

  listDeparted(): WorkspaceCatalogRecord[] {
    return this.deps.catalog.list({ lifecycle: ['offboarding', 'departed', 'restoring', 'purging', 'purged'] })
  }

  async assess(id: string): Promise<WorkspaceOffboardingAssessment | null> {
    const meta = this.deps.registry.get(id)
    if (!meta) return null
    await this.deps.sessionRegistry.ensureLoaded(id)
    const sessions = this.deps.sessionRegistry.listFor(id)
    const resumes = this.deps.resumeRegistry.list({ wsId: id })
    const running = this.runningHeadlessFor(id)
    const untrackedHeadlessActive = Boolean(this.deps.isWorkspaceHeadlessActive?.(id)) && running.length === 0
    const issues = await readWorkspaceIssues(meta.dir).catch(() => null)
    const openIssueIds = issues?.ok
      ? issues.issues.filter((issue) => !isTerminalStatus(issue.status)).map((issue) => issue.id)
      : []
    const scheduledIssueIds = issues?.ok
      ? issues.issues.filter((issue) => issue.when && !isTerminalStatus(issue.status)).map((issue) => issue.id)
      : []
    const git = await gitStatus(meta.dir).catch(() => null)
    const blockers = [
      ...(running.length > 0
        ? [`${running.length} headless run${running.length === 1 ? ' is' : 's are'} still active`]
        : []),
      ...(untrackedHeadlessActive ? ['a synchronous headless run is still active'] : []),
    ]
    return {
      workspace: { id: meta.id, tag: meta.tag, dir: meta.dir },
      canOffboard: blockers.length === 0,
      blockers,
      runningHeadless: running.map((task) => ({ taskId: task.taskId, resumeId: task.resumeId, agent: task.agent })),
      untrackedHeadlessActive,
      runningSessions: sessions.filter((session) => session.state === 'running').length,
      sessionRecords: sessions.length,
      resumeIds: resumes.map((resume) => resume.resumeId),
      openIssueIds,
      scheduledIssueIds,
      git,
    }
  }

  async offboard(input: {
    id: string
    reason?: string
    notes?: string
    successors?: Readonly<Record<string, string>>
  }): Promise<WorkspaceOffboardingResult> {
    const existing = this.deps.catalog.get(input.id)
    if (existing?.lifecycle === 'purged') {
      return { ok: false, code: 'already_purged', message: 'workspace files were already purged' }
    }
    if (existing?.lifecycle === 'departed') {
      return { ok: true, workspace: existing, assessment: await this.assessmentFromRecord(existing) }
    }
    const meta = this.deps.registry.get(input.id)
    if (!meta) return { ok: false, code: 'not_found', message: 'workspace is not active' }
    const assessment = await this.assess(input.id)
    if (!assessment) return { ok: false, code: 'not_found', message: 'workspace is not active' }
    if (!assessment.canOffboard) {
      return { ok: false, code: 'blocked', message: assessment.blockers.join('; '), assessment }
    }
    const successorError = this.validateSuccessors(input.id, input.successors)
    if (successorError) return { ok: false, code: 'conflict', message: successorError, assessment }

    const reason = input.reason?.trim() || 'Offboarded by the user'
    const preparedAt = new Date().toISOString()
    const handoff: WorkspaceHandoffSnapshot = {
      preparedAt,
      reason,
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      dirtyFiles: assessment.git?.files.map((file) => `${file.status} ${file.path}`) ?? [],
      openIssueIds: assessment.openIssueIds,
      scheduledIssueIds: assessment.scheduledIssueIds,
      resumeIds: assessment.resumeIds,
      ...(input.successors ? { successors: { ...input.successors } } : {}),
      sessionRecords: assessment.sessionRecords,
    }
    const departedDir = join(this.departedRoot, meta.id)
    if (existsSync(departedDir)) {
      return { ok: false, code: 'conflict', message: `departed directory already exists: ${departedDir}`, assessment }
    }

    await this.deps.catalog.beginOffboarding({ meta, departedDir, reason, handoff })
    // Close the dispatch race after the transition becomes visible. No runtime
    // may start work for a non-active Catalog row.
    const lateRuns = this.runningHeadlessFor(meta.id)
    const lateHeadlessActive = Boolean(this.deps.isWorkspaceHeadlessActive?.(meta.id))
    if (lateRuns.length > 0 || lateHeadlessActive) {
      await this.deps.catalog.cancelOffboarding(meta.id)
      const lateAssessment = await this.assess(meta.id)
      return {
        ok: false,
        code: 'blocked',
        message: 'a headless run started while offboarding was prepared; retry after it finishes',
        ...(lateAssessment ? { assessment: lateAssessment } : {}),
      }
    }

    try {
      // Prepare the handoff while the checkout is still at its active path. A
      // write failure cancels the transition instead of archiving a desk with
      // no handoff artifact.
      await this.writeHandoffFiles(meta, handoff)
    } catch (err) {
      await this.deps.catalog.cancelOffboarding(meta.id)
      throw err
    }

    try {
      // Registry removal is the logical door lock. From here onward ordinary
      // routes, issue scans, and the outer manager's active directory converge.
      await this.deps.registry.remove(meta.id)
      await this.pauseWorkspaceSessions(meta.id)
      await mkdir(this.departedRoot, { recursive: true })
      await moveDirectory(meta.dir, departedDir)
      await this.deps.resumeRegistry.retireWorkspace(meta.id, {
        reason,
        ...(input.successors ? { successors: input.successors } : {}),
      })
      const record = await this.deps.catalog.markDeparted(meta.id, preparedAt)
      this.deps.logger.info('workspace.offboarded', {
        id: meta.id,
        tag: meta.tag,
        departedDir,
        sessions: assessment.sessionRecords,
        resumes: assessment.resumeIds.length,
        openIssues: assessment.openIssueIds.length,
      })
      return { ok: true, workspace: record, assessment }
    } catch (err) {
      this.deps.logger.error('workspace.offboard_failed', { id: meta.id, err })
      await this.recoverRecord(this.deps.catalog.get(meta.id)).catch((recoveryErr) =>
        this.deps.logger.error('workspace.offboard_recovery_failed', { id: meta.id, err: recoveryErr }),
      )
      throw err
    }
  }

  async restore(id: string): Promise<WorkspaceOffboardingResult> {
    const record = this.deps.catalog.get(id)
    if (!record) return { ok: false, code: 'not_found', message: 'workspace is not in the catalog' }
    if (record.lifecycle === 'active') {
      const assessment = await this.assess(id)
      return assessment
        ? { ok: true, workspace: record, assessment }
        : { ok: false, code: 'conflict', message: 'catalog is active but registry is missing' }
    }
    if (record.lifecycle === 'purged' || record.lifecycle === 'purging') {
      return { ok: false, code: 'already_purged', message: 'purged workspace files cannot be restored' }
    }
    if (!record.departedDir || !existsSync(record.departedDir)) {
      return { ok: false, code: 'conflict', message: 'departed workspace directory is missing' }
    }
    if (existsSync(record.activeDir)) {
      return { ok: false, code: 'conflict', message: `active directory already exists: ${record.activeDir}` }
    }
    if (this.deps.registry.hasTag(record.tag)) {
      return { ok: false, code: 'conflict', message: `workspace tag is already in use: ${record.tag}` }
    }
    await this.deps.catalog.beginRestoring(id)
    try {
      await mkdir(dirname(record.activeDir), { recursive: true })
      await moveDirectory(record.departedDir, record.activeDir)
      await this.deps.registry.add(catalogRecordToMeta(record))
      await this.deps.resumeRegistry.recallWorkspace(id)
      const active = await this.deps.catalog.markActive(id)
      const assessment = await this.assess(id)
      if (!assessment) throw new Error('restored workspace did not re-enter the active registry')
      this.deps.logger.info('workspace.restored', { id, dir: record.activeDir })
      return { ok: true, workspace: active, assessment }
    } catch (err) {
      this.deps.logger.error('workspace.restore_failed', { id, err })
      await this.recoverRecord(this.deps.catalog.get(id)).catch(() => undefined)
      throw err
    }
  }

  async purge(id: string): Promise<WorkspaceOffboardingResult> {
    const record = this.deps.catalog.get(id)
    if (!record) return { ok: false, code: 'not_found', message: 'workspace is not in the catalog' }
    if (record.lifecycle === 'active' || record.lifecycle === 'offboarding' || record.lifecycle === 'restoring') {
      return { ok: false, code: 'conflict', message: 'offboard the workspace before purging it' }
    }
    if (record.lifecycle === 'purged') {
      return { ok: false, code: 'already_purged', message: 'workspace files were already purged' }
    }
    await this.deps.catalog.beginPurging(id)
    if (record.departedDir) await rm(record.departedDir, { recursive: true, force: true })
    await this.deps.sessionRegistry.removeAllFor(id)
    await this.deps.scrollbackStore.removeAllFor(id)
    const purged = await this.deps.catalog.markPurged(id)
    this.deps.logger.info('workspace.purged', { id, departedDir: record.departedDir ?? null })
    return { ok: true, workspace: purged, assessment: await this.assessmentFromRecord(purged) }
  }

  async recover(): Promise<void> {
    for (const record of this.deps.catalog.list({ lifecycle: ['offboarding', 'restoring', 'purging'] })) {
      await this.recoverRecord(record).catch((err) =>
        this.deps.logger.error('workspace.lifecycle_recovery_failed', { id: record.id, lifecycle: record.lifecycle, err }),
      )
    }
  }

  private async recoverRecord(record: WorkspaceCatalogRecord | null): Promise<void> {
    if (!record) return
    if (record.lifecycle === 'offboarding') {
      await this.deps.registry.remove(record.id)
      await this.pauseWorkspaceSessions(record.id)
      if (record.handoff && existsSync(record.activeDir)) {
        await this.writeHandoffFiles(catalogRecordToMeta(record), record.handoff)
      }
      if (record.departedDir && existsSync(record.activeDir) && !existsSync(record.departedDir)) {
        await mkdir(dirname(record.departedDir), { recursive: true })
        await moveDirectory(record.activeDir, record.departedDir)
      } else if (record.departedDir && existsSync(record.activeDir) && existsSync(record.departedDir)) {
        // Cross-device fallback completed its destination copy before a crash
        // but did not remove the source. The Catalog transition proves the
        // destination belongs to this move, so finish the source cleanup.
        await rm(record.activeDir, { recursive: true, force: true })
      }
      if (!record.departedDir || !existsSync(record.departedDir)) {
        throw new Error('cannot finish offboarding: neither active nor departed directory is available')
      }
      await this.deps.resumeRegistry.retireWorkspace(record.id, {
        reason: record.reason ?? 'Offboarded',
        ...(record.handoff?.successors ? { successors: record.handoff.successors } : {}),
      })
      await this.deps.catalog.markDeparted(record.id)
      return
    }
    if (record.lifecycle === 'restoring') {
      if (!existsSync(record.activeDir) && record.departedDir && existsSync(record.departedDir)) {
        await mkdir(dirname(record.activeDir), { recursive: true })
        await moveDirectory(record.departedDir, record.activeDir)
      } else if (existsSync(record.activeDir) && record.departedDir && existsSync(record.departedDir)) {
        await rm(record.departedDir, { recursive: true, force: true })
      }
      if (!existsSync(record.activeDir)) throw new Error('cannot finish restore: workspace directory is missing')
      if (!this.deps.registry.hasId(record.id)) await this.deps.registry.add(catalogRecordToMeta(record))
      await this.deps.resumeRegistry.recallWorkspace(record.id)
      await this.deps.catalog.markActive(record.id)
      return
    }
    if (record.lifecycle === 'purging') {
      if (record.departedDir) await rm(record.departedDir, { recursive: true, force: true })
      await this.deps.sessionRegistry.removeAllFor(record.id)
      await this.deps.scrollbackStore.removeAllFor(record.id)
      await this.deps.catalog.markPurged(record.id)
    }
  }

  private runningHeadlessFor(id: string): HeadlessTaskRecord[] {
    return this.deps.headlessTasks.list({ status: 'running' }).filter((task) =>
      task.wsId === id || (task.trigger?.kind === 'issue' && task.trigger.workspaceId === id),
    )
  }

  private validateSuccessors(
    workspaceId: string,
    successors: Readonly<Record<string, string>> | undefined,
  ): string | null {
    if (!successors) return null
    for (const [retiringId, successorId] of Object.entries(successors)) {
      const retiring = this.deps.resumeRegistry.get(retiringId)
      if (!retiring || retiring.wsId !== workspaceId) return `retiring Session does not belong to this workspace: ${retiringId}`
      if (retiringId === successorId) return `a Session cannot succeed itself: ${retiringId}`
      const successor = this.deps.resumeRegistry.get(successorId)
      if (!successor || successor.lifecycle === 'retired' || !successor.agentSessionId) {
        return `successor Session is not active and resumable: ${successorId}`
      }
    }
    return null
  }

  private async pauseWorkspaceSessions(wsId: string): Promise<void> {
    await this.deps.sessionRegistry.ensureLoaded(wsId)
    for (const record of this.deps.sessionRegistry.listFor(wsId)) {
      const live = this.deps.pool.get(record.id)
      let scrollbackFile: string | undefined
      if (record.agent === 'shell' && live) {
        const dump = live.dumpReplayBuffer()
        if (dump.length > 0) scrollbackFile = await this.deps.scrollbackStore.dump(wsId, record.id, dump)
      }
      this.deps.pool.disposeToken(record.id, 'workspace offboarded')
      if (record.state === 'running' || scrollbackFile) {
        await this.deps.sessionRegistry.update(wsId, record.id, {
          state: 'paused',
          lastActiveAt: new Date().toISOString(),
          ...(scrollbackFile ? { scrollbackFile } : {}),
        })
      }
    }
  }

  private async writeHandoffFiles(meta: WorkspaceMeta, handoff: WorkspaceHandoffSnapshot): Promise<void> {
    const aliceDir = join(meta.dir, '.alice')
    await mkdir(aliceDir, { recursive: true })
    const lines = [
      '# Workspace handoff',
      '',
      `- Workspace: \`${meta.tag}\` (\`${meta.id}\`)`,
      `- Prepared: ${handoff.preparedAt}`,
      `- Reason: ${handoff.reason}`,
      `- Session signatures: ${handoff.resumeIds.length > 0 ? handoff.resumeIds.map((id) => `\`@${id}\``).join(', ') : 'none'}`,
      `- Successors: ${handoff.successors && Object.keys(handoff.successors).length > 0
        ? Object.entries(handoff.successors).map(([from, to]) => `\`@${from}\` -> \`@${to}\``).join(', ')
        : 'none'}`,
      `- Open Issues: ${handoff.openIssueIds.length > 0 ? handoff.openIssueIds.map((id) => `\`[[${id}]]\``).join(', ') : 'none'}`,
      `- Scheduled Issues: ${handoff.scheduledIssueIds.length > 0 ? handoff.scheduledIssueIds.map((id) => `\`[[${id}]]\``).join(', ') : 'none'}`,
      `- Working tree at handoff: ${handoff.dirtyFiles.length > 0 ? 'dirty' : 'clean'}`,
      '',
      '## Notes',
      '',
      handoff.notes ?? 'No additional handoff notes were provided.',
      '',
      '## Uncommitted paths',
      '',
      ...(handoff.dirtyFiles.length > 0 ? handoff.dirtyFiles.map((file) => `- \`${file}\``) : ['- None']),
      '',
    ]
    await writeFile(join(aliceDir, 'HANDOFF.md'), lines.join('\n'), 'utf8')
    await writeFile(
      join(aliceDir, 'offboarding.json'),
      JSON.stringify({ schemaVersion: 1, workspaceId: meta.id, workspaceTag: meta.tag, ...handoff }, null, 2),
      'utf8',
    )
  }

  private async assessmentFromRecord(record: WorkspaceCatalogRecord): Promise<WorkspaceOffboardingAssessment> {
    return {
      workspace: { id: record.id, tag: record.tag, dir: record.activeDir },
      canOffboard: record.lifecycle === 'departed',
      blockers: record.lifecycle === 'departed' ? [] : [`workspace is ${record.lifecycle}`],
      runningHeadless: [],
      untrackedHeadlessActive: false,
      runningSessions: 0,
      sessionRecords: record.handoff?.sessionRecords ?? 0,
      resumeIds: record.handoff?.resumeIds ?? [],
      openIssueIds: record.handoff?.openIssueIds ?? [],
      scheduledIssueIds: record.handoff?.scheduledIssueIds ?? [],
      git: record.handoff
        ? {
            branch: null,
            clean: record.handoff.dirtyFiles.length === 0,
            files: record.handoff.dirtyFiles.map((path) => ({ status: '??', path })),
          }
        : null,
    }
  }
}

/** Atomic rename on the normal same-filesystem layout; crash-recoverable copy
 * fallback for a legacy Workspace whose activeDir lives on another volume. */
async function moveDirectory(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination)
    return
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
  }
  const staging = `${destination}.moving`
  await rm(staging, { recursive: true, force: true })
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, staging, { recursive: true, errorOnExist: true, force: false })
  await rename(staging, destination)
  await rm(source, { recursive: true, force: true })
}
