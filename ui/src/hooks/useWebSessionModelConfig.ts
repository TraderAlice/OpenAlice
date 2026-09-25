import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentInfo, PausedSessionRuntimeUpdate, SessionRecord } from '../components/workspace/api'
import { pinnedLaunchFromBinding, usePinnedRuntimeDraft } from './usePinnedRuntimeDraft'

/** The same provider/model/effort draft as Start, pinned to this Session's runtime. */
export function useWebSessionModelConfig({ workspaceId, record, agents, busy, reconfigure }: {
  workspaceId: string; record: SessionRecord; agents: readonly AgentInfo[]; busy: boolean;
  reconfigure(update: PausedSessionRuntimeUpdate): Promise<void>;
}) {
  const persisted = useMemo(() => pinnedLaunchFromBinding(record.agent, record.runtime), [record.agent, record.runtime])
  const persistedKey = JSON.stringify(persisted)
  const [initial, setInitial] = useState(persisted)
  useEffect(() => { setInitial(persisted) }, [persistedKey]) // serialized backend binding
  const editor = usePinnedRuntimeDraft({ workspaceId, agent: record.agent, agents, initial })
  const [error, setError] = useState<string | null>(null)
  const attempted = useRef<string | null>(null)
  const inFlight = useRef(false)
  useEffect(() => {
    const key = JSON.stringify(editor.draft)
    if (!editor.dirty || busy || inFlight.current || attempted.current === key || !editor.config.credentialSelectionReady) return
    attempted.current = key
    inFlight.current = true
    setError(null)
    void reconfigure(editor.toRuntimeUpdate()).then(() => {
      attempted.current = null
      setInitial(editor.draft)
    }).catch(cause => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { inFlight.current = false })
  }, [editor, busy, reconfigure])
  return { config: editor.config, dirty: editor.dirty, error: editor.dirty ? error : null,
    retry: () => { attempted.current = null; setError(null) },
  }
}
