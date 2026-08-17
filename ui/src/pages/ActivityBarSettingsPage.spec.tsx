// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import '../i18n'
import { i18n } from '../i18n'
import { defaultUiLayout, type UiLayout } from '../live/ui-layout'
import { ActivityBarSettingsPage } from './ActivityBarSettingsPage'

const mocks = vi.hoisted(() => ({
  layout: {
    version: 1 as const,
    groups: [] as UiLayout['groups'],
    hidden: ['dev'] as UiLayout['hidden'],
  },
  save: vi.fn(async (layout: UiLayout) => { mocks.layout = layout }),
  reset: vi.fn(async () => { mocks.layout = {
    version: 1 as const,
    groups: [],
    hidden: ['dev'],
  } }),
}))

vi.mock('../hooks/useUiLayout', () => ({
  useUiLayout: () => ({
    layout: mocks.layout,
    loading: false,
    error: null,
    save: mocks.save,
    reset: mocks.reset,
    refresh: async () => undefined,
  }),
}))

vi.mock('../hooks/useAliceProject', () => ({
  useAliceProject: () => ({
    project: { product: 'trader' },
    loading: false,
    error: null,
    refresh: async () => undefined,
  }),
}))

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  mocks.layout = defaultUiLayout()
  mocks.save.mockClear()
  mocks.reset.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('ActivityBarSettingsPage', () => {
  it('persists the first visibility edit instead of treating it as hydration', async () => {
    render(<ActivityBarSettingsPage />)

    const toggle = screen.getByRole('switch', { name: 'Show Dev Panel' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByRole('switch', { name: 'Hide Dev Panel' }).getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce(), { timeout: 1_500 })
    expect(mocks.save.mock.calls[0]?.[0].hidden).not.toContain('dev')
  })

  it('creates a custom group and can reset to the default document', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ActivityBarSettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Add group' }))
    expect(screen.getByDisplayValue('New group')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(mocks.reset).toHaveBeenCalledOnce()
  })

  it('reorders a row while the pointer is held and persists it on release', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const item = this.closest('[data-nav-item]')
      if (item?.parentElement) {
        const index = [...item.parentElement.querySelectorAll('[data-nav-item]')].indexOf(item)
        return DOMRect.fromRect({ x: 0, y: index * 40, width: 240, height: 40 })
      }
      const card = this.closest('[data-nav-group-card]')
      if (card) {
        const index = [...document.querySelectorAll('[data-nav-group-card]')].indexOf(card)
        return DOMRect.fromRect({ x: 0, y: index * 320, width: 240, height: 320 })
      }
      return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 })
    }
    try {
      render(<ActivityBarSettingsPage />)
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Reorder Ask Alice' }), {
        pointerId: 1,
        button: 0,
        clientX: 20,
        clientY: 10,
      })
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: 70 })

      const pages = [...document.querySelectorAll('[data-nav-group-card="primary"] [data-nav-item]')]
        .map((node) => node.getAttribute('data-nav-item'))
      expect(pages.slice(0, 2)).toEqual(['inbox', 'chat'])
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 20, clientY: 70 })
      await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce(), { timeout: 1_500 })
      expect(mocks.save.mock.calls[0]?.[0].groups[0]?.items.slice(0, 2)).toEqual(['inbox', 'chat'])
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })
})
