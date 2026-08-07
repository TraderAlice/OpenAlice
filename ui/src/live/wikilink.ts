import { useCallback } from 'react'

import { useWorkspace } from '../tabs/store'
import { useTrackedSelection } from './tracked-selection'

/**
 * Default behaviour for clicking an Obsidian-style `[[name]]` link rendered
 * by MarkdownContent: jump to the Tracked activity and select that entity.
 *
 * `[[name]]` references an *entity* (an asset/topic registered via the
 * `entity_upsert` tool), not a file — so the natural destination is the
 * Tracked detail pane, where the entity's description + every note that
 * backlinks it live. Entity keys are case-insensitive (see entity-store),
 * so the renderer lowercases the link text into `data-entity`; we select
 * by that key.
 */
export function useWikilinkHandler(): (entityKey: string) => void {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  const select = useTrackedSelection((s) => s.select)
  return useCallback(
    (entityKey: string) => {
      select(entityKey)
      setSidebar('tracked')
      openOrFocus({ kind: 'tracked', params: { entity: entityKey } })
    },
    [openOrFocus, setSidebar, select],
  )
}
