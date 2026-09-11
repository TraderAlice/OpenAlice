import { beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '../i18n'
import {
  humanizeOfficeToolName,
  officeBubbleText,
  officeToolBubbleKey,
} from './bubble-text'

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('officeBubbleText', () => {
  it('turns internal tool names into stable in-world activity language', () => {
    expect(officeToolBubbleKey('workspace_list')).toBe('office.bubbleToolWorkspace')
    expect(officeToolBubbleKey('market_search')).toBe('office.bubbleToolResearch')
    expect(officeBubbleText({ kind: 'tool', name: 'workspace_list' }, i18n.t))
      .toBe('Checking the office…')
    expect(officeBubbleText({ kind: 'tool', name: 'research' }, i18n.t))
      .toBe('Researching…')
  })

  it('humanizes an unknown tool without exposing transport punctuation', () => {
    expect(humanizeOfficeToolName('mcp:future_tool')).toBe('future tool')
    expect(officeBubbleText({ kind: 'tool', name: 'mcp:future_tool' }, i18n.t))
      .toBe('Using future tool…')
  })
})
