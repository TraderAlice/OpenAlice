import { useState, useEffect, useCallback, useMemo } from 'react'
import { api, type AppConfig } from '../api'
import type { ToolInfo } from '../api/tools'
import { Toggle } from '../components/Toggle'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, inputClass } from '../components/form'
import { useAutoSave } from '../hooks/useAutoSave'
import { PageHeader } from '../components/PageHeader'
import { PageLoading, EmptyState } from '../components/StateViews'

// ==================== Settings Section ====================

function SettingsSection() {
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    api.config.load().then(setConfig).catch(() => {})
  }, [])

  if (!config) return <PageLoading />

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[880px] mx-auto">
        {/* Agent */}
        <ConfigSection title="Agent" description="Controls file-system and tool permissions for the AI. Changes apply on the next request.">
          <div className="flex items-center justify-between gap-4 py-1">
            <div className="flex-1">
              <span className="text-sm font-medium text-text">
                Evolution Mode
              </span>
              <p className="text-[12px] text-text-muted mt-0.5 leading-relaxed">
                {config.agent?.evolutionMode
                  ? 'Full project access — AI can modify source code'
                  : 'Sandbox mode — AI can only edit data/brain/'}
              </p>
            </div>
            <Toggle
              checked={config.agent?.evolutionMode || false}
              onChange={async (v) => {
                try {
                  await api.config.updateSection('agent', { ...config.agent, evolutionMode: v })
                  setConfig((c) => c ? { ...c, agent: { ...c.agent, evolutionMode: v } } : c)
                } catch {
                  // Toggle doesn't flip on failure
                }
              }}
            />
          </div>
        </ConfigSection>

        {/* Persona */}
        <ConfigSection title="Persona" description="The system prompt that defines Alice's personality and behavior. Changes take effect on next server restart.">
          <PersonaEditor />
        </ConfigSection>

        {/* Compaction */}
        <ConfigSection title="Compaction" description="Context window management. When conversation size approaches Max Context minus Max Output tokens, older messages are automatically summarized to free up space.">
          <CompactionForm config={config} />
        </ConfigSection>
      </div>
    </div>
  )
}

// ==================== Compaction Form ====================

function CompactionForm({ config }: { config: AppConfig }) {
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
      <Field label="Max Context Tokens">
        <input className={inputClass} type="number" step={1000} value={ctx} onChange={(e) => setCtx(e.target.value)} />
      </Field>
      <Field label="Max Output Tokens">
        <input className={inputClass} type="number" step={1000} value={out} onChange={(e) => setOut(e.target.value)} />
      </Field>
      <SaveIndicator status={status} onRetry={retry} />
    </>
  )
}

// ==================== Persona Editor ====================

function PersonaEditor() {
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
      .catch(() => setError('Failed to load persona'))
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
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-sm text-text-muted">Loading...</div>

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
          {saving ? 'Saving...' : 'Save'}
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-green" />
            <span className="text-text-muted">Saved</span>
          </span>
        )}
        {error && (
          <span className="inline-flex items-center gap-1.5 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-red" />
            <span className="text-red">{error}</span>
          </span>
        )}
        {dirty && !saved && !error && (
          <span className="text-[11px] text-text-muted">Unsaved changes</span>
        )}
      </div>
      {filePath && <p className="text-[11px] text-text-muted mt-1">{filePath}</p>}
    </>
  )
}

// ==================== Tools Section ====================

const GROUP_LABELS: Record<string, string> = {
  thinking: 'Thinking Kit',
  brain: 'Brain',
  browser: 'Browser',
  cron: 'Cron Scheduler',
  equity: 'Equity Data',
  'crypto-data': 'Crypto Data',
  'currency-data': 'Currency Data',
  news: 'News',
  'news-archive': 'News Archive',
  analysis: 'Analysis Kit',
  'crypto-trading': 'Crypto Trading',
  'securities-trading': 'Securities Trading',
}

interface ToolGroup {
  key: string
  label: string
  tools: ToolInfo[]
}

function ToolsSection() {
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
    for (const t of inventory) {
      if (!map.has(t.group)) map.set(t.group, [])
      map.get(t.group)!.push(t)
    }
    return Array.from(map.entries()).map(([key, tools]) => ({
      key,
      label: GROUP_LABELS[key] ?? key,
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
        <EmptyState title="No tools registered." description="Tools will appear here when the engine starts." />
      ) : (
        <div className="max-w-[880px] mx-auto">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] text-text-muted">
              {inventory.length} tools in {groups.length} groups — changes apply on next AI request
            </p>
            <SaveIndicator status={status} onRetry={retry} />
          </div>
          <div className="space-y-2">
            {groups.map((g) => (
              <ToolGroupCard
                key={g.key}
                group={g}
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
  disabled: Set<string>
  expanded: boolean
  onToggleExpanded: () => void
  onToggleTool: (name: string) => void
  onToggleGroup: (tools: ToolInfo[], enable: boolean) => void
}

function ToolGroupCard({
  group,
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
          <span className="text-sm font-medium text-text truncate">{group.label}</span>
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

const TABS: { key: Tab; label: string }[] = [
  { key: 'settings', label: 'Settings' },
  { key: 'tools', label: 'Tools' },
]

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('settings')

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="Settings" />

      <div className="px-4 md:px-6 border-b border-border/60">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm font-medium transition-colors relative ${
                tab === t.key ? 'text-accent' : 'text-text-muted hover:text-text'
              }`}
            >
              {t.label}
              {tab === t.key && (
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
