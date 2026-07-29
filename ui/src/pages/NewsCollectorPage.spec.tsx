// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FeedsSection } from './NewsCollectorPage'

afterEach(cleanup)

describe('NewsCollectorPage feed editor', () => {
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
