import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Logger } from './logger.js'
import { ResumeRegistry } from './resume-registry.js'

const noopLogger = { warn() {} } as unknown as Logger
let dir: string
let path: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'resume-registry-'))
  path = join(dir, 'resume-identities.json')
})
afterEach(async () => rm(dir, { recursive: true, force: true }))

describe('ResumeRegistry', () => {
  it('maps one product resumeId to a backend-only native session id', async () => {
    const registry = await ResumeRegistry.load(path, noopLogger)
    const created = await registry.ensure({ wsId: 'ws-1', agent: 'claude', now: 1 })
    expect(created.resumeId).toMatch(/^resume-[a-z]+-[a-z]+-[a-z]+-[0-9a-z]{6}$/)
    await registry.bindAgentSessionId(created.resumeId, 'native-claude-session')

    const reloaded = await ResumeRegistry.load(path, noopLogger)
    expect(reloaded.get(created.resumeId)).toMatchObject({
      wsId: 'ws-1',
      agent: 'claude',
      lifecycle: 'active',
      agentSessionId: 'native-claude-session',
    })
  })

  it('refuses to move an identity across workspace or runtime boundaries', async () => {
    const registry = await ResumeRegistry.load(path, noopLogger)
    const created = await registry.ensure({ wsId: 'ws-1', agent: 'pi' })
    await expect(registry.ensure({ resumeId: created.resumeId, wsId: 'ws-2', agent: 'pi' }))
      .rejects.toThrow(/belongs to ws-1\/pi/)
  })

  it('keeps legacy UUID identities valid without rewriting them', async () => {
    const registry = await ResumeRegistry.load(path, noopLogger)
    const legacyId = '550e8400-e29b-41d4-a716-446655440000'
    const record = await registry.ensure({
      resumeId: legacyId,
      wsId: 'ws-legacy',
      agent: 'codex',
    })

    expect(record.resumeId).toBe(legacyId)
    expect((await ResumeRegistry.load(path, noopLogger)).get(legacyId)?.resumeId).toBe(legacyId)
  })

  it('lists one workspace newest-first for directory projection', async () => {
    const registry = await ResumeRegistry.load(path, noopLogger)
    await registry.ensure({ resumeId: 'resume-old', wsId: 'ws-1', agent: 'pi', now: 1 })
    await registry.ensure({ resumeId: 'resume-other', wsId: 'ws-2', agent: 'codex', now: 3 })
    await registry.ensure({ resumeId: 'resume-new', wsId: 'ws-1', agent: 'claude', now: 2 })

    expect(registry.list({ wsId: 'ws-1' }).map((record) => record.resumeId))
      .toEqual(['resume-new', 'resume-old'])
  })

  it('retires and recalls a Workspace without losing native identity history', async () => {
    const registry = await ResumeRegistry.load(path, noopLogger)
    await registry.ensure({
      resumeId: 'resume-owner', wsId: 'ws-1', agent: 'pi', agentSessionId: 'native-1', now: 1,
    })
    await registry.ensure({
      resumeId: 'resume-successor', wsId: 'ws-2', agent: 'codex', agentSessionId: 'native-2', now: 2,
    })
    await registry.retireWorkspace('ws-1', {
      reason: 'Workspace departed',
      successors: { 'resume-owner': 'resume-successor' },
      now: 3,
    })
    expect(registry.get('resume-owner')).toMatchObject({
      lifecycle: 'retired',
      retiredAt: 3,
      retirementReason: 'Workspace departed',
      successorResumeId: 'resume-successor',
      agentSessionId: 'native-1',
    })
    await expect(registry.ensure({ resumeId: 'resume-owner', wsId: 'ws-1', agent: 'pi' }))
      .rejects.toThrow(/retired/)

    await registry.recallWorkspace('ws-1', 4)
    expect(registry.get('resume-owner')).toMatchObject({
      lifecycle: 'active',
      updatedAt: 4,
      agentSessionId: 'native-1',
    })
    expect(registry.get('resume-owner')).not.toHaveProperty('retiredAt')
    expect(registry.get('resume-owner')).not.toHaveProperty('successorResumeId')
  })
})
