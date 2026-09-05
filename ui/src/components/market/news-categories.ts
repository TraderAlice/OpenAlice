export const NEWS_CATEGORIES = [
  { id: 'themes', labelKey: 'news.categoryThemes', tags: ['theme', 'themes', 'concept', 'concepts'] },
  { id: 'a-shares', labelKey: 'news.categoryAShares', tags: ['cn', 'china', 'a-share', 'a-shares', 'ashare'] },
  { id: 'chinext', labelKey: 'news.categoryChiNext', tags: ['chinext', 'gem'] },
  { id: 'star', labelKey: 'news.categoryStar', tags: ['star-market', 'star market', 'sci-tech-innovation-board'] },
  { id: 'bse', labelKey: 'news.categoryBse', tags: ['bse', 'beijing-stock-exchange'] },
  { id: 'neeq', labelKey: 'news.categoryNeeq', tags: ['neeq', 'new-third-board'] },
  { id: 'hk', labelKey: 'news.categoryHk', tags: ['hk', 'hong-kong', 'hong kong'] },
  { id: 'china-concepts', labelKey: 'news.categoryChinaConcepts', tags: ['china-concept', 'china-concepts', 'chinese-adr'] },
  { id: 'us', labelKey: 'news.categoryUs', tags: ['us', 'usa', 'united-states', 'wall-street'] },
  { id: 'ipo', labelKey: 'news.categoryIpo', tags: ['ipo', 'new-listing', 'new-stock'] },
  { id: 'industries', labelKey: 'news.categoryIndustries', tags: ['industry', 'industries', 'sector', 'sectors'] },
  { id: 'funds', labelKey: 'news.categoryFunds', tags: ['fund', 'funds', 'etf'] },
  { id: 'bonds', labelKey: 'news.categoryBonds', tags: ['bond', 'bonds', 'rates', 'fixed-income'] },
  { id: 'futures', labelKey: 'news.categoryFutures', tags: ['future', 'futures', 'commodity', 'commodities'] },
  { id: 'macro', labelKey: 'news.categoryMacro', tags: ['macro', 'economy', 'economic', 'world', 'geopolitics'] },
  { id: 'fx', labelKey: 'news.categoryFx', tags: ['fx', 'forex', 'currency', 'currencies'] },
  { id: 'wealth', labelKey: 'news.categoryWealth', tags: ['wealth', 'wealth-management'] },
  { id: 'options', labelKey: 'news.categoryOptions', tags: ['option', 'options'] },
  { id: 'warrants', labelKey: 'news.categoryWarrants', tags: ['warrant', 'warrants'] },
] as const

export type NewsCategoryId = typeof NEWS_CATEGORIES[number]['id']

export const NEWS_CATEGORY_GROUPS = [
  { labelKey: 'news.groupEquities', categories: ['a-shares', 'chinext', 'star', 'bse', 'neeq', 'hk', 'us'] },
  { labelKey: 'news.groupTopics', categories: ['themes', 'industries', 'ipo', 'china-concepts'] },
  { labelKey: 'news.groupAssets', categories: ['funds', 'bonds', 'futures', 'fx', 'options', 'warrants'] },
  { labelKey: 'news.groupMacro', categories: ['macro', 'wealth'] },
] as const satisfies ReadonlyArray<{ labelKey: string; categories: readonly NewsCategoryId[] }>
