// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsCategoryList } from './SettingsCategoryList'

const mocks = vi.hoisted(() => ({
  product: 'trader' as 'trader' | 'nano' | undefined,
}))

vi.mock('../hooks/useAliceProject', () => ({
  useAliceProject: () => ({
    project: mocks.product ? { product: mocks.product } : null,
    loading: false,
    error: null,
    refresh: async () => undefined,
  }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: Record<string, unknown>) => unknown) => selector({
    openOrFocus: vi.fn(),
  }),
}))

vi.mock('../tabs/types', () => ({
  getFocusedTab: () => null,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('./SidebarRow', () => ({
  SidebarRow: ({ label }: { label: string }) => <button type="button">{label}</button>,
}))

afterEach(() => {
  cleanup()
  mocks.product = 'trader'
})

describe('SettingsCategoryList', () => {
  it('hides trading and market-data categories on NanoAlice', () => {
    mocks.product = 'nano'
    render(<SettingsCategoryList />)
    expect(screen.queryByText('settings.category.trading')).toBeNull()
    expect(screen.queryByText('settings.category.marketData')).toBeNull()
    expect(screen.queryByText('settings.category.newsSources')).toBeNull()
    expect(screen.getByText('settings.category.aiProvider')).toBeTruthy()
  })
})
