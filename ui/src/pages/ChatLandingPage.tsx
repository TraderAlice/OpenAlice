import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Code2,
  Cpu,
  KeyRound,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Paperclip,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react'

import { useWorkspaces } from '../contexts/workspaces-context'
import { installHintFor } from '../components/workspace/agentInstall'
import {
  getAgentReadiness,
  listAgentCredentials,
  detectWorkspaceCredential,
  QuickChatError,
  type AgentCredentialReadiness,
  type SavedCredential,
} from '../components/workspace/api'
import { useWorkspace } from '../tabs/store'

/** Agent runtimes with no login of their own — they need an injected AI config
 *  to start (claude/codex carry their own CLI login). Mirrors the backend's
 *  LOGINLESS_AGENTS; only these surface the credential picker. */
const LOGINLESS_AGENTS = new Set(['opencode', 'pi'])

/** Today's chat workspace tag — mirrors backend `todayChatTag` / `defaultTagFor`
 *  (`chat-<month><day>`, en-US short month) so the composer can find the
 *  workspace a send will reuse and detect its current credential. */
function todayChatTag(): string {
  const now = new Date()
  const month = now.toLocaleString('en-US', { month: 'short' }).toLowerCase()
  return `chat-${month}${now.getDate()}`
}

/** Glyph per agent CLI, for the runtime picker (claude/codex/opencode/pi). */
const AGENT_ICONS: Record<string, LucideIcon> = {
  claude: Sparkles,
  codex: Cpu,
  opencode: Code2,
  pi: Bot,
}

/**
 * Quick-chat landing — the "type a message → you're in" front door for the
 * "Ask Alice" activity. A single composer: the user types a first message and
 * hits send; `quickChat` reuses-or-creates the chat workspace, spawns a fresh
 * session seeded with that message (the agent CLI opens already working on it),
 * and focuses into the session's terminal tab. No template/CLI pickers in the
 * way — the bottom row shows the workspace type (Chat) and a small runtime
 * picker for agent CLIs. Shell is not an agent runtime and is excluded here.
 */
export function ChatLandingPage({ spec }: { spec: { params: { targetWsId?: string } } }) {
  const { t } = useTranslation()
  const { quickChat, agents, workspaces, defaultAgent, setDefaultAgent } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)

  // Targeted launch: the chat sidebar's per-workspace "+" routes here with a
  // targetWsId — "Ask Alice, but spawn the session in THIS workspace" rather
  // than the default (today's chat workspace). Same composer; the send just
  // carries the target.
  const targetWsId = spec.params.targetWsId
  const targetWs = targetWsId ? workspaces.find((w) => w.id === targetWsId) : undefined

  // The selectable agent runtimes = the agent CLIs (the bare shell has no agent
  // loop, so it can't be seeded with a first message).
  const cliAgents = agents.filter((a) => a.kind !== 'utility')
  const targetCliAgents = targetWs
    ? cliAgents.filter((a) => targetWs.agents.includes(a.id))
    : cliAgents

  const [value, setValue] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const agentBoxRef = useRef<HTMLDivElement>(null)

  // Backend probes the host PATH and reports `installed` per agent. Treat a
  // missing value as installed (older backend / don't gate on a stale shape).
  const isInstalled = (a: { installed?: boolean }) => a.installed !== false
  const anyInstalled = targetCliAgents.some(isInstalled)
  // Whether the `/agents` fetch has actually landed. Before it does, `agents`
  // is `[]` and `anyInstalled` is falsely false — which would flash the
  // "nothing installed, go install something" nudge on every page load until
  // the request resolves. The backend registers claude/codex/opencode/pi/shell
  // unconditionally, so a loaded list always has ≥1 CLI agent; an empty
  // `targetCliAgents` means "still loading" (or the fetch failed) — in both cases we
  // must NOT assert that the host is missing its runtimes.
  const agentsKnown = targetCliAgents.length > 0

  // Prefer the user-level runtime default when it is valid for this target.
  // Without a saved default, require the user to pick an agent once; the pick is
  // persisted as the next default runtime.
  const defaultAgentUsable =
    defaultAgent !== null &&
    targetCliAgents.some((a) => a.id === defaultAgent) &&
    (!targetWs || targetWs.agents.includes(defaultAgent))
  const selectedAgentUsable =
    selectedAgent !== null && targetCliAgents.some((a) => a.id === selectedAgent)
  const effectiveAgent =
    (selectedAgentUsable ? selectedAgent : null) ?? (defaultAgentUsable ? defaultAgent : null)
  const selectedInfo = targetCliAgents.find((a) => a.id === effectiveAgent) ?? null
  const SelectedIcon = selectedInfo ? AGENT_ICONS[selectedInfo.id] : undefined
  // Surface install guidance when the chosen runtime isn't on PATH.
  const selectedMissing = selectedInfo != null && !isInstalled(selectedInfo)
  const installHint = selectedInfo ? installHintFor(selectedInfo.id) : undefined

  // ── Loginless-runtime credential picker (opencode/pi) ─────────────────────
  // opencode/pi have no login of their own, so a quick-chat send must seed them
  // with a vault credential. claude/codex skip all of this (own CLI login).
  const needsCred = effectiveAgent !== null && LOGINLESS_AGENTS.has(effectiveAgent)
  // The loginless-runtime credential set (null = not yet loaded). opencode and
  // pi are both provider-agnostic and share one compatibility set (any wire), so
  // a single preloaded list serves both — see the mount-time fetch below.
  const [creds, setCreds] = useState<SavedCredential[] | null>(null)
  // The cred the user explicitly picked (null = use the default below).
  const [pickedCred, setPickedCred] = useState<string | null>(null)
  // The cred today's chat workspace is already configured with, if it exists.
  const [detectedCred, setDetectedCred] = useState<string | null>(null)
  const [agentReadiness, setAgentReadiness] = useState<AgentCredentialReadiness | null>(null)
  const [credMenuOpen, setCredMenuOpen] = useState(false)
  const credBoxRef = useRef<HTMLDivElement>(null)

  // Today's chat workspace (the one a send reuses), if already created.
  const todaysChat = useMemo(
    () => workspaces.find((w) => w.template === 'chat' && w.tag === todayChatTag()) ?? null,
    [workspaces],
  )
  const credentialWorkspace = targetWs ?? todaysChat

  // Preload the loginless credential set ONCE on mount — NOT gated on the
  // selected agent. Previously this fired only after the agents list resolved
  // and the user landed on opencode/pi, so the dropdown's data was a second,
  // late-starting request that visibly lagged behind the agent button (a
  // request waterfall). Fetching at mount runs it in parallel with the agents
  // load, so the picker is ready the instant opencode/pi is chosen. opencode and
  // pi share the same compatibility (any configured wire), so one fetch covers
  // both; claude/codex never show the picker.
  useEffect(() => {
    let live = true
    listAgentCredentials('opencode')
      .then((list) => { if (live) setCreds(list) })
      .catch(() => { if (live) setCreds([]) })
    return () => { live = false }
  }, [])

  // Detect the target workspace's current cred/readiness for this runtime (for the default
  // selection + the overwrite notice). Only when the workspace already exists.
  useEffect(() => {
    if (!needsCred || effectiveAgent === null || credentialWorkspace === null || credentialWorkspace === undefined) {
      setDetectedCred(null)
      setAgentReadiness(null)
      return
    }
    let live = true
    detectWorkspaceCredential(credentialWorkspace.id, effectiveAgent)
      .then((r) => { if (live) setDetectedCred(r.slug) })
      .catch(() => { if (live) setDetectedCred(null) })
    getAgentReadiness(credentialWorkspace.id)
      .then((bundle) => { if (live) setAgentReadiness(bundle.agents[effectiveAgent] ?? null) })
      .catch(() => { if (live) setAgentReadiness(null) })
    return () => { live = false }
  }, [needsCred, effectiveAgent, credentialWorkspace])

  const workspaceCredReady =
    needsCred &&
    agentReadiness?.ready === true &&
    agentReadiness.requiresCredential === true &&
    agentReadiness.source === 'workspace-config'
  const noCreds = needsCred && !workspaceCredReady && creds !== null && creds.length === 0
  // Effective cred = explicit pick, else what the workspace already uses, else
  // the first compatible one. Mirrors the backend's resolution order.
  const effectiveCred =
    pickedCred ??
    (!workspaceCredReady && detectedCred && creds?.some((c) => c.slug === detectedCred) ? detectedCred : null) ??
    (!workspaceCredReady ? creds?.[0]?.slug : null) ??
    null
  const credInfo = creds?.find((c) => c.slug === effectiveCred) ?? null
  // Warn when sending will overwrite the workspace's existing cred with a
  // different one (only meaningful once today's workspace exists).
  const willOverwrite =
    needsCred && detectedCred !== null && effectiveCred !== null && effectiveCred !== detectedCred

  useEffect(() => {
    if (!credMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (credBoxRef.current && !credBoxRef.current.contains(e.target as Node)) {
        setCredMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [credMenuOpen])

  const goConfigureProvider = () => {
    openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })
  }

  const canSend = value.trim().length > 0 && !launching && !noCreds && effectiveAgent !== null

  // Close the agent menu on an outside click.
  useEffect(() => {
    if (!agentMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (agentBoxRef.current && !agentBoxRef.current.contains(e.target as Node)) {
        setAgentMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [agentMenuOpen])

  const submit = async () => {
    const prompt = value.trim()
    if (!prompt || launching) return
    if (effectiveAgent === null) {
      setAgentMenuOpen(true)
      return
    }
    // A loginless runtime with no configured provider can't launch — send the
    // user to set one up instead of spawning an agent that'll die immediately.
    if (noCreds) {
      goConfigureProvider()
      return
    }
    setError(null)
    setLaunching(true)
    try {
      // On success this focuses the new session's terminal tab; the landing tab
      // stays open in the background, so clear it for next time.
      await quickChat(
        prompt,
        effectiveAgent,
        needsCred ? (effectiveCred ?? undefined) : undefined,
        targetWsId,
      )
      setValue('')
    } catch (err) {
      // Backend says no compatible credential — bounce to the provider settings.
      if (err instanceof QuickChatError && err.code === 'no_ai_credential') {
        goConfigureProvider()
        return
      }
      console.error('chatLanding.quick_chat_failed', err)
      setError(t('chatLanding.error'))
    } finally {
      setLaunching(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits; Shift+Enter inserts a newline (standard chat-composer feel).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const useExample = (text: string) => {
    setValue(text)
    textareaRef.current?.focus()
  }

  return (
    <div className="relative h-full w-full overflow-auto bg-bg flex flex-col items-center justify-center px-4 py-6 md:px-6 md:py-10">
      {/* Ask-Alice backdrop — full-bleed, responsive-only layers (gradient wash
          + faint grid). The #302 mock's %-positioned circle / diagonal bars were
          dropped: they drift on portrait and read as pixel-placed art, not a
          responsive surface. pointer-events-none so it never intercepts clicks. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-overlay to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-overlay-strong to-transparent" />
        <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,var(--color-text)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-text)_1px,transparent_1px)] [background-size:96px_96px]" />
      </div>

      <div className="relative z-10 w-full max-w-2xl flex flex-col gap-4 md:gap-5">
        <div className="text-center space-y-1.5">
          {targetWs ? (
            <>
              <h1 className="text-xl md:text-2xl font-semibold text-text">
                {t('chatLanding.targetHeading')}
              </h1>
              <div className="flex items-center justify-center gap-2 pt-1">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 pl-2.5 pr-1.5 py-1 text-[12.5px] font-medium text-accent">
                  <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                  {targetWs.tag}
                  <button
                    type="button"
                    onClick={() => openOrFocus({ kind: 'chat-landing', params: {} })}
                    aria-label={t('chatLanding.clearTarget')}
                    title={t('chatLanding.clearTarget')}
                    className="ml-0.5 rounded-full p-0.5 text-accent/70 hover:text-accent hover:bg-accent/20 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-[19px] md:text-2xl font-semibold text-text leading-tight">{t('chatLanding.heading')}</h1>
              <p className="text-[13px] md:text-sm text-text-muted leading-relaxed">{t('chatLanding.subheading')}</p>
            </>
          )}
        </div>

        <div
          className={`rounded-xl md:rounded-2xl px-3 pt-3 pb-2 transition-colors ${
            targetWs
              ? 'bg-accent/[0.04] border border-accent/45 ring-1 ring-accent/15 focus-within:border-accent/70'
              : 'bg-bg-secondary/60 border border-border/60 focus-within:border-accent/50'
          }`}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('chatLanding.placeholder')}
            rows={3}
            autoFocus
            className="w-full bg-transparent resize-none outline-none text-text placeholder:text-text-muted/50 text-[15px] px-2 py-1.5 min-h-[92px] md:min-h-[72px] max-h-[40vh]"
          />
          <div className="flex flex-col gap-2 px-1 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {/* Workspace type (Chat). Static — quick-chat always targets the chat template. */}
              <span className="inline-flex min-h-8 items-center gap-1.5 text-[11px] text-text-muted bg-bg-tertiary px-2.5 py-1 rounded-md">
                <MessageSquare className="w-3 h-3" />
                {t('chatLanding.workspaceType')}
              </span>

              {/* Agent runtime picker — one of the installed CLIs. */}
              <div ref={agentBoxRef} className="relative">
                <button
                  type="button"
                  onClick={() => setAgentMenuOpen((o) => !o)}
                  disabled={targetCliAgents.length === 0}
                  aria-haspopup="menu"
                  aria-expanded={agentMenuOpen}
                  aria-label={t('chatLanding.selectAgent')}
                  className="inline-flex min-h-8 max-w-[190px] items-center gap-1.5 text-[11px] text-text-muted bg-bg-tertiary px-2.5 py-1 rounded-md transition-colors hover:text-text disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {SelectedIcon ? <SelectedIcon className="w-3 h-3" /> : null}
                  <span className="truncate">{selectedInfo?.displayName ?? t('chatLanding.selectAgent')}</span>
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </button>
                {agentMenuOpen && targetCliAgents.length > 0 && (
                  <div
                    role="menu"
                    className="absolute bottom-full left-0 mb-1 min-w-[170px] py-1 bg-bg-secondary border border-border/70 rounded-lg shadow-lg z-10"
                  >
                    {targetCliAgents.map((a) => {
                      const Icon = AGENT_ICONS[a.id]
                      const active = a.id === effectiveAgent
                      const missing = !isInstalled(a)
                      return (
                        <button
                          key={a.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSelectedAgent(a.id)
                            void setDefaultAgent(a.id)
                            setAgentMenuOpen(false)
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors hover:bg-bg-tertiary ${active ? 'text-accent' : missing ? 'text-text-muted/60' : 'text-text'}`}
                        >
                          {Icon ? <Icon className="w-3.5 h-3.5 shrink-0" /> : <span className="w-3.5 shrink-0" />}
                          <span className="flex-1">{a.displayName}</span>
                          {missing && (
                            <span className="text-[10px] text-text-muted/70 shrink-0">
                              {t('chatLanding.agentNotInstalled')}
                            </span>
                          )}
                          {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Credential picker — only for loginless runtimes (opencode/pi),
                  which can't start without an injected provider. When none is
                  configured, the pill becomes a shortcut to set one up. */}
              {needsCred && noCreds && (
                <button
                  type="button"
                  onClick={goConfigureProvider}
                  className="inline-flex min-h-8 items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-md transition-colors hover:bg-amber-500/20"
                >
                  <KeyRound className="w-3 h-3" />
                  {t('chatLanding.configureProvider')}
                </button>
              )}
              {needsCred && !noCreds && creds && creds.length > 0 && (
                <div ref={credBoxRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setCredMenuOpen((o) => !o)}
                    aria-haspopup="menu"
                    aria-expanded={credMenuOpen}
                    aria-label={t('chatLanding.selectCredential')}
                    className="inline-flex min-h-8 max-w-[190px] items-center gap-1.5 text-[11px] text-text-muted bg-bg-tertiary px-2.5 py-1 rounded-md transition-colors hover:text-text"
                  >
                    <KeyRound className="w-3 h-3" />
                    <span className="truncate">{credInfo?.label?.trim() || credInfo?.slug || t('chatLanding.selectCredential')}</span>
                    <ChevronDown className="w-3 h-3 opacity-60" />
                  </button>
                  {credMenuOpen && (
                    <div
                      role="menu"
                      className="absolute bottom-full left-0 mb-1 min-w-[180px] py-1 bg-bg-secondary border border-border/70 rounded-lg shadow-lg z-10"
                    >
                      {creds.map((cr) => {
                        const active = cr.slug === effectiveCred
                        return (
                          <button
                            key={cr.slug}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setPickedCred(cr.slug)
                              setCredMenuOpen(false)
                            }}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors hover:bg-bg-tertiary ${active ? 'text-accent' : 'text-text'}`}
                          >
                            <span className="flex-1 truncate">{cr.label?.trim() || cr.slug}</span>
                            <span className="text-[10px] text-text-muted/70 shrink-0">{cr.vendor}</span>
                            {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                disabled
                title={t('chatLanding.attachSoon')}
                aria-label={t('chatLanding.attach')}
                className="w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-text-muted/50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSend}
                title={t('chatLanding.send')}
                aria-label={t('chatLanding.send')}
                className="w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center bg-accent text-white transition-colors hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {error !== null && <div className="text-[12px] text-red px-1">{error}</div>}

        {/* Runtime guidance. A normal packaged build should expose managed Pi;
            no-runtime is now an abnormal setup/debug state, not a prompt to
            make a fresh user install a CLI. */}
        {agentsKnown && !anyInstalled ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px] space-y-1.5">
            <div className="font-medium text-text">{t('chatLanding.noAgentsTitle')}</div>
            <p className="text-text-muted">{t('chatLanding.noAgentsBody')}</p>
          </div>
        ) : selectedMissing && selectedInfo ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px] space-y-1.5">
            <p className="text-text-muted">
              {t('chatLanding.agentMissing', { name: selectedInfo.displayName })}
            </p>
            {installHint?.cmd && (
              <div className="flex items-center gap-2">
                <span className="text-text-muted/70">{t('chatLanding.installLabel')}</span>
                <code className="font-mono text-[11px] text-text bg-bg-tertiary rounded px-2 py-1 select-all">
                  {installHint.cmd}
                </code>
              </div>
            )}
            {installHint?.url && (
              <a
                href={installHint.url}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-accent hover:underline"
              >
                {t('chatLanding.installDocs')} ↗
              </a>
            )}
          </div>
        ) : null}

        {/* Loginless runtime has no provider configured — the conversion
            dead-end. Guide the user to set one up instead of a silent failure. */}
        {noCreds && selectedInfo && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px] space-y-1.5">
            <p className="text-text-muted">
              {t('chatLanding.noCredBody', { name: selectedInfo.displayName })}
            </p>
            <button
              type="button"
              onClick={goConfigureProvider}
              className="inline-flex items-center gap-1.5 text-accent hover:underline"
            >
              <KeyRound className="w-3 h-3" />
              {t('chatLanding.configureProvider')} ↗
            </button>
          </div>
        )}

        {/* The selected cred differs from the one today's workspace already uses
            — sending switches it. A notice, not a block (the user chose it). */}
        {willOverwrite && credInfo && (
          <div className="rounded-lg border border-border/60 bg-bg-secondary/60 px-3 py-2 text-[12px] text-text-muted">
            {t('chatLanding.credOverwrite', { from: detectedCred ?? '', to: credInfo.slug })}
          </div>
        )}

        <div className="scrollbar-hide -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-1 md:pb-0">
          <span className="shrink-0 text-[11px] text-text-muted/70">{t('chatLanding.examplesLabel')}</span>
          {[t('chatLanding.ex1'), t('chatLanding.ex2'), t('chatLanding.ex3')].map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => useExample(ex)}
              disabled={launching}
              className="shrink-0 min-h-8 text-[12px] text-text-muted bg-bg-secondary/60 border border-border/50 rounded-full px-3 py-1 transition-colors hover:border-accent/40 hover:text-text disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
