import { useEffect, useRef } from 'react'
import { useProjectWorkspaceSetup } from '../hooks/useProjectWorkspaceSetup'
import { useWorkspaces } from '../contexts/workspaces-context'

/** Silent Quick Start readiness observer; failure guidance lives in Settings. */
export function ProjectWorkspaceSetupNotice({ onPrepared }: { onPrepared: () => void }) {
  const { setup } = useProjectWorkspaceSetup()
  const { refresh, refreshAutoQuantPreference, refreshAutoPredictionPreference } = useWorkspaces()
  const notified = useRef(false)
  const sawSetupInProgress = useRef(setup?.phase !== 'complete')
  useEffect(() => {
    if (setup?.phase !== 'complete') { sawSetupInProgress.current = true; return }
    if (!sawSetupInProgress.current) return
    if (setup?.phase !== 'complete' || setup.pending.length || notified.current) return
    notified.current = true
    void refresh()
    void refreshAutoQuantPreference()
    void refreshAutoPredictionPreference?.()
    onPrepared()
  }, [onPrepared, refresh, refreshAutoQuantPreference, refreshAutoPredictionPreference, setup?.phase, setup?.pending.length])
  return null
}
