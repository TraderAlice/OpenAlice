// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { DevPage } from './DevPage'

vi.mock('../api/tools', () => ({
  toolsApi: {
    load: vi.fn().mockResolvedValue({ inventory: [] }),
    detail: vi.fn(),
    execute: vi.fn(),
  },
}))

beforeEach(async () => {
  await i18n.changeLanguage('zh')
})

afterEach(cleanup)

describe('DevPage', () => {
  it('localizes the Tools entry experience and names its filter', () => {
    render(<DevPage spec={{ kind: 'dev', params: { tab: 'tools' } }} />)

    expect(screen.getByRole('heading', { name: '工具' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '筛选工具…' }).getAttribute('placeholder')).toBe(
      '筛选工具…',
    )
    expect(screen.getByText('请从左侧面板选择一个工具。')).toBeTruthy()
  })
})
