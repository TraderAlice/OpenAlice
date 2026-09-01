import { useCallback } from 'react'

import { useWorkspace } from '../tabs/store'

/** Return from an Inbox duty to Office without owning excursion persistence. */
export function useOfficeInboxDutyReturn(): () => void {
  const setSidebar = useWorkspace((state) => state.setSidebar)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)

  return useCallback(() => {
    // The URL synchronizer replaces the current route after the Office tab is
    // focused. Do not infer that browser history still points at Office: a
    // reload may rebuild React Router's history index while keeping the same
    // session checkpoint, making navigate(-1) leave the field trip entirely.
    setSidebar('office')
    openOrFocus({ kind: 'office', params: {} })
  }, [openOrFocus, setSidebar])
}
