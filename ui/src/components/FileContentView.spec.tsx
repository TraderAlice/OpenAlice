import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FileContentView } from './FileContentView'

vi.mock('./MarkdownContent', () => ({
  MarkdownContent: ({ text, variant }: { text: string; variant?: string }) => (
    <div data-testid="markdown" data-variant={variant}>{text}</div>
  ),
}))

describe('FileContentView', () => {
  it('renders .html reports in the isolated report viewer', () => {
    render(<FileContentView path="research/close.html" result={{ kind: 'ok', content: '<h1>Close</h1>' }} />)

    expect(screen.getByTitle('HTML report: research/close.html')).toBeTruthy()
  })

  it('does not treat the legacy .htm extension as an HTML report', () => {
    render(<FileContentView path="research/legacy.htm" result={{ kind: 'ok', content: '<h1>Legacy</h1>' }} />)

    expect(screen.queryByTitle('HTML report: research/legacy.htm')).toBeNull()
    expect(screen.getByText('<h1>Legacy</h1>')).toBeTruthy()
  })

  it('renders durable Markdown files with long-form reading typography', () => {
    render(<FileContentView path="research/thesis.md" result={{ kind: 'ok', content: '# Thesis' }} />)

    expect(screen.getByTestId('markdown').getAttribute('data-variant')).toBe('reading')
  })
})
