// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AutomationApiSection } from './AutomationApiSection'

afterEach(cleanup)

describe('AutomationApiSection', () => {
  it('teaches durable scheduled ownership and the canonical markdown What', () => {
    const { container } = render(<AutomationApiSection />)
    const scheduledExample = container.querySelector('pre')

    expect(scheduledExample?.textContent).toContain('assignee: "@new-then-resume"')
    expect(scheduledExample?.textContent).not.toContain('assignee: "@new-each-run"')
    expect(screen.getByText(/scheduled work defaults to/).textContent).toContain('@new-then-resume')
    expect(screen.getByText(/The markdown below the closing/).textContent).toContain('exact scheduled prompt')
    expect(container.textContent).not.toContain('what: a standalone prompt')
  })

  it('describes the current run output and continuation contract', () => {
    const { container } = render(<AutomationApiSection />)
    const text = container.textContent ?? ''

    expect(text).toContain('Live progress and structured output appear under Runs')
    expect(text).toContain('"resumeId": "resume-…"')
    expect(text).toContain('"status": "running"')
    expect(text).toContain('Every headless run preserves its structured reply and tool activity')
    expect(text).not.toContain('there is no other output channel')
    expect(text).not.toContain('A headless run has no UI')
  })
})
