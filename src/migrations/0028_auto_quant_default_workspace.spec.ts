import { describe, expect, it } from 'vitest'

import { addAutoQuantDefaultWorkspacePreference } from './0028_auto_quant_default_workspace/index.js'

describe('0028 AutoQuant default Workspace preference', () => {
  it('adds an unconfigured AutoQuant pointer without guessing from existing Workspaces', () => {
    expect(addAutoQuantDefaultWorkspacePreference({
      version: 1,
      quickChat: {
        lastCredentialByAgent: { pi: 'google-1' },
        recentChatWorkspaceId: 'chat-one',
      },
    })).toEqual({
      updated: true,
      value: {
        version: 1,
        quickChat: {
          lastCredentialByAgent: { pi: 'google-1' },
          recentChatWorkspaceId: 'chat-one',
        },
        autoQuant: { defaultWorkspaceId: null },
      },
    })
  })

  it('is idempotent and preserves an existing pointer', () => {
    const value = {
      version: 1,
      quickChat: {
        lastCredentialByAgent: {},
        recentChatWorkspaceId: null,
      },
      autoQuant: { defaultWorkspaceId: 'aq-one' },
    }
    expect(addAutoQuantDefaultWorkspacePreference(value)).toEqual({
      value,
      updated: false,
    })
  })
})
