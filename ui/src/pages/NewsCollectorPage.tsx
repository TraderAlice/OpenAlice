import { useMemo, useState } from 'react'
import { type AppConfig, type NewsCollectorConfig, type NewsCollectorFeed } from '../api'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, SettingsScrollArea, inputClass } from '../components/form'
import { Toggle } from '../components/Toggle'
import { useConfigPage } from '../hooks/useConfigPage'
import { PageHeader } from '../components/PageHeader'
import { ConfirmDialog } from '../components/ConfirmDialog'

// ==================== Config Section ====================

const DEFAULT_NEWS_CONFIG: NewsCollectorConfig = {
  enabled: true,
  intervalMinutes: 10,
  maxInMemory: 2000,
  retentionDays: 7,
  feeds: [],
}

function CollectorSettings() {
  const { config, status, loadError, updateConfig, updateConfigImmediate, retry } = useConfigPage<NewsCollectorConfig>({
    section: 'news',
    extract: (full: AppConfig) => (full as Record<string, unknown>).news as NewsCollectorConfig,
  })

  const cfg = config ?? DEFAULT_NEWS_CONFIG
  const enabled = cfg.enabled !== false

  return (
    <div className="mx-auto w-full max-w-[880px]">
      <div className="mb-4 flex items-center justify-end gap-3">
        <SaveIndicator status={status} onRetry={retry} />
        <Toggle
          ariaLabel="News collection"
          size="sm"
          checked={enabled}
          onChange={(v) => updateConfigImmediate({ enabled: v })}
        />
      </div>

      <div className={`${!enabled ? 'opacity-40 pointer-events-none' : ''}`}>
        {/* Collection Settings */}
        <ConfigSection
          title="Collection Settings"
          description="Control how often articles are fetched and how long they are retained in the archive."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Fetch interval (min)">
              <input
                className={inputClass}
                type="number"
                min={1}
                value={cfg.intervalMinutes}
                onChange={(e) => updateConfig({ intervalMinutes: Number(e.target.value) || 10 })}
              />
            </Field>
            <Field label="Retention (days)">
              <input
                className={inputClass}
                type="number"
                min={1}
                value={cfg.retentionDays}
                onChange={(e) => updateConfig({ retentionDays: Number(e.target.value) || 7 })}
              />
            </Field>
          </div>
        </ConfigSection>

        {/* RSS Feeds */}
        <FeedsSection
          feeds={cfg.feeds}
          onChange={(feeds) => updateConfigImmediate({ feeds })}
        />
      </div>
      {loadError && <p className="mt-4 text-[13px] text-destructive">Failed to load configuration.</p>}
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
  }

  return (
    <ConfigSection
      title="RSS Feeds"
      description={
        feeds.length > 0
          ? `${activeCount} of ${feeds.length} feed${feeds.length > 1 ? 's' : ''} active. Toggle off to pause fetching without removing. Articles are searchable via globRss, grepRss, and readRss tools.`
          : 'No feeds configured yet. Add feeds to start collecting articles.'
      }
    >
      {/* Existing feeds */}
      {feeds.length > 0 && (
        <div className="space-y-2 mb-4">
          {feeds.map((feed, i) => {
            const isEnabled = feed.enabled !== false
            return (
              <div
                key={`${feed.source}-${i}`}
                className={`flex items-center gap-3 border border-border/60 rounded-lg px-3 py-2.5 ${isEnabled ? '' : 'opacity-50'}`}
              >
                <Toggle
                  ariaLabel={feed.name}
                  size="sm"
                  checked={isEnabled}
                  onChange={(v) => setEnabled(i, v)}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground truncate">{feed.name}</p>
                  {feed.description && (
                    <p className="text-[12px] text-muted-foreground/80 truncate">{feed.description}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">{feed.url}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-muted-foreground/50">source: {feed.source}</span>
                    {feed.categories && feed.categories.length > 0 && (
                      <span className="text-[11px] text-muted-foreground/50">• {feed.categories.join(', ')}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingRemoval({ feed, index: i })}
                  aria-label={`Remove ${feed.name}`}
                  className="oa-icon-action shrink-0 p-1 text-muted-foreground transition-colors hover:text-destructive"
                  title={`Remove ${feed.name}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Add feed form */}
      <div className="border border-border/40 rounded-lg p-4 space-y-3">
        <p className="text-[13px] font-medium text-muted-foreground">Add Feed</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name">
            <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. CoinDesk" />
          </Field>
          <Field label="Source Tag">
            <input className={inputClass} value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder="e.g. coindesk" />
          </Field>
        </div>
        <Field label="Feed URL">
          <input
            className={inputClass}
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://example.com/rss.xml"
            aria-invalid={showFeedUrlError}
            aria-describedby={showFeedUrlError ? 'news-feed-url-error' : undefined}
          />
          {showFeedUrlError && (
            <p id="news-feed-url-error" role="alert" className="mt-1 text-[12px] text-destructive">
              Enter a valid URL, for example https://example.com/rss.xml.
            </p>
          )}
        </Field>
        <Field label="Description (optional)">
          <input className={inputClass} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Short description shown in the feed list" />
        </Field>
        <button
          onClick={addFeed}
          disabled={!newName.trim() || !feedUrlValid || !newSource.trim()}
          className="btn-secondary"
        >
          Add Feed
        </button>
      </div>

      {pendingRemoval && (
        <ConfirmDialog
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
      <PageHeader
        title="News Collector"
        description="Configure RSS feeds and collection settings."
      />

      <SettingsScrollArea className="px-4 py-5 md:px-8">
        <CollectorSettings />
      </SettingsScrollArea>
    </div>
  )
}
