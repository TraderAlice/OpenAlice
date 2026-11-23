import { useEffect, useId, useState } from 'react'
import { ChevronDown, ChevronRight, Monitor, RefreshCw, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { getBackendConnection } from '../../auth/backendConnection'
import { useAliceProject } from '../../hooks/useAliceProject'
import { useRelayConnection } from '../../hooks/useRelayConnection'
import { useUpdateLifecycle } from '../../hooks/useUpdateLifecycle'
import { Button } from '../ui/button'
import { DataHomeSection, WorkspaceShellSection } from './LocalEnvironmentSections'

/** The relay owns Machine identity; the backend owns AliceProject identity. */
export function AliceLocationSection() {
  const { t } = useTranslation()
  const headingId = useId()
  const detailsId = useId()
  const connection = getBackendConnection()
  const { project, loading, error, refresh } = useAliceProject()
  const sharedMachines = useUpdateLifecycle({ optional: true })?.machines
  const localRelay = useRelayConnection()
  const relay = sharedMachines ?? localRelay
  const [showDetails, setShowDetails] = useState(false)
  const [returningIntegrated, setReturningIntegrated] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const desktopConnection = window.openAlice?.desktopConnection

  useEffect(() => {
    if (!sharedMachines && (desktopConnection || localRelay.status)) {
      void localRelay.refresh()
    }
  }, [sharedMachines, desktopConnection, localRelay.status?.target?.machine, localRelay.status?.target?.project, localRelay.refresh])

  const canChoose = Boolean(relay.status || desktopConnection || connection.kind === 'electron')
  const remote = relay.status?.target?.machine !== undefined && relay.status.target.machine !== 'local'
  const electron = connection.kind === 'electron'
  const relayMachine = relay.status?.target?.machine
  const machine = relay.status?.target?.machineName
    ?? (relayMachine && relayMachine !== 'local' ? relayMachine : undefined)
    ?? t('settings.backendConnection.thisMachine')
  const projectName = project?.displayName
    ?? (loading ? t('settings.backendConnection.checking') : t('settings.backendConnection.projectUnavailable'))
  const status = loading
    ? t('settings.backendConnection.checking')
    : project && !error
      ? t('settings.backendConnection.connected')
      : t('settings.backendConnection.unavailable')
  const mode = electron
    ? t('settings.backendConnection.integrated')
    : remote
      ? t('settings.backendConnection.remoteMode')
      : t('settings.backendConnection.separated')
  const transport = electron
    ? 'Electron IPC'
    : relay.status
      ? desktopConnection ? 'Electron relay' : 'Local CLI relay'
      : 'Loopback HTTP'
  const clientEndpoint = electron
    ? 'app://openalice'
    : relay.status
      ? window.location.host
      : connection.endpoint

  const startupTarget = relay.startup?.target
  const startupMachine = startupTarget
    ? relay.fleet.find((item) => item.key === startupTarget.machine)
    : undefined
  const matchesActiveStartupMachine = Boolean(startupTarget && startupTarget.machine === relay.status?.target?.machine)
  const matchesActiveStartupProject = Boolean(
    matchesActiveStartupMachine
    && startupTarget
    && startupTarget.project === (project?.key ?? relay.status?.target?.project),
  )
  const startupMachineName = startupTarget
    ? startupMachine?.displayName
      ?? (matchesActiveStartupMachine ? relay.status?.target?.machineName : undefined)
      ?? (startupTarget.machine === 'local' ? t('settings.backendConnection.thisMachine') : startupTarget.machine)
    : null
  const startupProjectName = startupTarget
    ? startupMachine?.projects.find((item) => item.key === startupTarget.project)?.displayName
      ?? (matchesActiveStartupProject ? (project?.displayName ?? relay.status?.target?.projectName) : undefined)
      ?? startupTarget.project
    : null
  const showActions = (desktopConnection && !electron) || (!loading && !project)

  return (
    <section aria-labelledby={headingId} className="@container rounded-xl border border-border/70 bg-card p-4 sm:p-5">
      <div className="mb-3 min-w-0">
        <h2 id={headingId} className="text-[14px] font-semibold text-foreground">
          {t('settings.backendConnection.title')}
        </h2>
      </div>

      <div className="flex min-w-0 flex-col gap-3 border-y border-border/60 py-3 @[32rem]:flex-row @[32rem]:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {remote
            ? <Server className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            : <Monitor className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px] font-semibold text-foreground">
              <span className="min-w-0 truncate" title={machine}>{machine}</span>
              <span className="text-muted-foreground" aria-hidden>/</span>
              <span className="min-w-0 truncate" title={projectName}>{projectName}</span>
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground" role="status">
              <span className={`size-2 shrink-0 rounded-full ${project && !error && !loading ? 'bg-success' : 'bg-muted-foreground/60'}`} aria-hidden />
              {status} · {mode}
            </p>
          </div>
        </div>
        {showActions && (
          <div className="flex flex-wrap items-center gap-2">
            {desktopConnection && !electron && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10 @[32rem]:min-h-8"
                disabled={returningIntegrated}
                onClick={() => {
                  setReturningIntegrated(true)
                  setSwitchError(null)
                  void desktopConnection.returnIntegrated().catch((cause: unknown) => {
                    setSwitchError(cause instanceof Error ? cause.message : String(cause))
                    setReturningIntegrated(false)
                  })
                }}
              >
                <Monitor className="size-3.5" aria-hidden />
                {returningIntegrated ? t('settings.backendConnection.checking') : t('settings.backendConnection.returnIntegrated')}
              </Button>
            )}
            {!loading && !project && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10 @[32rem]:min-h-8"
                onClick={() => void refresh()}
              >
                <RefreshCw className="size-3.5" aria-hidden />
                {t('settings.backendConnection.retry')}
              </Button>
            )}
          </div>
        )}
      </div>

      {canChoose && (
        <div className="flex min-w-0 flex-col gap-1 border-b border-border/60 py-2.5 text-[12px]">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="shrink-0 font-medium text-foreground">
              {t('settings.backendConnection.startupDefault')}:
            </span>
            <span className="min-w-0 truncate text-muted-foreground">
              {!relay.startup
                ? t('settings.backendConnection.checking')
                : startupTarget
                  ? `${startupMachineName} / ${startupProjectName}`
                  : t('settings.backendConnection.noStartupDefault', 'Choose a location on the next launch')}
            </span>
          </div>
          {relay.startup?.error && (
            <p role="alert" className="text-[12px] text-destructive">{relay.startup.error}</p>
          )}
        </div>
      )}

      {switchError && <p role="alert" className="py-2 text-[12px] text-destructive">{switchError}</p>}

      <button
        type="button"
        className="flex min-h-10 w-full items-center gap-2 pt-3 text-left text-[12px] text-muted-foreground hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]"
        onClick={() => setShowDetails((value) => !value)}
        aria-expanded={showDetails}
        aria-controls={detailsId}
      >
        {showDetails
          ? <ChevronDown className="size-4 shrink-0" aria-hidden />
          : <ChevronRight className="size-4 shrink-0" aria-hidden />}
        {t('settings.machines.environmentDetails')}
      </button>

      {showDetails && (
        <div id={detailsId} className="mt-3 min-w-0 space-y-4 border-t border-border/60 pt-4">
          <dl className="grid min-w-0 gap-x-6 gap-y-3 text-[12px] @[30rem]:grid-cols-2">
            <Detail label={t('settings.backendConnection.machine')} value={machine} />
            <Detail label="AliceProject" value={projectName} />
            {project && <Detail label={t('settings.backendConnection.projectKey')} value={project.key} mono />}
            {project && <Detail label={t('settings.backendConnection.projectId')} value={project.id} mono />}
            {project && <Detail label={t('settings.about.aliceProject.dataHome')} value={project.home} mono />}
            {project && (
              <Detail
                label={t('settings.about.aliceProject.appRoot')}
                value={project.appRoot ?? t('settings.about.aliceProject.runtimeManaged')}
                mono
              />
            )}
            <Detail label={t('settings.backendConnection.transport')} value={transport} />
            <Detail label={t('settings.backendConnection.clientEndpoint')} value={clientEndpoint} mono />
          </dl>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {remote
              ? t(desktopConnection ? 'settings.backendConnection.electronRemoteNote' : 'settings.backendConnection.remoteNote')
              : electron
                ? t('settings.backendConnection.electronNote')
                : t('settings.backendConnection.localNote')}
          </p>
          <DataHomeSection embedded />
          <WorkspaceShellSection embedded />
        </div>
      )}
    </section>
  )
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 break-all text-foreground ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</dd>
    </div>
  )
}
