// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AgentRuntimeIcon } from './agentRuntimeIcon'

afterEach(cleanup)

describe('AgentRuntimeIcon', () => {
  it('provides a distinct brand mark for every registered agent runtime', () => {
    const ids = ['claude', 'codex', 'cursor', 'agy', 'grok', 'omp', 'opencode', 'pi']
    const { container } = render(
      <div>{ids.map((id) => <AgentRuntimeIcon key={id} agentId={id} />)}</div>,
    )

    for (const id of ids) {
      expect(container.querySelector(`[data-agent-runtime-icon="${id}"]`)).toBeTruthy()
    }
  })

  it('keeps a generic vector fallback for extension runtimes', () => {
    const { container } = render(<AgentRuntimeIcon agentId="future-runtime" />)

    expect(container.querySelector('svg[data-agent-runtime-icon="future-runtime"]')).toBeTruthy()
  })

  it('renders the Codex glyph without the color asset white tile', () => {
    const { container } = render(<AgentRuntimeIcon agentId="codex" />)

    const icon = container.querySelector<HTMLElement>('[data-agent-runtime-icon="codex"]')
    expect(icon?.tagName).toBe('SPAN')
    expect(icon?.classList.contains('bg-current')).toBe(true)
    expect(container.querySelector('img[data-agent-runtime-icon="codex"]')).toBeNull()
  })
})
