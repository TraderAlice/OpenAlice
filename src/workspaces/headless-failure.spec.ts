import { describe, expect, it } from 'vitest'
import { headlessFailureSummary } from './headless-failure.js'
import type { HeadlessStructuredOutput } from './headless-output.js'

const output = (blocks: HeadlessStructuredOutput['blocks']): HeadlessStructuredOutput => ({
  schemaVersion: 1, blocks, assistantText: null,
  metrics: { textBlocks: 0, toolCalls: 0, toolFailures: 0 }, truncated: false,
})

describe('headless failure summary', () => {
  it('prefers the terminal structured error to stderr warnings', () => {
    expect(headlessFailureSummary({ status: 'failed', exitCode: 1,
      structured: output([{ type: 'error', message: 'No API key found for the selected model' }]),
      stderrTail: 'Experimental feature enabled',
    })).toBe('No API key found for the selected model')
  })
  it('does not report warnings or recovered errors as a successful turn failure', () => {
    expect(headlessFailureSummary({ status: 'done', error: 'old error',
      stderrTail: 'Experimental feature enabled',
      structured: output([{ type: 'error', message: 'retrying' }, { type: 'text', text: 'Recovered' }]),
    })).toBeUndefined()
  })
  it('uses stderr after an earlier structured error has been recovered', () => {
    expect(headlessFailureSummary({ status: 'failed', exitCode: 1, stderrTail: '\x1b[31mFatal startup error\x1b[0m\n',
      structured: output([{ type: 'error', message: 'retrying' }, { type: 'text', text: 'Recovered' }]),
    })).toBe('Fatal startup error')
  })
  it('reports termination causes even when no diagnostic exists', () => {
    expect(headlessFailureSummary({ status: 'failed', killed: true, stderrTail: 'Warning' })).toContain('timeout watchdog')
    expect(headlessFailureSummary({ status: 'failed', signal: 'SIGTERM' })).toContain('SIGTERM')
    expect(headlessFailureSummary({ status: 'failed', exitCode: 7 })).toContain('code 7')
    expect(headlessFailureSummary({ status: 'interrupted' })).toContain('interrupted')
  })
})
