import { describe, expect, it } from 'vitest'

import { claudeAdapter } from './adapters/claude.js'
import { codexAdapter } from './adapters/codex.js'
import { agyAdapter } from './adapters/agy.js'
import { cursorAdapter } from './adapters/cursor.js'
import { grokAdapter } from './adapters/grok.js'
import { opencodeAdapter } from './adapters/opencode.js'
import { piAdapter } from './adapters/pi.js'
import type { CliAdapter } from './cli-adapter.js'
import { parseHeadlessOutputText } from './headless-output.js'

function parse(
  adapter: CliAdapter,
  events: readonly Record<string, unknown>[],
  sourceTruncated = false,
) {
  return parseHeadlessOutputText({
    text: events.map((event) => JSON.stringify(event)).join('\n'),
    extractEvents: adapter.extractHeadlessOutputEvents?.bind(adapter),
    extractAssistantText: adapter.extractHeadlessAssistantText?.bind(adapter),
    sourceTruncated,
  })
}

describe('headless structured output', () => {
  it('pairs Claude tool_use/tool_result and keeps the final reply', () => {
    const output = parse(claudeAdapter, [
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'alice status' } }] },
      },
      {
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Everything is ready.' }] } },
      { type: 'result', subtype: 'success', result: 'Everything is ready.' },
    ])
    expect(output.assistantText).toBe('Everything is ready.')
    expect(output.blocks).toContainEqual({
      type: 'tool', id: 't1', name: 'Bash', status: 'completed', input: { command: 'alice status' }, output: 'ok',
    })
    expect(output.metrics).toEqual({ textBlocks: 1, toolCalls: 1, toolFailures: 0 })
  })

  it('normalizes the Claude 2.1.202 failed-tool stream while ignoring thinking as a reply', () => {
    const output = parse(claudeAdapter, [
      { type: 'system', subtype: 'init', session_id: 'claude-session', model: 'MiniMax-M3' },
      { type: 'system', subtype: 'thinking_tokens', session_id: 'claude-session', estimated_tokens: 42 },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'I should inspect the file.' }] },
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use', id: 'call-live', name: 'Read',
            input: { file_path: '/workspace/AGENTS.md', limit: 1, pages: '' },
          }],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result', tool_use_id: 'call-live', is_error: true,
            content: '<tool_use_error>Invalid pages parameter</tool_use_error>',
          }],
        },
      },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'CLAUDE_ASYNC_RUN_OK' }] },
      },
      { type: 'result', subtype: 'success', is_error: false, result: 'CLAUDE_ASYNC_RUN_OK' },
    ])

    expect(output.assistantText).toBe('CLAUDE_ASYNC_RUN_OK')
    expect(output.blocks).toEqual([
      {
        type: 'tool', id: 'call-live', name: 'Read', status: 'failed',
        input: { file_path: '/workspace/AGENTS.md', limit: 1, pages: '' },
        output: '<tool_use_error>Invalid pages parameter</tool_use_error>',
      },
      { type: 'text', text: 'CLAUDE_ASYNC_RUN_OK' },
    ])
    expect(output.metrics).toEqual({ textBlocks: 1, toolCalls: 1, toolFailures: 1 })
  })

  it('normalizes Codex command execution and file-change items', () => {
    const output = parse(codexAdapter, [
      { type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'alice status', status: 'in_progress' } },
      { type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: 'alice status', aggregated_output: 'ok', exit_code: 0, status: 'completed' } },
      { type: 'item.started', item: { id: 'f1', type: 'file_change', changes: [{ path: 'report.md' }], status: 'in_progress' } },
      { type: 'item.completed', item: { id: 'f1', type: 'file_change', changes: [{ path: 'report.md' }], status: 'completed' } },
      { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'Report written.' } },
    ])
    expect(output.assistantText).toBe('Report written.')
    expect(output.metrics.toolCalls).toBe(2)
    expect(output.blocks).toContainEqual(expect.objectContaining({ type: 'tool', id: 'c1', name: 'Shell', status: 'completed' }))
    expect(output.blocks).toContainEqual(expect.objectContaining({ type: 'tool', id: 'f1', name: 'File changes', status: 'completed' }))
  })

  it('normalizes the Codex 0.144.1 command stream and keeps the latest reply', () => {
    const output = parse(codexAdapter, [
      { type: 'thread.started', thread_id: 'codex-session' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'I will run the check.' } },
      {
        type: 'item.started',
        item: {
          id: 'item_1', type: 'command_execution', command: "/bin/zsh -lc 'printf CODEX_TOOL_OK'",
          aggregated_output: '', exit_code: null, status: 'in_progress',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'item_1', type: 'command_execution', command: "/bin/zsh -lc 'printf CODEX_TOOL_OK'",
          aggregated_output: 'CODEX_TOOL_OK', exit_code: 0, status: 'completed',
        },
      },
      { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'CODEX_HEADLESS_OK' } },
      { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
    ])

    expect(output.assistantText).toBe('CODEX_HEADLESS_OK')
    expect(output.blocks).toEqual([
      { type: 'text', text: 'I will run the check.' },
      {
        type: 'tool', id: 'item_1', name: 'Shell', status: 'completed',
        input: { command: "/bin/zsh -lc 'printf CODEX_TOOL_OK'" }, output: 'CODEX_TOOL_OK',
      },
      { type: 'text', text: 'CODEX_HEADLESS_OK' },
    ])
    expect(output.metrics).toEqual({ textBlocks: 2, toolCalls: 1, toolFailures: 0 })
  })

  it('keeps runtime-level failures as error blocks', () => {
    const codex = parse(codexAdapter, [
      { type: 'item.completed', item: { id: 'e1', type: 'error', message: 'Codex reconnecting' } },
      { type: 'error', message: 'Codex stream failed' },
      { type: 'turn.failed', error: { message: 'Codex provider unavailable' } },
    ])
    const opencode = parse(opencodeAdapter, [
      { type: 'error', error: { name: 'APIError', data: { message: 'OpenCode provider unavailable' } } },
    ])
    const pi = parse(piAdapter, [
      {
        type: 'message_end',
        message: {
          role: 'assistant', stopReason: 'error', errorMessage: 'Pi provider unavailable', content: [],
        },
      },
    ])
    expect(codex.blocks).toEqual([
      { type: 'error', message: 'Codex reconnecting' },
      { type: 'error', message: 'Codex stream failed' },
      { type: 'error', message: 'Codex provider unavailable' },
    ])
    expect(opencode.blocks).toContainEqual({ type: 'error', message: 'OpenCode provider unavailable' })
    expect(pi.blocks).toContainEqual({ type: 'error', message: 'Pi provider unavailable' })
  })

  it('deduplicates repeated terminal runtime errors', () => {
    const output = parse(codexAdapter, [
      { type: 'error', message: 'provider unavailable' },
      { type: 'turn.failed', error: { message: 'provider unavailable' } },
    ])
    expect(output.blocks).toEqual([{ type: 'error', message: 'provider unavailable' }])
  })

  it('normalizes current Codex web-search, MCP, and collaboration items', () => {
    const output = parse(codexAdapter, [
      { type: 'item.started', item: { id: 'w1', type: 'web_search', query: 'OpenAlice', action: { type: 'search' } } },
      { type: 'item.completed', item: { id: 'w1', type: 'web_search', query: 'OpenAlice', action: { type: 'search' } } },
      { type: 'item.started', item: { id: 'm1', type: 'mcp_tool_call', tool: 'lookup', arguments: { q: 'x' }, status: 'in_progress' } },
      { type: 'item.completed', item: { id: 'm1', type: 'mcp_tool_call', tool: 'lookup', error: { message: 'offline' }, status: 'failed' } },
      { type: 'item.started', item: { id: 'c1', type: 'collab_tool_call', tool: 'spawn_agent', receiver_thread_ids: [], prompt: 'inspect', status: 'in_progress' } },
      { type: 'item.completed', item: { id: 'c1', type: 'collab_tool_call', tool: 'spawn_agent', receiver_thread_ids: ['child'], agents_states: { child: { status: 'completed' } }, status: 'completed' } },
    ])
    expect(output.metrics).toEqual({ textBlocks: 0, toolCalls: 3, toolFailures: 1 })
    expect(output.blocks).toContainEqual(expect.objectContaining({ id: 'w1', name: 'Web search', status: 'completed' }))
    expect(output.blocks).toContainEqual(expect.objectContaining({ id: 'm1', name: 'lookup', status: 'failed', output: { message: 'offline' } }))
    expect(output.blocks).toContainEqual(expect.objectContaining({ id: 'c1', name: 'Collaboration · spawn agent', status: 'completed' }))
  })

  it('normalizes Cursor stream-json tools and keeps the terminal result', () => {
    const output = parse(cursorAdapter, [
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: "I'll read the README.md file" }] },
        session_id: 'c6b62c6f-7ead-4fd6-9922-e952131177ff',
      },
      {
        type: 'tool_call',
        subtype: 'started',
        call_id: 'toolu_read',
        tool_call: { readToolCall: { args: { path: 'README.md' } } },
        session_id: 'c6b62c6f-7ead-4fd6-9922-e952131177ff',
      },
      {
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'toolu_read',
        tool_call: {
          readToolCall: {
            args: { path: 'README.md' },
            result: { success: { content: '# Project\n' } },
          },
        },
        session_id: 'c6b62c6f-7ead-4fd6-9922-e952131177ff',
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: "I'll read the README.md fileBased on the README, I'll create a summary",
        session_id: 'c6b62c6f-7ead-4fd6-9922-e952131177ff',
      },
    ])
    expect(output.assistantText).toBe(
      "I'll read the README.md fileBased on the README, I'll create a summary",
    )
    expect(output.blocks).toEqual([
      { type: 'text', text: "I'll read the README.md file" },
      {
        type: 'tool',
        id: 'toolu_read',
        name: 'read',
        status: 'completed',
        input: { path: 'README.md' },
        output: { content: '# Project\n' },
      },
    ])
    expect(output.metrics).toEqual({ textBlocks: 1, toolCalls: 1, toolFailures: 0 })
  })

  it('normalizes Antigravity stream-json tools and keeps the terminal result', () => {
    const output = parse(agyAdapter, [
      {
        event: 'init',
        conversation_id: 'c3b66b04-872b-4fbe-a3a4-058a026ef20a',
        init: { cwd: '/home/user/project', tools: ['run_command'] },
      },
      {
        event: 'step_update',
        step_update: {
          conversation_id: 'c3b66b04-872b-4fbe-a3a4-058a026ef20a',
          step_index: 3,
          state: 'DONE',
          step_type: 'agent_response',
          text_delta: 'Git rebase rewrites history.\n',
        },
      },
      {
        event: 'step_update',
        step_update: {
          conversation_id: 'c3b66b04-872b-4fbe-a3a4-058a026ef20a',
          step_index: 4,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: 'run_command',
          tool_info: { name: 'run_command', parameters: { CommandLine: 'echo hello' } },
        },
      },
      {
        event: 'step_update',
        step_update: {
          conversation_id: 'c3b66b04-872b-4fbe-a3a4-058a026ef20a',
          step_index: 4,
          state: 'DONE',
          step_type: 'tool',
          tool_name: 'run_command',
          tool_info: {
            name: 'run_command',
            parameters: { CommandLine: 'echo hello' },
            output: 'hello\r\n',
          },
        },
      },
      {
        event: 'result',
        result: {
          conversation_id: 'c3b66b04-872b-4fbe-a3a4-058a026ef20a',
          status: 'SUCCESS',
          response: 'Git rebase rewrites history.\n',
        },
      },
    ])
    expect(output.assistantText).toBe('Git rebase rewrites history.')
    expect(output.blocks).toEqual([
      { type: 'text', text: 'Git rebase rewrites history.' },
      {
        type: 'tool',
        id: 'step-4',
        name: 'run_command',
        status: 'completed',
        input: { CommandLine: 'echo hello' },
        output: 'hello\r\n',
      },
    ])
    expect(output.metrics).toEqual({ textBlocks: 1, toolCalls: 1, toolFailures: 0 })
  })

  it('normalizes Grok 1.0.4 flattened streaming-json tools and keeps the last reply', () => {
    const output = parse(grokAdapter, [
      { type: 'thought', data: 'I should run echo.' },
      { type: 'text', data: 'I will run ' },
      { type: 'text', data: '`echo PING`.' },
      {
        type: 'tool_call',
        toolCallId: 'call-echo',
        title: 'run_terminal_command',
        kind: 'execute',
        status: 'pending',
        toolName: 'run_terminal_command',
        rawInput: { command: 'echo PING', description: 'Print PING' },
        content: [],
      },
      {
        type: 'tool_call_update',
        toolCallId: 'call-echo',
        status: null,
        content: [],
        rawOutput: null,
      },
      {
        type: 'tool_call_update',
        toolCallId: 'call-echo',
        status: 'in_progress',
        content: [{ type: 'content', content: { type: 'text', text: 'PING\n' } }],
        rawOutput: { type: 'Bash', output: [80, 73, 78, 71, 10], output_for_prompt: 'PING\n' },
      },
      {
        type: 'tool_call_update',
        toolCallId: 'call-echo',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'PING\n' } }],
        rawOutput: {
          type: 'Bash',
          output: [80, 73, 78, 71, 10],
          output_for_prompt: 'exit: 0\nPING\n',
          exit_code: 0,
          command: 'echo PING',
        },
      },
      { type: 'text', data: 'DONE' },
      { type: 'end', stopReason: 'end_turn', sessionId: '01a009ff-50a1-7550-a80f-f5144d904634' },
    ])
    expect(output.assistantText).toBe('DONE')
    expect(output.blocks).toEqual([
      { type: 'text', text: 'I will run `echo PING`.' },
      {
        type: 'tool',
        id: 'call-echo',
        name: 'run_terminal_command',
        status: 'completed',
        input: { command: 'echo PING', description: 'Print PING' },
        output: 'exit: 0\nPING\n',
      },
      { type: 'text', text: 'DONE' },
    ])
    expect(output.metrics).toEqual({ textBlocks: 2, toolCalls: 1, toolFailures: 0 })
  })

  it('normalizes Grok failed tools and aborted ends', () => {
    const output = parse(grokAdapter, [
      {
        type: 'tool_call',
        toolCallId: 'call-fail',
        toolName: 'run_terminal_command',
        rawInput: { command: 'false' },
      },
      {
        type: 'tool_call_update',
        toolCallId: 'call-fail',
        status: 'failed',
        rawOutput: { output_for_prompt: 'exit: 1\n' },
      },
      { type: 'end', stopReason: 'aborted', sessionId: '01a009ff-50a1-7550-a80f-f5144d904634' },
    ])
    expect(output.blocks).toEqual([
      {
        type: 'tool',
        id: 'call-fail',
        name: 'run_terminal_command',
        status: 'failed',
        input: { command: 'false' },
        output: 'exit: 1\n',
      },
      { type: 'error', message: 'Grok stopped: aborted' },
    ])
    expect(output.metrics).toEqual({ textBlocks: 0, toolCalls: 1, toolFailures: 1 })
  })

  it('normalizes Pi execution events and failed tools', () => {
    const output = parse(piAdapter, [
      { type: 'tool_execution_start', toolCallId: 'p1', toolName: 'bash', args: { command: 'false' } },
      { type: 'tool_execution_end', toolCallId: 'p1', toolName: 'bash', result: { content: 'failed' }, isError: true },
      { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'The command failed.' }] } },
    ])
    expect(output.assistantText).toBe('The command failed.')
    expect(output.metrics).toEqual({ textBlocks: 1, toolCalls: 1, toolFailures: 1 })
  })

  it('skips Pi cumulative message_update frames before JSON parsing', () => {
    const cumulativeFrame = '{"type":"message_update", deliberately-not-valid-json'
    expect(piAdapter.extractHeadlessOutputEvents?.(cumulativeFrame)).toEqual([])
    expect(piAdapter.extractHeadlessAssistantText?.(cumulativeFrame)).toBeNull()
    expect(piAdapter.keepHeadlessDiagnosticLine?.(cumulativeFrame)).toBe(false)
    expect(piAdapter.keepHeadlessDiagnosticLine?.('{"type":"tool_execution_update"}')).toBe(false)
    expect(piAdapter.keepHeadlessDiagnosticLine?.('{"type":"message_end"}')).toBe(true)
  })

  it('accepts OpenCode part.state tool snapshots', () => {
    const output = parse(opencodeAdapter, [
      {
        type: 'tool_use',
        sessionID: 'ses_1',
        part: {
          type: 'tool', callID: 'o1', tool: 'bash',
          state: { status: 'completed', input: { command: 'alice status' }, output: 'ok' },
        },
      },
      { type: 'text', sessionID: 'ses_1', part: { type: 'text', text: 'Done.' } },
    ])
    expect(output.assistantText).toBe('Done.')
    expect(output.blocks).toContainEqual({
      type: 'tool', id: 'o1', name: 'bash', status: 'completed', input: { command: 'alice status' }, output: 'ok',
    })
  })

  it('marks unfinished tools failed after a finished/truncated run', () => {
    const output = parse(piAdapter, [
      { type: 'tool_execution_start', toolCallId: 'p1', toolName: 'bash', args: {} },
    ], true)
    expect(output.blocks).toContainEqual(expect.objectContaining({ id: 'p1', status: 'failed' }))
    expect(output.truncated).toBe(true)
  })
})
