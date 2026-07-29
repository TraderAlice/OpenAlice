// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PageHeader } from './PageHeader'

afterEach(cleanup)

describe('PageHeader action layout', () => {
  it('opts substantial action groups into content-pane responsive stacking', () => {
    const { container } = render(
      <PageHeader
        title="Portfolio account"
        description="Connected"
        right={<button type="button">Place Order</button>}
        stackActionsOnNarrow
      />,
    )

    const header = container.firstElementChild as HTMLElement
    expect(header.style.containerType).toBe('inline-size')
    expect(header.querySelector('.oa-page-header-stack-actions')).toBeTruthy()
    expect(
      header.querySelector('.oa-page-header-actions')?.contains(
        screen.getByRole('button', { name: 'Place Order' }),
      ),
    ).toBe(true)
  })

  it('keeps ordinary compact headers on their existing inline layout', () => {
    const { container } = render(
      <PageHeader
        title="Issues"
        right={<button type="button" aria-label="Settings">Settings</button>}
      />,
    )

    const header = container.firstElementChild as HTMLElement
    expect(header.style.containerType).toBe('')
    expect(header.querySelector('.oa-page-header-stack-actions')).toBeNull()
    expect(header.querySelector('.oa-page-header-actions')).toBeNull()
  })
})
