import { describe, expect, it } from 'vitest'
import { SESSION_CHROME_TITLE_MAX, sessionChromeLabel, shortenSessionChromeTitle } from './display'

const goldLeadPrompt = `研究问题：
在「A股单标的 600531.SH（豫光金铅）日频」框架下，设计并验证一套可复现的有界马丁格尔量化研究方案：
优先回答——
(A) 以下列固定规则运行时，相对沪深300，近3年样本上是否构成可检验的交易/风险信号`

const goldLeadChatPrompt = `利用豫光金铅这只股票的波动性, 你能否帮我设计一套基于马丁格尔方法的算法, 我如何向auto quant输入我的需求呢? 填写完成类似下面的的信息: 研究问题：…… 决策用途：……（ 调用方已有判断 `

const dualMomentumPrompt = `**双动量策略（Dual Momentum）**是由知名量化投资专家加里·安托纳奇（Gary Antonacci）在《Dual Momentum Investing》一书中提出的经典策略。它将**相对`

const wtiPrompt = `研究问题： 在「WTI 现货年底前是否跌破 80 美元」这一宏观事件框架下，设计并验证一套可复现的量化研究方案： 优先回答——(A) 油价 regime / 距 80 阈值的状态，能否构成可检验的交易`

describe('shortenSessionChromeTitle', () => {
  it('keeps short titles intact', () => {
    expect(shortenSessionChromeTitle('豫光金铅研究')).toBe('豫光金铅研究')
  })

  it('prefers Chinese name and strategy for long research prompts', () => {
    const short = shortenSessionChromeTitle(goldLeadPrompt)
    expect(short).toBe('豫光金铅 · 有界马丁格尔')
    expect([...short].length).toBeLessThanOrEqual(SESSION_CHROME_TITLE_MAX + 2)
  })

  it('ignores scaffold parentheticals when a bare subject and strategy remain', () => {
    expect(shortenSessionChromeTitle(goldLeadChatPrompt)).toBe('豫光金铅 · 马丁格尔')
    expect(shortenSessionChromeTitle(
      '利用豫光金铅这只股票的波动性, 基于马丁格尔方法（缺什么请先问我）继续设计',
    )).toBe('豫光金铅 · 马丁格尔')
  })

  it('pairs 英伟达 with investment-logic wording', () => {
    expect(shortenSessionChromeTitle(
      '从基本面和一致预期、板块轮动与价格行为两侧，构建一份可证伪的英伟达投资逻辑；把可复用的研究保存到此 Workspace',
    )).toBe('英伟达 · 投资逻辑')
  })

  it('collapses dual-momentum essays to the strategy name', () => {
    expect(shortenSessionChromeTitle(dualMomentumPrompt)).toBe('双动量')
  })

  it('shortens WTI book-frame research prompts', () => {
    expect(shortenSessionChromeTitle(wtiPrompt)).toBe('WTI · 跌破80')
  })

  it('shortens Studio harness setup prompts', () => {
    expect(shortenSessionChromeTitle(
      'Set up this Harness Workspace so its Studio capability can run with many extra words across the whole chrome strip',
    )).toBe('Studio')
  })

  it('shortens macro / QMT / broker / US-fundamental prompts', () => {
    expect(shortenSessionChromeTitle(
      '先读取本 Workspace（或 Settings）里客户勾选的关注市场；若未配置，默认覆盖大A、美股、港股与主要宏观资产。阅读今天的宏观背景、板块轮动和异常异动——大A必看（指数、板块/资金流与异动），并覆盖上述自选市场。给出最值得关注的三个跨资产信号，标明每项数据的截至时间，并把事实证据和你的判断分开；缺数时说明缺口，不要编造。',
    )).toBe('今日宏观 · 跨资产')
    expect(shortenSessionChromeTitle(
      '我想做一个实时的据接口, 数据提供来自华安证券的QMT，你给我些实现的方法和建议吧',
    )).toBe('华安QMT · 实时接口')
    expect(shortenSessionChromeTitle(
      '帮我查一下现在是否可以用longbridge的账户进行港股交易',
    )).toBe('Longbridge · 港股')
    expect(shortenSessionChromeTitle('试 AAPL 基本面 用FMP的数据')).toBe('AAPL · FMP')
    expect(shortenSessionChromeTitle('000001.SZ  income_statement  — 利润表')).toBe('000001 · 利润表')
  })

  it('leaves ordinary long Latin titles for SpacedTruncate', () => {
    const long = 'Review the overnight cross-asset tape and summarize every open risk before the cash open'
    expect(shortenSessionChromeTitle(long)).toBe(long)
  })

  it('clamps a long CJK clause when no subject/strategy extracts', () => {
    const short = shortenSessionChromeTitle(
      '请帮我整理一下这个工作区里最近三周做过的所有研究笔记并按主题归类保存，顺便标出未完成的部分',
    )
    expect(short).toBe('请帮我整理一下这个工作区里最近三周做')
    expect([...short].length).toBeLessThanOrEqual(SESSION_CHROME_TITLE_MAX)
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
