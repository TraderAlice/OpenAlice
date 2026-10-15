import { describe, expect, it } from 'vitest'
import { buildDispatchCommunication, dispatchCommunicationSchema } from './dispatch-communication.js'
import type { HeadlessTaskInquiry } from './headless-task-registry.js'

const target = { workspaceId: 'execution-ws', resumeId: 'desk-session', agent: 'codex' }
const desk = { connectorId: 'telegram' }
const inquiry = (relation: 'owner' | 'creator' | 'run', commentId?: string): HeadlessTaskInquiry => ({
  subject: { kind: 'issue', workspaceId: 'issue-ws', issueId: 'desk', relation, ...(commentId ? { commentId } : {}) },
  question: 'audit', resolution: { mode: 'exact' },
})
describe('dispatch communication authority', () => {
  it.each(['owner', 'creator', 'run'] as const)('keeps an internal ask %s private even with a known desk target', relation => {
    expect(buildDispatchCommunication({ target, inquiry: inquiry(relation), desk })).toMatchObject({ reply: { kind: 'caller' } })
    expect(buildDispatchCommunication({ target, inquiry: inquiry(relation), desk }).delivery).toBeUndefined()
  })
  it('snapshots reply ownership separately from the execution workspace', () => {
    const result = buildDispatchCommunication({ target, inquiry: inquiry('owner', 'comment-1'), desk })
    expect(result.reply).toEqual({ kind: 'issue-comment', workspaceId: 'issue-ws', issueId: 'desk', commentId: 'comment-1' })
    expect(result.delivery).toEqual({ connectorId: 'telegram', source: 'conversation', contentWorkspaceId: 'execution-ws' })
    desk.connectorId = 'slack'
    expect(result.delivery?.connectorId).toBe('telegram')
    desk.connectorId = 'telegram'
  })
  it('never redirects an inbound comment when the desk binding changes', () => {
    expect(buildDispatchCommunication({ target, inquiry: inquiry('owner', 'c'), desk: { connectorId: 'slack', inboundConnectorId: 'telegram' } }).delivery).toBeUndefined()
  })
  it('marks Issue runs as automation without giving ordinary runs a delivery', () => {
    const trigger = { kind: 'issue' as const, workspaceId: 'issue-ws', issueId: 'desk' }
    expect(buildDispatchCommunication({ target, trigger, desk }).delivery?.source).toBe('automation')
    expect(buildDispatchCommunication({ target, trigger }).delivery).toBeUndefined()
  })
  it('does not guess a destination for unassociated headless work', () => {
    expect(buildDispatchCommunication({ target, desk })).toEqual({ version: 1, origin: { kind: 'unknown' }, target, reply: { kind: 'none' } })
  })
})

it('rejects mismatched delivery semantics at the shared boundary', () => {
  const communication = buildDispatchCommunication({ target, inquiry: inquiry('owner', 'c'), desk })
  expect(() => dispatchCommunicationSchema.parse({ ...communication, reply: { kind: 'caller' } })).toThrow()
  expect(() => dispatchCommunicationSchema.parse({ ...communication, delivery: { ...communication.delivery, source: 'automation' } })).toThrow()
  expect(() => dispatchCommunicationSchema.parse({ ...communication, delivery: { ...communication.delivery, contentWorkspaceId: 'wrong' } })).toThrow()
})
