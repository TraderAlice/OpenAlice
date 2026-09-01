// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '../i18n'
import { DemoBanner } from './DemoBanner'

beforeEach(async () => {
  await i18n.changeLanguage('zh')
})

afterEach(cleanup)

describe('DemoBanner', () => {
  it('uses the active interface language for the global demo notice', () => {
    render(<DemoBanner />)

    const badge = screen.getByText('演示')
    expect(badge.children).toHaveLength(0)
    expect(screen.getByText('录制预览')).toBeTruthy()
    expect(screen.getByText(/更改不会保存/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('·')
    expect(screen.getByRole('link', { name: '安装 OpenAlice' }).getAttribute('href')).toBe(
      'https://github.com/TraderAlice/OpenAlice',
    )
  })
})
