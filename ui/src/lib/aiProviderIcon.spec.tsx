// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { AIProviderIcon } from './aiProviderIcon'

afterEach(cleanup)

it('uses a neutral vector mark for custom providers', () => {
  const { container } = render(<AIProviderIcon vendor="custom" />)

  expect(container.querySelector('svg[data-ai-provider-icon="custom"]')).toBeTruthy()
})
