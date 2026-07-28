/** 0026_agent_conversation_log — create the private cross-Agent event stream. */
import { access, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type { Migration } from '../types.js'

function defaultLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

export async function ensureAgentConversationLog(
  launcherRoot: string = defaultLauncherRoot(),
): Promise<{ created: boolean }> {
  const path = join(launcherRoot, 'state', 'agent-conversations.jsonl')
  try {
    await access(path)
    return { created: false }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return { created: false }
  }

  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(path, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return { created: true }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return { created: false }
    throw err
  }
}

export const migration: Migration = {
  id: '0026_agent_conversation_log',
  appVersion: '0.87.0-beta',
  introducedAt: '2026-07-29',
  affects: ['workspaces/state/agent-conversations.jsonl'],
  summary: 'Create the private append-only cross-Agent conversation event log.',
  rationale: 'Prompt-flow analysis and future collaboration visualization need one independent record of dispatched and completed peer messages without treating the log as execution authority.',
  up: async () => { await ensureAgentConversationLog() },
}
