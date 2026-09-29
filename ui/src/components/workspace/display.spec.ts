import { describe, expect, it } from 'vitest'
import { SESSION_CHROME_TITLE_MAX, sessionChromeLabel, shortenSessionChromeTitle } from './display'

const goldLeadPrompt = `研究问题：
在「A股单标的 600531.SH（豫光金铅）日频」框架下，设计并验证一套可复现的有界马丁格尔量化研究方案：
优先回答——
(A) 以下列固定规则运行时，相对沪深300，近3年样本上是否构成可检验的交易/风险信号`

describe('shortenSessionChromeTitle', () => {
  it('keeps short titles intact', () => {
    expect(shortenSessionChromeTitle('豫光金铅研究')).toBe('豫光金铅研究')
  })

  it('prefers Chinese name and strategy for long research prompts', () => {
    const short = shortenSessionChromeTitle(goldLeadPrompt)
    expect(short).toBe('豫光金铅 · 有界马丁格尔')
    expect([...short].length).toBeLessThanOrEqual(SESSION_CHROME_TITLE_MAX + 2)
  })

  it('leaves ordinary medium titles for CSS ellipsis', () => {
    expect(shortenSessionChromeTitle('Review AAPL earnings')).toBe('Review AAPL earnings')
  })

  it('keeps long English titles intact for SpacedTruncate', () => {
    const long = 'Set up this Harness Workspace so its Studio capability can run with many extra words across the whole chrome strip'
    expect(shortenSessionChromeTitle(long)).toBe(long)
  })
})

describe('sessionChromeLabel', () => {
  it('preserves an explicit coworker displayName', () => {
    expect(sessionChromeLabel({
      name: 'ca3',
      title: goldLeadPrompt,
      displayName: '我的马丁实验',
    })).toBe('我的马丁实验')
  })

  it('shortens override roster titles the same way', () => {
    expect(sessionChromeLabel({
      name: 'ca3',
      title: null,
    }, goldLeadPrompt)).toBe('豫光金铅 · 有界马丁格尔')
  })
})
