import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FileContentView } from './FileContentView'

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
})
