import type { NewsArticle, NewsStoryDetail, NewsStoryPreview } from '../../api/types'

const HOUR_MS = 3_600_000
const now = Date.now()

export const demoNewsArticles: NewsArticle[] = [
  { id: 1001, time: new Date(now - 50 * HOUR_MS).toISOString(), title: '【演示】研究团队发布开放模型', content: '虚构的模型发布原文，内部研发代号 Orion。模型发布与两天后的开放申请是两个事实，属于同一个持续事件。', source: 'Example Research Archive (Demo)', role: 'official', categories: 'ai,tech', link: 'https://example.com/demo/ai/release' },
  { id: 1002, time: new Date(now - 0.06 * HOUR_MS).toISOString(), title: '【演示】模型开放开发者申请', content: '虚构后续公告：开发者可以申请使用。未披露真实用户数、收入或商业合同。', source: 'Example AI Lab (Demo)', role: 'official', categories: 'ai,tech', link: 'https://example.com/demo/ai/access' },
  { id: 1003, time: new Date(now - 0.05 * HOUR_MS).toISOString(), title: '[Demo] Research model access opens to developers', content: 'Fictional English coverage of the same access announcement. This is manually linked evidence, not an automated translation or grouping result.', source: 'Example Tech Media (Demo)', role: 'reporting', categories: 'ai,tech', link: 'https://example.com/demo/ai/coverage' },
  {
    time: new Date(now - 0.02 * HOUR_MS).toISOString(),
    title: '【演示】示例公司发布 Model One',
    content: '虚构公司公告原文：示例公司发布 Model One。用于展示官方 RSS、X 与股票新闻共同阅读，不是真实公司或投资信息。',
    source: 'Example IR (Demo)', publisher: 'Example IR (Demo)', kind: 'announcement', role: 'official',
    symbols: ['DEMO:EXAMPLE'], link: 'https://example.com/demo/company/ir', categories: 'tech,us',
  },
  {
    time: new Date(now - 0.03 * HOUR_MS).toISOString(),
    title: '【演示】示例公司发布 Model One',
    content: '虚构 X 原帖：我们发布了 Model One。保留作者和引用帖，便于与公司公告及媒体报道核对。',
    source: 'Example, Inc. (Demo)', publisher: 'Example, Inc. (Demo)', author: '@example_demo', kind: 'social', role: 'official',
    quote: { author: '@research_demo', text: '虚构引用帖：这是原始引用内容，与发帖者自己的正文分别保留。', url: 'https://example.com/demo/company/quoted' },
    symbols: ['DEMO:EXAMPLE'], link: 'https://example.com/demo/company/x', categories: 'tech,us',
  },
  {
    time: new Date(now - 0.04 * HOUR_MS).toISOString(),
    title: '【演示】示例公司发布 Model One',
    content: '虚构财经媒体摘要：从行业角度报道同一产品发布。摘要不代表已获取全文，点击来源可追溯原始链接。',
    source: 'Example Media (Demo)', publisher: 'Example Media (Demo)', kind: 'article', role: 'reporting',
    symbols: ['DEMO:EXAMPLE'], link: 'https://example.com/demo/company/news', categories: 'tech,us',
  },
  {
    time: new Date(now - 0.1 * HOUR_MS).toISOString(),
    title: '【演示】美联储维持政策利率不变',
    content: '示例报道：会议声明维持政策利率不变，继续观察通胀和就业数据。本条为聚合阅读演示，不是真实政策新闻。',
    source: 'cls', link: 'https://example.com/demo/fed/cls', categories: 'macro,important',
  },
  {
    time: new Date(now - 0.15 * HOUR_MS).toISOString(),
    title: '【演示】美联储：维持政策利率不变',
    content: '示例报道：从全球市场角度说明同一份政策声明。保留该来源的表述，便于与其他报道核对。',
    source: 'wallstreetcn', link: 'https://example.com/demo/fed/wallstreetcn', categories: 'macro,important',
  },
  {
    time: new Date(now - 0.2 * HOUR_MS).toISOString(),
    title: '【演示】美联储，维持政策利率不变。',
    content: '示例报道：同一政策事件的另一篇报道。三篇原文仍可在报道时间线逐一查看。',
    source: 'jrj', link: 'https://example.com/demo/fed/jrj', categories: 'macro,important',
  },
  {
    time: new Date(now - 0.3 * HOUR_MS).toISOString(),
    title: '【演示】沪深两市成交额连续第二日回升',
    content: '示例报道：展示 A 股市场频道与多源报道折叠。本条不包含真实成交数据。',
    source: 'wallstreetcn-a', link: 'https://example.com/demo/markets/wallstreetcn', categories: 'markets,cn',
  },
  {
    time: new Date(now - 0.35 * HOUR_MS).toISOString(),
    title: '【演示】沪深两市成交额连续第二日回升。',
    content: '示例报道：另一来源描述相同的成交变化。展示来源差异，不将原始报道删除。',
    source: 'jrj-a', link: 'https://example.com/demo/markets/jrj', categories: 'markets,cn',
  },
  {
    time: new Date(now - 0.5 * HOUR_MS).toISOString(),
    title: 'Apple Q1 services revenue grows 9.1%, slowest since 2019',
    content:
      'Apple reported Q1 FY26 results showing services revenue growth of +9.1% YoY — the slowest in over six years and the third consecutive quarterly deceleration. Headline EPS beat consensus at $1.65 vs $1.50 estimates, but analysts are focusing on the services margin trajectory.',
    source: 'Reuters',
    link: 'https://example.com/aapl-q1',
    categories: 'earnings,us,important,negative',
  },
  {
    time: new Date(now - 2 * HOUR_MS).toISOString(),
    title: 'NVDA gains 2.8% on data center capex commentary',
    content:
      'Nvidia rallied after hyperscaler capex comments suggested continued demand through 2027. Microsoft, Meta, and Alphabet collectively guided to $200B+ in 2026 AI capex.',
    source: 'Bloomberg',
    link: 'https://example.com/nvda-capex',
    categories: 'markets,us,positive',
  },
  {
    time: new Date(now - 4 * HOUR_MS).toISOString(),
    title: 'Fed minutes: 2026 cut path "data-dependent"',
    content:
      'May FOMC minutes echoed Chair Powell\'s post-meeting framing. No commitment on July cut; rate path remains data-dependent with attention on services CPI and shelter components.',
    source: 'WSJ',
    link: 'https://example.com/fomc-minutes',
    categories: 'macro,rates,important',
  },
  {
    time: new Date(now - 8 * HOUR_MS).toISOString(),
    title: 'Bitcoin reclaims $66k as ETF flows turn positive',
    content:
      'Spot Bitcoin ETFs saw net inflows of $312M Tuesday, the largest single-day net add since April. BTC reclaimed the $66k handle into European close.',
    source: 'CoinDesk',
    link: 'https://example.com/btc-66k',
    categories: 'crypto',
  },
  {
    time: new Date(now - 14 * HOUR_MS).toISOString(),
    title: 'SPY closes at fresh record on broadening leadership',
    content:
      'S&P 500 ETF closed at $516.20, a new all-time high. Internals improved — 78% of constituents above their 50-day MA, up from 64% last week.',
    source: 'CNBC',
    link: 'https://example.com/spy-record',
    categories: 'markets,us,positive',
  },
  {
    time: new Date(now - 22 * HOUR_MS).toISOString(),
    title: 'TLT under pressure as 10Y yield tests 4.60%',
    content:
      'Long-bond ETF TLT down 1.4% as the 10-year Treasury yield tested 4.60% intraday. May supply calendar and softer-than-expected demand at the 7Y auction cited.',
    source: 'Reuters',
    link: 'https://example.com/tlt-yields',
    categories: 'bonds,rates,us,negative',
  },
  {
    time: new Date(now - 1 * HOUR_MS).toISOString(),
    title: 'CSI 300 advances as financials and industrials strengthen',
    content: 'Mainland benchmarks moved higher in afternoon trade as large-cap financial and industrial names attracted fresh buying.',
    source: 'Wind',
    link: 'https://example.com/csi-300-advance',
    categories: 'markets,cn,positive',
  },
  {
    time: new Date(now - 3 * HOUR_MS).toISOString(),
    title: 'Hang Seng TECH rebounds with internet platforms',
    content: 'Hong Kong technology shares recovered from the morning low as platform companies led a broader risk-on move.',
    source: 'SCMP',
    link: 'https://example.com/hstech-rebound',
    categories: 'markets,hk,positive',
  },
  {
    time: new Date(now - 6 * HOUR_MS).toISOString(),
    title: 'Dollar eases as traders reassess the next Fed move',
    content: 'The dollar index pulled back while major currency pairs consolidated ahead of the next US inflation release.',
    source: 'Reuters',
    link: 'https://example.com/dollar-fed',
    categories: 'macro,fx,negative',
  },
  {
    time: new Date(now - 10 * HOUR_MS).toISOString(),
    title: 'WTI crude steadies after volatile inventory session',
    content: 'Oil prices stabilized as traders weighed a larger inventory draw against a softer near-term demand outlook.',
    source: 'Bloomberg',
    link: 'https://example.com/wti-inventories',
    categories: 'futures,commodities,energy,negative',
  },
]

demoNewsArticles.forEach((report, index) => { report.id ??= index + 1 })
const reportAt = (path: string) => demoNewsArticles.find(report => report.link === `https://example.com/demo/${path}`)!
const aiRelease = reportAt('ai/release'), aiAccess = reportAt('ai/access'), aiCoverage = reportAt('ai/coverage')
const company = ['company/ir', 'company/x', 'company/news'].map(reportAt)
const macro = ['fed/cls', 'fed/wallstreetcn', 'fed/jrj'].map(reportAt)
const detail = (value: Omit<NewsStoryDetail, 'version' | 'revision' | 'updatedAt' | 'preparedBy' | 'missingReportIds'>): NewsStoryDetail => ({
  version: 1, revision: 1, updatedAt: new Date(now).toISOString(), preparedBy: 'Demo · 手工整理 / manually prepared', missingReportIds: [], ...value,
})

/** Fictional editorial examples; no inference, live-provider or investment claim. */
export const demoNewsStories: NewsStoryDetail[] = [
  detail({ id: 'demo-ai-model', title: '【演示】开放模型：从发布到开发者开放', summary: '研究团队先发布模型，两天后开放开发者申请。中文公告与英文报道描述的是同一次开放；模型发布是更早的独立进展。', reason: 'AI 能力的可获得性可能改变开发者采用与行业竞争。当前没有使用量、收入或客户数据，不能据此推断受益股票。', topics: ['ai', 'tech', 'industry'], symbols: [], selected: true, status: 'active', overviewReportIds: [1001, 1002],
    developments: [
      { id: 'model-released', time: aiRelease.time, title: '研究团队发布模型', summary: '发布能力介绍，尚未开放开发者申请。', reportIds: [1001] },
      { id: 'developer-access', time: aiAccess.time, title: '开发者申请开放', summary: '申请渠道开放。原始公告与媒体报道分别保留，归入同一条进展。', reportIds: [1002, 1003] },
    ], reports: [aiRelease, aiAccess, aiCoverage].map(report => ({ ...report, id: report.id!, image: report.image ?? null })),
  }),
  detail({ id: 'demo-company-launch', title: '【演示】示例公司发布 Model One', summary: '公司公告、官方账号原帖和媒体报道共同说明一次产品发布。官方公告作为原始依据，X 上的引用内容与作者正文保持独立。', reason: '后续应关注定价、可交付时间与客户采用。演示未提供这些数据，也没有可核验的营收影响。', topics: ['tech', 'us', 'industry'], symbols: ['DEMO:EXAMPLE'], selected: true, status: 'watching', overviewReportIds: [company[0].id!],
    developments: [{ id: 'launch', time: company[0].time, title: 'Model One 发布', summary: '同一事实的三篇报道，保留公告、官方账号和媒体的各自表述。', reportIds: company.map(report => report.id!) }], reports: company.map(report => ({ ...report, id: report.id!, image: report.image ?? null })),
  }),
  detail({ id: 'demo-macro-policy', title: '【演示】利率决议：维持利率，继续观察数据', summary: '三家示例来源报道了同一次利率决议。事件概览独立于每篇报道的标题，原始表述和发布时间仍然可查。', reason: '政策预期关系到利率与风险资产定价。这里没有真实决议、预测变化或价格反应，不能将示例当作市场信号。', topics: ['macro', 'rates'], symbols: [], selected: true, status: 'watching', overviewReportIds: macro.map(report => report.id!),
    developments: [{ id: 'rate-decision', time: macro[0].time, title: '利率决议公布', summary: '维持政策利率；保留来源差异。当前证据只有示例报道，未标注为官方声明。', reportIds: macro.map(report => report.id!) }], reports: macro.map(report => ({ ...report, id: report.id!, image: report.image ?? null, role: 'reporting' })),
  }),
]

export const demoNewsStoryPreviews: NewsStoryPreview[] = demoNewsStories.map(story => ({ ...story,
  reports: story.reports.map(({ content: _content, quote: _quote, media: _media, image: _image, ...report }) => report),
}))
