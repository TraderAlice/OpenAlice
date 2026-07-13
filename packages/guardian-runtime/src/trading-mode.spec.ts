import { createCipheriv, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveGuardianTradingMode } from './trading-mode.js'

describe('resolveGuardianTradingMode', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'guardian-trading-mode-'))
    await mkdir(join(home, 'data/config'), { recursive: true })
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  const writeConfig = async (name: string, value: unknown) => {
    await writeFile(join(home, 'data/config', name), JSON.stringify(value))
  }

  it('prefers an env-locked mode over persisted state', async () => {
    await writeConfig('trading.json', { mode: 'pro' })
    await writeConfig('accounts.json', [{ id: 'alpaca' }])

    await expect(resolveGuardianTradingMode({ OPENALICE_TRADING_MODE: 'readonly' }, home))
      .resolves.toEqual({
        mode: 'readonly',
        source: 'env',
        envLocked: true,
        hasUTAConfig: true,
      })
  })

  it('uses persisted mode before account-based inference', async () => {
    await writeConfig('trading.json', { mode: 'lite' })
    await writeConfig('accounts.json', [{ id: 'alpaca' }])

    await expect(resolveGuardianTradingMode({}, home)).resolves.toMatchObject({
      mode: 'lite',
      source: 'config',
      envLocked: false,
      hasUTAConfig: true,
    })
  })

  it('defaults fresh roots to lite and roots with accounts to pro', async () => {
    await expect(resolveGuardianTradingMode({}, home)).resolves.toMatchObject({
      mode: 'lite',
      source: 'auto',
      hasUTAConfig: false,
    })

    await writeConfig('accounts.json', [{ id: 'alpaca' }])
    await expect(resolveGuardianTradingMode({}, home)).resolves.toMatchObject({
      mode: 'pro',
      source: 'auto',
      hasUTAConfig: true,
    })
  })

  it('detects accounts in the sealed credential envelope', async () => {
    const key = randomBytes(32)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([
      cipher.update(JSON.stringify([{ id: 'sealed-account' }]), 'utf8'),
      cipher.final(),
    ])
    await writeFile(join(home, 'sealing.key'), key.toString('base64'))
    await writeConfig('accounts.json', {
      $sealed: 1,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    })

    await expect(resolveGuardianTradingMode({}, home)).resolves.toMatchObject({
      mode: 'pro',
      source: 'auto',
      hasUTAConfig: true,
    })
  })
})
