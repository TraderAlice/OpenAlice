// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { IssuePage } from './IssuePage'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
}))

vi.mock('../components/IssuesBoard', () => ({
  IssuesBoard: () => <div>board</div>,
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: unknown) => unknown) => selector({
    openOrFocus: mocks.openOrFocus,
  }),
}))

beforeEach(async () => {
  await i18n.changeLanguage('zh')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('IssuePage', () => {
  it('localizes the page heading and settings action', () => {
    render(<IssuePage />)

    expect(screen.getByText('议题')).toBeTruthy()
    expect(screen.getByText('集中查看所有工作区追踪的工作。')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '议题设置' }))
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'settings',
      params: { category: 'issues' },
    })
  })
})
