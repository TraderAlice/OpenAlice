import { describe, expect, it } from 'vitest'

import { projectHeadlessTaskPresentation } from './headless-task-presentation'

const wrapper = 'You are a fresh worker reconstructing a follow-up. Target: {"kind":"issue"}'

describe('projectHeadlessTaskPresentation', () => {
  it('uses Issue provenance instead of delivered reconstruction instructions', () => {
    expect(projectHeadlessTaskPresentation({
      prompt: wrapper,
      inquiry: {
        subject: {
          kind: 'issue',
          workspaceId: 'ws-1',
          issueId: 'telegram-phone-desk',
          relation: 'owner',
        },
        question: '刚才给你升级了一下，你看看现在的版本呢',
        resolution: { mode: 'reconstructed' },
      },
    })).toEqual({
      title: 'Telegram Phone Desk',
      summary: '刚才给你升级了一下，你看看现在的版本呢',
    })
  })

  it('uses scheduled Issue identity without exposing its work instructions', () => {
    expect(projectHeadlessTaskPresentation({
      prompt: 'Long internal scheduled instructions',
      trigger: { kind: 'issue', workspaceId: 'ws-1', issueId: 'daily-market-close' },
    })).toEqual({ title: 'Daily Market Close' })
  })

  it('keeps direct API prompts available as bounded public titles', () => {
    expect(projectHeadlessTaskPresentation({ prompt: 'Reply with exactly OK.' }))
      .toEqual({ title: 'Reply with exactly OK.' })
  })
})
