/**
 * Stable clock anchor for identity-bearing Demo fixtures.
 *
 * The Demo bundle is recreated on every full-page reload. Using Date.now()
 * directly in an Inbox or Scheduled-Issue fingerprint therefore makes the
 * same recorded fixture look like new product evidence after each reload.
 * Office Day already rolls at the local calendar boundary, so one anchor per
 * local day keeps the recording truthful without carrying it into tomorrow.
 */
export function demoLocalDayAnchor(now = Date.now()): number {
  const anchor = new Date(now)
  anchor.setHours(0, 0, 0, 0)
  return anchor.getTime()
}
