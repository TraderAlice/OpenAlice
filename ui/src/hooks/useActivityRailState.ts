import { useActivityBarCollapse } from '../live/activity-bar-collapse'

/** The rail owns Harness sessions. Entering a Harness must not hide its list. */
export function useActivityRailState(compactByDefault: boolean) {
  const preference = useActivityBarCollapse((state) => state.railCollapsed)
  const setPreference = useActivityBarCollapse((state) => state.setRailCollapsed)
  const collapsed = preference ?? compactByDefault
  const toggle = () => setPreference(!collapsed)
  return { collapsed, toggle }
}
