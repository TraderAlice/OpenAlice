import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Check,
  Copy,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react'

import {
  getWorkspaceLaunchPlan,
  type WorkspaceLaunchEnvironmentEntry,
  type WorkspaceLaunchPlan,
} from './api'

interface Props {
  readonly wsId: string
  readonly agents: readonly string[]
  readonly workspaceDefaultAgent?: string | null
  readonly installationDefaultAgent: string | null
  readonly initialAgent?: string
  readonly onSaveDefaultAgent: (agent: string | null) => Promise<void>
}

const RUNTIME_LABELS: Readonly<Record<string, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
  pi: 'Pi',
  shell: 'Shell',
}

function sameCommand(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index])
}

function environmentValue(
  entry: WorkspaceLaunchEnvironmentEntry,
  labels: {
    readonly redacted: string
    readonly configured: string
    readonly pathCount: (count: number) => string
  },
): string {
  if (entry.presentation === 'redacted') return labels.redacted
  if (entry.presentation === 'configured') return labels.configured
  if (entry.presentation === 'path-count') {
    return labels.pathCount(entry.count ?? 0)
  }
  return entry.value ?? ''
}

function CommandTokens({ command }: { readonly command: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="launch-command">
      {command.map((token, index) => (
        <code
          key={`${index}:${token}`}
          className="max-w-full break-all rounded border border-border/70 bg-background/70 px-1.5 py-1 text-[11px] leading-tight text-foreground"
        >
          {token}
        </code>
      ))}
    </div>
  )
}

export function WorkspaceLaunchConfigurationPanel({
  wsId,
  agents,
  workspaceDefaultAgent,
  installationDefaultAgent,
  initialAgent,
  onSaveDefaultAgent,
}: Props) {
  const { t } = useTranslation()
  const agentIds = useMemo(() => [...new Set(agents.filter((id) => id !== 'shell'))], [agents])
  const runtimeIds = useMemo(() => [...new Set([...agents, 'shell'])], [agents])
  const inheritedDefault = installationDefaultAgent && agentIds.includes(installationDefaultAgent)
    ? installationDefaultAgent
    : agentIds[0] ?? ''
  const storedDefault = workspaceDefaultAgent && agentIds.includes(workspaceDefaultAgent)
    ? workspaceDefaultAgent
    : ''
  const preferred = storedDefault || inheritedDefault || (
    initialAgent && runtimeIds.includes(initialAgent) ? initialAgent : runtimeIds[0] ?? ''
  )
  const [selectedAgent, setSelectedAgent] = useState(preferred)
  const [defaultAgentDraft, setDefaultAgentDraft] = useState(storedDefault)
  const [defaultSaving, setDefaultSaving] = useState(false)
  const [defaultSaved, setDefaultSaved] = useState(false)
  const [defaultError, setDefaultError] = useState<string | null>(null)
  const [plan, setPlan] = useState<WorkspaceLaunchPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setDefaultAgentDraft(storedDefault)
  }, [storedDefault, wsId])

  useEffect(() => {
    if (runtimeIds.includes(selectedAgent)) return
    setSelectedAgent(preferred)
  }, [preferred, runtimeIds, selectedAgent])

  useEffect(() => {
    if (!selectedAgent) {
      setPlan(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setCopied(false)
    void getWorkspaceLaunchPlan(wsId, selectedAgent)
      .then((next) => {
        if (!cancelled) setPlan(next)
      })
      .catch((cause: Error) => {
        if (!cancelled) {
          setPlan(null)
          setError(cause.message)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshToken, selectedAgent, wsId])

  const copyCommand = async () => {
    if (!plan) return
    await navigator.clipboard.writeText(JSON.stringify(plan.launch.resolvedCommand))
    setCopied(true)
  }

  const saveDefaultAgent = async () => {
    setDefaultSaving(true)
    setDefaultError(null)
    try {
      await onSaveDefaultAgent(defaultAgentDraft || null)
      setDefaultSaved(true)
      window.setTimeout(() => setDefaultSaved(false), 1800)
    } catch (cause) {
      setDefaultError((cause as Error).message)
    } finally {
      setDefaultSaving(false)
    }
  }

  const resolvedDiffers = plan
    ? !sameCommand(plan.launch.composedCommand, plan.launch.resolvedCommand)
    : false
  const capabilities = plan?.agent.capabilities
  const environmentLabels = {
    redacted: t('workspaceSettings.launch.redacted'),
    configured: t('workspaceSettings.launch.configured'),
    pathCount: (count: number) => t('workspaceSettings.launch.pathCount', { count }),
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <section>
            <h3 className="text-sm font-semibold text-foreground">
              {t('workspaceSettings.launch.title')}
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t('workspaceSettings.launch.description')}
            </p>
            <div className="mt-3 rounded-lg border border-border bg-secondary/30 p-3">
              <label className="block text-xs font-medium text-foreground" htmlFor="workspace-default-agent">
                {t('workspaceSettings.launch.defaultRuntime')}
              </label>
              <select
                id="workspace-default-agent"
                value={defaultAgentDraft}
                onChange={(event) => {
                  const next = event.target.value
                  setDefaultAgentDraft(next)
                  setDefaultSaved(false)
                  if (next) setSelectedAgent(next)
                }}
                className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:border-primary focus:outline-none"
              >
                <option value="">
                  {t('workspaceSettings.launch.inheritRuntime', {
                    runtime: inheritedDefault ? (RUNTIME_LABELS[inheritedDefault] ?? inheritedDefault) : t('workspaceSettings.launch.automaticRuntime'),
                  })}
                </option>
                {agentIds.map((id) => (
                  <option key={id} value={id}>{RUNTIME_LABELS[id] ?? id}</option>
                ))}
              </select>
              <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
                {t('workspaceSettings.launch.defaultRuntimeHelp')}
              </p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="min-h-5 text-[11px]">
                  {defaultSaved && <span className="text-success">{t('workspaceSettings.launch.defaultSaved')}</span>}
                  {defaultError && <span className="text-destructive">{defaultError}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => void saveDefaultAgent()}
                  disabled={defaultSaving || defaultAgentDraft === storedDefault}
                  className="rounded-md bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {defaultSaving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
          </section>

          <section className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">
              {t('workspaceSettings.launch.previewTitle')}
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t('workspaceSettings.launch.previewDescription')}
            </p>
            <div className="mt-3 flex gap-1 overflow-x-auto rounded-lg border border-border bg-secondary/40 p-1.5">
              {runtimeIds.map((id) => (
                <button
                  type="button"
                  key={id}
                  onClick={() => setSelectedAgent(id)}
                  className={`oa-pressable shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium ${
                    selectedAgent === id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {RUNTIME_LABELS[id] ?? id}
                </button>
              ))}
            </div>
          </section>

          {loading && (
            <div className="oa-status-surface rounded-lg border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
              {t('workspaceSettings.launch.loading')}
            </div>
          )}

          {error && !loading && (
            <div className="oa-status-surface rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-[12px] text-destructive">
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium">{t('workspaceSettings.launch.loadError')}</div>
                  <div className="mt-1 break-words font-mono text-[11px]">{error}</div>
                </div>
              </div>
            </div>
          )}

          {plan && !loading && (
            <>
              <div className="oa-status-surface rounded-lg border border-border bg-secondary/30 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <TerminalSquare size={17} className="mt-0.5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{plan.agent.displayName}</div>
                      <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                        {plan.agent.binPath ?? plan.launch.composedCommand[0]}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-border bg-background/60 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                      {t(`workspaceSettings.launch.mode.${plan.launch.mode}`)}
                    </span>
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${
                      plan.agent.installed
                        ? 'border-success/30 bg-success/10 text-success'
                        : 'border-warning/30 bg-warning/10 text-warning'
                    }`}>
                      {plan.agent.installed
                        ? t('workspaceSettings.launch.runtimeReady')
                        : t('workspaceSettings.launch.runtimeMissing')}
                    </span>
                  </div>
                </div>
              </div>

              {!plan.agent.installed && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-[11px] leading-relaxed text-warning">
                  {t('workspaceSettings.launch.runtimeMissingHelp')}
                </div>
              )}

              <section className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-[12px] font-medium text-foreground">
                      {t('workspaceSettings.launch.command')}
                    </h4>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {t('workspaceSettings.launch.commandHelp')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyCommand()}
                    className="oa-icon-action shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={t('workspaceSettings.launch.copyCommand')}
                    title={t('workspaceSettings.launch.copyCommand')}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
                <CommandTokens command={plan.launch.composedCommand} />
                {resolvedDiffers && (
                  <div className="oa-disclosure-enter mt-3 border-t border-border/70 pt-3">
                    <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t('workspaceSettings.launch.resolvedCommand')}
                    </div>
                    <CommandTokens command={plan.launch.resolvedCommand} />
                  </div>
                )}
              </section>

              <section className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('workspaceSettings.launch.cwd')}
                  </div>
                  <div className="mt-1 break-all font-mono text-[11px] text-foreground">
                    {plan.launch.cwd}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('workspaceSettings.launch.transcript')}
                  </div>
                  <div className="mt-1 break-all font-mono text-[11px] text-foreground">
                    {plan.launch.transcriptDir ?? t('workspaceSettings.launch.noTranscript')}
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-border p-3">
                <h4 className="text-[12px] font-medium text-foreground">
                  {t('workspaceSettings.launch.environment')}
                </h4>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {t('workspaceSettings.launch.environmentHelp')}
                </p>
                <div className="mt-3 divide-y divide-border/60">
                  {plan.launch.environment.map((entry) => (
                    <div key={`${entry.source}:${entry.key}`} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="break-all font-mono text-[11px] text-foreground">{entry.key}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {t(`workspaceSettings.launch.source.${entry.source}`)}
                        </div>
                      </div>
                      <div className="max-w-[55%] break-all text-right font-mono text-[10px] text-muted-foreground">
                        {environmentValue(entry, environmentLabels)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {capabilities && (
                <section className="rounded-lg border border-border p-3">
                  <div className="flex items-start gap-2">
                    <ShieldCheck size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <h4 className="text-[12px] font-medium text-foreground">
                        {t('workspaceSettings.launch.capabilities')}
                      </h4>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {capabilities.parallelPerCwd && <Capability label={t('workspaceSettings.launch.parallel')} />}
                        {capabilities.resumeById && <Capability label={t('workspaceSettings.launch.resumeById')} />}
                        {capabilities.resumeLast && <Capability label={t('workspaceSettings.launch.resumeLast')} />}
                        {capabilities.headless && <Capability label={t('workspaceSettings.launch.headless')} />}
                        <Capability label={t(`workspaceSettings.launch.transcriptMode.${capabilities.transcriptDiscovery}`)} />
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border bg-secondary/30 p-3">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {t('workspaceSettings.launch.previewReadOnly')}
        </p>
        <button
          type="button"
          onClick={() => setRefreshToken((value) => value + 1)}
          disabled={loading}
          className="oa-pressable flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {t('common.retry')}
        </button>
      </div>
    </div>
  )
}

function Capability({ label }: { readonly label: string }) {
  return (
    <span className="rounded-full border border-border bg-secondary/50 px-2 py-1 text-[10px] text-muted-foreground">
      {label}
    </span>
  )
}
