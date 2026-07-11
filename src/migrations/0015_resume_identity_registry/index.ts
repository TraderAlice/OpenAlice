/**
 * 0015_resume_identity_registry — build the product-id → native-session-id
 * translation table and attach product resume ids to interactive Sessions.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type { Migration } from '../types.js'

function defaultLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) as unknown } catch { return null }
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(tmp, path)
}

interface MutableResumeRecord {
  resumeId: string
  wsId: string
  agent: string
  agentSessionId?: string
  latestTaskId?: string
  createdAt: number
  updatedAt: number
}

export async function migrateResumeIdentityRegistry(
  launcherRoot: string = defaultLauncherRoot(),
): Promise<{ identities: number; sessionsUpdated: number }> {
  const stateRoot = join(launcherRoot, 'state')
  const identities = new Map<string, MutableResumeRecord>()
  const existingRegistry = await readJson(join(stateRoot, 'resume-identities.json'))
  if (isRecord(existingRegistry) && Array.isArray(existingRegistry['records'])) {
    for (const value of existingRegistry['records']) {
      if (!isRecord(value)) continue
      if (
        typeof value['resumeId'] !== 'string' || typeof value['wsId'] !== 'string' ||
        typeof value['agent'] !== 'string' || typeof value['createdAt'] !== 'number' ||
        typeof value['updatedAt'] !== 'number'
      ) continue
      identities.set(value['resumeId'], {
        resumeId: value['resumeId'], wsId: value['wsId'], agent: value['agent'],
        createdAt: value['createdAt'], updatedAt: value['updatedAt'],
        ...(typeof value['agentSessionId'] === 'string' ? { agentSessionId: value['agentSessionId'] } : {}),
        ...(typeof value['latestTaskId'] === 'string' ? { latestTaskId: value['latestTaskId'] } : {}),
      })
    }
  }
  const headless = await readJson(join(stateRoot, 'headless-tasks.json'))
  if (isRecord(headless) && Array.isArray(headless['tasks'])) {
    for (const value of headless['tasks']) {
      if (!isRecord(value)) continue
      const resumeId = value['resumeId']
      const taskId = value['taskId']
      const wsId = value['wsId']
      const agent = value['agent']
      const startedAt = value['startedAt']
      if (
        typeof resumeId !== 'string' || typeof taskId !== 'string' ||
        typeof wsId !== 'string' || typeof agent !== 'string'
      ) continue
      const timestamp = typeof startedAt === 'number' ? startedAt : Date.now()
      const prior = identities.get(resumeId)
      const record: MutableResumeRecord = prior ?? {
        resumeId, wsId, agent, createdAt: timestamp, updatedAt: timestamp,
      }
      record.latestTaskId = taskId
      record.updatedAt = Math.max(record.updatedAt, timestamp)
      if (typeof value['agentSessionId'] === 'string') record.agentSessionId = value['agentSessionId']
      identities.set(resumeId, record)
    }
  }

  let sessionsUpdated = 0
  const sessionsDir = join(stateRoot, 'sessions')
  let files: string[] = []
  try { files = await readdir(sessionsDir) } catch { /* fresh install */ }
  for (const name of files) {
    if (!name.endsWith('.json')) continue
    const path = join(sessionsDir, name)
    const parsed = await readJson(path)
    if (!isRecord(parsed) || !Array.isArray(parsed['records'])) continue
    let changed = false
    const records = parsed['records'].map((value) => {
      if (!isRecord(value)) return value
      const wsId = value['wsId']
      const agent = value['agent']
      if (typeof wsId !== 'string' || typeof agent !== 'string') return value
      let resumeId = typeof value['resumeId'] === 'string' ? value['resumeId'] : undefined
      if (!resumeId && typeof value['sourceRunId'] === 'string' && isRecord(headless)) {
        const task = Array.isArray(headless['tasks'])
          ? headless['tasks'].find((item) => isRecord(item) && item['taskId'] === value['sourceRunId'])
          : undefined
        if (isRecord(task) && typeof task['resumeId'] === 'string') resumeId = task['resumeId']
      }
      if (!resumeId) resumeId = randomUUID()
      if (value['resumeId'] !== resumeId) {
        changed = true
        sessionsUpdated += 1
      }
      const createdAt = typeof value['createdAt'] === 'string'
        ? Date.parse(value['createdAt']) || Date.now()
        : Date.now()
      const hint = isRecord(value['resumeHint']) && value['resumeHint']['kind'] === 'agent-session-id'
        && typeof value['resumeHint']['value'] === 'string'
        ? value['resumeHint']['value']
        : undefined
      const prior = identities.get(resumeId)
      identities.set(resumeId, {
        resumeId,
        wsId,
        agent,
        createdAt: prior?.createdAt ?? createdAt,
        updatedAt: prior?.updatedAt ?? createdAt,
        ...(hint ? { agentSessionId: hint } : prior?.agentSessionId ? { agentSessionId: prior.agentSessionId } : {}),
        ...(prior?.latestTaskId ? { latestTaskId: prior.latestTaskId } : {}),
      })
      return { ...value, resumeId }
    })
    if (changed) await writeAtomic(path, { ...parsed, version: 2, records })
  }

  await writeAtomic(join(stateRoot, 'resume-identities.json'), {
    version: 1,
    records: [...identities.values()],
  })
  return { identities: identities.size, sessionsUpdated }
}

export const migration: Migration = {
  id: '0015_resume_identity_registry',
  appVersion: '0.75.0-beta',
  introducedAt: '2026-07-11',
  affects: [
    'workspaces/state/resume-identities.json',
    'workspaces/state/sessions/*.json',
  ],
  summary: 'Create the backend resumeId to native runtime session-id registry.',
  rationale: 'Product and frontend code should resume an OpenAlice conversation identity without knowing vendor-specific session ids.',
  up: async () => { await migrateResumeIdentityRegistry() },
}
