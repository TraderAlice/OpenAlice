import { existsSync, lstatSync, readlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const DESKTOP_UPGRADE_RECEIPT_SCHEMA_VERSION = 1
export const CHROMIUM_PROFILE_SINGLETON_NAMES = Object.freeze([
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie',
])

export function chromiumProfileReleaseState(entries) {
  const pending = entries
    .filter((entry) => entry.present)
    .map((entry) => {
      const kind = entry.kind ? ` [${entry.kind}]` : ''
      const target = entry.target ? ` -> ${entry.target}` : ''
      const detail = entry.detail ? ` (${entry.detail})` : ''
      return `${entry.name}${kind}${target}${detail}`
    })
  return { released: pending.length === 0, pending }
}

// Chromium's macOS singleton entries are symlinks. Their targets can disappear
// before Chromium removes the profile entry itself, so existsSync() alone
// would mistake the exact dangling-link restart race for a released profile.
export function inspectChromiumProfileSingleton(profileRoot, name) {
  const path = join(profileRoot, name)
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      let target
      try {
        target = readlinkSync(path)
      } catch (error) {
        if (error?.code === 'ENOENT') return { name, present: false }
        return {
          name,
          present: true,
          kind: 'symlink',
          detail: `readlink failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
      return {
        name,
        present: true,
        kind: 'symlink',
        target,
        ...(!existsSync(path) ? { detail: 'dangling target' } : {}),
      }
    }
    return {
      name,
      present: true,
      kind: stat.isSocket() ? 'socket' : stat.isFile() ? 'file' : 'other',
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { name, present: false }
    return {
      name,
      present: true,
      kind: 'inspection-error',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function waitForChromiumProfileRelease(profileRoot, options = {}) {
  const {
    label = 'OpenAlice',
    childExitCode = 'unknown',
    childPid = '<unknown>',
    timeoutMs = 10_000,
    pollIntervalMs = 100,
    inspect = inspectChromiumProfileSingleton,
    now = Date.now,
    sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
    log = console.log,
  } = options
  const startedAt = now()
  const deadline = startedAt + timeoutMs
  let lastState = { released: false, pending: [] }
  let observedPending = false
  while (true) {
    lastState = chromiumProfileReleaseState(
      CHROMIUM_PROFILE_SINGLETON_NAMES.map((name) => inspect(profileRoot, name)),
    )
    if (lastState.released) {
      if (observedPending) {
        log(`[desktop-upgrade] ${label} Chromium profile released after ${now() - startedAt}ms`)
      }
      return
    }
    observedPending = true
    const remainingMs = deadline - now()
    if (remainingMs <= 0) break
    await sleep(Math.min(pollIntervalMs, remainingMs))
  }
  throw new Error(
    `${label} exited ${childExitCode ?? 'unknown'} but Chromium profile remained claimed ` +
    `after ${timeoutMs}ms (pid=${childPid ?? '<unknown>'}, profile=${profileRoot}): ` +
    lastState.pending.join(', '),
  )
}

export function versionFromTag(tag) {
  return typeof tag === 'string' ? tag.replace(/^v/, '') : ''
}

export function selectPreviousDesktopTag(tags, candidateVersion) {
  return tags.find((tag) => versionFromTag(tag) !== candidateVersion) ?? null
}

export function desktopUpgradeWorkspaceTags(previousVersion) {
  const slug = previousVersion
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'release'
  const tag = `upgrade-${slug}`.slice(0, 28)
  return { tag, postUpgradeTag: `${tag}-post` }
}

export function previousDesktopAssetName(version, platform, arch) {
  if (platform === 'darwin') {
    return arch === 'arm64'
      ? `OpenAlice-${version}-arm64-mac.zip`
      : `OpenAlice-${version}-mac.zip`
  }
  if (platform === 'win32' && arch === 'x64') {
    return `OpenAlice.Setup.${version}.exe`
  }
  throw new Error(`unsupported desktop upgrade host: ${platform}-${arch}`)
}

export function candidateDesktopAssetName(version, platform, arch) {
  return previousDesktopAssetName(version, platform, arch)
}

export function windowsInstallerArgs(installRoot, isUpdate = false) {
  if (isUpdate) {
    // Mirror the silent NsisUpdater path. The production handoff additionally
    // uses --force-run; the smoke owns the candidate launch so it can inject
    // isolated state and verify both the first launch and a restart.
    return ['--updated', '/S']
  }
  return [
    '/S',
    `/D=${installRoot}`,
  ]
}

export function buildDesktopUpgradeSmokePlan(argv, options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const args = argv[0] === '--' ? argv.slice(1) : [...argv]
  const values = {
    fromTag: null,
    candidatePackageRoot: null,
    candidateArtifactDir: null,
    receiptPath: null,
    keep: false,
  }
  const errors = []
  const valueFlags = new Map([
    ['--from', 'fromTag'],
    ['--candidate-package-root', 'candidatePackageRoot'],
    ['--candidate-artifact-dir', 'candidateArtifactDir'],
    ['--receipt', 'receiptPath'],
  ])
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--keep') {
      values.keep = true
      continue
    }
    const key = valueFlags.get(arg)
    if (!key) {
      errors.push(`[desktop-upgrade] unknown option: ${arg}`)
      continue
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      errors.push(`[desktop-upgrade] ${arg} requires a value`)
      continue
    }
    values[key] = value
    index += 1
  }
  if (values.candidatePackageRoot && values.candidateArtifactDir) {
    errors.push('[desktop-upgrade] choose candidate package root or final artifact directory, not both')
  }
  return {
    errors,
    fromTag: values.fromTag,
    candidatePackageRoot: resolve(cwd, values.candidatePackageRoot ?? 'dist/electron-app'),
    candidateArtifactDir: values.candidateArtifactDir
      ? resolve(cwd, values.candidateArtifactDir)
      : null,
    receiptPath: values.receiptPath ? resolve(cwd, values.receiptPath) : null,
    keep: values.keep,
  }
}

export function buildUpgradeSeedExpression({ tag, sentinelKey, sentinelValue }) {
  return `
(async () => {
  const json = async (response) => {
    const text = await response.text()
    if (!response.ok) throw new Error(response.status + ' ' + text)
    return text ? JSON.parse(text) : null
  }
  const request = async (path, options) => {
    try { return await fetch(path, options) }
    catch { return fetch('app://openalice' + path, options) }
  }
  const eventually = async (path) => {
    let lastError
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const response = await request(path)
        if (response.ok) return json(response)
        lastError = new Error(response.status + ' ' + await response.text())
      } catch (error) { lastError = error }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw lastError ?? new Error('API did not become ready')
  }
  const version = await eventually('/api/version')
  const before = await json(await request('/api/workspaces'))
  let workspace = before.workspaces.find((candidate) => candidate.tag === ${JSON.stringify(tag)})
  if (!workspace) {
    const created = await json(await request('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag: ${JSON.stringify(tag)}, template: 'chat' }),
    }))
    workspace = created.workspace
  }
  const workspaceId = workspace.id
  await json(await request('/api/workspaces/' + encodeURIComponent(workspaceId) + '/metadata', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'N-1 upgrade sentinel' }),
  }))
  localStorage.setItem(${JSON.stringify(sentinelKey)}, ${JSON.stringify(sentinelValue)})
  const listed = await json(await request('/api/workspaces'))
  return {
    version: version.current,
    workspaceId,
    workspacePresent: listed.workspaces.some((workspace) => workspace.id === workspaceId),
    sentinel: localStorage.getItem(${JSON.stringify(sentinelKey)}),
  }
})()
`.trim()
}

export function buildUpgradeVerifyExpression({
  expectedWorkspaceId,
  postUpgradeTag,
  sentinelKey,
}) {
  return `
(async () => {
  const json = async (response) => {
    const text = await response.text()
    if (!response.ok) throw new Error(response.status + ' ' + text)
    return text ? JSON.parse(text) : null
  }
  const request = async (path, options) => {
    try { return await fetch(path, options) }
    catch { return fetch('app://openalice' + path, options) }
  }
  const eventually = async (path) => {
    let lastError
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const response = await request(path)
        if (response.ok) return json(response)
        lastError = new Error(response.status + ' ' + await response.text())
      } catch (error) { lastError = error }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw lastError ?? new Error('API did not become ready')
  }
  const version = await eventually('/api/version')
  const before = await json(await request('/api/workspaces'))
  const previous = before.workspaces.find((workspace) => workspace.id === ${JSON.stringify(expectedWorkspaceId)})
  let postUpgrade = before.workspaces.find((workspace) => workspace.tag === ${JSON.stringify(postUpgradeTag)})
  if (!postUpgrade) {
    const created = await json(await request('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag: ${JSON.stringify(postUpgradeTag)}, template: 'chat' }),
    }))
    postUpgrade = created.workspace
  }
  const after = await json(await request('/api/workspaces'))
  return {
    version: version.current,
    previousWorkspacePresent: Boolean(previous),
    previousDisplayName: previous?.displayName ?? null,
    postUpgradeWorkspaceId: postUpgrade.id,
    postUpgradeWorkspacePresent: after.workspaces.some((workspace) => workspace.id === postUpgrade.id),
    sentinel: localStorage.getItem(${JSON.stringify(sentinelKey)}),
  }
})()
`.trim()
}
