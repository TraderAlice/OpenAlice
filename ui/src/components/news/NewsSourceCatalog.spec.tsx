// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { NewsSourceCatalog } from './NewsSourceCatalog'

const presets = [
  { name: '财联社 · 电报', source: 'cls', url: 'https://feed.example/cls', rsshubRoute: 'cls/telegraph', categories: ['cn', 'markets'] },
  { name: 'Federal Reserve Press', source: 'fed', url: 'https://fed.example/feed', categories: ['macro'] },
]
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('news source catalog', () => {
  it('moves focus to the directory heading when opened from News', async () => {
    render(<NewsSourceCatalog presets={presets} feeds={[]} loading={false} error={null} onRetry={vi.fn()} onAdd={vi.fn()} focusDirectory />)
    const heading = screen.getByRole('heading', { name: /Source directory/ })
    await new Promise(resolve => requestAnimationFrame(resolve))
    expect(document.activeElement).toBe(heading)
  })
  it('shows access requirements and lets the user explicitly add a searched source', () => {
    const onAdd = vi.fn()
    render(<NewsSourceCatalog presets={presets} feeds={[]} loading={false} error={null} onRetry={() => {}} onAdd={onAdd} />)
    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Source directory' }).tabIndex).toBe(0)
    expect(screen.getByText('RSSHub required')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Country / region' }), { target: { value: 'cn' } })
    expect(screen.queryByRole('heading', { name: 'Federal Reserve Press' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Country / region' }), { target: { value: 'all' } })
    expect(screen.getByRole('heading', { name: 'Federal Reserve Press' })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a source' }), { target: { value: '财联社' } })
    expect(screen.queryByRole('heading', { name: 'Federal Reserve Press' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add source: 财联社 · 电报' }))
    expect(onAdd).toHaveBeenCalledWith(presets[0])
  })

  it('marks a disabled subscription as already added and exposes an empty search result', () => {
    render(<NewsSourceCatalog presets={presets} feeds={[{ ...presets[0], source: 'CLS', enabled: false }]} loading={false} error={null} onRetry={() => {}} onAdd={vi.fn()} />)
    const card = screen.getByRole('heading', { name: '财联社 · 电报' }).closest('article')!
    expect((within(card).getByRole('button', { name: 'Already added' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing source' } })
    expect(screen.getByText('No matching sources.')).toBeTruthy()
  })

  it('combines region and market filters using coverage rather than publisher language', () => {
    const onAdd = vi.fn()
    render(<NewsSourceCatalog presets={[
      { ...presets[1], regions: ['us'], markets: ['macro', 'bonds'] },
      { ...presets[0], regions: ['cn'], markets: ['markets'] },
      { name: '金十数据', source: 'jin10', url: 'https://feed.example/jin10', regions: ['global'], markets: ['macro', 'fx', 'commodities'] },
      { name: '华尔街见闻 · 美股', source: 'wallstreetcn-us', url: 'https://feed.example/us', regions: ['us'], markets: ['markets'] },
    ]} feeds={[]} loading={false} error={null} onRetry={vi.fn()} onAdd={onAdd} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Country / region' }), { target: { value: 'us' } })
    expect(screen.getByRole('heading', { name: 'Federal Reserve Press' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '华尔街见闻 · 美股' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '金十数据' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Macro' }))
    expect(screen.getByRole('heading', { name: 'Federal Reserve Press' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '华尔街见闻 · 美股' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('1 of 4')
    fireEvent.change(screen.getByRole('combobox', { name: 'Country / region' }), { target: { value: 'global' } })
    expect(screen.queryByRole('heading', { name: 'Federal Reserve Press' })).toBeNull()
    const card = screen.getByRole('heading', { name: '金十数据' }).closest('article')!
    expect(card.textContent).toContain('Global')
    expect(card.textContent).toContain('Forex')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'United States' } })
    expect(screen.getByText('No matching sources.')).toBeTruthy()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('can search translated coverage labels and represents unclassified custom entries explicitly', async () => {
    await i18n.changeLanguage('zh')
    render(<NewsSourceCatalog presets={[
      { ...presets[1], regions: ['us'], markets: ['macro', 'bonds'] },
      { name: 'Custom source', source: 'custom', url: 'https://feed.example/custom' },
    ]} feeds={[]} loading={false} error={null} onRetry={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Custom source' }).closest('article')?.textContent).toContain('未分类')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '美国' } })
    expect(screen.getByRole('heading', { name: 'Federal Reserve Press' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Custom source' })).toBeNull()
  })

  it('distinguishes a failed catalog from an empty search and allows retry', () => {
    const onRetry = vi.fn()
    render(<NewsSourceCatalog presets={[]} feeds={[]} loading={false} error="Catalog unavailable" onRetry={onRetry} onAdd={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('Catalog unavailable')
    expect(screen.queryByText('No matching sources.')).toBeNull()
    expect((screen.getByRole('searchbox') as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
