import type { Tool } from 'ai'
import { describe, expect, it } from 'vitest'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import { sessionSignatureFactory } from './session-signature.js'

async function run(tool: Tool) {
  return await tool.execute!({}, { toolCallId: 'signature', messages: [] }) as Record<string, unknown>
}

const base = {
  workspaceId: 'ws-research',
  workspaceLabel: 'Research',
  inboxStore: {} as never,
  entityStore: {} as never,
} satisfies WorkspaceToolContext

describe('session_signature', () => {
  it('returns the authoritative current product Session signature', async () => {
    const result = await run(sessionSignatureFactory.build({
      ...base,
      origin: {
        kind: 'interactive',
        sessionId: 'launcher-record-hidden',
        resumeId: 'resume-kind-owl-abc123',
        agent: 'codex',
      },
    }))
    expect(result).toMatchObject({
      ok: true,
      signature: '@resume-kind-owl-abc123',
      resumeId: 'resume-kind-owl-abc123',
      markdown: 'Signed-by: @resume-kind-owl-abc123',
    })
  })

  it('does not fabricate a signature outside an attributable Session', async () => {
    expect(await run(sessionSignatureFactory.build(base))).toMatchObject({ ok: false })
  })
})

