import { describe, expect, it } from 'vitest'

import { parseSessionCreatedBy, parseSessionMetadata, sessionMetadata } from './session-metadata.js'

describe('session-metadata', () => {
  it('wraps createdBy into the metadata bag', () => {
    expect(sessionMetadata({ kind: 'headless', surface: 'api' })).toEqual({
      createdBy: { kind: 'headless', surface: 'api' },
    })
  })

  it('parses every product birth kind', () => {
    expect(parseSessionCreatedBy({ kind: 'interactive', surface: 'quick-chat' })).toEqual({
      kind: 'interactive',
      surface: 'quick-chat',
    })
    expect(parseSessionCreatedBy({
      kind: 'issue',
      workspaceId: 'ws-1',
      issueId: 'daily',
      policy: 'new-each-run',
      fire: 'schedule',
    })).toEqual({
      kind: 'issue',
      workspaceId: 'ws-1',
      issueId: 'daily',
      policy: 'new-each-run',
      fire: 'schedule',
    })
    expect(parseSessionCreatedBy({
      kind: 'conversation',
      caller: { kind: 'agent', resumeId: 'resume-a', workspaceId: 'ws-a' },
      reason: 'explicit-workspace',
      subject: { kind: 'inbox', entryId: 'entry-1' },
    })).toEqual({
      kind: 'conversation',
      caller: { kind: 'agent', resumeId: 'resume-a', workspaceId: 'ws-a' },
      reason: 'explicit-workspace',
      subject: { kind: 'inbox', entryId: 'entry-1' },
    })
  })

  it('rejects malformed birth stamps without throwing', () => {
    expect(parseSessionMetadata(null)).toBeNull()
    expect(parseSessionMetadata({ createdBy: { kind: 'interactive', surface: 'nope' } })).toBeNull()
    expect(parseSessionMetadata({ createdBy: { kind: 'issue', workspaceId: 'ws' } })).toBeNull()
    expect(parseSessionMetadata({ createdBy: { kind: 'conversation', caller: { kind: 'human' } } })).toBeNull()
  })
})
