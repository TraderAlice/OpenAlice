import { readFileSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { inspectRuntime } from './lifecycle.mjs'
import { discoverRuntimeLogs } from './logs.mjs'
import { resolveInstalledLayout } from './install-layout.mjs'
import {
  installedContentIdentity,
  readInstallSource,
} from './install-source.mjs'
import { probeOpenAlice } from './runtime-client.mjs'

const CLI_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version
const MINIMUM_NODE_VERSION = [22, 19, 0]
const SOURCE_ARTIFACTS = Object.freeze([
  'dist/main.js',
  'ui/dist/index.html',
  'scripts/guardian/prod.mjs',
])

export async function diagnoseRuntime(options = {}, dependencies = {}) {
  const checks = []
  const add = (id, status, summary, detail) => {
    checks.push({
      id,
      status,
      summary,
      ...(detail ? { detail } : {}),
    })
  }

  const layout = Object.hasOwn(dependencies, 'layout')
    ? dependencies.layout
    : resolveInstalledLayout(import.meta.url)
  const installSource = await (
    dependencies.readInstallSourceImpl ?? readInstallSource
  )()
  const contentIdentity = (
    dependencies.installedContentIdentityImpl ?? installedContentIdentity
  )(import.meta.url)
  add(
    'cli.provenance',
    layout ? 'pass' : 'warn',
    layout
      ? `Installed OpenAlice ${CLI_VERSION} metadata is readable`
      : `OpenAlice ${CLI_VERSION} is running from a source checkout`,
    layout
      ? `${installSource.selector.kind} ${installSource.selector.value}; content ${contentIdentity ?? 'unknown'}`
      : 'Self-update is intentionally unavailable from a source checkout',
  )

  const nodeVersion = dependencies.nodeVersion ?? process.version
  const nodeSupported = isNodeVersionSupported(nodeVersion)
  add(
    'runtime.node',
    nodeSupported ? 'pass' : 'fail',
    nodeSupported
      ? `Node.js ${nodeVersion} satisfies >=${MINIMUM_NODE_VERSION.join('.')}`
      : `Node.js ${nodeVersion} is too old`,
    nodeSupported ? undefined : `Install Node.js ${MINIMUM_NODE_VERSION.join('.')} or newer`,
  )

  const status = await (dependencies.inspectRuntime ?? inspectRuntime)(options, dependencies)
  addRuntimeOwnershipCheck(status, add)
  await addEndpointCheck(status, add, dependencies)
  addComponentChecks(status, add)
  await addProviderCheck(status, add, dependencies)
  await addUpdateCheck(layout, add, dependencies)
  await addLogCheck(status, add, dependencies)

  const failures = checks.filter((check) => check.status === 'fail').length
  const warnings = checks.filter((check) => check.status === 'warn').length
  return {
    schemaVersion: 1,
    overall: failures > 0 ? 'error' : warnings > 0 ? 'degraded' : 'healthy',
    summary: {
      passed: checks.length - failures - warnings,
      warnings,
      failures,
    },
    cli: {
      productVersion: CLI_VERSION,
      installed: Boolean(layout),
      contentIdentity,
      installSource,
    },
    runtime: status,
    checks,
  }
}

function addRuntimeOwnershipCheck(status, add) {
  if (status.class === 'absent') {
    add(
      'runtime.ownership',
      'warn',
      'No OpenAlice Runtime owns the selected home',
      `Start it with "openalice up --home ${status.home}"`,
    )
    return
  }
  if (status.class === 'incompatible') {
    add('runtime.ownership', 'fail', 'The running Guardian control API is incompatible', status.detail)
    return
  }
  if (status.class === 'unhealthy') {
    add('runtime.ownership', 'fail', 'The selected Runtime is unhealthy', status.detail)
    return
  }
  add(
    'runtime.ownership',
    'pass',
    `${status.owner?.surface ?? 'OpenAlice'} owns the selected home`,
    status.owner?.pid ? `pid ${status.owner.pid}; state ${status.state}` : `state ${status.state}`,
  )
}

async function addEndpointCheck(status, add, dependencies) {
  const endpoint = status.endpoints?.web
  if (!endpoint) {
    add(
      'runtime.web',
      status.class === 'absent' ? 'warn' : 'fail',
      'No Web endpoint is currently advertised',
    )
    return
  }
  if (!isLoopbackWebUrl(endpoint)) {
    add('runtime.web', 'fail', 'The advertised Web endpoint is not safe loopback HTTP', endpoint)
    return
  }
  const probe = dependencies.probeRuntime ?? probeOpenAlice
  let ready = false
  try {
    ready = await probe(endpoint)
  } catch {
    ready = false
  }
  add(
    'runtime.web',
    ready ? 'pass' : 'fail',
    ready ? `OpenAlice Web is ready at ${endpoint}` : `OpenAlice Web did not answer at ${endpoint}`,
  )
}

function addComponentChecks(status, add) {
  for (const name of ['alice', 'uta', 'connector']) {
    const state = status.components?.[name]
    if (!state) continue
    if (state === 'ready' || state === 'disabled') {
      add(`component.${name}`, 'pass', `${displayComponent(name)} is ${state}`)
    } else {
      add(
        `component.${name}`,
        name === 'alice' ? 'fail' : 'warn',
        `${displayComponent(name)} is ${state}`,
        status.componentDetail?.[name]?.detail,
      )
    }
  }
}

async function addProviderCheck(status, add, dependencies) {
  const provider = status.provider
  if (status.class === 'absent' || !provider || provider.kind === 'unknown') {
    add('runtime.provider', 'warn', 'Runtime provider integrity cannot be inspected while stopped')
    return
  }
  if (provider.kind !== 'source') {
    add(
      'runtime.provider',
      provider.contentIdentity ? 'pass' : 'warn',
      `${provider.kind} Runtime provider is active`,
      provider.contentIdentity
        ? `content ${provider.contentIdentity}`
        : 'This provider did not advertise a content identity',
    )
    return
  }
  const root = provider.root ?? status.owner?.launchRoot
  if (!root) {
    add('runtime.provider', 'fail', 'Source Runtime did not advertise its checkout root')
    return
  }
  const readFileImpl = dependencies.readFileImpl ?? readFile
  const accessImpl = dependencies.accessImpl ?? access
  let packageVersion
  try {
    packageVersion = JSON.parse(await readFileImpl(resolve(root, 'package.json'), 'utf8')).version
  } catch (error) {
    add('runtime.provider', 'fail', 'Source Runtime package metadata is unreadable', safeError(error))
    return
  }
  const missing = []
  for (const relativePath of SOURCE_ARTIFACTS) {
    try {
      await accessImpl(resolve(root, relativePath))
    } catch {
      missing.push(relativePath)
    }
  }
  if (missing.length > 0) {
    add('runtime.provider', 'fail', 'Source Runtime build artifacts are incomplete', missing.join(', '))
    return
  }
  const advertisedVersion = status.productVersion ?? status.runtimeVersion
  add(
    'runtime.provider',
    packageVersion === advertisedVersion ? 'pass' : 'warn',
    `Source Runtime is complete at ${root}`,
    packageVersion === advertisedVersion
      ? `product ${packageVersion}`
      : `package ${String(packageVersion)}; running ${String(advertisedVersion)}`,
  )
}

async function addUpdateCheck(layout, add, dependencies) {
  if (!layout) {
    add('update.metadata', 'pass', 'Source checkout update ownership is explicit')
    return
  }
  const readFileImpl = dependencies.readFileImpl ?? readFile
  let cache
  try {
    cache = JSON.parse(await readFileImpl(layout.updateCachePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      add('update.metadata', 'warn', 'No stable update check has been cached yet')
      return
    }
    add('update.metadata', 'warn', 'Cached update metadata is unreadable', safeError(error))
    return
  }
  const result = cache?.schemaVersion === 1 ? cache.result : null
  if (!result || !['available', 'current', 'unsupported'].includes(result.status)) {
    add('update.metadata', 'warn', 'Cached update metadata is incomplete')
    return
  }
  add(
    'update.metadata',
    result.status === 'available' ? 'warn' : 'pass',
    result.status === 'available'
      ? `OpenAlice ${String(result.latestVersion)} is available`
      : result.status === 'current'
        ? 'The cached stable release check is current'
        : 'This install source does not use the stable self-update channel',
    typeof cache.checkedAt === 'string' ? `checked ${cache.checkedAt}` : undefined,
  )
}

async function addLogCheck(status, add, dependencies) {
  try {
    const files = await (dependencies.discoverLogs ?? discoverRuntimeLogs)(
      status.home,
      dependencies,
    )
    const logExpected = status.owner?.mode === 'detached'
    add(
      'runtime.logs',
      logExpected && files.length === 0 ? 'warn' : 'pass',
      files.length > 0
        ? `${files.length} safe Runtime log file${files.length === 1 ? '' : 's'} discovered`
        : logExpected
          ? 'Detached Runtime log is missing'
          : 'No detached Runtime log is expected',
    )
  } catch (error) {
    add('runtime.logs', 'fail', 'Runtime log layout is unsafe or unreadable', safeError(error))
  }
}

function isNodeVersionSupported(value) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(value))
  if (!match) return false
  const actual = match.slice(1).map((part) => Number(part ?? 0))
  for (let index = 0; index < MINIMUM_NODE_VERSION.length; index += 1) {
    if (actual[index] !== MINIMUM_NODE_VERSION[index]) {
      return actual[index] > MINIMUM_NODE_VERSION[index]
    }
  }
  return true
}

function isLoopbackWebUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:'
      && url.hostname === '127.0.0.1'
      && url.username === ''
      && url.password === ''
  } catch {
    return false
  }
}

function displayComponent(name) {
  if (name === 'alice') return 'Alice'
  if (name === 'uta') return 'UTA'
  return 'Connector'
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 500)
}
