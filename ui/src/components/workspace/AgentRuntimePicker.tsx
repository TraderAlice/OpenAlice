import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Copy, ExternalLink, LayoutGrid, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { inputClass } from '@/components/form'
import { SelectionCheckIcon } from '@/components/ui/selection-check-icon'
import { AgentRuntimeIcon } from '../../lib/agentRuntimeIcon'
import { agentRuntimePickerStatusKey } from '../../lib/agentRuntimeReadiness'
import { installHintFor } from './agentInstall'
import type { AgentInfo, AgentRuntimeReadinessSnapshot } from './api'

export interface AgentRuntimePickerHandle {
  open(): void
}

export interface AgentRuntimePickerProps {
  readonly agents: readonly AgentInfo[]
  readonly primary: readonly AgentInfo[]
  readonly selectedId: string | null
  readonly readiness: AgentRuntimeReadinessSnapshot | null
  readonly disabled?: boolean
  readonly toolbar?: boolean
  readonly menuPlacement?: 'up' | 'down'
  readonly onSelect: (agentId: string) => void
}

function matchesQuery(agent: AgentInfo, query: string): boolean {
  if (!query) return true
  const haystack = `${agent.displayName} ${agent.id}`.toLowerCase()
  return haystack.includes(query)
}

function AgentRuntimeRow({
  agent,
  selected,
  readiness,
  onSelect,
}: {
  agent: AgentInfo
  selected: boolean
  readiness: AgentRuntimeReadinessSnapshot | null
  onSelect(): void
}) {
  const { t } = useTranslation()
  const statusKey = agentRuntimePickerStatusKey(readiness?.agents[agent.id])
  const status = statusKey ? t(statusKey) : undefined

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-h-11 w-full min-w-0 items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm leading-5 transition-colors hover:bg-muted ${
        selected ? 'bg-muted/50 text-foreground' : 'text-foreground'
      }`}
    >
      <AgentRuntimeIcon agentId={agent.id} className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium">{agent.displayName}</span>
          {status && (
            <span className="max-w-[7.5rem] shrink-0 truncate text-sm font-normal text-muted-foreground" title={status}>
              {status}
            </span>
          )}
        </span>
      </span>
      <span className="mt-0.5 size-4 shrink-0">{selected && <SelectionCheckIcon />}</span>
    </button>
  )
}

function UninstalledRuntimeGuidance({ agent }: { agent: AgentInfo }) {
  const { t } = useTranslation()
  const hint = installHintFor(agent.id)

  const copyCommand = async () => {
    if (!hint?.cmd || !navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(hint.cmd)
    } catch {
      // Guidance remains visible even when the clipboard is unavailable.
    }
  }

  return (
    <div className="flex w-full min-w-0 items-start gap-2 rounded-md px-2.5 py-2 text-sm leading-5 text-muted-foreground">
      <AgentRuntimeIcon agentId={agent.id} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium">{agent.displayName}</span>
          <span className="shrink-0 text-sm font-normal">
            {t('chatLanding.agentNotInstalled')}
          </span>
        </div>
        {hint?.cmd && (
          <p className="mt-0.5 truncate font-mono text-sm leading-5" title={hint.cmd}>{hint.cmd}</p>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {hint?.cmd && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void copyCommand()}
              aria-label={t('chatLanding.copyInstallCommand', { name: agent.displayName })}
            >
              <Copy />
              {t('chatLanding.copyInstallCommand', { name: agent.displayName })}
            </Button>
          )}
          {hint?.url && (
            <a
              href={hint.url}
              target="_blank"
              rel="noreferrer"
              aria-label={t('chatLanding.openInstallDocs', { name: agent.displayName })}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-foreground hover:bg-muted"
            >
              <ExternalLink className="size-3" />
              {t('chatLanding.installDocs')}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

export const AgentRuntimePicker = forwardRef<AgentRuntimePickerHandle, AgentRuntimePickerProps>(
  function AgentRuntimePicker(
    {
      agents,
      primary,
      selectedId,
      readiness,
      disabled = false,
      toolbar = false,
      menuPlacement = 'up',
      onSelect,
    },
    ref,
  ) {
    const { t } = useTranslation()
    const triggerRef = useRef<HTMLButtonElement>(null)
    const [menuOpen, setMenuOpen] = useState(false)
    const [othersOpen, setOthersOpen] = useState(false)
    const [query, setQuery] = useState('')
    const selected = agents.find((agent) => agent.id === selectedId)
      ?? (selectedId
        ? {
            id: selectedId,
            displayName: selectedId,
            kind: 'agent' as const,
            installed: false,
            capabilities: {
              parallelPerCwd: false,
              resumeLast: false,
              resumeById: false,
              transcriptDiscovery: 'none' as const,
            },
          }
        : null)
    const selectedOutsidePrimary = selected !== null
      && !primary.some((agent) => agent.id === selected.id)
    const normalizedQuery = query.trim().toLowerCase()
    const installed = useMemo(
      () => agents.filter((agent) => agent.installed !== false && matchesQuery(agent, normalizedQuery)),
      [agents, normalizedQuery],
    )
    const notInstalled = useMemo(
      () => agents.filter((agent) => agent.installed === false && matchesQuery(agent, normalizedQuery)),
      [agents, normalizedQuery],
    )

    useImperativeHandle(ref, () => ({
      open() {
        setMenuOpen(true)
      },
    }), [])

    const choose = (agentId: string) => {
      onSelect(agentId)
      setMenuOpen(false)
      setOthersOpen(false)
      setQuery('')
    }

    return (
      <>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            ref={triggerRef}
            disabled={disabled || agents.length === 0}
            render={<button
              type="button"
              aria-label={t('chatLanding.selectAgent')}
              onClick={() => {
                if (!menuOpen) setMenuOpen(true)
              }}
              className={`oa-pressable inline-flex min-h-9 min-w-0 max-w-[190px] items-center gap-2 rounded-full py-1.5 text-sm leading-5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${toolbar ? 'bg-transparent px-3' : 'bg-secondary px-3'}`}
            />}
          >
            <AgentRuntimeIcon agentId={selected?.id} className="size-4 shrink-0" />
            <span className="truncate">{selected?.displayName ?? t('chatLanding.selectAgent')}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={menuPlacement === 'down' ? 'bottom' : 'top'}
            sideOffset={6}
            className="min-w-[min(16rem,calc(100vw-2rem))]"
          >
            <DropdownMenuRadioGroup value={selectedId}>
            {primary.map((agent) => {
              const active = agent.id === selectedId
              const missing = agent.installed === false
              return (
                <DropdownMenuRadioItem
                  key={agent.id}
                  value={agent.id}
                  closeOnClick
                  disabled={missing}
                  onClick={() => {
                    if (missing) return
                    choose(agent.id)
                  }}
                  className={`${active ? 'bg-muted text-foreground' : missing ? 'text-muted-foreground' : 'text-foreground'}`}
                >
                  <AgentRuntimeIcon agentId={agent.id} className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">{agent.displayName}</span>
                  {missing && (
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {t('chatLanding.agentNotInstalled')}
                    </span>
                  )}
                </DropdownMenuRadioItem>
              )
            })}
            {selectedOutsidePrimary && selected && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel inset>
                    {t('chatLanding.currentRuntime')}
                  </DropdownMenuLabel>
                  <DropdownMenuRadioItem
                    value={selected.id}
                    closeOnClick
                    disabled={selected.installed === false}
                    onClick={() => {
                      if (selected.installed === false) return
                      choose(selected.id)
                    }}
                    className={`${
                      selected.installed === false ? 'text-muted-foreground' : 'bg-muted text-foreground'
                    }`}
                  >
                    <AgentRuntimeIcon agentId={selectedOutsidePrimary ? selected?.id : null} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">{selected.displayName}</span>
                    {selected.installed === false && (
                      <span className="shrink-0 text-sm text-muted-foreground">
                        {t('chatLanding.agentNotInstalled')}
                      </span>
                    )}
                  </DropdownMenuRadioItem>
                </DropdownMenuGroup>
              </>
            )}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setOthersOpen(true)}
            >
              <LayoutGrid className="size-4" aria-hidden />
              {t('chatLanding.otherRuntimes')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog
          open={othersOpen}
          onOpenChange={(open) => {
            setOthersOpen(open)
            if (!open) setQuery('')
          }}
        >
          <DialogContent finalFocus={triggerRef} className="flex max-h-[min(40rem,calc(100dvh-2rem))] w-full max-w-[calc(100%-2rem)] flex-col gap-3 overflow-hidden sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('chatLanding.allRuntimesTitle')}</DialogTitle>
              <DialogDescription>{t('chatLanding.allRuntimesDescription')}</DialogDescription>
            </DialogHeader>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('chatLanding.searchRuntimes')}
                aria-label={t('chatLanding.searchRuntimes')}
                className={`${inputClass} pl-8`}
              />
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
              {installed.length === 0 && notInstalled.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                  {t('chatLanding.noRuntimeMatches', { query })}
                </p>
              ) : (
                <div className="flex flex-col gap-4 pb-1">
                  {installed.length > 0 && (
                    <section>
                      <h3 className="px-2.5 pb-1 text-sm leading-5 font-medium text-muted-foreground">
                        {t('chatLanding.installedRuntimes')}
                      </h3>
                      <div className="flex flex-col">
                        {installed.map((agent) => (
                          <AgentRuntimeRow
                            key={agent.id}
                            agent={agent}
                            selected={agent.id === selectedId}
                            readiness={readiness}
                            onSelect={() => choose(agent.id)}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                  {notInstalled.length > 0 && (
                    <section>
                      <h3 className="px-2.5 pb-1 text-sm leading-5 font-medium text-muted-foreground">
                        {t('chatLanding.notInstalledRuntimes')}
                      </h3>
                      <div className="flex flex-col">
                        {notInstalled.map((agent) => (
                          <UninstalledRuntimeGuidance key={agent.id} agent={agent} />
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setOthersOpen(false)}>
                {t('common.close')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    )
  },
)
