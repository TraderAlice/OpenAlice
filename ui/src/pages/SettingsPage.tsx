import { useState, useEffect, useCallback, useMemo } from 'react'
import { api, type AppConfig } from '../api'
import type { ToolInfo } from '../api/tools'
import { Toggle } from '../components/Toggle'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, inputClass } from '../components/form'
import { useAutoSave } from '../hooks/useAutoSave'
import { PageHeader } from '../components/PageHeader'
import { PageLoading, EmptyState } from '../components/StateViews'
import { useTranslation } from 'react-i18next'
import { useLocale, useSetLocale, LOCALE_LABELS } from '../i18n/useLocale'
import { useEditorTabsPref } from '../live/editor-tabs-pref'

// ==================== Appearance ====================

function AppearanceSection() {
  const { t } = useTranslation()
  const showEditorTabs = useEditorTabsPref((s) => s.showEditorTabs)
  const setShowEditorTabs = useEditorTabsPref((s) => s.setShowEditorTabs)
  return (
    <ConfigSection title={t('settings.appearance.title')} description={t('settings.appearance.description')}>
      <div className="flex items-center justify-between gap-4 py-1">
        <div className="flex-1">
          <span className="text-sm font-medium text-text">
            {t('settings.appearance.showEditorTabs')}
          </span>
          <p className="text-[12px] text-text-muted mt-0.5 leading-relaxed">
            {showEditorTabs
              ? t('settings.appearance.showEditorTabsOn')
              : t('settings.appearance.showEditorTabsOff')}
          </p>
        </div>
        <Toggle checked={showEditorTabs} onChange={setShowEditorTabs} />
      </div>
    </ConfigSection>
  )
}

// ==================== Language ====================

function LanguageSection() {
  const { t } = useTranslation()
  const locale = useLocale()
  const setLocale = useSetLocale()
  return (
    <ConfigSection title={t('settings.language.title')} description={t('settings.language.description')}>
      <div className="flex gap-2 py-1">
        {(['en', 'zh', 'ja', 'zh-Hant'] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            className={`px-3 py-1.5 text-sm rounded border transition-colors ${
              locale === l
                ? 'border-accent text-accent bg-accent/10'
                : 'border-border text-text-muted hover:text-text'
            }`}
          >
            {LOCALE_LABELS[l]}
          </button>
        ))}
      </div>
    </ConfigSection>
  )
}

// ==================== AI Trading Toggle ====================

/**
 * Master switch for AI-initiated trade execution (issue #95). OFF by default;
 * enabling it requires a deliberate danger-confirm (turning it OFF is
 * immediate). While ON, a persistent red banner keeps the risk visible.
 */
function AiTradingToggle({
  config,
  setConfig,
}: {
  config: AppConfig
  setConfig: React.Dispatch<React.SetStateAction<AppConfig | null>>
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const enabled = config.agent?.allowAiTrading || false

  const persist = useCallback(async (v: boolean) => {
    await api.config.updateSection('agent', { ...config.agent, allowAiTrading: v })
    setConfig((c) => (c ? { ...c, agent: { ...c.agent, allowAiTrading: v } } : c))
  }, [config.agent, setConfig])

  const onToggle = (v: boolean) => {
    if (v) {
      setConfirming(true) // enabling is dangerous → confirm first, persist on confirm
    } else {
      void persist(false).catch(() => { /* toggle stays on if the write fails */ })
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 py-1">
        <div className="flex-1">
          <span className="text-sm font-medium text-text">{t('settings.agent.allowAiTrading')}</span>
          <p className="text-[12px] text-text-muted mt-0.5 leading-relaxed">
            {enabled ? t('settings.agent.allowAiTradingOn') : t('settings.agent.allowAiTradingOff')}
          </p>
        </div>
        <Toggle checked={enabled} onChange={onToggle} />
      </div>
      {enabled && (
        <div className="mt-2 rounded-md border border-red/30 bg-red/5 px-3 py-2 text-[12px] text-red leading-relaxed">
          ⚠ {t('settings.agent.allowAiTradingWarning')}
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title={t('settings.agent.allowAiTradingConfirmTitle')}
          message={t('settings.agent.allowAiTradingConfirmBody')}
          confirmLabel={t('settings.agent.allowAiTradingConfirmCta')}
          variant="danger"
          onConfirm={async () => {
            try { await persist(true) } catch { /* stays off — write failed */ }
            setConfirming(false)
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  )
}

// ==================== Settings Section ====================

function SettingsSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    api.config.load().then(setConfig).catch(() => {})
  }, [])

  if (!config) return <PageLoading />

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[880px] mx-auto">
        {/* Appearance */}
        <AppearanceSection />

        {/* Language */}
        <LanguageSection />

        {/* Agent */}
        <ConfigSection title={t('settings.agent.title')} description={t('settings.agent.description')}>
          <AiTradingToggle config={config} setConfig={setConfig} />
        </ConfigSection>

        {/* Persona */}
        <ConfigSection title={t('settings.persona.title')} description={t('settings.persona.description')}>
          <PersonaEditor />
        </ConfigSection>

        {/* Compaction */}
        <ConfigSection title={t('settings.compaction.title')} description={t('settings.compaction.description')}>
          <CompactionForm config={config} />
        </ConfigSection>
      </div>
    </div>
  )
}

// ==================== Compaction Form ====================

function CompactionForm({ config }: { config: AppConfig }) {
  const { t } = useTranslation()
  const [ctx, setCtx] = useState(String(config.compaction?.maxContextTokens || ''))
  const [out, setOut] = useState(String(config.compaction?.maxOutputTokens || ''))

  const data = useMemo(
    () => ({ maxContextTokens: Number(ctx), maxOutputTokens: Number(out) }),
    [ctx, out],
  )

  const save = useCallback(async (d: { maxContextTokens: number; maxOutputTokens: number }) => {
    await api.config.updateSection('compaction', d)
  }, [])

  const { status, retry } = useAutoSave({ data, save })

  return (
    <>
      <Field label={t('settings.compaction.maxContextTokens')}>
        <input className={inputClass} type="number" step={1000} value={ctx} onChange={(e) => setCtx(e.target.value)} />
      </Field>
      <Field label={t('settings.compaction.maxOutputTokens')}>
        <input className={inputClass} type="number" step={1000} value={out} onChange={(e) => setOut(e.target.value)} />
      </Field>
      <SaveIndicator status={status} onRetry={retry} />
    </>
  )
}

// ==================== Persona Editor ====================

function PersonaEditor() {
  const { t } = useTranslation()
  const [content, setContent] = useState('')
  const [filePath, setFilePath] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    api.persona.get()
      .then(({ content, path }) => {
        setContent(content)
        setFilePath(path)
      })
      .catch(() => setError(t('settings.persona.loadError')))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await api.persona.update(content)
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError(t('settings.persona.saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-sm text-text-muted">{t('settings.persona.loading')}</div>

  return (
    <>
      <textarea
        className={`${inputClass} min-h-[200px] max-h-[400px] resize-y font-mono text-xs leading-relaxed`}
        value={content}
        onChange={(e) => { setContent(e.target.value); setDirty(true) }}
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="btn-primary-sm"
        >
          {saving ? t('settings.persona.saving') : t('settings.persona.save')}
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-green" />
            <span className="text-text-muted">{t('settings.persona.saved')}</span>
          </span>
        )}
        {error && (
          <span className="inline-flex items-center gap-1.5 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-red" />
            <span className="text-red">{error}</span>
          </span>
        )}
        {dirty && !saved && !error && (
          <span className="text-[11px] text-text-muted">{t('settings.persona.unsaved')}</span>
        )}
      </div>
      {filePath && <p className="text-[11px] text-text-muted mt-1">{filePath}</p>}
    </>
  )
}

// ==================== Tools Section ====================

interface ToolGroup {
  key: string
  tools: ToolInfo[]
}

function ToolsSection() {
  const { t } = useTranslation()
  const groupLabel = (key: string): string => {
    switch (key) {
      case 'thinking': return t('settings.tools.group.thinking')
      case 'cron': return t('settings.tools.group.cron')
      case 'equity': return t('settings.tools.group.equity')
      case 'crypto-data': return t('settings.tools.group.cryptoData')
      case 'currency-data': return t('settings.tools.group.currencyData')
      case 'news': return t('settings.tools.group.news')
      case 'news-archive': return t('settings.tools.group.newsArchive')
      case 'analysis': return t('settings.tools.group.analysis')
      case 'crypto-trading': return t('settings.tools.group.cryptoTrading')
      case 'securities-trading': return t('settings.tools.group.securitiesTrading')
      default: return key
    }
  }
  const [inventory, setInventory] = useState<ToolInfo[]>([])
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    api.tools.load().then((res) => {
      setInventory(res.inventory)
      setDisabled(new Set(res.disabled))
      setLoaded(true)
    }).catch(() => {})
  }, [])

  const groups = useMemo<ToolGroup[]>(() => {
    const map = new Map<string, ToolInfo[]>()
    for (const tool of inventory) {
      if (!map.has(tool.group)) map.set(tool.group, [])
      map.get(tool.group)!.push(tool)
    }
    return Array.from(map.entries()).map(([key, tools]) => ({
      key,
      tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
    }))
  }, [inventory])

  const configData = useMemo(
    () => ({ disabled: [...disabled].sort() }),
    [disabled],
  )

  const save = useCallback(async (d: { disabled: string[] }) => {
    await api.tools.update(d.disabled)
  }, [])

  const { status, retry } = useAutoSave({ data: configData, save, enabled: loaded })

  const toggleTool = useCallback((name: string) => {
    setDisabled((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const toggleGroup = useCallback((tools: ToolInfo[], enable: boolean) => {
    setDisabled((prev) => {
      const next = new Set(prev)
      for (const t of tools) {
        if (enable) next.delete(t.name)
        else next.add(t.name)
      }
      return next
    })
  }, [])

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return (
    <div className="flex-1 overflow-y-auto">
      {!loaded ? (
        <PageLoading />
      ) : groups.length === 0 ? (
        <EmptyState title={t('settings.tools.emptyTitle')} description={t('settings.tools.emptyDescription')} />
      ) : (
        <div className="max-w-[880px] mx-auto">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] text-text-muted">
              {t('settings.tools.summary', { tools: inventory.length, groups: groups.length })}
            </p>
            <SaveIndicator status={status} onRetry={retry} />
          </div>
          <div className="space-y-2">
            {groups.map((g) => (
              <ToolGroupCard
                key={g.key}
                group={g}
                label={groupLabel(g.key)}
                disabled={disabled}
                expanded={expanded.has(g.key)}
                onToggleExpanded={() => toggleExpanded(g.key)}
                onToggleTool={toggleTool}
                onToggleGroup={toggleGroup}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ==================== ToolGroupCard ====================

interface ToolGroupCardProps {
  group: ToolGroup
  label: string
  disabled: Set<string>
  expanded: boolean
  onToggleExpanded: () => void
  onToggleTool: (name: string) => void
  onToggleGroup: (tools: ToolInfo[], enable: boolean) => void
}

function ToolGroupCard({
  group,
  label,
  disabled,
  expanded,
  onToggleExpanded,
  onToggleTool,
  onToggleGroup,
}: ToolGroupCardProps) {
  const enabledCount = group.tools.filter((t) => !disabled.has(t.name)).length
  const noneEnabled = enabledCount === 0

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Group header */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-bg-secondary">
        <button
          onClick={onToggleExpanded}
          className="flex items-center gap-2 flex-1 text-left min-w-0"
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="text-sm font-medium text-text truncate">{label}</span>
          <span className="text-[11px] text-text-muted shrink-0">
            {enabledCount}/{group.tools.length}
          </span>
        </button>
        <Toggle
          size="sm"
          checked={!noneEnabled}
          onChange={(v) => onToggleGroup(group.tools, v)}
        />
      </div>

      {/* Tool list */}
      <div
        className={`transition-all duration-150 ${
          expanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        } overflow-hidden`}
      >
        <div className="divide-y divide-border">
          {group.tools.map((t) => {
            const enabled = !disabled.has(t.name)
            return (
              <div
                key={t.name}
                className={`flex items-center gap-3 px-4 py-2 ${
                  enabled ? '' : 'opacity-50'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] text-text font-mono">{t.name}</span>
                  {t.description && (
                    <p className="text-[11px] text-text-muted mt-0.5 line-clamp-1">
                      {t.description}
                    </p>
                  )}
                </div>
                <Toggle
                  size="sm"
                  checked={enabled}
                  onChange={() => onToggleTool(t.name)}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ==================== Page ====================

type Tab = 'settings' | 'tools'

const TABS: { key: Tab; labelKey: 'settings.tab.settings' | 'settings.tab.tools' }[] = [
  { key: 'settings', labelKey: 'settings.tab.settings' },
  { key: 'tools', labelKey: 'settings.tab.tools' },
]

export function SettingsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('settings')

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('settings.title')} />

      <div className="px-4 md:px-6 border-b border-border/60">
        <div className="flex gap-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`px-3 py-2 text-sm font-medium transition-colors relative ${
                tab === item.key ? 'text-accent' : 'text-text-muted hover:text-text'
              }`}
            >
              {t(item.labelKey)}
              {tab === item.key && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-t" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 px-4 md:px-8 py-6">
        <div className="flex-1 min-h-0">
          {tab === 'settings' ? <SettingsSection /> : <ToolsSection />}
        </div>
      </div>
    </div>
  )
}
