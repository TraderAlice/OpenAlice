import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, Loader2, RefreshCw, RotateCcw, ScrollText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  getHarnessSurface,
  harnessSurfaceUrl,
  restartHarnessSurface,
  startHarnessSurface,
  type HarnessSurfaceResponse,
} from '../api/harness-surfaces'
import { Button } from '../components/ui/button'

export function HarnessSurfacePage({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
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
        <Button variant="ghost" size="sm" onClick={() => setShowLogs((value) => !value)} aria-expanded={showLogs}>
          <ScrollText aria-hidden />{t('harnessSurface.logs')}
        </Button>
        <Button variant="outline" size="sm" disabled={!surfaceUrl} onClick={() => surfaceUrl && window.open(surfaceUrl, '_blank', 'noopener,noreferrer')}>
          <ExternalLink aria-hidden />{t('harnessSurface.openSeparate')}
        </Button>
      </div>

      {showLogs && (
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
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-md text-center">
              {phase !== 'failed' && !error && <Loader2 className="mx-auto mb-3 size-6 animate-spin text-primary motion-reduce:animate-none" aria-hidden />}
              <h2 className="text-base font-semibold text-foreground">
                {error ? t('harnessSurface.failedTitle') : t('harnessSurface.startingTitle')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {error ?? t('harnessSurface.startingBody')}
              </p>
              {error && (
                <Button className="mt-4" onClick={() => void restart()}>
                  <RotateCcw aria-hidden />{t('harnessSurface.tryAgain')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
