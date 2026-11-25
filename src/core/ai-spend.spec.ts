import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  decideAiSpend, parseCeilingCents, parseSpendMode, spendAlertLevel, costCents, aiSpendDay,
} from './ai-spend.js'

describe('ai-spend pure helpers', () => {
  it('defaults: $20 ceiling, block mode', () => {
    expect(parseCeilingCents(undefined)).toBe(2000)
    expect(parseCeilingCents('junk')).toBe(2000)
    expect(parseCeilingCents('0')).toBe(0)
    expect(parseSpendMode(undefined)).toBe('block')
    expect(parseSpendMode('alert')).toBe('alert')
  })
  it('alert levels at 80% / 100%', () => {
    expect(spendAlertLevel(2000, 1599)).toBe('none')
    expect(spendAlertLevel(2000, 1600)).toBe('approaching')
    expect(spendAlertLevel(2000, 2000)).toBe('over')
  })
  it('refuses with the ceiling message', () => {
    const v = decideAiSpend({ ceilingCents: 2000, usedCents: 1990, reservedCents: 0, estimateCents: 20 })
    expect(v.allowed).toBe(false)
    expect(!v.allowed && v.reason).toMatch(/^AI spend ceiling reached/)
  })
  it('prices by model tier, rounds up', () => {
    expect(costCents('claude-sonnet-5-5', 1_000_000, 0)).toBe(300)
    expect(costCents('x', 1, 1)).toBe(1)
    expect(aiSpendDay(new Date('2026-11-24T03:00:00Z'))).toBe('2026-11-23')
  })
})

describe('ai-spend reserve/settle (file store)', () => {
  beforeEach(async () => {
    // Fresh temp OPENALICE_HOME per test; paths.ts reads it at import time.
    process.env['OPENALICE_HOME'] = await mkdtemp(join(tmpdir(), 'ai-spend-'))
    vi.resetModules()
  })

  it('blocks at the ceiling, resumes when raised', async () => {
    const m = await import('./ai-spend.js')
    await m.writeAiSpendSettings({ ceilingCents: 100, mode: 'block' })
    expect((await m.reserveAiSpend(60)).ok).toBe(true)
    await m.settleAiSpend(60, 70)
    expect((await m.reserveAiSpend(40)).ok).toBe(false)
    await expect(m.withAiSpend(40, async () => 1)).rejects.toThrow(/AI spend ceiling reached/)
    await m.writeAiSpendSettings({ ceilingCents: 500 })
    expect((await m.reserveAiSpend(40)).ok).toBe(true)
    expect((await m.readAiSpendStatus()).spentCents).toBe(70)
  })

  it('alert mode never blocks', async () => {
    const m = await import('./ai-spend.js')
    await m.writeAiSpendSettings({ ceilingCents: 10, mode: 'alert' })
    expect((await m.reserveAiSpend(50)).ok).toBe(true)
  })
})
