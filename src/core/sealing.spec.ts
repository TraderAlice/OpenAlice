import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join } from 'node:path'

/**
 * sealing.ts resolves the key path from userDataHome at call time, and
 * paths.ts resolves userDataHome from env at import time — so each test
 * gets a fresh temp home via resetModules + env (same pattern as
 * paths.spec.ts / global-provider-keys.spec.ts).
 */
let home: string
let savedHome: string | undefined

async function loadSealing() {
  vi.resetModules()
  process.env['OPENALICE_HOME'] = home
  return await import('./sealing.js')
}

beforeEach(async () => {
  savedHome = process.env['OPENALICE_HOME']
  home = await mkdtemp(join(tmpdir(), 'oa-sealing-'))
})

afterEach(async () => {
  if (savedHome === undefined) delete process.env['OPENALICE_HOME']
  else process.env['OPENALICE_HOME'] = savedHome
  vi.resetModules()
  await rm(home, { recursive: true, force: true })
})

describe('seal / unseal', () => {
  it('round-trips a JSON value', async () => {
    const { seal, unseal } = await loadSealing()
    const value = [{ id: 'okx-1', presetConfig: { apiKey: 'k', secret: 's' } }]
    const envelope = await seal(value)
    expect(envelope.$sealed).toBe(1)
    expect(envelope.alg).toBe('aes-256-gcm')
    await expect(unseal(envelope)).resolves.toEqual(value)
  })

  it('ciphertext does not contain the plaintext secret', async () => {
    const { seal } = await loadSealing()
    const envelope = await seal({ secret: 'super-secret-broker-key' })
    expect(JSON.stringify(envelope)).not.toContain('super-secret-broker-key')
  })

  it('creates the key file on first seal, owner-only', async () => {
    const { seal, sealingKeyPath } = await loadSealing()
    expect(existsSync(sealingKeyPath())).toBe(false)
    await seal({})
    expect(sealingKeyPath()).toBe(join(home, 'sealing.key'))
    expect(existsSync(sealingKeyPath())).toBe(true)
    if (platform() !== 'win32') {
      const mode = (await stat(sealingKeyPath())).mode & 0o777
      expect(mode).toBe(0o600)
    }
  })

  it('reuses the same key across seals (stable at-rest identity)', async () => {
    const { seal, unseal, sealingKeyPath } = await loadSealing()
    await seal({ first: true })
    const keyBefore = await readFile(sealingKeyPath(), 'utf-8')
    const second = await seal({ second: true })
    expect(await readFile(sealingKeyPath(), 'utf-8')).toBe(keyBefore)
    await expect(unseal(second)).resolves.toEqual({ second: true })
  })

  it('throws UnsealError when the key file is missing', async () => {
    const { seal, unseal, sealingKeyPath, UnsealError } = await loadSealing()
    const envelope = await seal({ x: 1 })
    await rm(sealingKeyPath())
    await expect(unseal(envelope)).rejects.toBeInstanceOf(UnsealError)
    await expect(unseal(envelope)).rejects.toThrow(/does not exist/)
  })

  it('throws UnsealError when the key was replaced (auth tag mismatch)', async () => {
    const { seal, unseal, sealingKeyPath, UnsealError } = await loadSealing()
    const envelope = await seal({ x: 1 })
    const { randomBytes } = await import('node:crypto')
    await writeFile(sealingKeyPath(), randomBytes(32).toString('base64'))
    await expect(unseal(envelope)).rejects.toBeInstanceOf(UnsealError)
    await expect(unseal(envelope)).rejects.toThrow(/does not authenticate/)
  })

  it('throws UnsealError on a malformed key file', async () => {
    const { seal, unseal, sealingKeyPath, UnsealError } = await loadSealing()
    const envelope = await seal({ x: 1 })
    await writeFile(sealingKeyPath(), 'bm90LWEta2V5\n') // base64("not-a-key") — wrong length
    await expect(unseal(envelope)).rejects.toBeInstanceOf(UnsealError)
  })
})

describe('isSealedEnvelope', () => {
  it('accepts envelopes and rejects everything else', async () => {
    const { seal, isSealedEnvelope } = await loadSealing()
    expect(isSealedEnvelope(await seal([]))).toBe(true)
    expect(isSealedEnvelope([])).toBe(false)
    expect(isSealedEnvelope([{ id: 'x' }])).toBe(false) // legacy plaintext array
    expect(isSealedEnvelope(null)).toBe(false)
    expect(isSealedEnvelope({ $sealed: 2, iv: '', tag: '', data: '' })).toBe(false)
    expect(isSealedEnvelope({ $sealed: 1, iv: '', tag: '' })).toBe(false) // missing data
  })
})
