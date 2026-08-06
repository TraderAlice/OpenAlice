import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

import { migrateQuickChatAccessMode } from './0035_quick_chat_access_mode/index.js'

const roots: string[] = []

async function fixture(recentLaunch: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-quick-chat-access-'))
  roots.push(root)
  const path = join(root, 'preferences.json')
  await writeFile(path, JSON.stringify({ quickChat: { recentLaunch } }), 'utf-8')
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('0035_quick_chat_access_mode', () => {
  it('preserves a saved credential as an explicit vault choice', async () => {
    const path = await fixture({ agent: 'pi', credentialSlug: 'deepseek-1', model: null })

    expect(await migrateQuickChatAccessMode(path)).toEqual({ updated: true })
    expect(JSON.parse(await readFile(path, 'utf-8')).quickChat.recentLaunch).toEqual({
      agent: 'pi',
      credentialSlug: 'deepseek-1',
      model: null,
      accessMode: 'vault',
    })
  })

  it('keeps a legacy null credential on normal Workspace resolution', async () => {
    const path = await fixture({ agent: 'pi', credentialSlug: null, model: null })

    expect(await migrateQuickChatAccessMode(path)).toEqual({ updated: true })
    expect(JSON.parse(await readFile(path, 'utf-8')).quickChat.recentLaunch.accessMode).toBe('auto')
  })

  it('is idempotent for an explicit native runtime account', async () => {
    const path = await fixture({
      agent: 'pi',
      accessMode: 'native',
      credentialSlug: null,
      model: 'runtime-model',
    })

    expect(await migrateQuickChatAccessMode(path)).toEqual({ updated: false })
  })
})
