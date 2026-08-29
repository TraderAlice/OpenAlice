import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createIssue } from './mutate.js'
import {
  connectorDeskDefaultWhat,
  createConnectorDesk,
  createTelegramConnectorDesk,
  disableTelegramConnectorDesk,
  findConnectorDesks,
  findTelegramConnectorDesks,
  TELEGRAM_CONNECTOR_ISSUE_ID,
  updateTelegramConnectorDesk,
} from './connector-desk.js'

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
      connectorDesk: 'telegram',
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
    expect(first.issue.title).toBe('Chat on Telegram')
    expect(first.issue.what).toBe(connectorDeskDefaultWhat('Telegram'))
    expect(first.issue.what).toContain('the chat connected to the owner through Telegram')
    expect(first.issue.what).not.toMatch(/phone desk/i)
    expect(first.issue.connectorDesk).toBe('telegram')
    expect(first.issue.commentPrompt).toBe('{comment}')

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
    expect(disabled.issue.connectorDesk).toBeUndefined()
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
    expect(revived.issue.title).toBe(first.issue.title)
    expect(revived.issue.what).toBe(first.issue.what)
    expect(revived.issue.connectorDesk).toBe('telegram')
    expect(revived.issue.status).toBe('todo')
    expect(revived.issue.commentPrompt).toBe('{comment}')
  })

  it('does not rewrite title or What when reviving a leftover desk', async () => {
    await writeFile(join(wsA, '.alice', 'issues', `${TELEGRAM_CONNECTOR_ISSUE_ID}.md`), `---
title: Telegram phone desk
status: canceled
assignee: '@new-then-resume'
when: { kind: every, every: 4h }
---

You are the Telegram phone desk for this Workspace.
`)
    const revived = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsA },
      [{ id: 'ws-a', dir: wsA }],
    )
    expect(revived.ok).toBe(true)
    if (!revived.ok) return
    expect(revived.issue.id).toBe(TELEGRAM_CONNECTOR_ISSUE_ID)
    expect(revived.issue.title).toBe('Telegram phone desk')
    expect(revived.issue.what).toBe('You are the Telegram phone desk for this Workspace.')
    expect(revived.issue.connectorDesk).toBe('telegram')
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

  it('rejects unsupported cadences at the domain boundary', async () => {
    const created = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsA },
      [{ id: 'ws-a', dir: wsA }],
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const updated = await updateTelegramConnectorDesk(wsA, created.issue.id, {
      when: { kind: 'every', every: '3h' },
    })
    expect(updated).toMatchObject({
      ok: false,
      reason: 'invalid',
      error: 'Unsupported heartbeat: 3h',
    })
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

  it('allows one desk per connector at the same time', async () => {
    const telegram = await createTelegramConnectorDesk(
      { id: 'ws-a', dir: wsA },
      [{ id: 'ws-a', dir: wsA }, { id: 'ws-b', dir: wsB }],
    )
    const other = await createConnectorDesk(
      'feishu',
      'Feishu',
      { id: 'ws-b', dir: wsB },
      [{ id: 'ws-a', dir: wsA }, { id: 'ws-b', dir: wsB }],
    )
    expect(telegram.ok).toBe(true)
    expect(other.ok).toBe(true)
    if (!telegram.ok || !other.ok) return
    expect(telegram.issue.connectorDesk).toBe('telegram')
    expect(other.issue.connectorDesk).toBe('feishu')
    expect(other.issue.id).toBe('feishu-phone-desk')
    expect(other.issue.title).toBe('Chat on Feishu')
    expect(other.issue.what).toBe(connectorDeskDefaultWhat('Feishu'))
    const all = await findConnectorDesks([{ id: 'ws-a', dir: wsA }, { id: 'ws-b', dir: wsB }])
    expect(all.map((desk) => desk.connectorId).sort()).toEqual(['feishu', 'telegram'])
  })
})
