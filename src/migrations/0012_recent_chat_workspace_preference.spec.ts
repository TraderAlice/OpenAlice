import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { migrateRecentChatWorkspacePreference } from './0012_recent_chat_workspace_preference/index.js'

let root: string
let launcherRoot: string
let preferencesPath: string

async function writeRegistry(workspaces: unknown[]): Promise<void> {
  await mkdir(join(launcherRoot, 'state', 'sessions'), { recursive: true })
  await writeFile(
    join(launcherRoot, 'workspaces.json'),
    JSON.stringify({ version: 1, workspaces }),
    'utf-8',
  )
}

async function writeSessions(wsId: string, dates: string[]): Promise<void> {
  await writeFile(
    join(launcherRoot, 'state', 'sessions', `${wsId}.json`),
    JSON.stringify({
      version: 1,
      records: dates.map((lastActiveAt, index) => ({ id: `${wsId}-${index}`, lastActiveAt })),
    }),
    'utf-8',
  )
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mig0012-'))
  launcherRoot = join(root, 'workspaces')
  preferencesPath = join(root, 'data', 'preferences.json')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('0012 recent Chat workspace preference', () => {
  it('selects the Chat workspace with the latest session activity', async () => {
    await writeRegistry([
      { id: 'chat-newer', template: 'chat', createdAt: '2026-07-10T00:00:00Z' },
      { id: 'chat-active', template: 'chat', createdAt: '2026-07-01T00:00:00Z' },
      { id: 'auto-quant', template: 'auto-quant', createdAt: '2026-07-11T00:00:00Z' },
    ])
    await writeSessions('chat-newer', ['2026-07-10T01:00:00Z'])
    await writeSessions('chat-active', ['2026-07-11T01:00:00Z'])

    expect(await migrateRecentChatWorkspacePreference(preferencesPath, launcherRoot)).toEqual({
      updated: true,
      workspaceId: 'chat-active',
    })
    expect(JSON.parse(await readFile(preferencesPath, 'utf-8'))).toEqual({
      version: 1,
      quickChat: {
        lastCredentialByAgent: {},
        recentChatWorkspaceId: 'chat-active',
      },
    })
  })

  it('preserves credentials and is idempotent when the preference is valid', async () => {
    await writeRegistry([
      { id: 'chat-one', template: 'chat', createdAt: '2026-07-01T00:00:00Z' },
      { id: 'chat-two', template: 'chat', createdAt: '2026-07-02T00:00:00Z' },
    ])
    await mkdir(join(preferencesPath, '..'), { recursive: true })
    await writeFile(preferencesPath, JSON.stringify({
      version: 1,
      quickChat: {
        lastCredentialByAgent: { pi: 'meituan-1' },
        recentChatWorkspaceId: 'chat-one',
      },
    }), 'utf-8')

    expect(await migrateRecentChatWorkspacePreference(preferencesPath, launcherRoot)).toEqual({
      updated: false,
      workspaceId: 'chat-one',
    })
    const parsed = JSON.parse(await readFile(preferencesPath, 'utf-8'))
    expect(parsed.quickChat.lastCredentialByAgent).toEqual({ pi: 'meituan-1' })
  })

  it('does nothing when no Chat workspace exists', async () => {
    await writeRegistry([
      { id: 'auto-quant', template: 'auto-quant', createdAt: '2026-07-11T00:00:00Z' },
    ])
    expect(await migrateRecentChatWorkspacePreference(preferencesPath, launcherRoot)).toEqual({
      updated: false,
      workspaceId: null,
    })
  })
})
