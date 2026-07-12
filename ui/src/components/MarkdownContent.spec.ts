import { describe, expect, it } from 'vitest'

import { renderMarkdownHtml } from './MarkdownContent'

describe('renderMarkdownHtml', () => {
  it('keeps GFM strikethrough enabled by default', () => {
    const html = renderMarkdownHtml('Keep ~~this~~ struck.')

    expect(html).toContain('<del>this</del>')
  })

  it('can disable strikethrough for financial agent comments', () => {
    const html = renderMarkdownHtml(
      'Tough stock at ~$197 — wait for reclaim-and-hold 50d (~$188); value lower.',
      { strikethrough: false },
    )

    expect(html).not.toContain('<del>')
    expect(html).toContain('~$197')
    expect(html).toContain('(~$188)')
  })

  it('preserves other GFM inline behavior when strikethrough is disabled', () => {
    const html = renderMarkdownHtml('Source: http://example.com and [[stock-glw]].', {
      strikethrough: false,
    })

    expect(html).toContain('<a href="http://example.com">http://example.com</a>')
    expect(html).toContain('class="wikilink"')
  })

  it('keeps exact code-span wikilinks as code by default', () => {
    const html = renderMarkdownHtml('Tracked `[[stock-glw]]`.')

    expect(html).toContain('<code>[[stock-glw]]</code>')
    expect(html).not.toContain('class="wikilink"')
  })

  it('can render exact code-span wikilinks as entity links for inbox comments', () => {
    const html = renderMarkdownHtml('Tracked `[[stock-glw]]` + `[[ai-data-center-power]]`.', {
      codeSpanWikilinks: true,
      strikethrough: false,
    })

    expect(html).not.toContain('<code>')
    expect(html).toContain('data-entity="stock-glw"')
    expect(html).toContain('data-entity="ai-data-center-power"')
  })

  it('renders a Session signature as a resumable link but leaves code examples alone', () => {
    const html = renderMarkdownHtml('Signed-by: @resume-kind-owl-abc123 and `@resume-example`')
    expect(html).toContain('class="session-signature"')
    expect(html).toContain('data-resume-id="resume-kind-owl-abc123"')
    expect(html).toContain('<code>@resume-example</code>')
  })
})
