// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NewsCollectorFeed } from '../api/types'
import { FeedsSection } from './NewsCollectorPage'

afterEach(cleanup)

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
    render(<FeedsSection feeds={feeds} onChange={onChange} />)

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
    render(<FeedsSection feeds={[]} onChange={onChange} />)

    fireEvent.change(screen.getByPlaceholderText('e.g. CoinDesk'), {
      target: { value: 'Example Markets' },
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. coindesk'), {
      target: { value: 'example-markets' },
    })
    fireEvent.change(screen.getByPlaceholderText('https://example.com/rss.xml'), {
      target: { value: 'not-a-url' },
    })

    const addButton = screen.getByRole('button', { name: 'Add Feed' })
    const urlInput = screen.getByPlaceholderText('https://example.com/rss.xml')

    expect((addButton as HTMLButtonElement).disabled).toBe(true)
    expect(urlInput.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toContain('Enter a valid URL')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('submits a trimmed feed after the URL becomes valid', () => {
    const onChange = vi.fn()
    render(<FeedsSection feeds={[]} onChange={onChange} />)

    fireEvent.change(screen.getByPlaceholderText('e.g. CoinDesk'), {
      target: { value: ' Example Markets ' },
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. coindesk'), {
      target: { value: ' example-markets ' },
    })
    fireEvent.change(screen.getByPlaceholderText('https://example.com/rss.xml'), {
      target: { value: ' https://example.com/rss.xml ' },
    })

    const addButton = screen.getByRole('button', { name: 'Add Feed' })

    expect((addButton as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(addButton)

    expect(onChange).toHaveBeenCalledWith([{
      name: 'Example Markets',
      url: 'https://example.com/rss.xml',
      source: 'example-markets',
      enabled: true,
    }])
  })
})

describe('RSSHub news presets', () => {
  it('adds CLS and Jin10 under a reverse-proxy prefix without replacing existing feeds', () => {
    function Editor() {
      const [feeds, setFeeds] = useState<NewsCollectorFeed[]>([{
        name: 'Existing feed', source: 'existing', url: 'https://example.com/rss', enabled: false,
      }])
      return <FeedsSection feeds={feeds} onChange={setFeeds} />
    }
    render(<Editor />)
    fireEvent.change(screen.getByLabelText('RSSHub instance URL'), {
      target: { value: ' https://news.example.com/rsshub/// ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add 财联社 · 电报' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add 金十数据 · 市场快讯' }))
    expect(screen.getByText('https://news.example.com/rsshub/jin10')).toBeTruthy()
    expect(screen.getByText('https://news.example.com/rsshub/cls/telegraph')).toBeTruthy()
    expect(screen.queryByText('https://news.example.com/rsshub/gelonghui/live')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add 格隆汇 · 实时快讯' })).toBeNull()
    expect(screen.getByText('https://example.com/rss')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Existing feed' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('button', { name: 'Added 财联社 · 电报' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('RSSHub instance URL'), { target: { value: 'http://localhost:1200' } })
    expect(screen.getByText('https://news.example.com/rsshub/cls/telegraph')).toBeTruthy()
  })

  it('adds the built-in Gelonghui source without an RSSHub URL', () => {
    function Editor() {
      const [feeds, setFeeds] = useState<NewsCollectorFeed[]>([{
        name: 'Existing feed', source: 'existing', url: 'https://example.com/rss', enabled: false,
      }])
      return <FeedsSection feeds={feeds} onChange={setFeeds} />
    }
    render(<Editor />)

    expect((screen.getByLabelText('RSSHub instance URL') as HTMLInputElement).value).toBe('')
    const add = screen.getByRole('button', { name: 'Add or replace built-in Gelonghui direct collection' })
    expect(add.hasAttribute('disabled')).toBe(false)
    fireEvent.click(add)

    expect(screen.getByRole('switch', { name: '格隆汇实时快讯' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('https://www.gelonghui.com/live')).toBeTruthy()
    expect(screen.getByText('Built-in direct collection from Gelonghui live news.')).toBeTruthy()
    expect(screen.getByText('source: gelonghui')).toBeTruthy()
    expect(screen.getByText('https://example.com/rss')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Existing feed' }).getAttribute('aria-checked')).toBe('false')
  })


  it('preserves a custom feed whose source tag matches the built-in provider', () => {
    const customUrl = 'https://example.com/custom-news.xml'
    function Editor() {
      const [feeds, setFeeds] = useState<NewsCollectorFeed[]>([{
        name: 'Custom Gelonghui-tagged feed', source: 'gelonghui', url: customUrl, enabled: false,
      }])
      return <FeedsSection feeds={feeds} onChange={setFeeds} />
    }
    render(<Editor />)

    fireEvent.click(screen.getByRole('button', { name: 'Add or replace built-in Gelonghui direct collection' }))

    expect(screen.getByText(customUrl)).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Custom Gelonghui-tagged feed' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: '格隆汇实时快讯' }).getAttribute('aria-checked')).toBe('true')
  })
  it('replaces a legacy Gelonghui feed in place without duplicating or changing other feeds', () => {
    const urls = [
      'https://example.com/before',
      'https://old-rsshub.example.com/gelonghui/live',
      'https://example.com/after',
    ]
    function Editor() {
      const [feeds, setFeeds] = useState<NewsCollectorFeed[]>([
        { name: 'Before', source: 'before', url: urls[0], enabled: true },
        { name: '格隆汇 · 实时快讯', source: 'gelonghui', url: urls[1], enabled: false },
        { name: 'After', source: 'after', url: urls[2], enabled: false },
      ])
      return <FeedsSection feeds={feeds} onChange={setFeeds} />
    }
    render(<Editor />)
    fireEvent.click(screen.getByRole('button', { name: 'Add or replace built-in Gelonghui direct collection' }))

    const displayedUrls = screen.getAllByText(/^https?:\/\//).map((element) => element.textContent)
    expect(displayedUrls).toEqual([urls[0], 'https://www.gelonghui.com/live', urls[2]])
    expect(screen.queryByText(urls[1])).toBeNull()
    expect(screen.getAllByText('source: gelonghui')).toHaveLength(1)
    expect(screen.getByRole('switch', { name: '格隆汇实时快讯' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Before' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'After' }).getAttribute('aria-checked')).toBe('false')
  })

  it('requires an HTTP instance URL without embedded secrets or discarded URL components', () => {
    const onChange = vi.fn()
    render(<FeedsSection feeds={[]} onChange={onChange} />)
    const input = screen.getByLabelText('RSSHub instance URL')
    const add = screen.getByRole('button', { name: 'Add 财联社 · 电报' })
    expect(add.hasAttribute('disabled')).toBe(true)
    for (const value of ['file:///tmp/rss', 'https://user:secret@example.com', 'https://example.com?key=secret', 'https://example.com#feed']) {
      fireEvent.change(input, { target: { value } })
      expect(input.getAttribute('aria-invalid')).toBe('true')
      fireEvent.click(add)
    }
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'http://localhost:1200' } })
    expect(add.hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not duplicate or enable a previously configured source on another instance', () => {
    const onChange = vi.fn()
    render(<FeedsSection feeds={[{
      name: 'My CLS', source: 'CLS', url: 'https://old.example.com/cls/telegraph', enabled: false,
    }]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('RSSHub instance URL'), { target: { value: 'http://localhost:1200' } })
    const add = screen.getByRole('button', { name: 'Added 财联社 · 电报' })
    expect(add.hasAttribute('disabled')).toBe(true)
    fireEvent.click(add)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('switch', { name: 'My CLS' }).getAttribute('aria-checked')).toBe('false')
  })
})
