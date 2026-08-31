// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { SaveIndicator } from './SaveIndicator'

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => cleanup())

describe('SaveIndicator', () => {
  it('announces localized saving and saved states without relying on color', async () => {
    await i18n.changeLanguage('zh')
    const { rerender } = render(<SaveIndicator status="saving" />)

    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.getAttribute('aria-atomic')).toBe('true')
    expect(status.textContent).toBe('保存中…')
    expect(status.querySelector('svg')).toBeTruthy()

    rerender(<SaveIndicator status="saved" />)
    expect(screen.getByRole('status').textContent).toBe('已保存')
    expect(screen.getByRole('status').querySelector('svg')).toBeTruthy()
  })

  it('renders an explicit retry action for a failed save', () => {
    const retry = vi.fn()
    render(<SaveIndicator status="error" onRetry={retry} />)

    expect(screen.getByRole('status').textContent).toContain('Save failed')
    const button = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement
    expect(button.type).toBe('button')
    fireEvent.click(button)
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('renders nothing while idle', () => {
    const { container } = render(<SaveIndicator status="idle" />)
    expect(container.firstChild).toBeNull()
  })
})
