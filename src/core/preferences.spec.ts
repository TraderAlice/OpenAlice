import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

import {
  readPreferences,
  readAppearancePreferences,
  readQuickChatPreferences,
  rememberQuickChatCredential,
  rememberRecentChatWorkspace,
  saveAppearancePreferences,
} from './preferences.js'

const roots: string[] = []

async function preferenceFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-preferences-'))
  roots.push(root)
  return join(root, 'preferences.json')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('preferences', () => {
  it('treats a missing or malformed file as empty preferences', async () => {
    const path = await preferenceFile()
    expect(await readPreferences(path)).toEqual({
      version: 1,
      quickChat: { lastCredentialByAgent: {}, recentChatWorkspaceId: null },
      appearance: {
        activeFamilyId: 'builtin-openalice',
        mode: 'system',
        terminal: { mode: 'follow' },
        marketColors: 'protected',
        marketDirection: 'green-up-red-down',
        statusColors: 'protected',
      },
    })

    await writeFile(path, '{not-json', 'utf-8')
    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: {},
      recentChatWorkspaceId: null,
    })
  })

  it('remembers independent credentials per agent without secret material', async () => {
    const path = await preferenceFile()
    await rememberQuickChatCredential('pi', 'minimax-1', path)
    await rememberQuickChatCredential('opencode', 'glm-1', path)

    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: { pi: 'minimax-1', opencode: 'glm-1' },
      recentChatWorkspaceId: null,
    })
    const raw = await readFile(path, 'utf-8')
    expect(raw).not.toContain('apiKey')
    expect(raw).not.toContain('baseUrl')
  })

  it('clears one agent without disturbing the others', async () => {
    const path = await preferenceFile()
    await Promise.all([
      rememberQuickChatCredential('pi', 'minimax-1', path),
      rememberQuickChatCredential('opencode', 'glm-1', path),
    ])
    await rememberQuickChatCredential('pi', null, path)

    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: { opencode: 'glm-1' },
      recentChatWorkspaceId: null,
    })
  })

  it('remembers a recent chat workspace without disturbing runtime credentials', async () => {
    const path = await preferenceFile()
    await rememberQuickChatCredential('pi', 'meituan-1', path)
    await rememberRecentChatWorkspace('chat-calm-river', path)

    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: { pi: 'meituan-1' },
      recentChatWorkspaceId: 'chat-calm-river',
    })

    await rememberRecentChatWorkspace(null, path)
    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: { pi: 'meituan-1' },
      recentChatWorkspaceId: null,
    })
  })

  it('persists appearance policy without disturbing quick-chat state', async () => {
    const path = await preferenceFile()
    await rememberQuickChatCredential('pi', 'meituan-1', path)
    await saveAppearancePreferences({
      activeFamilyId: 'imported-eighties-1234',
      mode: 'dark',
      terminal: { mode: 'override', familyId: 'imported-eighties-1234', variant: 'dark' },
      marketColors: 'theme',
      marketDirection: 'red-up-green-down',
      statusColors: 'theme',
    }, path)
    expect(await readAppearancePreferences(path)).toEqual({
      activeFamilyId: 'imported-eighties-1234',
      mode: 'dark',
      terminal: { mode: 'override', familyId: 'imported-eighties-1234', variant: 'dark' },
      marketColors: 'theme',
      marketDirection: 'red-up-green-down',
      statusColors: 'theme',
    })
    expect((await readQuickChatPreferences(path)).lastCredentialByAgent).toEqual({ pi: 'meituan-1' })
  })
})
