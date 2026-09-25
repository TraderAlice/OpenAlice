// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ModelCatalogStatus } from './ModelCatalogStatus'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, args?: { model?: string }) => args?.model ? `${key}: ${args.model}` : key }) }))
afterEach(cleanup)
const catalog = { enabled: true, loading: false, error: null, source: 'snapshot' as const, models: [{ id: 'new' }], refresh: vi.fn() }
it('warns for a selected model absent from a successful snapshot, including an empty list', () => {
  const { rerender } = render(<ModelCatalogStatus catalog={catalog} selectedModel="old" />)
  expect(screen.getByText('modelCatalog.missing: old')).toBeTruthy()
  rerender(<ModelCatalogStatus catalog={{ ...catalog, models: [] }} selectedModel="old" />)
  expect(screen.getByText('modelCatalog.missing: old')).toBeTruthy()
})
it('does not treat an incomplete seed list or no selection as a mismatch', () => {
  const { rerender } = render(<ModelCatalogStatus catalog={{ ...catalog, source: 'bundled' }} selectedModel="old" />)
  expect(screen.queryByText('modelCatalog.missing: old')).toBeNull()
  rerender(<ModelCatalogStatus catalog={catalog} />)
  expect(screen.queryByText(/modelCatalog.missing/)).toBeNull()
  rerender(<ModelCatalogStatus catalog={catalog} selectedModel="new" />)
  expect(screen.queryByText(/modelCatalog.missing/)).toBeNull()
})

it('keeps bundled suggestions without offering a refresh for an unsupported provider', () => {
  render(<ModelCatalogStatus catalog={{ ...catalog, source: 'bundled', discoverySupported: false }} selectedModel="manual" />)
  expect(screen.getByText('modelCatalog.bundled')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByText(/modelCatalog.missing/)).toBeNull()
})
