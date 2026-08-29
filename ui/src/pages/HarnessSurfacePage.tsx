import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, ExternalLink, Loader2, RefreshCw, RotateCcw, ScrollText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  getHarnessSurface,
  harnessSurfaceUrl,
  restartHarnessSurface,
  startHarnessSurface,
  type HarnessSurfaceResponse,
} from '../api/harness-surfaces'
import { Button } from '../components/ui/button'
import { harnessSurfaceFailureKind } from '../lib/harness-surface-failure'
import { useWorkspace } from '../tabs/store'
import type { WorkspaceSource } from '../tabs/types'

const HARNESS_SETUP_PROMPT = `Set up this Harness Workspace so its Studio capability can run.

Inspect harness.json, the repository documentation, lockfiles, and package scripts before changing anything. Install the required dependencies with the repository's declared package manager and normal locked-install workflow. Do not guess a global tool or replace the lockfile. Then run the smallest relevant Studio/readiness smoke, stop any processes you started, and report exactly what you installed and verified. Do not change product code unless setup genuinely requires a repository fix.`

export function HarnessSurfacePage({
  workspaceId,
  source,
}: {
  workspaceId: string
  source: Exclude<WorkspaceSource, 'chat'>
}) {
  const { t } = useTranslation()
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const [response, setResponse] = useState<HarnessSurfaceResponse | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [frameGeneration, setFrameGeneration] = useState(0)
  const [showLogs, setShowLogs] = useState(false)
  const surfaceUrl = useMemo(() => response ? harnessSurfaceUrl(response) : null, [response])

  const load = useCallback(async () => {
    try {
      const current = await getHarnessSurface(workspaceId)
      if (current.surface.phase === 'stopped') {
        setResponse(await startHarnessSurface(workspaceId))
      } else {
        setResponse(current)
      }
      setRequestError(null)
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : String(err))
    }
  }, [workspaceId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!response || (response.surface.phase !== 'starting' && response.surface.phase !== 'stopping')) return
    const timer = window.setInterval(() => void load(), 500)
    return () => window.clearInterval(timer)
  }, [load, response])
  useEffect(() => {
    if (response?.surface.phase !== 'ready') return
    const timer = window.setInterval(() => void load(), 3_000)
    return () => window.clearInterval(timer)
  }, [load, response?.surface.phase])

  const restart = async () => {
    setRequestError(null)
    try {
      setResponse(await restartHarnessSurface(workspaceId))
      setFrameGeneration((value) => value + 1)
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : String(err))
    }
  }

  const phase = response?.surface.phase
  const error = requestError ?? response?.surface.error ?? null
  const logs = response?.surface.logs ?? ''
  const failureKind = harnessSurfaceFailureKind(logs)

  const openSetupQuickStart = () => {
    openOrFocus({
      kind: source === 'auto-quant' ? 'auto-quant-landing' : 'auto-prediction-landing',
      params: { targetWsId: workspaceId, initialPrompt: HARNESS_SETUP_PROMPT },
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{t('harnessSurface.studio')}</p>
          <p className="truncate text-xs text-muted-foreground" aria-live="polite">
            {t(`harnessSurface.phase.${phase ?? 'starting'}`)}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setFrameGeneration((value) => value + 1)} disabled={!surfaceUrl}>
          <RefreshCw aria-hidden />{t('harnessSurface.refresh')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void restart()}>
          <RotateCcw aria-hidden />{t('harnessSurface.restart')}
        </Button>
        {!error && (
          <Button variant="ghost" size="sm" onClick={() => setShowLogs((value) => !value)} aria-expanded={showLogs}>
            <ScrollText aria-hidden />{t('harnessSurface.logs')}
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={!surfaceUrl} onClick={() => surfaceUrl && window.open(surfaceUrl, '_blank', 'noopener,noreferrer')}>
          <ExternalLink aria-hidden />{t('harnessSurface.openSeparate')}
        </Button>
      </div>

      {showLogs && !error && (
        <pre className="max-h-48 shrink-0 overflow-auto border-b border-border bg-muted/40 p-3 text-xs text-muted-foreground" aria-label={t('harnessSurface.logs')}>
          {response?.surface.logs || t('harnessSurface.noLogs')}
        </pre>
      )}

      <div className="relative min-h-0 flex-1">
        {surfaceUrl && phase === 'ready' ? (
          <iframe
            key={`${response?.surface.generation ?? 0}-${frameGeneration}`}
            src={surfaceUrl}
            title={t('harnessSurface.studio')}
            className="h-full w-full border-0 bg-background"
            allow="clipboard-read; clipboard-write"
          />
        ) : (
          <div className="flex h-full items-center justify-center overflow-auto p-4 sm:p-6">
            <div className="w-full max-w-2xl text-center">
              {phase !== 'failed' && !error && <Loader2 className="mx-auto mb-3 size-6 animate-spin text-primary motion-reduce:animate-none" aria-hidden />}
              <h2 className="text-base font-semibold text-foreground">
                {error ? t('harnessSurface.failedTitle') : t('harnessSurface.startingTitle')}
              </h2>
              {error ? (
                <div className="mt-3 text-left">
                  <p className="text-sm text-muted-foreground">
                    {t(`harnessSurface.diagnosis.${failureKind}`)}
                  </p>
                  <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
                    <p className="break-words font-mono text-xs text-foreground">{error}</p>
                    <details className="mt-2" open>
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                        {t('harnessSurface.studioOutput')}
                      </summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 text-xs text-muted-foreground">
                        {logs || t('harnessSurface.noLogs')}
                      </pre>
                    </details>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t('harnessSurface.setupBody')}
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button onClick={openSetupQuickStart}>
                      <Bot aria-hidden />
                      {t('harnessSurface.setupWithAgent')}
                    </Button>
                    <Button variant="outline" onClick={() => void restart()}>
                      <RotateCcw aria-hidden />{t('harnessSurface.tryAgain')}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('harnessSurface.startingBody')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
