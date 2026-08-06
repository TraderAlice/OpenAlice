import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

import { migrateQuickChatRecentLaunch } from './0034_quick_chat_recent_launch/index.js'

const roots: string[] = []

async function fixture(value: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-quick-chat-launch-'))
  roots.push(root)
  const path = join(root, 'preferences.json')
  await writeFile(path, JSON.stringify(value), 'utf-8')
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('0034_quick_chat_recent_launch', () => {
  it('seeds the complete tuple from the latest legacy runtime credential', async () => {
    const path = await fixture({
      version: 1,
      quickChat: {
        lastCredentialByAgent: { opencode: 'glm-1', pi: 'deepseek-1' },
        recentChatWorkspaceId: 'chat-one',
      },
    })

    expect(await migrateQuickChatRecentLaunch(path)).toEqual({ updated: true })
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as Record<string, any>
    expect(parsed['quickChat']).toEqual({
      lastCredentialByAgent: { opencode: 'glm-1', pi: 'deepseek-1' },
      recentChatWorkspaceId: 'chat-one',
      recentLaunch: {
        agent: 'pi',
        credentialSlug: 'deepseek-1',
        model: null,
        reasoningEffort: null,
      },
    })
  })

  it('is idempotent and preserves an explicit runtime-native launch', async () => {
    const path = await fixture({
      quickChat: {
        lastCredentialByAgent: {},
        recentLaunch: {
          agent: 'codex',
          credentialSlug: null,
          model: 'gpt-5.6-terra',
          reasoningEffort: 'high',
        },
      },
    })

    expect(await migrateQuickChatRecentLaunch(path)).toEqual({ updated: false })
  })
})
