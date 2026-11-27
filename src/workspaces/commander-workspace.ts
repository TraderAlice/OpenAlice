import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { WorkspaceMeta } from './workspace-registry.js'

/**
 * Launcher-owned global Commander identity. It deliberately does not live in
 * WorkspaceRegistry: Commander sits one level above all active business
 * Workspaces in this AliceProject rather than acting as another business desk.
 */
export const COMMANDER_WORKSPACE_ID = 'commander'
export const COMMANDER_WORKSPACE_TAG = 'Commander'

/**
 * Historical control-plane id retained strictly for read-only session path
 * lookup and migration 0039 compatibility on upgraded user homes.
 */
export const LEGACY_MANAGER_WORKSPACE_ID = 'workspace-manager'

export interface CommanderPointer {
  readonly version: 1
  readonly resumeId: string
  readonly createdAt: number
  readonly updatedAt: number
}

export function commanderPointerPath(launcherRoot: string): string {
  return join(launcherRoot, 'state', 'commander.json')
}

export function createCommanderWorkspaceMeta(
  launcherRoot: string,
): WorkspaceMeta {
  return {
    id: COMMANDER_WORKSPACE_ID,
    tag: COMMANDER_WORKSPACE_TAG,
    dir: join(launcherRoot, 'workspaces'),
    createdAt: new Date(0).toISOString(),
  }
}

function parseCommanderPointer(raw: unknown): CommanderPointer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (
    record['version'] !== 1
    || typeof record['resumeId'] !== 'string'
    || record['resumeId'].trim().length === 0
    || typeof record['createdAt'] !== 'number'
    || !Number.isFinite(record['createdAt'])
    || typeof record['updatedAt'] !== 'number'
    || !Number.isFinite(record['updatedAt'])
  ) {
    return null
  }
  return {
    version: 1,
    resumeId: record['resumeId'].trim(),
    createdAt: record['createdAt'],
    updatedAt: record['updatedAt'],
  }
}

/**
 * Atomic, serialized JSON pointer store (`state/commander.json`) backing the
 * single canonical Commander identity per AliceProject.
 */
export class CommanderPointerStore {
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  static forLauncherRoot(launcherRoot: string): CommanderPointerStore {
    return new CommanderPointerStore(commanderPointerPath(launcherRoot))
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.chain.catch(() => undefined).then(operation)
    this.chain = next
    return next
  }

  private async readUnlocked(): Promise<CommanderPointer | null> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return parseCommanderPointer(JSON.parse(raw) as unknown)
    } catch {
      return null
    }
  }

  private async writeUnlocked(pointer: CommanderPointer): Promise<CommanderPointer> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, `${JSON.stringify(pointer, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, this.filePath)
    return pointer
  }

  read(): Promise<CommanderPointer | null> {
    return this.enqueue(() => this.readUnlocked())
  }

  write(resumeId: string, nowMs: number = Date.now()): Promise<CommanderPointer> {
    const trimmed = resumeId.trim()
    if (!trimmed) {
      return Promise.reject(new Error('Commander resumeId must be non-empty'))
    }
    return this.enqueue(async () => {
      const existing = await this.readUnlocked()
      const createdAt = existing?.resumeId === trimmed ? existing.createdAt : nowMs
      return this.writeUnlocked({
        version: 1,
        resumeId: trimmed,
        createdAt,
        updatedAt: nowMs,
      })
    })
  }

  ensure(
    createResumeId: () => Promise<string> | string,
    nowMs: number = Date.now(),
  ): Promise<{ pointer: CommanderPointer; created: boolean }> {
    return this.enqueue(async () => {
      const existing = await this.readUnlocked()
      if (existing) {
        return { pointer: existing, created: false }
      }
      const resumeId = (await createResumeId()).trim()
      if (!resumeId) {
        throw new Error('Commander resumeId must be non-empty')
      }
      const pointer = await this.writeUnlocked({
        version: 1,
        resumeId,
        createdAt: nowMs,
        updatedAt: nowMs,
      })
      return { pointer, created: true }
    })
  }
}

/**
 * Appended to Commander's system prompt on structured Web and headless runs
 * (and seeded on fresh terminal spawns) so the global coordination and triage
 * contract remains durable across restarts without cluttering user messages.
 */
export const COMMANDER_SYSTEM_PROMPT = `You are the OpenAlice Commander — the single global executive coordinator across all active Workspaces in this AliceProject.

Your current working directory contains one child directory per ACTIVE Workspace. It is the command floor above those Workspaces, not a business Workspace of your own.

Operating conventions:
- Keep your own session agile: handle triage, synthesis, quick status checks, and user communication directly. Delegate heavy research, coding, backtesting, or multi-step work to active Workspaces via \`alice orchestration worker-start\` (\`--harness chat|autoquant|prediction\` or \`--ws-id\`) and end your turn to await wakes.
- Scheduled Issue Threads across active Workspaces automatically report their outcomes to your mailbox. When woken for scheduled/task reports (\`alice conversation check\`) or orchestration updates (\`alice orchestration check\`), review what happened first:
  1. Absorb routine/expected passes silently — do NOT spam the human Inbox for uneventful ticks.
  2. For recoverable hiccups or follow-up investigations, steer or dispatch a worker Thread.
  3. Call \`alice inbox push\` only when an outcome, anomaly, risk, or deliverable genuinely warrants human attention.
- NEVER drop reports, research files, Issues, or other business artifacts directly in this top-level floor directory. Choose the responsible active Workspace and write or delegate there.
- Prefer OpenAlice's \`alice\` CLI over raw HTTP. Start from structured product indexes (\`alice peer list\`, \`alice issue list --mode detailed\`, \`alice orchestration worker-list\`) rather than batch-crawling every Workspace directory.
- Preview lifecycle or template mutations before applying them; never offboard, merge, purge, or upgrade without clear user authorization.
- If you edit a target Workspace directly, commit the change in that Workspace with a clear message.`

export function commanderTerminalPrompt(prompt?: string): string {
  const trimmed = prompt?.trim()
  if (!trimmed) return COMMANDER_SYSTEM_PROMPT
  return `${COMMANDER_SYSTEM_PROMPT}\n\nUser request:\n${trimmed}`
}

export function commanderSkillPath(launcherRepoRoot: string): string {
  return join(launcherRepoRoot, 'default', 'skills', 'commander')
}

/**
 * Concise reporting-line convention appended to scheduled Issue execution
 * prompts so scheduled Threads report clearly to the global Commander instead
 * of pushing routine tick noise straight to the human Inbox.
 */
export const THREAD_REPORTING_CONVENTION_NOTE =
  '[Reporting Line Convention] Scheduled outcomes in this AliceProject are automatically reviewed by the global Commander. Summarize findings, metrics, errors, and artifact paths clearly in your final reply rather than pushing routine status noise directly to the human Inbox, unless this task explicitly instructs you to notify the human directly.'
