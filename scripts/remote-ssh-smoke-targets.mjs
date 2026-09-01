function runtimeRow(snapshot, agent) {
  const row = snapshot?.agents?.[agent]
  if (!row || typeof row !== 'object') {
    throw new Error(`Remote Runtime readiness did not include ${agent}: ${JSON.stringify(snapshot)}`)
  }
  return row
}

function catalogRow(catalog, agent) {
  const row = catalog?.agents?.find?.((candidate) => candidate?.id === agent)
  if (!row || typeof row !== 'object') {
    throw new Error(`Remote Agent catalog did not include ${agent}: ${JSON.stringify(catalog)}`)
  }
  return row
}

export function requireMissingAgentRuntime({ readiness, catalog }, agent) {
  const readinessRow = runtimeRow(readiness, agent)
  const detected = catalogRow(catalog, agent)
  if (
    readinessRow.installed !== false
    || readinessRow.status !== 'not_installed'
    || readinessRow.ready !== false
    || detected.installed !== false
  ) {
    throw new Error(`Remote ${agent} Runtime was not reported missing: ${JSON.stringify({ readinessRow, detected })}`)
  }
  return { readinessRow, detected }
}

export function requireDiscoveredAgentRuntime({ readiness, catalog }, agent, expectedPath) {
  const readinessRow = runtimeRow(readiness, agent)
  const detected = catalogRow(catalog, agent)
  if (
    readinessRow.installed !== true
    || readinessRow.status !== 'unknown'
    || readinessRow.ready !== false
    || readinessRow.checkedAt !== null
    || detected.installed !== true
    || detected.binPath !== expectedPath
    || typeof detected.fingerprint !== 'string'
    || detected.fingerprint.length === 0
    || readinessRow.fingerprint !== detected.fingerprint
  ) {
    throw new Error(`Remote ${agent} Runtime discovery did not retire its cached missing state: ${JSON.stringify({ readinessRow, detected })}`)
  }
  return { readinessRow, detected }
}

export function requireBrokerAccountNeedsInstall(payload, expected) {
  const account = payload?.accounts?.find?.((candidate) => candidate?.accountId === expected.accountId)
  if (!account || typeof account !== 'object') {
    throw new Error(`Broker Pack readiness did not include account ${expected.accountId}: ${JSON.stringify(payload)}`)
  }
  if (
    account.presetId !== expected.presetId
    || account.engine !== expected.engine
    || account.configuredEnabled !== true
    || account.state !== 'needs-install'
    || account.operational !== false
    || account.action !== 'install'
  ) {
    throw new Error(`Broker account ${expected.accountId} did not fail closed on its missing Pack: ${JSON.stringify(account)}`)
  }

  const pack = payload?.packs?.find?.((candidate) => candidate?.engine === expected.engine)
  if (
    !pack
    || typeof pack !== 'object'
    || pack.installed !== false
    || pack.source !== 'missing'
    || !Array.isArray(pack.requiredBy)
    || !pack.requiredBy.includes(account.label)
  ) {
    throw new Error(`Missing ${expected.engine} Pack did not name its dependent account: ${JSON.stringify(pack)}`)
  }
  return { account, pack }
}
