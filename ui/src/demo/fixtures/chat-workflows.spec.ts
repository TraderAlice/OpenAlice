import { describe, expect, it } from 'vitest'
import { en } from '../../i18n/locales/en'
import { zh } from '../../i18n/locales/zh'
import { ja } from '../../i18n/locales/ja'
import { zhHant } from '../../i18n/locales/zh-Hant'
import { chatLandingExampleGroups } from '../../lib/chat-landing-examples'
import { demoChatWorkflowReply } from './chat-workflows'

describe('demo Chat workflow coverage', () => {
  for (const [language, catalog] of Object.entries({ en, zh, ja, zhHant })) {
    it(`covers every ${language} starter with a distinct answer and install link`, () => {
      const examples = [undefined, 'nano'].flatMap(product => chatLandingExampleGroups(
        key => catalog.chatLanding[key.replace('chatLanding.', '') as keyof typeof catalog.chatLanding], product,
      ).flat())
      const answers = new Map<string, string>()
      for (const example of examples) {
        const answer = demoChatWorkflowReply(example.prompt)
        expect(answer).toContain('https://github.com/TraderAlice/OpenAlice')
        expect(answer).toContain('demo')
        expect(answer!.length).toBeGreaterThan(250)
        answers.set(example.id, answer!)
      }
      expect(new Set(answers.values()).size).toBe(answers.size)
    })
  }
  it('leaves arbitrary prompts to the existing demo conversation flow', () => {
    expect(demoChatWorkflowReply('Execute a live trade')).toBeNull()
  })
})
