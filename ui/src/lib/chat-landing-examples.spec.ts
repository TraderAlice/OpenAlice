import { describe, expect, it } from 'vitest'

import { chatLandingExampleGroups } from './chat-landing-examples'

describe('chatLandingExampleGroups', () => {
  const t = (key: string) => key

  it('keeps market and portfolio ideas on TraderAlice', () => {
    const ids = chatLandingExampleGroups(t, 'trader').flat().map((example) => example.id)
    expect(ids).toContain('market')
    expect(ids).toContain('portfolio')
    expect(ids).toContain('quant')
  })

  it('replaces trading ideas on NanoAlice', () => {
    const groups = chatLandingExampleGroups(t, 'nano')
    const ids = groups.flat().map((example) => example.id)
    expect(groups).toHaveLength(1)
    expect(ids).toEqual(['workspace', 'code-review', 'inbox'])
    expect(ids).not.toContain('market')
    expect(ids).not.toContain('portfolio')
    expect(ids).not.toContain('quant')
  })
})
