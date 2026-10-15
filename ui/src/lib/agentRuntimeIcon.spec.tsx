// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { AgentRuntimeIcon } from './agentRuntimeIcon'

afterEach(cleanup)

it('keeps a generic vector fallback for extension runtimes', () => {
  const { container } = render(<AgentRuntimeIcon agentId="future-runtime" />)

  expect(container.querySelector('svg[data-agent-runtime-icon="future-runtime"]')).toBeTruthy()
})
