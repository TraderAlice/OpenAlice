import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { getApiKeyFromAuthFile, getAccessToken, clearTokenCache } from './auth.js'

const ORIGINAL_CODEX_HOME = process.env.CODEX_HOME

async function withAuthFile(payload: object): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'codex-auth-'))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'auth.json'), JSON.stringify(payload, null, 2))
  process.env.CODEX_HOME = dir
  clearTokenCache()
  return dir
}

afterEach(async () => {
  clearTokenCache()
  const dir = process.env.CODEX_HOME
  if (dir && dir !== ORIGINAL_CODEX_HOME && dir.includes('codex-auth-')) {
    await rm(dir, { recursive: true, force: true })
  }
  if (ORIGINAL_CODEX_HOME === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = ORIGINAL_CODEX_HOME
})

describe('codex auth helpers', () => {
  it('reads API key mode credentials from auth.json', async () => {
    await withAuthFile({
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk-test-auth-file',
    })

    await expect(getApiKeyFromAuthFile()).resolves.toBe('sk-test-auth-file')
  })

  it('returns API key mode credentials from getAccessToken', async () => {
    await withAuthFile({
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk-test-token',
    })

    await expect(getAccessToken()).resolves.toBe('sk-test-token')
  })
})
