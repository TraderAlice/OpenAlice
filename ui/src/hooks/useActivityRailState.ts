import { useEffect, useState } from 'react'
import { useActivityBarCollapse } from '../live/activity-bar-collapse'

/** Workbench expansion is temporary. Never overwrite the user's saved global
 * preference just because a feature needs extra canvas space. */
export function useActivityRailState(workbench: boolean, compactByDefault: boolean) {
  const preference = useActivityBarCollapse((state) => state.railCollapsed)
  const setPreference = useActivityBarCollapse((state) => state.setRailCollapsed)
  const [workbenchExpanded, setWorkbenchExpanded] = useState(false)
  useEffect(() => {
    if (!workbench) setWorkbenchExpanded(false)
  }, [workbench])
  const collapsed = workbench ? !workbenchExpanded : preference ?? compactByDefault
  const toggle = () => {
    if (workbench) setWorkbenchExpanded(!workbenchExpanded)
    else setPreference(!collapsed)
  }
  return { collapsed, toggle }
}
