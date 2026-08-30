import { useId, useMemo, useState } from 'react'
import { ChevronDown, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TELEGRAM_DESK_CADENCES } from '../api/connectors'
import { ConfirmDialog } from './ConfirmDialog'
import { Field, inputClass } from './form'
import { MarkdownWhatEditor } from './MarkdownWhatEditor'
import { useAgentLaunchPreferences } from '../hooks/useAgentLaunchConfig'
import { useTelegramConnectorDesk } from '../hooks/useTelegramConnectorDesk'
import { resolveChatWorkspaceTarget } from '../lib/chat-workspace-target'
import { useWorkspaces } from '../contexts/workspaces-context'
import { workspaceDisplayName } from './workspace/display'
import { useWorkspace } from '../tabs/store'
import { Toggle } from './Toggle'

export function TelegramDeskPanel({
  connectorId = 'telegram',
  label,
  linked,
  online,
}: {
  connectorId?: string
  label?: string
  linked: boolean
  online: boolean
}) {
  const { t } = useTranslation()
  const { workspaces } = useWorkspaces()
  const { recentChatWorkspaceId, loaded: launchPreferencesLoaded } = useAgentLaunchPreferences()
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const { desk, loading, error, enable, disable, saveWhat, saveCadence } = useTelegramConnectorDesk(connectorId)
  const deskName = label ?? connectorId
  const [wsId, setWsId] = useState('')
  const [working, setWorking] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const workspaceSelectId = useId()
  const cadenceSelectId = useId()

  const preferredWsId = useMemo(
    () => launchPreferencesLoaded
      ? resolveChatWorkspaceTarget(workspaces, null, recentChatWorkspaceId)?.id ?? ''
      : '',
    [launchPreferencesLoaded, workspaces, recentChatWorkspaceId],
  )
  const choices = useMemo(
    () => [...workspaces].sort((left, right) => {
      if (left.id === preferredWsId) return -1
      if (right.id === preferredWsId) return 1
      return workspaceDisplayName(left).localeCompare(workspaceDisplayName(right))
    }),
    [workspaces, preferredWsId],
  )
  const selectedWsId = wsId || preferredWsId || (launchPreferencesLoaded ? choices[0]?.id || '' : '')
  const boundWorkspace = desk ? workspaces.find((workspace) => workspace.id === desk.wsId) : undefined
  const currentEvery = desk?.issue.when?.kind === 'every' ? desk.issue.when.every : null
  const cadenceOptions = useMemo(() => {
    const values = [...TELEGRAM_DESK_CADENCES]
    if (currentEvery && !values.includes(currentEvery as typeof TELEGRAM_DESK_CADENCES[number])) {
      values.push(currentEvery as typeof TELEGRAM_DESK_CADENCES[number])
    }
    return values
  }, [currentEvery])

  return (
    <section className="rounded-xl border border-border/70 bg-secondary/10 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <MessageSquare size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <h3 className="text-[13px] font-semibold text-foreground">{t('connectorSettings.desk.title', { name: deskName })}</h3>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              {t('connectorSettings.desk.description', { name: deskName })}
            </p>
          </div>
        </div>
        {linked ? (
          <div className="flex min-h-10 items-center gap-2">
            <span className="text-[12px] font-medium text-foreground">
              {desk
                ? t(online ? 'connectorSettings.desk.on' : 'connectorSettings.desk.waiting')
                : t('connectorSettings.desk.off')}
            </span>
            <Toggle
              size="sm"
              checked={Boolean(desk)}
              disabled={loading || working || (!desk && (!selectedWsId || !launchPreferencesLoaded))}
              ariaLabel={t('connectorSettings.desk.toggleAria', { name: deskName })}
              onChange={(checked) => {
                if (!checked) {
                  setConfirmDisable(true)
                  return
                }
                setWorking(true)
                void enable(selectedWsId).finally(() => setWorking(false))
              }}
            />
          </div>
        ) : (
          <span className="rounded-full border border-border bg-background/45 px-2.5 py-1 text-[10.5px] font-medium text-muted-foreground">
            {t('connectorSettings.desk.afterLink')}
          </span>
        )}
      </div>

      {loading ? (
        <p className="mt-3 text-[12px] text-muted-foreground">{t('connectorSettings.desk.loading')}</p>
      ) : !linked ? (
        <p className="mt-3 border-t border-border/60 pt-3 text-[11.5px] leading-5 text-muted-foreground">
          {t('connectorSettings.desk.needLink')}
        </p>
      ) : desk ? (
        <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
            {t(online
              ? 'connectorSettings.desk.boundWorkspace'
              : 'connectorSettings.desk.waitingForConnector', {
              workspace: boundWorkspace ? workspaceDisplayName(boundWorkspace) : desk.wsId,
              name: deskName,
            })}
          </p>
          <button
            type="button"
            className="oa-pressable flex min-h-11 w-full items-center justify-between rounded-lg border border-border/60 bg-background/30 px-3 py-2.5 text-left text-[12px] font-medium text-foreground hover:bg-secondary/35"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            {t('connectorSettings.desk.advanced')}
            <ChevronDown size={14} className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {advancedOpen && (
            <div className="oa-disclosure-enter space-y-4">
              <Field
                label={t('connectorSettings.desk.cadence')}
                controlId={cadenceSelectId}
                description={t('connectorSettings.desk.cadenceDescription')}
              >
                <select
                  id={cadenceSelectId}
                  className={inputClass}
                  value={currentEvery ?? ''}
                  disabled={working}
                  onChange={(event) => {
                    const next = event.target.value
                    if (!next) return
                    void saveCadence(next)
                  }}
                >
                  {!currentEvery && <option value="">{t('connectorSettings.desk.cadenceCustom')}</option>}
                  {cadenceOptions.map((every) => (
                    <option key={every} value={every}>
                      {t('connectorSettings.desk.cadenceEvery', { every })}
                    </option>
                  ))}
                </select>
              </Field>
              <div>
                <h4 className="text-[12px] font-medium text-foreground">{t('connectorSettings.desk.what')}</h4>
                <p className="mb-2 mt-1 text-[11.5px] leading-5 text-muted-foreground">
                  {t('connectorSettings.desk.whatDescription')}
                </p>
                <MarkdownWhatEditor
                  value={desk.issue.what}
                  onSave={saveWhat}
                  ariaLabel={t('connectorSettings.desk.what')}
                  placeholder={t('connectorSettings.desk.whatPlaceholder')}
                />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="oa-pressable inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 py-2 text-[12px] text-foreground hover:border-primary/50"
              onClick={() => openOrFocus({
                kind: 'issue-detail',
                params: { wsId: desk.wsId, id: desk.issue.id },
              })}
            >
              <MessageSquare size={14} aria-hidden />
              {t('connectorSettings.desk.open')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
          {choices.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">{t('connectorSettings.desk.noWorkspaces')}</p>
          ) : (
            <Field
              label={t('connectorSettings.desk.workspace')}
              controlId={workspaceSelectId}
              description={t('connectorSettings.desk.workspaceDescription')}
            >
              <select
                id={workspaceSelectId}
                className={inputClass}
                value={selectedWsId}
                  disabled={working || !launchPreferencesLoaded}
                onChange={(event) => setWsId(event.target.value)}
              >
                {choices.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspaceDisplayName(workspace)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="text-[11.5px] leading-5 text-muted-foreground">
            {t(online
              ? 'connectorSettings.desk.turnOnHint'
              : 'connectorSettings.desk.turnOnWhileOfflineHint', { name: deskName })}
          </p>
        </div>
      )}

      {error && (
        <p className="mt-3 text-[12px] text-destructive" role="alert">
          {t('connectorSettings.desk.actionError', { error })}
        </p>
      )}

      {confirmDisable && (
        <ConfirmDialog
          title={t('connectorSettings.desk.disableTitle', { name: deskName })}
          message={t('connectorSettings.desk.disableMessage', { name: deskName })}
          confirmLabel={t('connectorSettings.desk.disable')}
          workingLabel={t('connectorSettings.desk.disabling')}
          onConfirm={async () => {
            setWorking(true)
            await disable()
            setWorking(false)
            setConfirmDisable(false)
          }}
          onClose={() => setConfirmDisable(false)}
        />
      )}
    </section>
  )
}
