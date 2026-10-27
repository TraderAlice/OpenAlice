import { describe, expect, it } from 'vitest'
import type { NewsArticle } from '../../api/types'
import { groupNewsArticles } from './reading-groups'

const article = (title: string, extra: Partial<NewsArticle> = {}): NewsArticle => ({
  title, content: '', source: 'fed', link: null, categories: 'macro',
  time: '2026-10-21T08:00:00Z', ...extra,
})

describe('news reading groups', () => {
  it('folds different-language coverage with the same prepared occurrence identity', () => {
    const eventRef = { storyId: 'enterprise-plan', developmentId: 'bundle' }
    expect(groupNewsArticles([
      article('格隆汇｜某公司整合企业套餐', { eventRef }),
      article('Company combines enterprise subscription offerings', { eventRef }),
    ])).toHaveLength(1)
  })

  it('keeps distinct developments separate even when their visible titles match', () => {
    const title = 'Company announces subscription plan update'
    expect(groupNewsArticles([
      article(title, { eventRef: { storyId: 'enterprise-plan', developmentId: 'announcement' } }),
      article(title, { eventRef: { storyId: 'enterprise-plan', developmentId: 'availability' } }),
    ])).toHaveLength(2)
  })

  it('does not fold reports with ambiguous prepared identity by their titles', () => {
    const title = 'Company announces subscription plan update'
    expect(groupNewsArticles([article(title, { eventRef: null }), article(title, { eventRef: null })])).toHaveLength(2)
  })
  it('keeps reports without a publication time out of date-based folding', () => {
    const title = 'Fed publishes latest policy statement'
    expect(groupNewsArticles([article(title), article(title, { timeBasis: 'collection' })])).toHaveLength(2)
  })
  it('folds syndicated headlines with punctuation and case changes, preserving every report', () => {
    const reports = [article('美联储：维持利率不变'), article('美联储，维持利率不变！', { source: 'cls', time: '2026-10-21T09:00:00Z' })]
    const original = reports.map(report => ({ ...report }))
    const [group] = groupNewsArticles(reports)
    expect(groupNewsArticles(reports)).toHaveLength(1)
    expect(group.reports).toHaveLength(2)
    expect(group.reports[0].source).toBe('cls')
    expect(group.sources).toEqual(['cls', 'fed'])
    expect(reports).toEqual(original)
  })

  it('matches modest wording additions to the same informative headline', () => {
    expect(groupNewsArticles([
      article('Fed holds rates steady as inflation cools'),
      article('Fed holds interest rates steady as inflation cools'),
    ])).toHaveLength(1)
  })

  it('recognizes tracking variants of an article URL without erasing meaningful query parameters', () => {
    expect(groupNewsArticles([
      article('Fed publishes latest policy statement', { link: 'https://fed.example/press?id=1&utm_source=rss' }),
      article('Latest monetary policy statement from the Fed', { link: 'https://fed.example/press?id=1#top' }),
    ])).toHaveLength(1)
    expect(groupNewsArticles([
      article('Policy update', { link: 'https://fed.example/press?id=1' }),
      article('Another policy update', { link: 'https://fed.example/press?id=2' }),
    ])).toHaveLength(2)
  })

  it.each([
    ['Apple revenue rises 10 percent in latest quarter', 'Apple revenue rises 20 percent in latest quarter'],
    ['US GDP growth reaches -0.5% in third quarter', 'US GDP growth reaches +0.5% in third quarter'],
    ['US GDP growth reaches −0.5% in third quarter', 'US GDP growth reaches +0.5% in third quarter'],
    ['Fed will cut rates after the next policy meeting', 'Fed will not cut rates after the next policy meeting'],
    ["Fed can cut interest rates at next policy meeting", "Fed can't cut interest rates at next policy meeting"],
    ['Fed can cut interest rates at next policy meeting', 'Fed can’t cut interest rates at next policy meeting'],
    ['Apple beats revenue expectations in the latest quarter', 'Tesla beats revenue expectations in the latest quarter'],
    ['中国央行宣布下调存款准备金率', '中国央行宣布上调存款准备金率'],
    ['公司宣布收购计划', '公司否认收购计划'],
    ['apple acquires startup after shareholders approve the deal in a special meeting', 'tesla acquires startup after shareholders approve the deal in a special meeting'],
    ['Apple buys Nvidia shares after latest earnings announcement', 'Nvidia buys Apple shares after latest earnings announcement'],
    ['Fed announces policy change after inflation eases for a second consecutive month', 'Fed plans policy change after inflation eases for a second consecutive month'],
    ['Market update', 'Market update'],
  ])('keeps uncertain or conflicting facts separate: %s / %s', (left, right) => {
    expect(groupNewsArticles([article(left), article(right)])).toHaveLength(2)
  })

  it('does not merge recurring headlines across a day or when time is invalid', () => {
    const title = 'Fed holds rates steady as inflation cools'
    expect(groupNewsArticles([article(title), article(title, { time: '2026-10-22T08:00:01Z' })])).toHaveLength(2)
    expect(groupNewsArticles([article(title), article(title, { time: 'invalid' })])).toHaveLength(2)
  })

  it('compares every report with the first report so a chain cannot grow past its time window', () => {
    const title = 'Fed holds rates steady as inflation cools'
    const groups = groupNewsArticles([
      article(title, { time: '2026-10-21T08:00:00Z' }),
      article(title, { time: '2026-10-22T07:00:00Z' }),
      article(title, { time: '2026-10-22T09:00:00Z' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.reports.length)).toEqual([1, 2])
  })

  it('does not invent a source for missing attribution', () => {
    expect(groupNewsArticles([article('Fed publishes latest policy statement', { source: null })])[0].sources).toEqual([])
  })
})
