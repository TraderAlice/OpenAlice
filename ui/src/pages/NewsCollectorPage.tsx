import { useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { type AppConfig, type NewsCollectorConfig, type NewsCollectorFeed } from '../api'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, SettingsScrollArea, inputClass } from '../components/form'
import { CountBadge } from '../components/CountBadge'
import { ContextHelp } from '../components/ContextHelp'
import { Collapsible, CollapsibleContent, CollapsibleDetailsTrigger, CollapsibleTrigger } from '../components/ui/collapsible'
import { Toggle } from '../components/Toggle'
import { useConfigPage } from '../hooks/useConfigPage'
import { PageHeader } from '../components/PageHeader'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button } from '../components/ui/button'

// ==================== Config Section ====================

const DEFAULT_NEWS_CONFIG: NewsCollectorConfig = {
  enabled: true,
  intervalMinutes: 10,
  maxInMemory: 2000,
  retentionDays: 7,
  feeds: [],
}

function CollectorSettings() {
  const { config, status, loadError, updateConfig, updateConfigImmediate, reload, retry } = useConfigPage<NewsCollectorConfig>({
    section: 'news',
    extract: (full: AppConfig) => (full as Record<string, unknown>).news as NewsCollectorConfig,
  })

  const cfg = config ?? DEFAULT_NEWS_CONFIG
  const enabled = cfg.enabled !== false

  return (
    <div className="w-full max-w-[880px]">
      <div className="flex min-h-12 items-center justify-between gap-4 border-b border-border/60 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Collect articles</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <SaveIndicator status={status} onRetry={retry} />
          <Toggle
            ariaLabel="News collection"
            size="sm"
            checked={enabled}
            disabled={!config}
            onChange={(v) => updateConfigImmediate({ enabled: v })}
          />
        </div>
      </div>

      <fieldset disabled={!config || !enabled} className="min-w-0 disabled:opacity-50">
        {/* Collection Settings */}
        <ConfigSection
          title="Collection Settings"
          help="Control how often articles are fetched and how long they are retained in the archive."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Fetch interval (min)" controlId="news-interval">
              <input
                className={inputClass}
                type="number"
                min={1}
                id="news-interval"
                value={cfg.intervalMinutes}
                onChange={(e) => updateConfig({ intervalMinutes: Number(e.target.value) || 10 })}
              />
            </Field>
            <Field label="Retention (days)" controlId="news-retention">
              <input
                className={inputClass}
                type="number"
                min={1}
                id="news-retention"
                value={cfg.retentionDays}
                onChange={(e) => updateConfig({ retentionDays: Number(e.target.value) || 7 })}
              />
            </Field>
          </div>
        </ConfigSection>

        {/* RSS Feeds */}
        {config && <FeedsSection
          feeds={config.feeds}
          onChange={(feeds) => updateConfigImmediate({ feeds })}
        />}
      </fieldset>
      {loadError && (
        <div role="alert" className="mt-4 flex min-h-12 items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-sm text-destructive">Failed to load configuration.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      )}
    </div>
  )
}

// ==================== Feeds Section ====================

export function isValidFeedUrl(value: string): boolean {
  try {
    new URL(value.trim())
    return true
  } catch {
    return false
  }
}

const RSSHUB_PRESETS = [
  { name: '财联社 · 电报', source: 'cls', route: 'cls/telegraph', description: 'CLS telegraph news via your RSSHub instance.' },
  { name: '格隆汇 · 实时快讯', source: 'gelonghui', route: 'gelonghui/live', description: 'Gelonghui live news via your RSSHub instance.' },
  { name: '金十数据 · 市场快讯', source: 'jin10', route: 'jin10', description: 'Jin10 market news via your RSSHub instance.' },
]

function rssHubBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null
    return url.href.replace(/\/+$/, '') + '/'
  } catch {
    return null
  }
}

function RssHubPresets({ feeds, onChange }: {
  feeds: NewsCollectorFeed[]
  onChange: (feeds: NewsCollectorFeed[]) => void
}) {
  const [instance, setInstance] = useState('')
  const baseUrl = rssHubBaseUrl(instance)
  const invalid = instance.trim().length > 0 && !baseUrl

  return (
    <Collapsible className="mb-4 border-b border-border/60 pb-3">
      <CollapsibleDetailsTrigger>RSSHub</CollapsibleDetailsTrigger>
      <CollapsibleContent keepMounted>
        <div className="space-y-3 pt-3">
          <p id="rsshub-help" className="text-sm leading-5 text-muted-foreground">
            Connect an RSSHub instance reachable from the OpenAlice backend.
            Restart Alice after saving to collect the new feeds.
          </p>
          <Field label="RSSHub instance URL" controlId="rsshub-instance">
            <input
              id="rsshub-instance"
              type="url"
              className={inputClass}
              value={instance}
              onChange={(event) => setInstance(event.target.value)}
              placeholder="http://localhost:1200"
              aria-invalid={invalid}
              aria-describedby={invalid ? 'rsshub-help rsshub-error' : 'rsshub-help'}
            />
            {invalid && (
              <p id="rsshub-error" role="alert" className="mt-1 text-sm text-destructive">
                Enter an HTTP(S) instance URL without credentials, a query, or a fragment.
              </p>
            )}
          </Field>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {RSSHUB_PRESETS.map((preset) => {
              const added = feeds.some((feed) => feed.source.trim().toLowerCase() === preset.source)
              return (
                <Button
                  key={preset.source}
                  type="button"
                  variant="outline"
                  disabled={!baseUrl || added}
                  onClick={() => {
                    if (!baseUrl || added) return
                    onChange([...feeds, {
                      name: preset.name,
                      source: preset.source,
                      url: new URL(preset.route, baseUrl).href,
                      description: preset.description,
                      enabled: true,
                    }])
                  }}
                >
                  {added ? 'Added' : 'Add'} {preset.name}
                </Button>
              )
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function FeedsSection({
  feeds,
  onChange,
}: {
  feeds: NewsCollectorFeed[]
  onChange: (feeds: NewsCollectorFeed[]) => void
}) {
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newSource, setNewSource] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const addFeedRef = useRef<HTMLButtonElement>(null)
  const feedNameRef = useRef<HTMLInputElement>(null)
  const [pendingRemoval, setPendingRemoval] = useState<{
    feed: NewsCollectorFeed
    index: number
  } | null>(null)

  const activeCount = useMemo(() => feeds.filter((f) => f.enabled !== false).length, [feeds])
  const feedUrlValid = isValidFeedUrl(newUrl)
  const showFeedUrlError = newUrl.trim().length > 0 && !feedUrlValid

  const removeFeed = (index: number) => onChange(feeds.filter((_, i) => i !== index))

  const setEnabled = (index: number, enabled: boolean) => {
    onChange(feeds.map((f, i) => (i === index ? { ...f, enabled } : f)))
  }

  const addFeed = () => {
    if (!newName.trim() || !feedUrlValid || !newSource.trim()) return
    const entry: NewsCollectorFeed = {
      name: newName.trim(),
      url: newUrl.trim(),
      source: newSource.trim(),
      enabled: true,
    }
    if (newDescription.trim()) entry.description = newDescription.trim()
    onChange([...feeds, entry])
    setNewName('')
    setNewUrl('')
    setNewSource('')
    setNewDescription('')
    feedNameRef.current?.focus()
  }

  return (
    <ConfigSection
      title="RSS Feeds"
      accessory={<CountBadge count={activeCount} label={`${activeCount} of ${feeds.length} feeds active`} />}
    >
      <RssHubPresets feeds={feeds} onChange={onChange} />
      {/* Existing feeds */}
      {feeds.length > 0 && (
        <div className="space-y-2 mb-4">
          {feeds.map((feed, i) => {
            const isEnabled = feed.enabled !== false
            return (
              <div
                key={`${feed.source}-${i}`}
                className={`flex min-h-12 items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 ${isEnabled ? 'bg-background' : 'bg-muted/30'}`}
              >
                <Toggle
                  ariaLabel={feed.name}
                  size="sm"
                  checked={isEnabled}
                  onChange={(v) => setEnabled(i, v)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex min-w-0 items-center gap-1">
                    <p className="truncate text-sm font-medium text-foreground">{feed.name}</p>
                    <ContextHelp label={feed.name}>{[
                      feed.description,
                      `Source: ${feed.source}`,
                      feed.categories?.length ? `Categories: ${feed.categories.join(', ')}` : '',
                    ].filter(Boolean).join('. ')}</ContextHelp>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground" title={feed.url}>{feed.url}</p>
                </div>
                <Button
                  type="button"
                  onClick={() => setPendingRemoval({ feed, index: i })}
                  aria-label={`Remove ${feed.name}`}
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  title={`Remove ${feed.name}`}
                >
                  <X aria-hidden className="size-3.5" />
                </Button>
              </div>
            )
          })}
        </div>
      )}

      {/* Add feed form */}
      <Collapsible defaultOpen={feeds.length === 0}>
        <CollapsibleTrigger ref={addFeedRef} render={<Button variant="outline" className="mb-3" />}><Plus aria-hidden />New feed</CollapsibleTrigger>
        <CollapsibleContent keepMounted>
          <form className="space-y-3 rounded-lg border border-border/60 p-4" onSubmit={(event) => { event.preventDefault(); addFeed() }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name" controlId="news-feed-name">
                <input ref={feedNameRef} id="news-feed-name" className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. CoinDesk" />
              </Field>
              <Field label="Source Tag" controlId="news-feed-source">
                <input id="news-feed-source" className={inputClass} value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder="e.g. coindesk" />
              </Field>
            </div>
            <Field label="Feed URL" controlId="news-feed-url">
              <input
                className={inputClass}
                type="url"
                id="news-feed-url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://example.com/rss.xml"
                aria-invalid={showFeedUrlError}
                aria-describedby={showFeedUrlError ? 'news-feed-url-error' : undefined}
              />
              {showFeedUrlError && (
                <p id="news-feed-url-error" role="alert" className="mt-1 text-sm text-destructive">
                  Enter a valid URL, for example https://example.com/rss.xml.
                </p>
              )}
            </Field>
            <Field label="Description (optional)" controlId="news-feed-description">
              <input id="news-feed-description" className={inputClass} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Short description shown in the feed list" />
            </Field>
            <Button
              type="submit"
              disabled={!newName.trim() || !feedUrlValid || !newSource.trim()}
              variant="outline"
            >
              Add Feed
            </Button>
          </form>
        </CollapsibleContent>
      </Collapsible>

      {pendingRemoval && (
        <ConfirmDialog
          fallbackFocusRef={addFeedRef}
          title={`Remove ${pendingRemoval.feed.name}?`}
          message={(
            <>
              OpenAlice will stop collecting new articles from{' '}
              <strong>{pendingRemoval.feed.name}</strong> and remove it from your saved News Sources.
              Existing articles remain available until the configured retention period expires.
            </>
          )}
          confirmLabel="Remove feed"
          workingLabel="Removing…"
          onConfirm={() => {
            removeFeed(pendingRemoval.index)
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

      <SettingsScrollArea>
        <CollectorSettings />
      </SettingsScrollArea>
    </div>
  )
}
