import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { api, type AppConfig, type NewsCollectorConfig, type NewsCollectorFeed } from '../api'
import type { NewsCollectorFeedState, NewsCollectorFeedStatus } from '../api/types'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, SettingsScrollArea, inputClass } from '../components/form'
import { Toggle } from '../components/Toggle'
import { useConfigPage } from '../hooks/useConfigPage'
import { PageHeader } from '../components/PageHeader'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button } from '../components/ui/button'
import { NewsModulesSection, RssHubKeySection } from '../components/news-modules/NewsModulesSection'

const DEFAULT_NEWS_CONFIG: NewsCollectorConfig = {
  enabled: true,
  intervalMinutes: 10,
  maxInMemory: 2000,
  retentionDays: 7,
  rsshubBaseUrl: 'http://127.0.0.1:1200',
  feeds: [],
  modules: [],
  subscriptions: [],
}

const STATUS_POLL_INTERVAL_MS = 5_000

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function CollectorSettings() {
  const { config, status, loadError, updateConfig, updateConfigImmediate, retry, reload } = useConfigPage<NewsCollectorConfig>({
    section: 'news',
    extract: (full: AppConfig) => (full as Record<string, unknown>).news as NewsCollectorConfig,
  })

  const cfg = { ...DEFAULT_NEWS_CONFIG, ...(config ?? {}) }
  const enabled = cfg.enabled !== false
  const [presets, setPresets] = useState<NewsCollectorFeed[]>([])
  const [presetsLoading, setPresetsLoading] = useState(true)
  const [presetsError, setPresetsError] = useState<string | null>(null)
  const [presetsRetryKey, setPresetsRetryKey] = useState(0)
  const [statusFeeds, setStatusFeeds] = useState<NewsCollectorFeedStatus[]>([])
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [statusRetryKey, setStatusRetryKey] = useState(0)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<{ total: number; new: number } | null>(null)
  const statusRefreshRef = useRef<((afterCollection?: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setPresetsLoading(true)
    setPresetsError(null)
    void api.config.getNewsPresets(controller.signal)
      .then(({ feeds }) => setPresets(feeds))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setPresetsError(getErrorMessage(error, 'Failed to load news source presets.'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setPresetsLoading(false)
      })
    return () => controller.abort()
  }, [presetsRetryKey])

  useEffect(() => {
    const controller = new AbortController()
    let mounted = true
    let currentRequest: Promise<void> | null = null
    const refresh = async (afterCollection = false) => {
      if (currentRequest) {
        if (!afterCollection) return currentRequest
        await currentRequest
      }
      if (currentRequest) return currentRequest
      currentRequest = (async () => {
        setStatusLoading(true)
        try {
          const result = await api.news.getCollectorStatus(controller.signal)
          if (mounted) {
            setStatusFeeds(result.feeds)
            setStatusError(null)
          }
        } catch (error) {
          if (mounted && !controller.signal.aborted) setStatusError(getErrorMessage(error, 'Failed to load collector status.'))
        } finally {
          if (mounted) setStatusLoading(false)
        }
      })().finally(() => { currentRequest = null })
      return currentRequest
    }
    statusRefreshRef.current = refresh
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, STATUS_POLL_INTERVAL_MS)
    return () => {
      mounted = false
      window.clearInterval(interval)
      controller.abort()
      if (statusRefreshRef.current === refresh) statusRefreshRef.current = null
    }
  }, [statusRetryKey])

  const checkNow = async () => {
    if (checking) return
    setChecking(true)
    setCheckError(null)
    setCheckResult(null)
    try {
      setCheckResult(await api.news.collect())
    } catch (error) {
      setCheckError(getErrorMessage(error, 'News collection failed.'))
    } finally {
      await statusRefreshRef.current?.(true)
      setChecking(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[880px]">
      <div className="flex min-h-12 items-center justify-between gap-4 border-b border-border/60 py-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">Collect articles</p>
          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
            Fetch enabled feeds on the configured schedule.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <SaveIndicator status={status} onRetry={retry} />
          <Toggle
            ariaLabel="News collection"
            size="sm"
            checked={enabled}
            onChange={(value) => updateConfigImmediate({ enabled: value })}
          />
        </div>
      </div>

      <div className={`${!enabled ? 'opacity-40 pointer-events-none' : ''}`}>
        <ConfigSection
          title="Collection Settings"
          description="Source, instance and interval changes apply without restart. Retention changes take effect after restarting Alice."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Fetch interval (min)" controlId="news-fetch-interval">
              <input id="news-fetch-interval" className={inputClass} type="number" min={1} value={cfg.intervalMinutes} onChange={(event) => updateConfig({ intervalMinutes: Number(event.target.value) || 10 })} />
            </Field>
            <Field label="Retention (days)" controlId="news-retention-days">
              <input id="news-retention-days" className={inputClass} type="number" min={1} value={cfg.retentionDays} onChange={(event) => updateConfig({ retentionDays: Number(event.target.value) || 7 })} />
            </Field>
          </div>
        </ConfigSection>

        <ConfigSection
          title="RSSHub instance"
          description="All RSSHub routes use this backend-reachable address. Changing it updates the endpoint used by every RSSHub source; no restart is required."
        >
          <Field label="RSSHub instance URL" controlId="news-rsshub-base-url" description="OpenAlice does not install RSSHub. The configured instance must be reachable from the OpenAlice backend." descriptionId="news-rsshub-base-help">
            <input
              id="news-rsshub-base-url"
              type="url"
              className={inputClass}
              value={cfg.rsshubBaseUrl}
              onChange={(event) => updateConfig({ rsshubBaseUrl: event.target.value })}
              placeholder="http://127.0.0.1:1200"
              aria-invalid={!normalizeRsshubBaseUrl(cfg.rsshubBaseUrl)}
              aria-describedby={!normalizeRsshubBaseUrl(cfg.rsshubBaseUrl) ? 'news-rsshub-base-help news-rsshub-base-error' : 'news-rsshub-base-help'}
            />
            {!normalizeRsshubBaseUrl(cfg.rsshubBaseUrl) && (
              <p id="news-rsshub-base-error" role="alert" className="mt-1 text-[12px] text-destructive">
                Enter an HTTP(S) URL without credentials, a query, or a fragment.
              </p>
            )}
          </Field>
        </ConfigSection>

        <FeedsSection
          feeds={cfg.feeds}
          onChange={(feeds) => updateConfigImmediate({ feeds })}
          presets={presets}
          presetsLoading={presetsLoading}
          presetsError={presetsError}
          onRetryPresets={() => setPresetsRetryKey((value) => value + 1)}
          rsshubBaseUrl={cfg.rsshubBaseUrl}
        />

      </div>
      <RssHubKeySection />
      {config && <NewsModulesSection
        selections={cfg.modules}
        subscriptions={cfg.subscriptions}
        onSelectionsChange={(modules) => updateConfigImmediate({ modules })}
        onSubscriptionsChange={(subscriptions) => updateConfigImmediate({ subscriptions })}
        collectorEnabled={enabled}
        saveStatus={status}
      />}

      <CollectionStatusSection
        feeds={statusFeeds}
        loading={statusLoading}
        error={statusError}
        onRetry={() => setStatusRetryKey((value) => value + 1)}
        checking={checking}
        onCheckNow={() => void checkNow()}
        checkError={checkError}
        checkResult={checkResult}
        onRetryCheck={() => void checkNow()}
      />

      {loadError && (
        <div role="alert" className="mt-4 flex min-h-12 items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-[13px] text-destructive">Failed to load configuration.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>Retry</Button>
        </div>
      )}
    </div>
  )
}


// ==================== Feeds Section ====================

export function isValidFeedUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

function normalizeRsshubBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null
    return url.href.replace(/\/+$/, '') + '/'
  } catch {
    return null
  }
}


function isValidRsshubRoute(value: string): boolean {
  const route = value.trim()
  if (!route || URL.canParse(route) || /^[\/]|[\\#\s]/.test(route)) return false
  try {
    const path = route.split('?')[0]!
    if (path.split('/').some((part) => ['.', '..'].includes(decodeURIComponent(part)))) return false
    const url = new URL(route, 'https://rsshub.invalid/')
    return url.origin === 'https://rsshub.invalid' && url.pathname !== '/'
  } catch {
    return false
  }
}

function isSamePresetSource(feed: NewsCollectorFeed, preset: NewsCollectorFeed): boolean {
  if (feed.source.trim().toLowerCase() !== preset.source.trim().toLowerCase()) return false
  if (preset.rsshubRoute) return feed.rsshubRoute === preset.rsshubRoute
  return !feed.rsshubRoute && feed.url === preset.url
}

function formatTimestamp(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

const FEED_STATE_LABELS: Record<NewsCollectorFeedState, string> = {
  disabled: 'Disabled',
  never_attempted: 'Never checked',
  checking: 'Checking',
  healthy: 'Healthy',
  error: 'Error',
}

function CollectionStatusSection({
  feeds,
  loading,
  error,
  onRetry,
  checking,
  onCheckNow,
  checkError,
  checkResult,
  onRetryCheck,
}: {
  feeds: NewsCollectorFeedStatus[]
  loading: boolean
  error: string | null
  onRetry: () => void
  checking: boolean
  onCheckNow: () => void
  checkError: string | null
  checkResult: { total: number; new: number } | null
  onRetryCheck: () => void
}) {
  return (
    <ConfigSection
      title="Source status"
      description="In-memory status for each news source. Status resets when the OpenAlice server restarts."
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">Status refreshes every 5 seconds while this page is open.</p>
        <Button type="button" variant="outline" size="sm" disabled={checking} onClick={onCheckNow}>
          {checking ? 'Checking…' : 'Check now'}
        </Button>
      </div>
      {checkResult && (
        <p role="status" aria-live="polite" className="mb-3 text-[12px] text-muted-foreground">
          Check complete: {checkResult.total} articles fetched, {checkResult.new} new.
        </p>
      )}
      {checkError && (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-[12px] text-destructive">{checkError}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetryCheck}>Retry check</Button>
        </div>
      )}
      {error && (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-[12px] text-destructive">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>Retry status</Button>
        </div>
      )}
      {feeds.length > 0 ? (
        <div className="space-y-2">
          {feeds.map((feed, index) => (
            <article key={feed.id || feed.source + ':' + feed.url + ':' + index} className="rounded-lg border border-border/60 px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="break-words text-[13px] font-medium text-foreground">{feed.name}</h4>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Source: {feed.source}</p>
                  <p className="mt-0.5 break-all text-[11px] text-muted-foreground">{feed.url}</p>
                </div>
                <span className="shrink-0 text-[11px] font-medium text-foreground">{FEED_STATE_LABELS[feed.state]}</span>
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                <div><dt className="inline">Last attempt: </dt><dd className="inline">{formatTimestamp(feed.lastAttemptAt)}</dd></div>
                <div><dt className="inline">Last success: </dt><dd className="inline">{formatTimestamp(feed.lastSuccessAt)}</dd></div>
                <div><dt className="inline">Items: </dt><dd className="inline">{feed.lastItemCount ?? '—'}</dd></div>
                <div><dt className="inline">New items: </dt><dd className="inline">{feed.lastNewItemCount ?? '—'}</dd></div>
              </dl>
              {feed.lastError && <p className="mt-2 break-words text-[11px] text-destructive">{feed.lastError}</p>}
            </article>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">{loading ? 'Loading source status…' : 'No source status is available yet.'}</p>
      )}
    </ConfigSection>
  )
}

function FeedEditor({
  feed,
  formId,
  rsshubBaseUrl,
  onSave,
  onCancel,
}: {
  feed?: NewsCollectorFeed
  formId: string
  rsshubBaseUrl: string
  onSave: (feed: NewsCollectorFeed) => void
  onCancel?: () => void
}) {
  const isEditing = feed !== undefined
  const [sourceType, setSourceType] = useState<'direct' | 'rsshub'>(feed?.rsshubRoute ? 'rsshub' : 'direct')
  const [name, setName] = useState(feed?.name ?? '')
  const [source, setSource] = useState(feed?.source ?? '')
  const [url, setUrl] = useState(feed?.rsshubRoute ? '' : feed?.url ?? '')
  const [route, setRoute] = useState(feed?.rsshubRoute ?? '')
  const [categories, setCategories] = useState(feed?.categories?.join(', ') ?? '')
  const [description, setDescription] = useState(feed?.description ?? '')
  const [submitted, setSubmitted] = useState(false)
  const baseUrl = normalizeRsshubBaseUrl(rsshubBaseUrl)
  const directUrlValid = isValidFeedUrl(url)
  const routeValid = isValidRsshubRoute(route)
  const showDirectUrlError = !directUrlValid && (submitted || url.trim().length > 0)
  const showRouteError = !routeValid && (submitted || route.trim().length > 0)
  const canSave = Boolean(name.trim() && source.trim() && (sourceType === 'direct' ? directUrlValid : routeValid && baseUrl))
  const fieldId = (name: string) => formId + '-' + name
  const errorId = (name: string) => fieldId(name) + '-error'

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    if (!canSave) return

    const normalizedRoute = route.trim()
    const next: NewsCollectorFeed = {
      ...(feed ?? { name: '', url: '', source: '' }),
      id: feed?.id || crypto.randomUUID(),
      name: name.trim(),
      source: source.trim(),
      url: sourceType === 'direct' ? url.trim() : new URL(normalizedRoute, baseUrl as string).href,
      enabled: feed?.enabled ?? true,
    }
    if (sourceType === 'rsshub') next.rsshubRoute = normalizedRoute
    else delete next.rsshubRoute

    const normalizedCategories = categories.split(',').map((category) => category.trim()).filter(Boolean)
    if (normalizedCategories.length) next.categories = normalizedCategories
    else delete next.categories
    if (description.trim()) next.description = description.trim()
    else delete next.description
    onSave(next)
    if (!isEditing) {
      setName('')
      setSource('')
      setUrl('')
      setRoute('')
      setCategories('')
      setDescription('')
      setSourceType('direct')
      setSubmitted(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border border-border/60 p-4">
      <p className="text-[13px] font-medium text-foreground">{isEditing ? 'Edit source' : 'Add source'}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" controlId={fieldId('name')}>
          <input id={fieldId('name')} className={inputClass} value={name} onChange={(event) => setName(event.target.value)} required aria-invalid={submitted && !name.trim()} aria-describedby={submitted && !name.trim() ? errorId('name') : undefined} />
          {submitted && !name.trim() && <p id={errorId('name')} role="alert" className="mt-1 text-[12px] text-destructive">Enter a source name.</p>}
        </Field>
        <Field label="Source tag" controlId={fieldId('source')}>
          <input id={fieldId('source')} className={inputClass} value={source} onChange={(event) => setSource(event.target.value)} required aria-invalid={submitted && !source.trim()} aria-describedby={submitted && !source.trim() ? errorId('source') : undefined} />
          {submitted && !source.trim() && <p id={errorId('source')} role="alert" className="mt-1 text-[12px] text-destructive">Enter a source tag.</p>}
        </Field>
      </div>
      <Field label="Source type" controlId={fieldId('type')}>
        <select id={fieldId('type')} className={inputClass} value={sourceType} onChange={(event) => setSourceType(event.target.value as 'direct' | 'rsshub')}>
          <option value="direct">Direct feed URL</option>
          <option value="rsshub">RSSHub route</option>
        </select>
      </Field>
      {sourceType === 'direct' ? (
        <Field label="Feed URL" controlId={fieldId('url')}>
          <input id={fieldId('url')} className={inputClass} type="text" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/rss.xml" required aria-invalid={showDirectUrlError} aria-describedby={showDirectUrlError ? errorId('url') : undefined} />
          {showDirectUrlError && <p id={errorId('url')} role="alert" className="mt-1 text-[12px] text-destructive">Enter a valid HTTP(S) feed URL.</p>}
        </Field>
      ) : (
        <>
          <Field label="RSSHub route" controlId={fieldId('route')} description="This route is requested from the configured RSSHub instance above.">
            <input id={fieldId('route')} className={inputClass} type="text" value={route} onChange={(event) => setRoute(event.target.value)} placeholder="finance/eastmoney/stock/000001" required aria-invalid={showRouteError} aria-describedby={showRouteError ? errorId('route') : undefined} />
            {showRouteError && <p id={errorId('route')} role="alert" className="mt-1 text-[12px] text-destructive">Enter a route path, not a full URL.</p>}
          </Field>
          {submitted && !baseUrl && <p role="alert" className="text-[12px] text-destructive">Set a valid RSSHub instance URL above before adding this route.</p>}
        </>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Categories (comma-separated)" controlId={fieldId('categories')}>
          <input id={fieldId('categories')} className={inputClass} value={categories} onChange={(event) => setCategories(event.target.value)} placeholder="markets, technology" />
        </Field>
        <Field label="Description (optional)" controlId={fieldId('description')}>
          <input id={fieldId('description')} className={inputClass} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short description shown in the feed list" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline">{isEditing ? 'Save' : 'Add Feed'}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  )
}

export function FeedsSection({
  feeds,
  onChange,
  presets,
  presetsLoading,
  presetsError,
  onRetryPresets,
  rsshubBaseUrl,
}: {
  feeds: NewsCollectorFeed[]
  onChange: (feeds: NewsCollectorFeed[]) => void
  presets: NewsCollectorFeed[]
  presetsLoading: boolean
  presetsError: string | null
  onRetryPresets: () => void
  rsshubBaseUrl: string
}) {
  const [selectedPresetIndex, setSelectedPresetIndex] = useState('')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<{ feed: NewsCollectorFeed; index: number } | null>(null)
  const activeCount = useMemo(() => feeds.filter((feed) => feed.enabled !== false).length, [feeds])
  const selectedPreset = selectedPresetIndex === '' ? undefined : presets[Number(selectedPresetIndex)]
  const duplicatePreset = selectedPreset ? feeds.some((feed) => isSamePresetSource(feed, selectedPreset)) : false

  const setEnabled = (index: number, enabled: boolean) => {
    onChange(feeds.map((feed, feedIndex) => feedIndex === index ? { ...feed, enabled } : feed))
  }

  const addPreset = () => {
    if (!selectedPreset || duplicatePreset) return
    onChange([...feeds, { ...selectedPreset, id: crypto.randomUUID(), enabled: true, categories: selectedPreset.categories ? [...selectedPreset.categories] : undefined }])
    setSelectedPresetIndex('')
  }

  return (
    <ConfigSection
      title="RSS Feeds"
      description={feeds.length > 0 ? activeCount + ' of ' + feeds.length + ' feeds active.' : 'Add a feed to start collecting articles.'}
    >
      <div className="mb-4 space-y-3 border-b border-border/60 pb-4">
        <h4 className="text-[13px] font-medium">Quick-add sources</h4>
        <p className="text-[12px] leading-5 text-muted-foreground">Choose from the server-provided English and Chinese sources, or add a custom source below.</p>
        {presetsError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
            <p className="text-[12px] text-destructive">{presetsError}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetryPresets}>Retry presets</Button>
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="News source preset" controlId="news-source-preset">
            <select id="news-source-preset" className={inputClass} value={selectedPresetIndex} onChange={(event) => setSelectedPresetIndex(event.target.value)} disabled={presetsLoading || Boolean(presetsError) || presets.length === 0}>
              <option value="">{presetsLoading ? 'Loading sources…' : 'Select a source'}</option>
              {presets.map((preset, index) => (
                <option key={preset.id || preset.source + ':' + preset.url + ':' + index} value={String(index)}>
                  {(preset.rsshubRoute ? 'RSSHub · ' : 'Direct · ') + preset.name}
                </option>
              ))}
            </select>
          </Field>
          <Button type="button" variant="outline" className="mb-3.5" disabled={!selectedPreset || duplicatePreset} onClick={addPreset}>
            {duplicatePreset ? 'Already added' : 'Add preset'}
          </Button>
        </div>
        {!presetsLoading && !presetsError && presets.length === 0 && <p className="text-[12px] text-muted-foreground">No source presets are available.</p>}
      </div>

      {feeds.length > 0 && (
        <div className="mb-4 space-y-2">
          {feeds.map((feed, index) => {
            const isEnabled = feed.enabled !== false
            return (
              <div key={feed.id || feed.source + ':' + index} className={'rounded-lg border border-border/60 px-3 py-2.5 ' + (isEnabled ? '' : 'opacity-50')}>
                <div className="flex flex-wrap items-start gap-2">
                  <Toggle ariaLabel={feed.name} size="sm" checked={isEnabled} onChange={(value) => setEnabled(index, value)} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[13px] font-medium text-foreground">{feed.name}</p>
                    {feed.description && <p className="mt-0.5 break-words text-[12px] text-muted-foreground/80">{feed.description}</p>}
                    <p className="mt-0.5 break-all text-[11px] text-muted-foreground/60">{feed.rsshubRoute ? 'RSSHub route: ' + feed.rsshubRoute : feed.url}</p>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground/60">
                      <span>source: {feed.source}</span>
                      {feed.categories && feed.categories.length > 0 && <span>categories: {feed.categories.join(', ')}</span>}
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 gap-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditingIndex(index)}>Edit</Button>
                    <Button type="button" onClick={() => setPendingRemoval({ feed, index })} aria-label={'Remove ' + feed.name} variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" title={'Remove ' + feed.name}>
                      <X aria-hidden="true" className="size-3.5" />
                    </Button>
                  </div>
                </div>
                {editingIndex === index && (
                  <div className="mt-3">
                    <FeedEditor
                      key={'edit-' + index}
                      feed={feed}
                      formId={'news-edit-' + index}
                      rsshubBaseUrl={rsshubBaseUrl}
                      onSave={(updated) => {
                        onChange(feeds.map((current, feedIndex) => feedIndex === index ? updated : current))
                        setEditingIndex(null)
                      }}
                      onCancel={() => setEditingIndex(null)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <FeedEditor
        key="add-news-feed"
        formId="news-new"
        rsshubBaseUrl={rsshubBaseUrl}
        onSave={(feed) => onChange([...feeds, feed])}
      />

      {pendingRemoval && (
        <ConfirmDialog
          title={'Remove ' + pendingRemoval.feed.name + '?'}
          message={(
            <>
              OpenAlice will stop collecting new articles from <strong>{pendingRemoval.feed.name}</strong> and remove it from your saved News Sources.
              Existing articles remain available until the configured retention period expires.
            </>
          )}
          confirmLabel="Remove feed"
          workingLabel="Removing…"
          onConfirm={() => {
            onChange(feeds.filter((_, index) => index !== pendingRemoval.index))
            setEditingIndex(null)
            setPendingRemoval(null)
          }}
          onClose={() => setPendingRemoval(null)}
        />
      )}
    </ConfigSection>
  )
}

// ==================== Page ====================

export function NewsCollectorPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="News Collector" />

      <SettingsScrollArea className="px-4 py-5 md:px-8">
        <CollectorSettings />
      </SettingsScrollArea>
    </div>
  )
}
