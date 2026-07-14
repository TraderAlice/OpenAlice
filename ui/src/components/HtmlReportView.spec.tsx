import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createSandboxedHtmlReportDocument, HtmlReportView } from './HtmlReportView'

afterEach(cleanup)

describe('HtmlReportView', () => {
  it('keeps static presentation markup while removing active content', () => {
    const document = createSandboxedHtmlReportDocument(`<!doctype html>
      <html><head>
        <style>.metric { color: rebeccapurple }</style>
        <script>parent.postMessage('owned', '*')</script>
      </head><body>
        <h1 class="metric" onclick="alert(1)">Close report</h1>
        <svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>
        <form action="https://example.com"><input name="secret"></form>
      </body></html>`)

    expect(document).toContain('.metric { color: rebeccapurple }')
    expect(document).toContain('<svg')
    expect(document).toContain('Content-Security-Policy')
    expect(document).not.toContain('<script')
    expect(document).not.toContain('onclick=')
    expect(document).not.toContain('<form')
    expect(document).not.toContain('<input')
  })

  it('removes external resource and navigation URLs but keeps embedded data', () => {
    const document = createSandboxedHtmlReportDocument(`
      <img id="remote" src="https://tracker.example/pixel.png">
      <img id="embedded" src="data:image/svg+xml;base64,PHN2Zy8+">
      <a id="external" href="https://example.com">external</a>
      <a id="local" href="#details">details</a>
    `)
    const parsed = new DOMParser().parseFromString(document, 'text/html')

    expect(parsed.querySelector('#remote')?.hasAttribute('src')).toBe(false)
    expect(parsed.querySelector('#embedded')?.getAttribute('src')).toMatch(/^data:/)
    expect(parsed.querySelector('#external')?.hasAttribute('href')).toBe(false)
    expect(parsed.querySelector('#local')?.getAttribute('href')).toBe('#details')
  })

  it('renders through an origin-less iframe sandbox', () => {
    render(<HtmlReportView path="research/close.html" content="<h1>Close</h1>" />)

    const frame = screen.getByTitle('HTML report: research/close.html')
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Close</h1>')
  })
})
