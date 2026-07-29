// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
