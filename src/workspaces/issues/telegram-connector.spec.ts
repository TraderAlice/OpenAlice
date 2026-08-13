import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createIssue } from './mutate.js'
import {
  createTelegramConnectorDesk,
  disableTelegramConnectorDesk,
  findTelegramConnectorDesks,
  TELEGRAM_CONNECTOR_ISSUE_ID,
  updateTelegramConnectorDesk,
} from './telegram-connector.js'

let home: string
let wsA: string
let wsB: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tg-desk-'))
  wsA = join(home, 'a')
  wsB = join(home, 'b')
  await mkdir(join(wsA, '.alice', 'issues'), { recursive: true })
  await mkdir(join(wsB, '.alice', 'issues'), { recursive: true })
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('telegram connector desk', () => {
  it('refuses the flag on the generic create path', async () => {
    const created = await createIssue(wsA, {
      title: 'Sneak',
      telegramConnector: true,
      when: { kind: 'every', every: '4h' },
    })
    expect(created).toMatchObject({
      ok: false,
      reason: 'invalid',
    })
    if (!created.ok && created.reason === 'invalid') {
      expect(created.error).toMatch(/Connector Settings/)
    }
  })

  it('creates exactly one desk and then conflicts', async () => {
    const first = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsA },
      [{ id: 'ws-a', dir: wsA }, { id: 'ws-b', dir: wsB }],
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.issue.id).toBe(TELEGRAM_CONNECTOR_ISSUE_ID)
    expect(first.issue.telegramConnector).toBe(true)

    const second = await createTelegramConnectorDesk(
      { id: 'ws-b', dir: wsB },
      [{ id: 'ws-a', dir: wsA }, { id: 'ws-b', dir: wsB }],
    )
    expect(second).toEqual({
      ok: false,
      reason: 'conflict',
      id: TELEGRAM_CONNECTOR_ISSUE_ID,
      wsId: 'ws-a',
    })
  })

  it('disables the desk by canceling and dropping the flag', async () => {
    const created = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsA },
      [{ id: 'ws-a', dir: wsA }],
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const disabled = await disableTelegramConnectorDesk(wsA, created.issue.id)
    expect(disabled.ok).toBe(true)
    if (!disabled.ok) return
    expect(disabled.issue.telegramConnector).toBeUndefined()
    expect(disabled.issue.status).toBe('canceled')
    expect(await findTelegramConnectorDesks([{ id: 'ws-a', dir: wsA }])).toEqual([])
  })

  it('revives a disabled leftover in the same workspace', async () => {
    const first = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsA },
      [{ id: 'ws-a', dir: wsA }],
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect((await disableTelegramConnectorDesk(wsA, first.issue.id)).ok).toBe(true)

    const revived = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsA },
      [{ id: 'ws-a', dir: wsA }],
    )
    expect(revived.ok).toBe(true)
    if (!revived.ok) return
    expect(revived.issue.id).toBe(TELEGRAM_CONNECTOR_ISSUE_ID)
    expect(revived.issue.telegramConnector).toBe(true)
    expect(revived.issue.status).toBe('todo')
  })

  it('updates the desk cadence through the Settings helper', async () => {
    const created = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsA },
      [{ id: 'ws-a', dir: wsA }],
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const updated = await updateTelegramConnectorDesk(wsA, created.issue.id, {
      when: { kind: 'every', every: '1h' },
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.issue.when).toEqual({ kind: 'every', every: '1h' })
  })

  it('does not treat a hand-written false flag as a desk', async () => {
    await writeFile(join(wsA, '.alice', 'issues', 'nope.md'), `---
title: Nope
telegramConnector: false
---

x
`)
    expect(await findTelegramConnectorDesks([{ id: 'ws-a', dir: wsA }])).toEqual([])
  })
})
