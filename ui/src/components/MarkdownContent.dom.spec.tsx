// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceActionsContext } from '../contexts/workspace-actions-context'
import { MarkdownContent } from './MarkdownContent'

afterEach(cleanup)

function Report({ text, actionVersion }: { text: string; actionVersion: number }) {
  return (
    <WorkspaceActionsContext.Provider
      value={{
        openHeadlessRun: vi.fn(async () => {
          void actionVersion
        }),
      }}
    >
      <MarkdownContent text={text} variant="reading" onWikilink={vi.fn()} />
    </WorkspaceActionsContext.Provider>
  )
}

describe('MarkdownContent DOM stability', () => {
  it('preserves report nodes and browser-injected annotations across unrelated updates', () => {
    const text = '# Stable report\n\nA paragraph selected for translation.'
    const view = render(<Report text={text} actionVersion={1} />)
    const body = view.container.querySelector<HTMLElement>('.markdown-content')!
    const heading = body.querySelector('h1')!
    const annotation = document.createElement('span')
    annotation.dataset.browserTranslation = 'true'
    annotation.textContent = ' translated'
    body.querySelector('p')!.appendChild(annotation)

    view.rerender(<Report text={text} actionVersion={2} />)

    expect(view.container.querySelector('.markdown-content')).toBe(body)
    expect(view.container.querySelector('.markdown-content h1')).toBe(heading)
    expect(view.container.querySelector('[data-browser-translation="true"]')).toBe(annotation)
  })

  it('replaces generated content when the Markdown actually changes', () => {
    const view = render(<Report text="# First report" actionVersion={1} />)
    const body = view.container.querySelector<HTMLElement>('.markdown-content')!
    const firstHeading = body.querySelector('h1')!
    const annotation = document.createElement('span')
    annotation.dataset.browserTranslation = 'true'
    body.appendChild(annotation)

    view.rerender(<Report text="# Revised report" actionVersion={1} />)

    expect(view.container.querySelector('.markdown-content')).toBe(body)
    expect(body.querySelector('h1')).not.toBe(firstHeading)
    expect(body.querySelector('h1')?.textContent).toBe('Revised report')
    expect(body.querySelector('[data-browser-translation="true"]')).toBeNull()
  })
})
