// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:1200/"}

import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsCollectorFeed } from '../api/types'
import { FeedsSection } from './NewsCollectorPage'

let nextId = 0
beforeEach(() => {
  nextId = 0
  vi.stubGlobal('crypto', { randomUUID: () => String(++nextId) })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const presets: NewsCollectorFeed[] = [
  { name: '财联社 · 电报', source: 'CLS', url: 'https://news.example.com/rsshub/cls/telegraph', rsshubRoute: 'cls/telegraph', enabled: true },
  { name: '格隆汇 · 实时快讯', source: 'gelonghui', url: 'https://news.example.com/rsshub/gelonghui/live', rsshubRoute: 'gelonghui/live', enabled: true },
  { name: 'Example Direct', source: 'example-direct', url: 'https://direct.example.com/feed.xml', enabled: true },
]

const presetProps = {
  presets,
  presetsLoading: false,
  presetsError: null,
  onRetryPresets: () => {},
  rsshubBaseUrl: 'https://news.example.com/rsshub',
}

function choosePreset(name: string) {
  const option = screen.getByRole('option', { name }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('News source preset'), { target: { value: option.value } })
}

describe('NewsCollectorPage feed editor', () => {
  it('confirms the named feed before removing it', () => {
    const onChange = vi.fn()
    const feeds = [
      {
        name: 'Federal Reserve Press',
        url: 'https://www.federalreserve.gov/feeds/press_all.xml',
        source: 'fed',
        enabled: true,
      },
      {
        name: 'ECB Press',
        url: 'https://www.ecb.europa.eu/rss/press.html',
        source: 'ecb',
        enabled: true,
      },
    ]
    render(<FeedsSection {...presetProps} feeds={feeds} onChange={onChange} />)

    const removeButton = screen.getByRole('button', { name: 'Remove Federal Reserve Press' })
    fireEvent.click(removeButton)

    expect(screen.getByRole('heading', { name: 'Remove Federal Reserve Press?' })).toBeTruthy()
    expect(screen.getByText(/Existing articles remain available/)).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Remove Federal Reserve Press?' })).toBeNull()
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(removeButton)
    fireEvent.click(screen.getByRole('button', { name: 'Remove feed' }))

    expect(onChange).toHaveBeenCalledWith([feeds[1]])
    expect(screen.queryByRole('heading', { name: 'Remove Federal Reserve Press?' })).toBeNull()
  })

  it('rejects an invalid feed URL before submitting the feed', () => {
    const onChange = vi.fn()
    render(<FeedsSection {...presetProps} feeds={[]} onChange={onChange} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Example Markets' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Source tag' }), {
      target: { value: 'example-markets' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Feed URL' }), {
      target: { value: 'not-a-url' },
    })

    const addButton = screen.getByRole('button', { name: 'Add Feed' })
    const urlInput = screen.getByRole('textbox', { name: 'Feed URL' })

    fireEvent.click(addButton)
    expect(urlInput.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('submits a trimmed feed after the URL becomes valid', () => {
    const onChange = vi.fn()
    render(<FeedsSection {...presetProps} feeds={[]} onChange={onChange} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: ' Example Markets ' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Source tag' }), {
      target: { value: ' example-markets ' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Feed URL' }), {
      target: { value: ' https://example.com/rss.xml ' },
    })

    const addButton = screen.getByRole('button', { name: 'Add Feed' })

    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(addButton)

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({
      id: expect.any(String),
      name: 'Example Markets',
      url: 'https://example.com/rss.xml',
      source: 'example-markets',
      enabled: true,
    })])
  })
})

describe('RSSHub news presets', () => {
  it('appends server routes and uses the shared instance for newly entered routes without altering direct feeds', () => {
    const existing: NewsCollectorFeed = {
      id: 'existing-id', name: 'Existing feed', source: 'existing', url: 'https://example.com/rss', enabled: false,
    }
    const onFeedsChange = vi.fn()
    function Editor() {
      const [feeds, setFeeds] = useState<NewsCollectorFeed[]>([existing])
      const [base, setBase] = useState(presetProps.rsshubBaseUrl)
      return (
        <>
          <button type="button" onClick={() => setBase('http://localhost:1210')}>Switch instance</button>
          <FeedsSection {...presetProps} rsshubBaseUrl={base} feeds={feeds} onChange={(next) => { setFeeds(next); onFeedsChange(next) }} />
        </>
      )
    }
    render(<Editor />)
    choosePreset('RSSHub · 财联社 · 电报')
    fireEvent.click(screen.getByRole('button', { name: 'Add preset' }))
    choosePreset('RSSHub · 格隆汇 · 实时快讯')
    fireEvent.click(screen.getByRole('button', { name: 'Add preset' }))

    expect(screen.getByText((text) => text.includes('cls/telegraph'))).toBeTruthy()
    expect(screen.getByText((text) => text.includes('gelonghui/live'))).toBeTruthy()
    expect(screen.getByText('https://example.com/rss')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Existing feed' }).getAttribute('aria-checked')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Switch instance' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Source type' }), { target: { value: 'rsshub' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Custom route' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Source tag' }), { target: { value: 'custom' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'RSSHub route' }), { target: { value: 'custom/feed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Feed' }))
    expect(onFeedsChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      existing,
      expect.objectContaining({ source: 'custom', rsshubRoute: 'custom/feed', url: 'http://localhost:1210/custom/feed' }),
    ]))
    expect(screen.getByText('https://example.com/rss')).toBeTruthy()
  })

  it('keeps saved feeds unchanged while the server preset menu loads', () => {
    const feed: NewsCollectorFeed = { name: 'Existing feed', source: 'existing', url: 'https://example.com/rss', enabled: false }
    const onChange = vi.fn()
    const { rerender } = render(<FeedsSection {...presetProps} feeds={[feed]} onChange={onChange} />)
    rerender(<FeedsSection {...presetProps} presets={[]} presetsLoading feeds={[feed]} onChange={onChange} />)
    expect(screen.getByText('https://example.com/rss')).toBeTruthy()
    expect((screen.getByLabelText('News source preset') as HTMLSelectElement).disabled).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('preserves a feed identity when editing the same source', () => {
    const feed: NewsCollectorFeed = { id: 'stable-feed-id', name: 'Existing feed', source: 'existing', url: 'https://example.com/rss', enabled: false }
    const onChange = vi.fn()
    render(<FeedsSection {...presetProps} feeds={[feed]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = within(screen.getByText('Edit source').closest('form') as HTMLFormElement)
    fireEvent.change(editor.getByRole('textbox', { name: 'Name' }), { target: { value: 'Renamed feed' } })
    fireEvent.click(editor.getByRole('button', { name: 'Save' }))
    expect(onChange).toHaveBeenCalledWith([{ ...feed, name: 'Renamed feed' }])
  })

  it('rebuilds an explicit RSSHub companion URL without retaining credentials', () => {
    const feed: NewsCollectorFeed = { id: 'rsshub-id', name: 'RSSHub feed', source: 'rsshub', url: 'https://news.example.com/rsshub/cls?key=old&display=full', rsshubRoute: 'cls', enabled: true }
    const onChange = vi.fn()
    render(<FeedsSection {...presetProps} feeds={[feed]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = within(screen.getByText('Edit source').closest('form') as HTMLFormElement)
    fireEvent.click(editor.getByRole('button', { name: 'Save' }))
    const saved = onChange.mock.calls[0][0][0] as NewsCollectorFeed
    expect(saved.url).toBe('https://news.example.com/rsshub/cls')
    expect(saved.url).not.toContain('key=')
    expect(saved.rsshubRoute).toBe('cls')
  })

  it('keeps a legacy absolute RSSHub-looking URL direct until RSSHub is explicitly selected', () => {
    const legacyUrl = 'https://news.example.com/rsshub/cls/telegraph'
    const legacyFeed: NewsCollectorFeed = {
      name: 'Legacy CLS feed', source: 'CLS', url: legacyUrl, enabled: false,
    }
    const onFeedsChange = vi.fn()
    function Editor() {
      const [feeds, setFeeds] = useState<NewsCollectorFeed[]>([legacyFeed])
      const [base, setBase] = useState(presetProps.rsshubBaseUrl)
      return (
        <>
          <button type="button" onClick={() => setBase('http://localhost:1210/rsshub')}>Switch instance</button>
          <FeedsSection {...presetProps} rsshubBaseUrl={base} feeds={feeds} onChange={(next) => { setFeeds(next); onFeedsChange(next) }} />
        </>
      )
    }
    render(<Editor />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch instance' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = within(screen.getByText('Edit source').closest('form') as HTMLFormElement)
    expect((editor.getByRole('combobox', { name: 'Source type' }) as HTMLSelectElement).value).toBe('direct')
    expect((editor.getByRole('textbox', { name: 'Feed URL' }) as HTMLInputElement).value).toBe(legacyUrl)
    fireEvent.change(editor.getByRole('textbox', { name: 'Name' }), { target: { value: 'Renamed legacy feed' } })
    fireEvent.click(editor.getByRole('button', { name: 'Save' }))

    const savedDirect = onFeedsChange.mock.calls[0][0][0] as NewsCollectorFeed
    expect(savedDirect.url).toBe(legacyUrl)
    expect(savedDirect).not.toHaveProperty('rsshubRoute')

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const migratedEditor = within(screen.getByText('Edit source').closest('form') as HTMLFormElement)
    fireEvent.change(migratedEditor.getByRole('combobox', { name: 'Source type' }), { target: { value: 'rsshub' } })
    fireEvent.change(migratedEditor.getByRole('textbox', { name: 'RSSHub route' }), { target: { value: 'cls/telegraph' } })
    fireEvent.click(migratedEditor.getByRole('button', { name: 'Save' }))

    const savedRoute = onFeedsChange.mock.calls[1][0][0] as NewsCollectorFeed
    expect(savedRoute).toEqual(expect.objectContaining({
      name: 'Renamed legacy feed',
      url: 'http://localhost:1210/rsshub/cls/telegraph',
      rsshubRoute: 'cls/telegraph',
    }))
  })

  it.each([
    ['same-origin absolute URL', 'http://127.0.0.1:1200/rsshub/cls/telegraph'],
    ['RSSHub-origin absolute URL', 'https://rsshub.invalid/cls/telegraph'],
    ['percent-encoded traversal', 'cls/%2e%2e/admin'],
  ])('rejects %s in an RSSHub route before adding the feed', (_kind, route) => {
    const onChange = vi.fn()
    render(<FeedsSection {...presetProps} feeds={[]} onChange={onChange} />)
    const editor = within(screen.getByText('Add source').closest('form') as HTMLFormElement)
    fireEvent.change(editor.getByRole('textbox', { name: 'Name' }), { target: { value: 'Unsafe route' } })
    fireEvent.change(editor.getByRole('textbox', { name: 'Source tag' }), { target: { value: 'unsafe-route' } })
    fireEvent.change(editor.getByRole('combobox', { name: 'Source type' }), { target: { value: 'rsshub' } })
    const routeInput = editor.getByRole('textbox', { name: 'RSSHub route' })
    fireEvent.change(routeInput, { target: { value: route } })
    expect((routeInput as HTMLInputElement).value).toBe(route)

    fireEvent.click(editor.getByRole('button', { name: 'Add Feed' }))
    expect(routeInput.getAttribute('aria-invalid')).toBe('true')
    expect(editor.getByRole('alert')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rejects a credential-bearing direct URL before adding the feed', () => {
    const onChange = vi.fn()
    render(<FeedsSection {...presetProps} feeds={[]} onChange={onChange} />)
    const editor = within(screen.getByText('Add source').closest('form') as HTMLFormElement)
    fireEvent.change(editor.getByRole('textbox', { name: 'Name' }), { target: { value: 'Private feed' } })
    fireEvent.change(editor.getByRole('textbox', { name: 'Source tag' }), { target: { value: 'private-feed' } })
    const urlInput = editor.getByRole('textbox', { name: 'Feed URL' })
    fireEvent.change(urlInput, { target: { value: 'https://user:password@example.com/rss.xml' } })

    fireEvent.click(editor.getByRole('button', { name: 'Add Feed' }))
    expect(urlInput.getAttribute('aria-invalid')).toBe('true')
    expect(editor.getByRole('alert')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })


  it('does not duplicate or enable an already configured disabled route', () => {
    const onChange = vi.fn()
    render(<FeedsSection {...presetProps} feeds={[{
      id: 'original-id', name: 'My CLS', source: 'CLS', url: 'https://old.example.com/cls/telegraph', rsshubRoute: 'cls/telegraph', enabled: false,
    }]} onChange={onChange} />)
    choosePreset('RSSHub · 财联社 · 电报')
    const add = screen.getByRole('button', { name: 'Already added' })
    expect(add.hasAttribute('disabled')).toBe(true)
    fireEvent.click(add)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('switch', { name: 'My CLS' }).getAttribute('aria-checked')).toBe('false')
  })
})
