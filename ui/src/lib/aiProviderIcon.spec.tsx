// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AIProviderIcon } from './aiProviderIcon'

afterEach(cleanup)

describe('AIProviderIcon', () => {
  it('renders every registered provider identity', () => {
    const vendors = [
      'anthropic',
      'openai',
      'google',
      'xai',
      'minimax',
      'glm',
      'kimi',
      'deepseek',
      'longcat',
      'openrouter',
      'cursor',
    ]
    const { container } = render(
      <div>{vendors.map((vendor) => <AIProviderIcon key={vendor} vendor={vendor} />)}</div>,
    )

    for (const vendor of vendors) {
      expect(container.querySelector(`[data-ai-provider-icon="${vendor}"]`)).toBeTruthy()
    }
  })

  it('uses a neutral vector mark for custom providers', () => {
    const { container } = render(<AIProviderIcon vendor="custom" />)

    expect(container.querySelector('svg[data-ai-provider-icon="custom"]')).toBeTruthy()
  })

  it('keeps monochrome marks transparent and theme-aware', () => {
    const { container } = render(<AIProviderIcon vendor="openai" />)

    const icon = container.querySelector<HTMLElement>('[data-ai-provider-icon="openai"]')
    expect(icon?.tagName).toBe('SPAN')
    expect(icon?.classList.contains('bg-current')).toBe(true)
  })
})
