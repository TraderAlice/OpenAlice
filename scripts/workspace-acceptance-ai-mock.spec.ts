import { describe, expect, it } from 'vitest'

import {
  cliToolCallStream,
  textCompletionStream,
  WORKSPACE_ACCEPTANCE_AGENT_ISSUE_ID,
  WORKSPACE_ACCEPTANCE_ASSISTANT_TEXT,
} from './workspace-acceptance-ai-mock.mjs'

function dataPayloads(stream: string) {
  return stream
    .split('\n\n')
    .filter((line) => line.startsWith('data: {'))
    .map((line) => JSON.parse(line.slice('data: '.length)))
}

describe('workspace acceptance AI mock', () => {
  it('drives Pi through its real bash tool into the Workspace CLI', () => {
    const payloads = dataPayloads(cliToolCallStream())
    const call = payloads[0].choices[0].delta.tool_calls[0]

    expect(call.function.name).toBe('bash')
    expect(JSON.parse(call.function.arguments).command).toContain(
      `alice-workspace issue create --id ${WORKSPACE_ACCEPTANCE_AGENT_ISSUE_ID}`,
    )
    expect(payloads.at(-1).choices[0].finish_reason).toBe('tool_calls')
  })

  it('returns a structured final assistant reply after the tool result', () => {
    const payloads = dataPayloads(textCompletionStream(WORKSPACE_ACCEPTANCE_ASSISTANT_TEXT))

    expect(payloads[1].choices[0].delta.content).toBe(WORKSPACE_ACCEPTANCE_ASSISTANT_TEXT)
    expect(payloads.at(-1).choices[0].finish_reason).toBe('stop')
  })
})
