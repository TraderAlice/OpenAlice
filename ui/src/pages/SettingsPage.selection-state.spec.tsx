// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { useLocaleStore } from '../i18n/store'
import { LanguageSection, SettingsTabBar } from './SettingsPage'

beforeEach(async () => {
  localStorage.clear()
  useLocaleStore.setState({ locale: 'zh' })
  await i18n.changeLanguage('zh')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Settings selection controls', () => {
  it('exposes the current language and updates the pressed state immediately', () => {
    render(<LanguageSection />)

    const group = screen.getByRole('group', { name: '语言' })
    expect(group).toBeTruthy()
    expect(screen.getByRole('button', { name: '中文' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'English' }).className).toContain('min-h-10')

    fireEvent.click(screen.getByRole('button', { name: 'English' }))

    expect(useLocaleStore.getState().locale).toBe('en')
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '中文' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('exposes the active Settings page view without changing its button interaction', () => {
    const onSelect = vi.fn()
    const { rerender } = render(<SettingsTabBar tab="settings" onSelect={onSelect} />)

    expect(screen.getByRole('button', { name: '设置' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '工具' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '设置' }).className).toContain('min-h-10')

    fireEvent.click(screen.getByRole('button', { name: '工具' }))
    expect(onSelect).toHaveBeenCalledWith('tools')

    rerender(<SettingsTabBar tab="tools" onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: '设置' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '工具' }).getAttribute('aria-pressed')).toBe('true')
  })
})
