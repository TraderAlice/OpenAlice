/**
 * Shared installation policy. Providers own OS-specific discovery/commands;
 * entry points own consent UI. Neither a package postinstall nor a missing
 * executable grants permission to mutate the host.
 */
export async function coordinateDependencies({
  inspect,
  plan,
  confirm,
  execute,
  interactive = false,
  refresh = async () => {},
}) {
  const before = await inspect()
  const missing = before.filter(check => check.status !== 'available')
  if (!missing.length) return { status: 'ready', checks: before, actions: [] }

  // An executable that exists but fails its probe is not permission to replace
  // the user's installation. Keep its diagnostic and request manual repair.
  if (missing.some(check => check.status !== 'missing')) {
    return { status: 'repair-required', checks: before, actions: [] }
  }
  const actions = await plan(missing)
  if (!actions.length) return { status: 'manual-install', checks: before, actions }
  if (!interactive) return { status: 'needs-consent', checks: before, actions }
  if (!await confirm({ checks: missing, actions })) {
    return { status: 'declined', checks: before, actions }
  }
  for (const action of actions) {
    let result
    try {
      result = await execute(action)
    } catch (error) {
      return { status: 'install-failed', checks: before, actions, failedAction: action, error: String(error) }
    }
    if (result.code !== 0) {
      return { status: 'install-failed', checks: before, actions, failedAction: action, code: result.code }
    }
  }
  // Installers may change PATH or install into a known location. Never report
  // success merely because a package manager returned zero.
  await refresh()
  const after = await inspect()
  return {
    status: after.every(check => check.status === 'available') ? 'ready' : 'verification-failed',
    checks: after,
    actions,
  }
}
