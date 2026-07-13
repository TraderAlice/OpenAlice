/**
 * Resolve the UTA carrier URL from process env.
 *
 * UTA is optional: Alice can boot without a live UTA process, but it still
 * needs a stable target URL so the proxy can recover automatically if UTA
 * starts later. Guardian injects OPENALICE_UTA_URL; bare Alice defaults to the
 * conventional local carrier port. OPENALICE_LITE_MODE=1 intentionally
 * disables the carrier path.
 */
export function resolveUTAUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env['OPENALICE_UTA_URL']?.trim()
  if (explicit) return explicit
  const port = env['OPENALICE_UTA_PORT']?.trim() || '47333'
  return `http://127.0.0.1:${port}`
}

export function isUTADisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return truthy(env['OPENALICE_LITE_MODE']) || truthy(env['OPENALICE_UTA_DISABLED'])
}

function truthy(raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false
  const normalized = raw.toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}
