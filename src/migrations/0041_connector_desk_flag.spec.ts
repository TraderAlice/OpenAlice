import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrateConnectorDeskFlag, rewriteIssueDocument } from './0041_connector_desk_flag/index.js'

describe('0041 connector desk flag', () => {
  it('rewrites the shipped Telegram boolean into connectorDesk', () => {
    const next = rewriteIssueDocument(`---
title: Telegram phone desk
telegramConnector: true
---

You are the Telegram phone desk.
`)
    expect(next).toContain('connectorDesk: telegram')
    expect(next).not.toContain('telegramConnector')
    expect(next).toContain('You are the Telegram phone desk.')
  })

  it('is a no-op when the file is already on the new key', () => {
    const raw = `---
title: Desk
connectorDesk: telegram
---

x
`
    expect(rewriteIssueDocument(raw)).toBe(raw)
  })

  it('walks catalog workspaces and rewrites issue files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'connector-desk-flag-'))
    const ws = join(root, 'ws-a')
    await mkdir(join(ws, '.alice', 'issues'), { recursive: true })
    await mkdir(join(root, 'state'), { recursive: true })
    await writeFile(join(root, 'state', 'workspace-catalog.json'), JSON.stringify({
      version: 1,
      workspaces: [{
        id: 'ws-a',
        tag: 'a',
        activeDir: ws,
        createdAt: '2026-08-01T00:00:00.000Z',
        lifecycle: 'active',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }],
    }))
    await writeFile(join(ws, '.alice', 'issues', 'telegram-phone-desk.md'), `---
title: Telegram phone desk
status: todo
telegramConnector: true
---

Wake up.
`)
    await migrateConnectorDeskFlag(root)
    const rewritten = await readFile(join(ws, '.alice', 'issues', 'telegram-phone-desk.md'), 'utf8')
    expect(rewritten).toContain('connectorDesk: telegram')
    expect(rewritten).not.toContain('telegramConnector')
  })
})
