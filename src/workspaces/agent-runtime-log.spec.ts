import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { AgentRuntimeLog, conversationCause, issueCause } from './agent-runtime-log.js'

const silent = { warn() { /* test */ } }

async function openLog(): Promise<{ log: AgentRuntimeLog; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-runtime-log-'))
  const path = join(dir, 'agent-runtime.jsonl')
  return { log: await AgentRuntimeLog.open(path, silent), path }
}

describe('AgentRuntimeLog', () => {
  it('records a born → started → stopped occupancy chain', async () => {
    const { log } = await openLog()
    const subject = { workspaceId: 'desk-a', resumeId: 'resume-alice', agent: 'pi' }
    const born = await log.record('session.born', { ...subject, sessionRecordId: 'pi-1' })
    const started = await log.record('runtime.started', {
      ...subject,
      sessionRecordId: 'pi-1',
      taskId: 'run-1',
      surface: 'headless',
      cause: issueCause('desk-a', 'morning-scan'),
    }, { causedBy: born?.seq })
    await log.record('runtime.stopped', {
      ...subject,
      taskId: 'run-1',
      surface: 'headless',
      status: 'done',
    }, { causedBy: started?.seq })

    const entries = await log.read()
    expect(entries.map((entry) => entry.type)).toEqual([
      'session.born',
      'runtime.started',
      'runtime.stopped',
    ])
    expect(entries[1]?.causedBy).toBe(born?.seq)
    expect(entries[2]?.payload).toMatchObject({ status: 'done', taskId: 'run-1' })
  })

  it('serves newest-first pages and afterSeq replay', async () => {
    const { log } = await openLog()
    const subject = { workspaceId: 'desk-a', resumeId: 'resume-alice', agent: 'codex' }
    await log.record('session.born', subject)
    await log.record('runtime.started', { ...subject, surface: 'terminal', cause: { kind: 'ui' } })
    await log.record('runtime.stopped', { ...subject, surface: 'terminal', status: 'paused' })

    const page = await log.query({ page: 1, pageSize: 2 })
    expect(page.total).toBe(3)
    expect(page.entries.map((entry) => entry.type)).toEqual(['runtime.stopped', 'runtime.started'])

    const replay = await log.read({ afterSeq: 1 })
    expect(replay.map((entry) => entry.seq)).toEqual([2, 3])
  })

  it('records a conversation reject without inventing a task', async () => {
    const { log, path } = await openLog()
    await log.record('runtime.rejected', {
      workspaceId: 'desk-a',
      resumeId: 'resume-gone',
      agent: 'pi',
      reason: 'retired-session',
      cause: conversationCause({
        source: { kind: 'session', workspaceId: 'desk-b', resumeId: 'resume-caller', agent: 'codex' },
      }),
    })
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain('"type":"runtime.rejected"')
    expect(raw).not.toContain('taskId')
  })

  it('records headless turn text and tool status without tool I/O', async () => {
    const { log, path } = await openLog()
    const subject = { workspaceId: 'desk-a', resumeId: 'resume-alice', agent: 'codex', taskId: 'run-1', surface: 'headless' as const }
    await log.record('runtime.turn.tool', {
      ...subject,
      toolId: 't1',
      toolName: 'workspace_list',
      toolStatus: 'running',
    })
    await log.record('runtime.turn.text', { ...subject, text: 'Desk is clear.' })
    await log.record('runtime.stopped', {
      ...subject,
      status: 'done',
      assistantText: 'Desk is clear.',
      metrics: { textBlocks: 1, toolCalls: 1, toolFailures: 0 },
    })
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain('"type":"runtime.turn.tool"')
    expect(raw).toContain('"type":"runtime.turn.text"')
    expect(raw).toContain('"assistantText":"Desk is clear."')
    expect(raw).not.toContain('input')
    expect(raw).not.toContain('output')
  })

  it('recovers one enriched live projection event per Session', async () => {
    const { log, path } = await openLog()
    const subject = { workspaceId: 'desk-a', resumeId: 'resume-alice', agent: 'claude' }
    await log.record('runtime.started', { ...subject, surface: 'headless', cause: { kind: 'http' } })
    await log.record('runtime.turn.text', { ...subject, text: 'Still working.' })
    await log.record('runtime.started', {
      workspaceId: 'desk-b',
      resumeId: 'resume-bob',
      agent: 'pi',
      surface: 'webpi',
      cause: { kind: 'ui' },
    })

    expect(log.firstSeq()).toBe(1)
    expect(log.projectionEvents()).toHaveLength(2)
    expect(log.projectionEvents()[0]).toMatchObject({
      seq: 2,
      type: 'runtime.turn.text',
      payload: { workspaceId: 'desk-a', resumeId: 'resume-alice', surface: 'headless' },
    })

    await log.close()
    const reopened = await AgentRuntimeLog.open(path, silent)
    expect(reopened.firstSeq()).toBe(1)
    expect(reopened.projectionEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        seq: 2,
        payload: expect.objectContaining({ resumeId: 'resume-alice', surface: 'headless' }),
      }),
      expect.objectContaining({
        seq: 3,
        payload: expect.objectContaining({ resumeId: 'resume-bob', surface: 'webpi' }),
      }),
    ]))
  })

})
