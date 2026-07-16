import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp,
  Check,
  ChevronDown,
  KeyRound,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Paperclip,
  X,
} from 'lucide-react'

import { useWorkspaces } from '../contexts/workspaces-context'
import { installHintFor } from '../components/workspace/agentInstall'
import {
  QuickChatError,
  type Workspace,
} from '../components/workspace/api'
import {
  AgentLaunchDetails,
  AgentLaunchSelectors,
  type AgentLaunchSelectorsHandle,
} from '../components/workspace/AgentLaunchControls'
import { workspaceDisplayTitle } from '../components/workspace/display'
import { useWorkspace } from '../tabs/store'
import {
  useAgentLaunchConfig,
  useAgentLaunchPreferences,
} from '../hooks/useAgentLaunchConfig'

export { resolveAgentRuntime as resolveChatAgent } from '../lib/agentRuntime'
export {
  formatContextWindow,
  resolveAgentCredential as resolveChatCredential,
  resolveAgentLaunchAiDetails as resolveQuickChatAiDetails,
  resolveAgentLaunchCredentialSlug as resolveQuickChatCredentialSlug,
} from '../hooks/useAgentLaunchConfig'

function workspaceActivityMs(workspace: Pick<Workspace, 'createdAt' | 'sessions'>): number {
  const sessionActivity = workspace.sessions
    .map((session) => Date.parse(session.lastActiveAt))
    .filter(Number.isFinite)
  if (sessionActivity.length > 0) return Math.max(...sessionActivity)
  const created = Date.parse(workspace.createdAt)
  return Number.isFinite(created) ? created : 0
}

/** Resolve the visible global-composer target. Explicit selection wins, then
 *  the persisted recent Chat workspace, then latest activity for upgrades. */
export function resolveChatWorkspaceTarget(
  workspaces: readonly Workspace[],
  explicitWorkspaceId: string | null,
  recentWorkspaceId: string | null,
): Workspace | null {
  const chats = workspaces.filter((workspace) => workspace.template === 'chat')
  const explicit = explicitWorkspaceId
    ? chats.find((workspace) => workspace.id === explicitWorkspaceId)
    : undefined
  if (explicit) return explicit
  const recent = recentWorkspaceId
    ? chats.find((workspace) => workspace.id === recentWorkspaceId)
    : undefined
  if (recent) return recent
  return [...chats].sort((a, b) => workspaceActivityMs(b) - workspaceActivityMs(a))[0] ?? null
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
  const { quickChat, agents, workspaces, defaultAgent, setDefaultAgent, openAgentConfig } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)

  // Targeted launch: the chat sidebar's Workspace row and per-workspace "+"
  // route here with a targetWsId — "Ask Alice, but spawn the session in THIS
  // workspace" rather than the recent Chat workspace. Same composer; the send
  // just carries the target.
  const targetWsId = spec.params.targetWsId
  const targetWs = targetWsId ? workspaces.find((w) => w.id === targetWsId) : undefined
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const launchPreferences = useAgentLaunchPreferences()
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const workspaceBoxRef = useRef<HTMLDivElement>(null)
  const activeWorkspaceOptionRef = useRef<HTMLButtonElement>(null)
  const selectedChatWorkspace = useMemo(
    () => resolveChatWorkspaceTarget(
      workspaces,
      targetWsId ?? selectedWorkspaceId,
      launchPreferences.recentChatWorkspaceId,
    ),
    [workspaces, targetWsId, selectedWorkspaceId, launchPreferences.recentChatWorkspaceId],
  )
  const workspaceTarget = targetWs ?? selectedChatWorkspace
  const chatWorkspaceOptions = useMemo(
    () => workspaces
      .filter((workspace) => workspace.template === 'chat')
      .sort((a, b) => workspaceActivityMs(b) - workspaceActivityMs(a)),
    [workspaces],
  )

  // The selectable agent runtimes = the agent CLIs (the bare shell has no agent
  // loop, so it can't be seeded with a first message).
  const cliAgents = agents.filter((a) => a.kind !== 'utility')
  const targetCliAgents = workspaceTarget
    ? cliAgents.filter((a) => workspaceTarget.agents.includes(a.id))
    : cliAgents

  const [value, setValue] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const launchSelectorsRef = useRef<AgentLaunchSelectorsHandle>(null)
  const credentialWorkspace = workspaceTarget
  const launchConfig = useAgentLaunchConfig({
    agents: targetCliAgents,
    defaultAgent,
    setDefaultAgent,
    preferences: launchPreferences,
    workspaceId: credentialWorkspace?.id ?? null,
    hasWorkspace: credentialWorkspace !== null && credentialWorkspace !== undefined,
  })
  const effectiveAgent = launchConfig.effectiveAgent
  const selectedInfo = launchConfig.selectedAgent
  const installHint = selectedInfo ? installHintFor(selectedInfo.id) : undefined

  const goConfigureProvider = () => {
    openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })
  }

  const adjustQuickChatAi = () => {
    if (
      credentialWorkspace &&
      (effectiveAgent === 'opencode' || effectiveAgent === 'pi')
    ) {
      openAgentConfig(credentialWorkspace.id, effectiveAgent, 'ai')
      return
    }
    goConfigureProvider()
  }

  // A missing runtime choice should open the picker, not leave a mysteriously
  // disabled send button. submit() already handles that branch.
  const canSend = value.trim().length > 0 && !launching && launchConfig.credentialSelectionReady
  const effectiveTargetWorkspaceId = targetWsId ?? workspaceTarget?.id

  useEffect(() => {
    if (!workspaceMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (workspaceBoxRef.current && !workspaceBoxRef.current.contains(e.target as Node)) {
        setWorkspaceMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [workspaceMenuOpen])

  // The picker opens upward from the composer. Keep the active option inside
  // its own scroll viewport so a long Workspace history cannot push recent or
  // currently selected targets beyond the top of the window.
  useEffect(() => {
    if (!workspaceMenuOpen) return
    const frame = requestAnimationFrame(() => {
      activeWorkspaceOptionRef.current?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [workspaceMenuOpen, workspaceTarget?.id])

  const submit = async () => {
    const prompt = value.trim()
    if (!prompt || launching) return
    if (!launchConfig.credentialSelectionReady) return
    if (effectiveAgent === null) {
      launchSelectorsRef.current?.openAgentMenu()
      return
    }
    setError(null)
    setLaunching(true)
    try {
      const runtimeRow = await launchConfig.checkSelectedRuntime()
      if (runtimeRow?.ready !== true) {
        if (runtimeRow?.repairTarget === 'ai-provider' || launchConfig.needsProviderSetup) {
          goConfigureProvider()
          return
        }
        setError(runtimeRow?.message ?? t('chatLanding.runtimeNotReady'))
        return
      }
      // A global OpenCode/Pi config is only a fallback when the user has not
      // selected a vault credential for this launch. The provider pill is an
      // explicit per-Workspace choice: always send it so the backend can write
      // the selected provider/model before spawning the runtime.
      // On success this focuses the new session's terminal tab; the landing tab
      // stays open in the background, so clear it for next time.
      const workspaceId = await quickChat(
        prompt,
        effectiveAgent,
        launchConfig.launchCredentialSlug,
        effectiveTargetWorkspaceId,
      )
      launchPreferences.adoptRecentChatWorkspace(workspaceId)
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
                    className="oa-icon-action ml-0.5 rounded-full p-0.5 text-accent/70 hover:text-accent hover:bg-accent/20 transition-colors"
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
          className={`rounded-xl px-3 pb-2 pt-3 shadow-[0_18px_50px_-40px_var(--color-text)] transition-[border-color,box-shadow] md:rounded-2xl ${
            targetWs
              ? 'bg-accent/[0.04] border border-accent/45 ring-1 ring-accent/15 focus-within:border-accent/70'
              : 'border border-border/80 bg-bg-secondary/70 focus-within:border-accent/60 focus-within:shadow-[0_20px_55px_-38px_var(--color-accent)]'
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
            className="w-full max-h-[40vh] min-h-[92px] resize-none bg-transparent px-2 py-1.5 text-[15px] text-text outline-none placeholder:text-text-muted/70 md:min-h-[72px]"
          />
          <div className="flex flex-col gap-2 px-1 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {/* Workspace target — recent by default, explicit when selected.
                  Visible but non-blocking: users can see where the new Session
                  will live without answering a chooser on every send. */}
              <div ref={workspaceBoxRef} className="relative">
                <button
                  type="button"
                  onClick={() => setWorkspaceMenuOpen((open) => !open)}
                  disabled={chatWorkspaceOptions.length === 0 || targetWs !== undefined}
                  aria-haspopup="menu"
                  aria-expanded={workspaceMenuOpen}
                  aria-label={t('chatLanding.selectWorkspace')}
                  className="oa-pressable inline-flex min-h-8 max-w-[220px] items-center gap-1.5 rounded-md bg-bg-tertiary px-2.5 py-1 text-[11px] text-text-muted hover:text-text disabled:cursor-default"
                >
                  <MessageSquare className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {workspaceTarget
                      ? workspaceDisplayTitle(workspaceTarget)
                      : t('chatLanding.newWorkspaceTarget')}
                  </span>
                  {chatWorkspaceOptions.length > 0 && targetWs === undefined && (
                    <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
                  )}
                </button>
                {workspaceMenuOpen && targetWs === undefined && chatWorkspaceOptions.length > 0 && (
                  <div
                    role="menu"
                    className="oa-popover-enter absolute bottom-full left-0 z-10 mb-1 max-h-[min(24rem,calc(100vh-8rem))] min-w-[220px] max-w-[320px] overflow-y-auto overscroll-contain rounded-lg border border-border/70 bg-bg-secondary py-1 shadow-lg [scrollbar-gutter:stable]"
                  >
                    {chatWorkspaceOptions.map((workspace) => {
                      const active = workspace.id === workspaceTarget?.id
                      return (
                        <button
                          key={workspace.id}
                          ref={active ? activeWorkspaceOptionRef : undefined}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSelectedWorkspaceId(workspace.id)
                            launchConfig.resetCredentialSelection()
                            setWorkspaceMenuOpen(false)
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-tertiary ${active ? 'text-accent' : 'text-text'}`}
                        >
                          <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{workspaceDisplayTitle(workspace)}</span>
                          {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <AgentLaunchSelectors
                ref={launchSelectorsRef}
                config={launchConfig}
                onConfigureProvider={goConfigureProvider}
              />
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
                className="oa-icon-action w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center bg-accent text-white transition-colors hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <AgentLaunchDetails
            config={launchConfig}
            hasWorkspaceTarget={credentialWorkspace !== null && credentialWorkspace !== undefined}
            onAdjustAi={adjustQuickChatAi}
            className="mx-1 mt-2 border-t border-border/50 px-1 pt-2"
          />
        </div>

        {error !== null && <div className="text-[12px] text-red px-1">{error}</div>}

        {/* Runtime guidance. A normal packaged build should expose managed Pi;
            no-runtime is now an abnormal setup/debug state, not a prompt to
            make a fresh user install a CLI. */}
        {launchConfig.agentsKnown && !launchConfig.anyInstalled ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px] space-y-1.5">
            <div className="font-medium text-text">{t('chatLanding.noAgentsTitle')}</div>
            <p className="text-text-muted">{t('chatLanding.noAgentsBody')}</p>
          </div>
        ) : launchConfig.selectedMissing && selectedInfo ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px] space-y-1.5">
            <p className="text-text-muted">
              {t('chatLanding.agentMissing', { name: selectedInfo.displayName })}
            </p>
            {installHint?.cmd && (
              <div className="flex items-center gap-2">
                <span className="text-text-muted">{t('chatLanding.installLabel')}</span>
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
        {launchConfig.noCredentials && selectedInfo && (
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
        {launchConfig.willOverwriteCredential && launchConfig.credential && (
          <div className="rounded-lg border border-border/60 bg-bg-secondary/60 px-3 py-2 text-[12px] text-text-muted">
            {t('chatLanding.credOverwrite', {
              from: launchConfig.detectedCredential?.slug ?? '',
              to: launchConfig.credential.slug,
            })}
          </div>
        )}

        <div className="relative -mx-4 md:mx-0">
          <div className="scrollbar-hide flex items-center gap-2 overflow-x-auto px-4 pb-1 pr-14 md:flex-wrap md:overflow-visible md:px-1 md:pr-1 md:pb-0">
            <span className="shrink-0 text-[11px] font-medium text-text-muted">{t('chatLanding.examplesLabel')}</span>
            {[t('chatLanding.ex1'), t('chatLanding.ex2'), t('chatLanding.ex3')].map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => useExample(ex)}
                disabled={launching}
                className="min-h-8 shrink-0 rounded-full border border-border/70 bg-bg-secondary/75 px-3 py-1 text-[12px] text-text-muted transition-colors hover:border-accent/50 hover:bg-bg-secondary hover:text-text disabled:opacity-40"
              >
                {ex}
              </button>
            ))}
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-bg via-bg/90 to-transparent md:hidden"
          />
        </div>
      </div>
    </div>
  )
}
