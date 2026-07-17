import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { migrateThemeFileState } from './0024_theme_file_state/index.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('0024 theme file state migration', () => {
  it('creates theme storage and seeds appearance without disturbing preferences', async () => {
    const data = await makeData()
    await writeFile(join(data, 'preferences.json'), JSON.stringify({
      version: 1,
      quickChat: { lastCredentialByAgent: { pi: 'provider-1' }, recentChatWorkspaceId: null },
    }))
    expect(await migrateThemeFileState(data)).toBe(true)
    await expect(access(join(data, 'themes'))).resolves.toBeUndefined()
    expect(JSON.parse(await readFile(join(data, 'preferences.json'), 'utf8'))).toMatchObject({
      quickChat: { lastCredentialByAgent: { pi: 'provider-1' } },
      appearance: { activeFamilyId: 'builtin-openalice', mode: 'system', terminal: { mode: 'follow' } },
    })
    const once = await readFile(join(data, 'preferences.json'), 'utf8')
    expect(await migrateThemeFileState(data)).toBe(false)
    expect(await readFile(join(data, 'preferences.json'), 'utf8')).toBe(once)
  })

  it('fails without modifying malformed state', async () => {
    const data = await makeData()
    await writeFile(join(data, 'preferences.json'), '{bad')
    await expect(migrateThemeFileState(data)).rejects.toThrow('malformed')
    expect(await readFile(join(data, 'preferences.json'), 'utf8')).toBe('{bad')
  })
})

async function makeData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'theme-migration-'))
  roots.push(root)
  return root
}
