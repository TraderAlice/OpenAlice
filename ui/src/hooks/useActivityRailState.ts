import { useEffect, useState } from 'react'
import { useActivityBarCollapse } from '../live/activity-bar-collapse'

/** The rail owns Harness sessions. Entering a Harness must not hide its list. */
export function useActivityRailState(compactByDefault: boolean, temporaryCollapse = false) {
  const preference = useActivityBarCollapse((state) => state.railCollapsed)
  const setPreference = useActivityBarCollapse((state) => state.setRailCollapsed)
  const [temporarilyExpanded, setTemporarilyExpanded] = useState(false)
  useEffect(() => setTemporarilyExpanded(false), [temporaryCollapse])
  const collapsed = temporaryCollapse ? !temporarilyExpanded : preference ?? compactByDefault
  const toggle = () => {
    if (temporaryCollapse) setTemporarilyExpanded((expanded) => !expanded)
    else setPreference(!collapsed)
  }
  return { collapsed, toggle }
}
