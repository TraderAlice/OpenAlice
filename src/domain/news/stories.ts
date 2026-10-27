import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { dataPath } from '../../core/paths.js'
import { newsStorySchema, type NewsFollowUpdate, type NewsReadStatus, type NewsReaderPatch, type NewsStoryDetail, type NewsStory, type NewsStoryPreview } from './reading-contract.js'
import { newsStoryRelation } from './relations.js'
import type { INewsProvider, NewsItem } from './types.js'
import { isImportantReport, newsReport } from './report.js'
import { NewsReadingState } from './reading-state.js'
import { eventHeat, newsPublisher } from './heat.js'
import { associationView, evidenceDigest, readAssociations, writeAssociations } from './associations.js'
import { newsAssociationInputSchema, type NewsAssociationAsset } from './association-contract.js'

export interface StoryQuery {
  industry?: string
  asset?: string
  country?: string
  eventId?: string
  readStatus?: NewsReadStatus
  relatedTo?: string
  selected?: boolean
  topics?: string[]
  source?: string
  keyword?: string
  symbol?: string
  startTime?: string
  endTime?: string
  offset?: number
  order?: 'recent' | 'heat' | 'relevance'
  bookmarked?: boolean
  important?: boolean
}

export interface ReportOccurrence {
  storyId: string
  developmentId: string
}

export class NewsStoryStore {
  private writes: Promise<unknown> = Promise.resolve()
  private reader: NewsReadingState
  private now: () => number
  constructor(private provider: INewsProvider, private directory = dataPath('news-collector', 'stories', 'v1'), private options: { now?: () => number; coverage?: () => string[]; onFollowUpdate?: (update: NewsFollowUpdate) => Promise<unknown>; resolveAsset?: (asset: NewsAssociationAsset) => Promise<boolean> } = {}) {
    this.reader = new NewsReadingState(join(directory, '.reading-state.json'))
    this.now = options.now ?? Date.now
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.writes.then(action)
    this.writes = next.catch(() => {})
    return next
  }

  async pending(query: { limit?: number; offset?: number; status?: 'pending' | 'review' | 'failed'; order?: 'oldest' | 'recent' } = {}) {
    if (query.order === 'recent' && query.offset) throw new Error('Recent pending work is a bounded queue head, not an offset page')
    if (!this.provider.scanNews) throw new Error('Complete archive scanning unavailable')
    const assigned = new Set((await this.readStories()).flatMap(story => story.developments.flatMap(development => development.reportIds)))
    const state = await this.reader.read()
    const counts = { pending: 0, review: 0, failed: 0, ready: 0 }
    let matched = 0
    const items: Array<Omit<ReturnType<typeof newsReport>, 'content' | 'quote' | 'media' | 'image'> & { processing?: typeof state.reports[string] }> = []
    for await (const item of this.provider.scanNews()) {
      const processing = Object.hasOwn(state.reports, item.id) ? state.reports[item.id] : undefined
      // A committed event acknowledges evidence even if its receipt write was interrupted.
      if (assigned.has(item.id) && (!processing || processing.status === 'failed')) continue
      const status = processing?.status ?? 'pending'
      counts[status]++
      const ready = status === 'pending' || status === 'failed' && (processing?.retryAt ?? Infinity) <= this.now()
      if (ready) counts.ready++
      if (query.status && query.status !== 'pending' ? status !== query.status : !ready) continue
      if (matched++ < (query.offset ?? 0)) continue
      if (query.order !== 'recent' && items.length >= (query.limit ?? 40)) continue
      const { content: _content, quote: _quote, media: _media, image: _image, ...preview } = newsReport(item)
      items.push({ ...preview, ...(processing ? { processing } : {}) })
      if (query.order === 'recent') {
        items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time) || b.id - a.id)
        if (items.length > (query.limit ?? 40)) items.pop()
      }
    }
    return { items, counts, nextOffset: query.order !== 'recent' && matched > (query.offset ?? 0) + (query.limit ?? 40) ? (query.offset ?? 0) + (query.limit ?? 40) : null }
  }

  async original(id: number) {
    const item = (await this.evidence([id])).get(id)
    if (!item) throw new Error('Original report unavailable')
    return newsReport(item)
  }

  disposition(ids: number[], status: 'review' | 'failed' | 'retry', reason: string) {
    return this.exclusive(async () => {
      if (!ids.length || ids.length > 40 || ids.some(id => !Number.isSafeInteger(id) || id < 0) || new Set(ids).size !== ids.length) throw new Error('Invalid original report IDs')
      if (reason.length > 1000 || status !== 'retry' && !reason.trim()) throw new Error('Explain the unresolved work')
      if ((await this.evidence(ids, true)).size !== ids.length) throw new Error('Referenced archive report unavailable')
      await this.reader.update(state => {
        for (const id of ids) {
          if (status === 'retry') {
            if (reason.trim()) state.reports[id] = { status: 'pending', reason: reason.trim(), attempts: 0 }
            else delete state.reports[id]
            continue
          }
          // Only an explicit human retry may release a review hold.
          if (state.reports[id]?.status === 'review') continue
          const attempts = (state.reports[id]?.attempts ?? 0) + (status === 'failed' ? 1 : 0)
          state.reports[id] = { status, reason: reason.trim(), attempts, ...(status === 'failed' && attempts < 3 ? { retryAt: this.now() + 5 * 2 ** (attempts - 1) * 60000 } : {}) }
        }
      })
      return { reportIds: ids, status }
    })
  }

  setReader(id: string, patch: NewsReaderPatch) {
    return this.exclusive(async () => {
      const story = await this.get(id)
      const { readRevision, ...flags } = patch
      if (readRevision != null && readRevision !== story.revision) throw new Error('Event revision changed')
      const state = await this.reader.update(state => { state.events[id] = { ...state.events[id], ...flags,
        ...(patch.following ? { observedDevelopments: [...new Set([...(state.events[id]?.observedDevelopments ?? []), ...story.developments.map(fact => fact.id)])] } : {}),
        ...(readRevision === undefined ? {} : { readProgress: readRevision === null ? null : { revision: story.revision, developmentIds: story.developments.map(value => value.id) } }),
      } })
      return state.events[id]
    })
  }

  async followedTopics(): Promise<string[]> {
    return (await this.reader.read()).followedTopics ?? []
  }

  setTopicFollow(value: string, following: boolean): Promise<string[]> {
    return this.exclusive(async () => {
      const topic = value.trim().toLowerCase()
      if (!topic || topic.length > 80) throw new Error('Invalid stored topic')
      const stories = await this.readStories()
      if (following && !stories.some(story => story.topics.some(label => label.toLowerCase() === topic))) throw new Error('Unknown stored topic')
      const state = await this.reader.update(state => {
        const topics = new Set(state.followedTopics ?? [])
        if (following) topics.add(topic)
        else topics.delete(topic)
        state.followedTopics = [...topics].sort()
        if (following) for (const story of stories.filter(story => story.topics.some(label => label.toLowerCase() === topic))) {
          const saved = state.events[story.id] ?? {}
          state.events[story.id] = { ...saved, observedDevelopments: [...new Set([...(saved.observedDevelopments ?? []), ...story.developments.map(fact => fact.id)])] }
        }
      })
      return state.followedTopics ?? []
    })
  }

  async list(query: StoryQuery = {}): Promise<{ stories: NewsStoryPreview[]; sources: string[]; topics: Array<{ topic: string; count: number }>; nextOffset: number | null }> {
    const stories = await this.readStories()
    const associations = new Map(await Promise.all(stories.map(async story => [story.id, associationView(await readAssociations(this.directory, story.id), story.revision)] as const)))
    const related = query.relatedTo ? stories.find(story => story.id === query.relatedTo) : undefined
    const relations = new Map(stories.map(story => [story.id, related ? newsStoryRelation(related, story) : { topics: [], symbols: [] }]))
    const ids = [...new Set(stories.flatMap(story => story.developments.flatMap(fact => fact.reportIds)))]
    const evidence = await this.evidence(ids, true)
    const sourceImportant = new Set(stories.filter(story => story.developments.some(fact => fact.reportIds.some(id => {
      const report = evidence.get(id)
      return report && isImportantReport(report)
    }))).map(story => story.id))
    const now = this.now()
    const attention = new Map(stories.map(story => [story.id, eventHeat(story.developments.flatMap(fact => fact.reportIds).flatMap(id => evidence.has(id) ? [evidence.get(id)!] : []), now)]))
    const coverage = [...new Set(this.options.coverage?.() ?? [])].sort()
    const state = await this.reader.update(state => {
      if (!stories.length || state.history.some(sample => Math.floor(sample.at / 3600000) === Math.floor(now / 3600000))) return false
      state.history = [...state.history.filter(sample => sample.at >= now - 7 * 86400000), { at: now, coverage, scores: Object.fromEntries([...attention].map(([id, value]) => [id, value.heat])) }].slice(-192)
    })
    const important = (story: NewsStory) => state.events[story.id]?.important ?? (sourceImportant.has(story.id) || story.importance?.level === 'important')
    // Changed or unknown collector coverage cannot support a like-for-like trend.
    const baseline = coverage.length ? [...state.history].reverse().find(sample => sample.at <= now - 6 * 3600000 && sample.at >= now - 7 * 3600000 && JSON.stringify(sample.coverage) === JSON.stringify(coverage)) : undefined
    const topics = new Map<string, number>()
    for (const story of stories) for (const topic of new Set(story.topics.map(topic => topic.toLowerCase()))) topics.set(topic, (topics.get(topic) ?? 0) + 1)
    const matches = this.provider.matchNewsArchive ? await this.provider.matchNewsArchive(ids, query) : await this.matchEvidence(ids, query)
    const sourceIds = new Set(matches.sourceIds), keywordIds = new Set(matches.keywordIds)
    const filtered = stories.filter(story => {
      if (query.eventId && story.id !== query.eventId) return false
      const view = associations.get(story.id)
      const targets = view?.status === 'current' ? view.current?.relations.filter(relation => relation.status === 'active') ?? [] : []
      if (query.country && !targets.some(relation => relation.country === query.country)) return false
      if (query.industry && !targets.some(relation => relation.industry === query.industry)) return false
      if (query.asset && !targets.some(relation => relation.asset?.barId === query.asset)) return false
      const read = state.events[story.id]?.readProgress
      if (query.readStatus === 'unread' && read) return false
      if (query.readStatus === 'updated' && (!read || read.revision >= story.revision)) return false
      if (query.relatedTo && (story.id === query.relatedTo || !relations.get(story.id)!.topics.length && !relations.get(story.id)!.symbols.length)) return false
      if (query.selected && !story.selected) return false
      if (query.bookmarked && !state.events[story.id]?.bookmarked) return false
      if (query.important && !important(story)) return false
      if (query.topics?.length && !story.topics.some(topic => query.topics!.some(value => value.toLowerCase() === topic.toLowerCase()))) return false
      if (query.symbol && !story.symbols.some(symbol => symbol.toLowerCase() === query.symbol!.toLowerCase() || symbol.split(':').pop()?.toLowerCase() === query.symbol!.toLowerCase())) return false
      const reportIds = story.developments.flatMap(fact => fact.reportIds)
      if (query.source && !reportIds.some(id => sourceIds.has(id))) return false
      const text = [story.title, story.summary, story.reason, ...(story.transmission?.steps ?? []), story.transmission?.condition ?? '', ...story.topics, ...story.symbols, ...story.developments.flatMap(fact => [fact.title, fact.summary])].join(' ').toLowerCase()
      if (query.keyword && !text.includes(query.keyword.toLowerCase()) && !reportIds.some(id => keywordIds.has(id))) return false
      const latest = Math.max(...story.developments.map(fact => Date.parse(fact.time)))
      return (!query.startTime || latest > Date.parse(query.startTime)) && (!query.endTime || latest <= Date.parse(query.endTime))
    }).sort((a, b) => {
      if (query.relatedTo) {
        const left = relations.get(a.id)!, right = relations.get(b.id)!
        return right.symbols.length - left.symbols.length || right.topics.length - left.topics.length || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id)
      }
      if (query.order === 'heat') return (attention.get(b.id)?.heat ?? 0) - (attention.get(a.id)?.heat ?? 0) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id)
      if (query.keyword && query.order !== 'recent') {
        const keyword = query.keyword.toLowerCase()
        const rank = (story: NewsStory) => (story.title.toLowerCase().includes(keyword) ? 4 : 0) + (story.topics.some(topic => topic.toLowerCase().includes(keyword)) ? 2 : 0) + (story.summary.toLowerCase().includes(keyword) ? 1 : 0)
        const difference = rank(b) - rank(a)
        if (difference) return difference
      }
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id)
    })
    const offset = query.offset ?? 0
    const recent = filtered.slice(offset, offset + 50)
    return { topics: [...topics].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)), sources: matches.sources, nextOffset: filtered.length > offset + 50 ? offset + 50 : null, stories: recent.map(story => {
      const detail = this.resolve(story, evidence)
      const saved = state.events[story.id]
      const heat = attention.get(story.id)!
      const previous = baseline?.scores[story.id]
      const trend: NonNullable<NewsStoryPreview['reading']>['trend'] = previous === undefined ? 'unknown' : heat.heat > previous * 1.1 + 0.05 ? 'rising' : heat.heat < previous * 0.9 - 0.05 ? 'falling' : 'steady'
      const withinDay = (time: number | undefined) => time !== undefined && now >= time && now - time < 86400000
      const publishers = new Set(story.developments.flatMap(fact => fact.reportIds).map(id => evidence.get(id)).flatMap(report => report ? [newsPublisher(report)].filter(Boolean) : [])).size
      return { ...detail, associations: associations.get(story.id), reading: { ...heat, publishers, trend, following: saved?.following ?? false, readProgress: saved?.readProgress ?? null, bookmarked: saved?.bookmarked ?? false, locked: saved?.locked ?? false, important: important(story),
        isNew: withinDay(saved?.firstSeen) && withinDay(Math.min(...story.developments.map(fact => Date.parse(fact.time)))),
        hasUpdate: story.developments.length > 1 && withinDay(saved?.lastDevelopmentAt) && withinDay(Math.max(...story.developments.map(fact => Date.parse(fact.time)))),
      }, reports: detail.reports.map(({ content: _content, quote: _quote, media: _media, image: _image, ...report }) => report) }
    }) }
  }

  async reportOccurrences(ids: number[]): Promise<Map<number, ReportOccurrence | null>> {
    const occurrences = new Map<number, ReportOccurrence | null>()
    if (!ids.length) return occurrences
    const requested = new Set(ids)
    for (const story of await this.readStories()) {
      for (const development of story.developments) {
        for (const id of development.reportIds) {
          if (!requested.has(id)) continue
          // Conflicting prepared identities must never force two reports together.
          occurrences.set(id, occurrences.has(id) ? null : { storyId: story.id, developmentId: development.id })
        }
      }
    }
    return occurrences
  }

  private async readStories(): Promise<NewsStory[]> {
    let names: string[]
    try { names = await readdir(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const stories: NewsStory[] = []
    for (const name of names.filter(name => /^[a-z0-9][a-z0-9-]{0,79}\.json$/.test(name))) {
      const story = newsStorySchema.parse(JSON.parse(await readFile(join(this.directory, name), 'utf8')))
      if (name !== `${story.id}.json`) throw new Error('Stored event identity mismatch')
      stories.push(story)
    }
    return stories
  }

  async get(id: string): Promise<NewsStoryDetail> {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw new Error('Invalid event identity')
    const story = newsStorySchema.parse(JSON.parse(await readFile(join(this.directory, `${id}.json`), 'utf8')))
    if (story.id !== id) throw new Error('Stored event identity mismatch')
    return { ...this.resolve(story, await this.evidence(story.developments.flatMap(fact => fact.reportIds))), associations: associationView(await readAssociations(this.directory, id), story.revision) }
  }

  async getAssociations(id: string) {
    const story = await this.get(id)
    const originals = await this.evidence(story.developments.flatMap(fact => fact.reportIds))
    return { record: await readAssociations(this.directory, id), view: story.associations!, evidence: story.reports.flatMap(value => {
      const report = originals.get(value.id)
      if (!report) return []
      const field = report.content.trim() ? 'content' as const : 'title' as const
      return [{ reportId: report.id, field, sha256: evidenceDigest(report[field]), text: report[field] }]
    }) }
  }

  publishAssociations(id: string, value: unknown, options: { automatic?: boolean } = {}) {
    return this.exclusive(async () => {
      const input = newsAssociationInputSchema.parse(value)
      const story = await this.get(id)
      const previous = await readAssociations(this.directory, id)
      const latest = previous?.history.at(-1)
      if (input.storyId !== id || input.storyRevision !== story.revision || input.revision !== (latest?.revision ?? 0) + 1) throw new Error('Association revision conflict')
      if (Date.parse(input.preparedAt) < Date.parse(story.updatedAt) || latest && Date.parse(input.preparedAt) < Date.parse(latest.preparedAt)) throw new Error('Association preparation time conflict')
      const state = await this.reader.read()
      if (options.automatic && state.events[id]?.locked) throw new Error('Event is locked for human review')
      if (options.automatic && latest?.protected) throw new Error('Associations are protected by a human correction')
      const originals = await this.evidence(story.developments.flatMap(fact => fact.reportIds))
      for (const relation of input.relations) {
        if (relation.asset && !await this.options.resolveAsset?.(relation.asset)) throw new Error('Asset identity is unresolved or ambiguous; retain it in unresolved')
        for (const citation of relation.evidence) {
        const report = story.reports.some(report => report.id === citation.reportId) ? originals.get(citation.reportId) : undefined
        if (!report || citation.field === 'title' && report.content.trim() || evidenceDigest(report[citation.field]) !== citation.sha256 || !report[citation.field].includes(citation.excerpt)) throw new Error('Association evidence mismatch or unavailable')
        if (state.reports[citation.reportId]?.status === 'review') throw new Error('Association evidence is awaiting human review')
        }
      }
      const saved = { ...input, protected: options.automatic ? false : input.protected ?? true, authority: options.automatic ? 'native' as const : 'operator' as const }
      const record = { version: 1 as const, storyId: id, history: [...(previous?.history ?? []), saved] }
      await writeAssociations(this.directory, record)
      return associationView(record, story.revision)
    })
  }

  publish(value: unknown, options: { automatic?: boolean } = {}): Promise<NewsStory> {
    return this.exclusive(async () => {
      const story = newsStorySchema.parse(value)
      const path = join(this.directory, `${story.id}.json`)
      let previous: NewsStory | undefined
      try { previous = newsStorySchema.parse(JSON.parse(await readFile(path, 'utf8'))) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (story.revision !== (previous?.revision ?? 0) + 1) throw new Error('Story revision conflict')
      if (previous && Date.parse(story.updatedAt) < Date.parse(previous.updatedAt)) throw new Error('Story revision time conflict')
      if (options.automatic) {
        const state = await this.reader.read()
        if (state.events[story.id]?.locked) throw new Error('Event is locked for human review')
        if (!story.importance) throw new Error('Automatic events must include an importance assessment with a reason and original report IDs')
        if (story.transmission === undefined) throw new Error('Automatic events must include transmission with steps, a condition and report IDs, or null when no supported path exists')
        const assignments = new Map(story.developments.flatMap(fact => fact.reportIds.map(id => [id, fact.id] as const)))
        if (previous?.developments.some(fact => fact.reportIds.some(id => assignments.get(id) !== fact.id))) throw new Error('Automatic revisions must retain prior developments and evidence')
        if ([...assignments.keys()].some(id => state.reports[id]?.status === 'review')) throw new Error('Original report is awaiting human review')
        if ((await this.readStories()).some(other => other.id !== story.id && other.developments.some(fact => fact.reportIds.some(id => assignments.has(id))))) throw new Error('Original report is already assigned to another event')
      }
      const result = this.resolve(story, await this.evidence(story.developments.flatMap(fact => fact.reportIds), true))
      if (result.missingReportIds.length) throw new Error('Referenced archive report unavailable')
      if (story.comparisons?.some(note => note.kind === 'official-response' && !result.reports.some(report => note.reportIds.includes(report.id) && report.role === 'official'))) {
        throw new Error('An official response requires an original with an explicit official source role')
      }
      await mkdir(this.directory, { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(story) + '\n', { flag: 'wx', mode: 0o600 })
        await rename(temporary, path)
      } finally { await rm(temporary, { force: true }) }
      let update: NewsFollowUpdate | undefined
      await this.reader.update(state => {
        const saved = state.events[story.id] ?? {}
        const observed = new Set(saved.observedDevelopments ?? previous?.developments.map(fact => fact.id) ?? [])
        const fresh = story.developments.filter(fact => !observed.has(fact.id))
        if (fresh.length && (saved.following || story.topics.some(topic => state.followedTopics?.includes(topic.toLowerCase())))) {
          update = { storyId: story.id, revision: story.revision, title: story.title, developmentIds: fresh.map(fact => fact.id) }
        }
        state.events[story.id] = { ...saved, firstSeen: saved.firstSeen ?? this.now(),
          observedDevelopments: [...new Set([...observed, ...story.developments.map(fact => fact.id)])],
          ...(story.developments.some(fact => !previous?.developments.some(old => old.id === fact.id)) ? { lastDevelopmentAt: this.now() } : {}) }
        for (const id of story.developments.flatMap(fact => fact.reportIds)) delete state.reports[id]
      })
      if (update) {
        try { await this.options.onFollowUpdate?.(update) }
        catch { console.warn('news: follow notification unavailable; event publication retained') }
      }
      return story
    })
  }

  private async evidence(ids: number[], preview = false): Promise<Map<number, NewsItem>> {
    const unique = [...new Set(ids)]
    const items = this.provider.getNewsByIds ? await this.provider.getNewsByIds(unique, { preview })
      : (await Promise.all(unique.map(id => this.provider.getNewsById?.(id)))).filter((item): item is NewsItem => Boolean(item))
    return new Map(items.map(item => [item.id, item]))
  }

  private async matchEvidence(ids: number[], query: StoryQuery) {
    const evidence = await this.evidence(ids)
    const sourceIds: number[] = [], keywordIds: number[] = [], sources = new Set<string>()
    for (const item of evidence.values()) {
      const publisher = item.metadata.publisher ?? item.metadata.source
      if (publisher) sources.add(publisher)
      if (query.source && publisher?.toLowerCase() === query.source.toLowerCase()) sourceIds.push(item.id)
      if (query.keyword && [item.title, item.content, ...Object.values(item.metadata)].join('\n').toLowerCase().includes(query.keyword.toLowerCase())) keywordIds.push(item.id)
    }
    return { sourceIds, keywordIds, sources: [...sources] }
  }

  private resolve(story: NewsStory, evidence: Map<number, NewsItem>): NewsStoryDetail {
    const result: NewsStoryDetail = { ...story, reports: [], missingReportIds: [] }
    const ids = story.developments.flatMap(development => development.reportIds)
    for (const id of ids) {
      const item = evidence.get(id)
      if (!item) { result.missingReportIds.push(id); continue }
      result.reports.push(newsReport(item))
    }
    return result
  }
}
