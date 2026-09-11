/** Versioned local AliceProject → SSH Machine transfer planner. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
} from 'node:fs/promises'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { parse as parseYaml } from 'yaml'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path'

import {
  deriveAliceProjectIdFromCanonicalHome,
  resolveAliceProjectIdentity,
} from './alice-project.ts'
import { readAliceProjectProduct, type AliceProjectProduct } from './alice-project-product.ts'
import { transformProjectTransferFile } from './project-transfer-files.ts'
import {
  readProjectTransferCredentialBundle,
  summarizeProjectTransferCredentials,
  type ProjectTransferCredentialBundle,
  type ProjectTransferCredentialSummary,
} from './project-transfer-secrets.ts'
import type { SupervisorAliceProjectSummary } from './supervisor-config.ts'

const execFile = promisify(execFileCallback)

export const PROJECT_TRANSFER_SCHEMA_VERSION = 1
export const PROJECT_TRANSFER_RECEIPT_FILE = '.openalice-transfer-receipt.json'

const AI_PROVIDER_CONFIG_PATH = 'data/config/ai-provider-manager.json'
const MARKET_DATA_CONFIG_PATH = 'data/config/market-data.json'
const GIT_INDEX_MAX_BYTES = 64 * 1024 * 1024
const credentialSnapshots = new WeakMap<ProjectTransferPlan, Buffer>()

export type ProjectTransferIssuePolicy = 'keep-blocked' | 'new-then-resume'
export type ProjectTransferCredentialMode = 'include' | 'omit'
export type ProjectTransferEntryKind = 'directory' | 'file' | 'symlink'
export type ProjectTransferTransform =
  | 'workspace-registry-paths'
  | 'workspace-catalog-paths'
  | 'strip-ai-credentials'
  | 'strip-market-provider-keys'
  | 'rewrite-issue-owner'

export interface ProjectTransferEntry {
  path: string
  kind: ProjectTransferEntryKind
  mode: number
  size: number
  sha256: string | null
  sourceSize?: number
  sourceSha256?: string
  linkTarget?: string
  transform?: ProjectTransferTransform
}

export interface ProjectTransferExclusion {
  reason:
    | 'session-plane'
    | 'runtime-state'
    | 'machine-local'
    | 'credential-plane'
    | 'git-ignored'
    | 'untracked-session-dossier'
  files: number
  bytes: number
  examples: string[]
}

export interface ProjectTransferScheduledIssue {
  workspaceId: string
  issueId: string
  path: string
  assignee: string
}

export interface ProjectTransferPlan {
  schemaVersion: 1
  transferId: string
  generatedAt: string
  source: {
    projectId: string
    key: string
    displayName: string
    home: string
    product: AliceProjectProduct
  }
  destination: {
    machineKey: string
    projectId: string
    key: string
    displayName: string
    home: string
    requiredFreeBytes: number
  }
  policy: {
    credentials: ProjectTransferCredentialMode
    scheduledIssues: ProjectTransferIssuePolicy | null
  }
  portable: {
    entries: ProjectTransferEntry[]
    files: number
    directories: number
    symlinks: number
    bytes: number
  }
  excluded: ProjectTransferExclusion[]
  credentials: ProjectTransferCredentialSummary
  scheduledIssues: ProjectTransferScheduledIssue[]
  blockers: Array<{ code: string; message: string }>
  readyToApply: boolean
}

export interface PlanProjectTransferInput {
  source: SupervisorAliceProjectSummary
  destinationMachineKey: string
  destinationProjectKey: string
  destinationDisplayName?: string
  destinationHome: string
  credentials?: ProjectTransferCredentialMode
  scheduledIssues?: ProjectTransferIssuePolicy | null
  env?: NodeJS.ProcessEnv
  now?: () => Date
  randomId?: () => string
  isGitTracked?: (workspaceRoot: string, relativePath: string) => Promise<boolean>
  readCredentials?: (home: string) => Promise<ProjectTransferCredentialBundle>
}

export async function planProjectTransfer(
  input: PlanProjectTransferInput,
): Promise<ProjectTransferPlan> {
  const sourceHome = await realpath(input.source.home)
  const destinationHome = posix.normalize(input.destinationHome)
  const blockers: ProjectTransferPlan['blockers'] = []
  const launcherRoot = input.env?.['AQ_LAUNCHER_ROOT']?.trim()
  if (launcherRoot && resolve(launcherRoot) !== join(sourceHome, 'workspaces')) {
    blockers.push({
      code: 'ESPLITROOT',
      message: 'AQ_LAUNCHER_ROOT points outside the selected AliceProject; split-root transfer is not supported.',
    })
  }
  const credentialsMode = input.credentials ?? 'include'
  const credentialBundle = credentialsMode === 'include'
    ? await (input.readCredentials ?? readProjectTransferCredentialBundle)(sourceHome)
    : null
  const credentialBytes = credentialBundle
    ? Buffer.from(JSON.stringify(credentialBundle), 'utf8')
    : null
  const credentialSummary = credentialBundle
    ? summarizeProjectTransferCredentials(credentialBundle)
    : emptyCredentialSummary()
  const exclusions = new Map<ProjectTransferExclusion['reason'], ProjectTransferExclusion>()
  const entries: ProjectTransferEntry[] = []
  const scheduledIssues: ProjectTransferScheduledIssue[] = []
  const linkedWorktrees: string[] = []
  const nestedGitRepositories: string[] = []
  const gitPortabilityIssues = new Map<string, string[]>()
  await walkPortableTree(sourceHome, '', {
    entries,
    exclusions,
    scheduledIssues,
    issuePolicy: input.scheduledIssues ?? null,
    isGitTracked: input.isGitTracked,
    workspaceGitIndexes: new Map(),
    linkedWorktrees,
    nestedGitRepositories,
    gitPortabilityIssues,
    destinationHome,
  })
  entries.sort((left, right) => left.path.localeCompare(right.path))
  scheduledIssues.sort((left, right) => left.path.localeCompare(right.path))
  if (scheduledIssues.length > 0 && !input.scheduledIssues) {
    blockers.push({
      code: 'EISSUEPOLICY',
      message: `${scheduledIssues.length} scheduled Issue(s) use an exact Session owner; choose keep-blocked or new-then-resume.`,
    })
  }
  if (linkedWorktrees.length > 0) {
    blockers.push({
      code: 'ELINKEDWORKTREE',
      message: `${linkedWorktrees.length} linked Git worktree(s) cannot be transferred faithfully; materialize each as an independent repository first.`,
    })
  }
  if (nestedGitRepositories.length > 0) {
    blockers.push({
      code: 'ENESTEDGIT',
      message: `${nestedGitRepositories.length} nested Git repository or initialized submodule path(s) cannot be transferred faithfully; materialize or remove them first: ${nestedGitRepositories.slice(0, 3).join(', ')}.`,
    })
  }
  if (gitPortabilityIssues.size > 0) {
    const examples = [...gitPortabilityIssues.entries()].slice(0, 3)
      .map(([path, issues]) => `${path} (${issues.join(', ')})`)
      .join('; ')
    blockers.push({
      code: 'EGITPORTABILITY',
      message: `${gitPortabilityIssues.size} Git Workspace(s) depend on machine-local object/config state and must be materialized before transfer: ${examples}.`,
    })
  }

  const product = await readAliceProjectProduct(sourceHome)
  const destinationProject = resolveAliceProjectIdentity({
    home: destinationHome,
    key: input.destinationProjectKey,
    displayName: input.destinationDisplayName ?? input.source.displayName,
    env: {
      OPENALICE_PROJECT_ID: deriveAliceProjectIdFromCanonicalHome(destinationHome),
    },
  })
  const portableBytes = entries.reduce((sum, entry) => sum + entry.size, 0)
  const requiredFreeBytes = portableBytes
    + (credentialBytes?.byteLength ?? 0)
    + Math.max(64 * 1024 * 1024, Math.ceil(portableBytes * 0.05))
  const transferId = input.randomId?.() ?? deterministicTransferId({
    sourceProjectId: input.source.id,
    destinationMachineKey: input.destinationMachineKey,
    destinationProjectId: destinationProject.id,
    destinationHome,
    credentials: credentialsMode,
    scheduledIssues: input.scheduledIssues ?? null,
    entries,
  })
  const plan: ProjectTransferPlan = {
    schemaVersion: PROJECT_TRANSFER_SCHEMA_VERSION,
    transferId,
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    source: {
      projectId: input.source.id,
      key: input.source.key,
      displayName: input.source.displayName,
      home: sourceHome,
      product,
    },
    destination: {
      machineKey: input.destinationMachineKey,
      projectId: destinationProject.id,
      key: destinationProject.key,
      displayName: destinationProject.displayName,
      home: destinationHome,
      requiredFreeBytes,
    },
    policy: {
      credentials: credentialsMode,
      scheduledIssues: input.scheduledIssues ?? null,
    },
    portable: {
      entries,
      files: entries.filter((entry) => entry.kind === 'file').length,
      directories: entries.filter((entry) => entry.kind === 'directory').length,
      symlinks: entries.filter((entry) => entry.kind === 'symlink').length,
      bytes: portableBytes,
    },
    excluded: [...exclusions.values()],
    credentials: credentialSummary,
    scheduledIssues,
    blockers,
    readyToApply: blockers.length === 0,
  }
  if (credentialBytes) credentialSnapshots.set(plan, Buffer.from(credentialBytes))
  return plan
}

function deterministicTransferId(input: {
  sourceProjectId: string
  destinationMachineKey: string
  destinationProjectId: string
  destinationHome: string
  credentials: ProjectTransferCredentialMode
  scheduledIssues: ProjectTransferIssuePolicy | null
  entries: ProjectTransferEntry[]
}): string {
  const digest = hashBuffer(Buffer.from(JSON.stringify(input), 'utf8'))
  return `transfer-${digest.slice(0, 40)}`
}

/**
 * The consented credential snapshot stays process-private: it is neither part
 * of JSON plan output nor a reusable offline verifier for low-entropy secrets.
 */
export function readProjectTransferCredentialSnapshot(plan: ProjectTransferPlan): Buffer | null {
  const snapshot = credentialSnapshots.get(plan)
  return snapshot ? Buffer.from(snapshot) : null
}

function emptyCredentialSummary(): ProjectTransferCredentialSummary {
  return {
    ai: { count: 0, vendors: [] },
    broker: { count: 0, presets: [] },
    connector: { count: 0, adapters: [] },
    providerKeys: { count: 0, vendors: [] },
  }
}

interface WalkContext {
  entries: ProjectTransferEntry[]
  exclusions: Map<ProjectTransferExclusion['reason'], ProjectTransferExclusion>
  scheduledIssues: ProjectTransferScheduledIssue[]
  issuePolicy: ProjectTransferIssuePolicy | null
  isGitTracked?: (workspaceRoot: string, relativePath: string) => Promise<boolean>
  workspaceGitIndexes: Map<string, Promise<WorkspaceGitIndex | null>>
  linkedWorktrees: string[]
  nestedGitRepositories: string[]
  gitPortabilityIssues: Map<string, string[]>
  destinationHome: string
}

interface WorkspaceGitIndex {
  portablePaths: Set<string>
  portableDirectories: Set<string>
  trackedPaths: Set<string>
  trackedDirectories: Set<string>
  portabilityIssues: string[]
}

async function walkPortableTree(
  home: string,
  relativePath: string,
  context: WalkContext,
): Promise<void> {
  const absolutePath = relativePath ? join(home, ...relativePath.split('/')) : home
  const info = await lstat(absolutePath)
  if (relativePath) validateManifestPath(relativePath)
  const reason = relativePath ? exclusionReason(relativePath) : null
  if (reason) {
    const measured = await measureTree(absolutePath)
    addExclusion(context.exclusions, reason, relativePath, measured)
    return
  }

  const workspaceEntry = workspaceTreeEntry(relativePath)
  const gitIndex = workspaceEntry
    ? await readWorkspaceGitIndexOnce(
        workspaceEntry.workspaceRoot(home),
        context.workspaceGitIndexes,
      )
    : null
  if (workspaceEntry && gitIndex?.portabilityIssues.length) {
    context.gitPortabilityIssues.set(workspaceEntry.rootPath, gitIndex.portabilityIssues)
  }
  const sessionDossier = workspaceSessionDossier(relativePath)
  if (sessionDossier) {
    const tracked = context.isGitTracked
      ? await context.isGitTracked(sessionDossier.workspaceRoot(home), sessionDossier.gitPath)
      : gitIndex?.trackedPaths.has(sessionDossier.gitPath) === true
    if (!tracked) {
      addExclusion(context.exclusions, 'untracked-session-dossier', relativePath, {
        files: info.isDirectory() ? 0 : 1,
        bytes: info.isFile() ? info.size : 0,
      })
      return
    }
  }

  if (workspaceEntry?.gitPath === '.git' && !info.isDirectory()) {
    context.linkedWorktrees.push(relativePath.slice(0, -'/.git'.length))
    addExclusion(context.exclusions, 'machine-local', relativePath, {
      files: 1,
      bytes: info.isFile() ? info.size : 0,
    })
    return
  }

  if (
    workspaceEntry
    && workspaceEntry.gitPath.endsWith('/.git')
    && !workspaceEntry.gitPath.startsWith('.git/')
  ) {
    context.nestedGitRepositories.push(posix.dirname(relativePath))
    addExclusion(context.exclusions, 'machine-local', relativePath, await measureTree(absolutePath))
    return
  }

  if (
    workspaceEntry
    && workspaceEntry.gitPath
    && isNativeAgentProjectPath(workspaceEntry.gitPath)
    && !isPortableNativeProjectAsset(workspaceEntry.gitPath)
    && (
      !gitIndex
      || !isTrackedGitWorkspaceEntry(gitIndex, workspaceEntry.gitPath, info.isDirectory())
    )
  ) {
    addExclusion(
      context.exclusions,
      'machine-local',
      relativePath,
      await measureTree(absolutePath),
    )
    return
  }

  if (
    workspaceEntry
    && gitIndex
    && workspaceEntry.gitPath
    && !isPortableGitWorkspaceEntry(gitIndex, workspaceEntry.gitPath, info.isDirectory())
  ) {
    addExclusion(
      context.exclusions,
      'git-ignored',
      relativePath,
      await measureTree(absolutePath),
    )
    return
  }

  if (info.isSymbolicLink()) {
    const linkTarget = await readlink(absolutePath)
    if (!isPortableSymlink(home, absolutePath, linkTarget)) {
      addExclusion(context.exclusions, 'machine-local', relativePath, { files: 1, bytes: 0 })
      return
    }
    context.entries.push({
      path: relativePath,
      kind: 'symlink',
      mode: info.mode & 0o777,
      size: 0,
      sha256: null,
      linkTarget,
    })
    return
  }
  if (info.isDirectory()) {
    if (relativePath) {
      context.entries.push({
        path: relativePath,
        kind: 'directory',
        mode: info.mode & 0o777,
        size: 0,
        sha256: null,
      })
    }
    const children = await readdir(absolutePath)
    for (const child of children.sort()) {
      await walkPortableTree(home, relativePath ? `${relativePath}/${child}` : child, context)
    }
    return
  }
  if (!info.isFile()) throw transferPlanError(`Unsupported filesystem entry: ${relativePath}`)

  let scheduledIssue: ProjectTransferScheduledIssue | null = null
  if (isIssuePath(relativePath)) {
    scheduledIssue = await inspectScheduledIssue(absolutePath, relativePath)
    if (scheduledIssue) context.scheduledIssues.push(scheduledIssue)
  }
  const transform = transferTransform(
    relativePath,
    scheduledIssue !== null && context.issuePolicy === 'new-then-resume',
  )
  const sourceBytes = transform ? await readFile(absolutePath) : null
  const portableBytes = transform && sourceBytes
    ? transformProjectTransferFile({
        path: relativePath,
        transform,
        bytes: sourceBytes,
        destinationHome: context.destinationHome,
      })
    : null
  context.entries.push({
    path: relativePath,
    kind: 'file',
    mode: info.mode & 0o777,
    size: portableBytes?.byteLength ?? info.size,
    sha256: portableBytes ? hashBuffer(portableBytes) : await hashFile(absolutePath),
    ...(sourceBytes ? {
      sourceSize: sourceBytes.byteLength,
      sourceSha256: hashBuffer(sourceBytes),
    } : {}),
    ...(transform ? { transform } : {}),
  })
}

function exclusionReason(path: string): ProjectTransferExclusion['reason'] | null {
  const parts = path.split('/')
  const workspaceNativeState = workspaceNativeStateReason(path)
  if (workspaceNativeState) return workspaceNativeState
  const gitLocalState = gitLocalStateReason(path)
  if (gitLocalState) return gitLocalState
  if (parts[0] === 'bin' || parts[0] === 'cli') return 'machine-local'
  if (parts[0] === 'state' || parts[0] === 'runtime' || parts[0] === 'logs') return 'runtime-state'
  if (parts[0] === 'data' && parts[1] === 'logs') return 'runtime-state'
  if (parts[0] === 'data' && ['sessions', 'tool-calls'].includes(parts[1] ?? '')) return 'session-plane'
  if (parts[0] === 'demo-text-backups') return 'machine-local'
  if (parts[0] === 'data' && parts[1] === '_backup') return 'credential-plane'
  if (matchesFileFamily(path, '.cli-install.lock')) return 'machine-local'
  if (matchesFileFamily(path, PROJECT_TRANSFER_RECEIPT_FILE)) return 'machine-local'
  if (matchesFileFamily(path, '.cli-update-check.json')) return 'machine-local'
  if (matchesFileFamily(path, '.cli-install.lock.guard')) return 'machine-local'
  if (matchesFileFamily(path, 'sealing.key')) return 'machine-local'
  if (matchesFileFamily(path, 'provider-keys.json')) return 'credential-plane'
  if (parts[0] === 'workspaces' && parts[1] === 'state') {
    if (['sessions', 'resume-identities.json', 'headless-tasks.json', 'headless-logs',
      'agent-conversations.jsonl', 'agent-runtime.jsonl', 'scrollback',
      'workspace-manager-sessions'].includes(parts[2] ?? '')) return 'session-plane'
    if (
      ['runtime.lock', 'runtime-readiness', 'schedule-markers.json'].includes(parts[2] ?? '')
      || /(?:lock|lease)(?:\.|$)/u.test(parts[2] ?? '')
    ) return 'runtime-state'
    if (
      path !== 'workspaces/state/workspace-catalog.json'
      && matchesFileFamily(path, 'workspaces/state/workspace-catalog.json')
    ) return 'machine-local'
  }
  if (
    path !== 'workspaces/workspaces.json'
    && matchesFileFamily(path, 'workspaces/workspaces.json')
  ) return 'machine-local'
  if (parts[0] === 'data' && parts[1] === 'config') {
    if (
      matchesFileFamily(path, 'data/config/accounts.json')
      || matchesFileFamily(path, 'data/config/connectors.json')
      || (path !== AI_PROVIDER_CONFIG_PATH && matchesFileFamily(path, AI_PROVIDER_CONFIG_PATH))
      || (path !== MARKET_DATA_CONFIG_PATH && matchesFileFamily(path, MARKET_DATA_CONFIG_PATH))
    ) return 'credential-plane'
    if (matchesFileFamily(path, 'data/config/sessions.json')) return 'session-plane'
    if (
      matchesFileFamily(path, 'data/config/ports.json')
      || matchesFileFamily(path, 'data/config/auth.json')
    ) return 'machine-local'
  }
  if (parts[0] === 'data' && parts[1] === 'control') return 'runtime-state'
  return null
}

/**
 * Native Agent login/session/config files are deliberately not AliceProject
 * credentials. They may contain plaintext API keys or host-bound login state,
 * so the destination runtime must recreate them from the transferred Alice
 * vault or its own login flow. Shared skills and ordinary dot-directory files
 * remain portable.
 */
function workspaceNativeStateReason(path: string): ProjectTransferExclusion['reason'] | null {
  if (!path.startsWith('workspaces/')) return null
  const parts = path.split('/')
  if (parts.includes('.pi-agent')) return 'machine-local'

  if (
    matchesNestedFileFamily(path, '.claude', 'settings.local.json')
    || matchesNestedFileFamily(path, '.claude', 'openalice-provider.json')
    || matchesNestedFileFamily(path, '.codex', 'auth.json')
    || matchesNestedFileFamily(path, '.codex', 'env.json')
    || matchesNestedFileFamily(path, '.codex', 'config.toml')
    || matchesNestedFileFamily(path, '.codex', 'openalice-provider.json')
    || matchesNestedTree(path, '.codex', 'openalice-home')
    || matchesWorkspaceRootFileFamily(path, 'opencode.json')
    || matchesWorkspaceRootFileFamily(path, 'tui.json')
    || matchesNestedFileFamily(path, '.opencode', 'openalice-provider.json')
    || matchesNestedFileFamily(path, '.pi', 'settings.json')
    || matchesNestedFileFamily(path, '.pi', 'openalice-provider.json')
    || matchesNestedPath(path, ['.pi', 'extensions', 'openalice-provider.ts'])
  ) return 'credential-plane'

  if (
    matchesNestedTree(path, '.codex', 'sessions')
    || matchesNestedFileFamily(path, '.codex', 'history.jsonl')
    || matchesNestedFileFamily(path, '.codex', 'session_index.jsonl')
    || matchesNestedTree(path, '.claude', 'projects')
    || matchesNestedTree(path, '.claude', 'session-env')
    || matchesNestedTree(path, '.claude', 'debug')
    || matchesNestedTree(path, '.claude', 'todos')
    || matchesNestedFileFamily(path, '.claude', 'history.jsonl')
  ) return 'session-plane'
  const codexPath = nestedPathParts(path, '.codex')
  if (codexPath) {
    if (
      ['log', 'cache', 'tmp', '.tmp', 'shell_snapshots'].includes(codexPath[0] ?? '')
      || /^(?:state|logs)_.*\.sqlite(?:-shm|-wal)?$/u.test(codexPath[0] ?? '')
    ) return 'session-plane'
    if (
      ['installation_id', 'models_cache.json', 'version.json'].includes(codexPath[0] ?? '')
    ) return 'machine-local'
  }
  return null
}

/** Git object/ref/index state is portable; host credentials and path pointers are not. */
function gitLocalStateReason(path: string): ProjectTransferExclusion['reason'] | null {
  if (!path.startsWith('workspaces/')) return null
  const parts = path.split('/')
  const gitIndex = parts.indexOf('.git')
  if (gitIndex < 0) return null
  const gitPath = parts.slice(gitIndex + 1)
  if (gitPath.some((part) => part.endsWith('.lock'))) return 'runtime-state'
  if (
    matchesFileFamily(gitPath.join('/'), 'config')
    || matchesFileFamily(gitPath.join('/'), 'config.worktree')
    || gitPath.join('/') === 'objects/info/alternates'
    || gitPath[0] === 'worktrees'
    || (gitPath[0] === 'modules' && gitPath.at(-1) === 'config')
  ) return 'machine-local'
  return null
}

function matchesNestedFileFamily(path: string, directory: string, baseName: string): boolean {
  const parts = path.split('/')
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] !== directory) continue
    if (matchesFileFamily(parts.slice(index + 1).join('/'), baseName)) return true
  }
  return false
}

function matchesNestedTree(path: string, directory: string, child: string): boolean {
  return matchesNestedPath(path, [directory, child])
}

function matchesNestedPath(path: string, sequence: string[]): boolean {
  const parts = path.split('/')
  return parts.some((_, index) => sequence.every((part, offset) => parts[index + offset] === part))
}

function nestedPathParts(path: string, directory: string): string[] | null {
  const parts = path.split('/')
  const index = parts.indexOf(directory)
  return index < 0 ? null : parts.slice(index + 1)
}

function isNativeAgentProjectPath(path: string): boolean {
  return ['.claude', '.codex', '.opencode', '.pi']
    .some((root) => path === root || path.startsWith(`${root}/`))
}

function isPortableNativeProjectAsset(path: string): boolean {
  if (path === '.claude' || path === '.codex' || path === '.pi') return true
  return ['.claude/skills', '.codex/skills', '.pi/skills']
    .some((root) => path === root || path.startsWith(`${root}/`))
}

function matchesWorkspaceRootFileFamily(path: string, baseName: string): boolean {
  const parts = path.split('/')
  if (parts[0] !== 'workspaces') return false
  let candidate: string | undefined
  if (parts[1] === 'workspaces' || parts[1] === 'departed-workspaces') {
    if (parts.length === 3) candidate = parts[2]
    else if (parts.length === 4) candidate = parts[3]
  } else if (parts[1]?.endsWith('-mirror') && parts.length === 3) {
    candidate = parts[2]
  }
  return candidate !== undefined && matchesFileFamily(candidate, baseName)
}

function matchesFileFamily(path: string, basePath: string): boolean {
  const pathDirectory = posix.dirname(path)
  const baseDirectory = posix.dirname(basePath)
  if (pathDirectory !== baseDirectory) return false
  const name = posix.basename(path)
  const baseName = posix.basename(basePath)
  const stem = baseName.endsWith('.json') ? baseName.slice(0, -'.json'.length) : baseName
  return name === baseName
    || name.startsWith(`${baseName}.`)
    || name.startsWith(`.${stem}.`)
}

function transferTransform(
  path: string,
  rewriteIssueOwner: boolean,
): ProjectTransferTransform | undefined {
  if (path === 'workspaces/workspaces.json') return 'workspace-registry-paths'
  if (path === 'workspaces/state/workspace-catalog.json') return 'workspace-catalog-paths'
  if (path === AI_PROVIDER_CONFIG_PATH) return 'strip-ai-credentials'
  if (path === MARKET_DATA_CONFIG_PATH) return 'strip-market-provider-keys'
  if (rewriteIssueOwner) return 'rewrite-issue-owner'
  return undefined
}

function workspaceSessionDossier(path: string): {
  workspaceRoot(home: string): string
  gitPath: string
} | null {
  const match = /^(workspaces\/(?:workspaces|departed-workspaces)\/[^/]+)\/(\.alice\/sessions\/.*)$/u.exec(path)
  if (!match?.[1] || !match[2]) return null
  return {
    workspaceRoot: (home) => join(home, ...match[1]!.split('/')),
    gitPath: match[2],
  }
}

function workspaceTreeEntry(path: string): {
  rootPath: string
  workspaceRoot(home: string): string
  gitPath: string
} | null {
  const match = /^(workspaces\/(?:workspaces|departed-workspaces)\/[^/]+)(?:\/(.*))?$/u.exec(path)
    ?? /^(workspaces\/[^/]+-mirror)(?:\/(.*))?$/u.exec(path)
  if (!match?.[1]) return null
  return {
    rootPath: match[1],
    workspaceRoot: (home) => join(home, ...match[1]!.split('/')),
    gitPath: match[2] ?? '',
  }
}

async function readWorkspaceGitIndexOnce(
  workspaceRoot: string,
  cache: Map<string, Promise<WorkspaceGitIndex | null>>,
): Promise<WorkspaceGitIndex | null> {
  let pending = cache.get(workspaceRoot)
  if (!pending) {
    pending = readWorkspaceGitIndex(workspaceRoot)
    cache.set(workspaceRoot, pending)
  }
  return pending
}

async function readWorkspaceGitIndex(workspaceRoot: string): Promise<WorkspaceGitIndex | null> {
  try {
    await lstat(join(workspaceRoot, '.git'))
  } catch (error: unknown) {
    // The Workspace container may also hold top-level control files. Those
    // paths match the structural prefix but are not Workspace directories, so
    // `<file>/.git` reports ENOTDIR rather than ENOENT.
    if (isNodeError(error, 'ENOENT') || isNodeError(error, 'ENOTDIR')) return null
    throw transferPlanError(`Could not inspect Git metadata for Workspace ${workspaceRoot}.`, error)
  }

  const portabilityIssues = await inspectGitPortabilityIssues(workspaceRoot)
  let stdout: string
  try {
    const result = await execFile('git', [
      '-C', workspaceRoot,
      'ls-files', '-z', '-t', '--cached', '--others', '--exclude-standard', '--full-name', '--', '.',
    ], { encoding: 'utf8', maxBuffer: GIT_INDEX_MAX_BYTES })
    stdout = String(result.stdout)
  } catch (error: unknown) {
    throw transferPlanError(`Could not read the Git index for Workspace ${workspaceRoot}.`, error)
  }

  const portablePaths = new Set<string>()
  const portableDirectories = new Set<string>()
  const trackedPaths = new Set<string>()
  const trackedDirectories = new Set<string>()
  for (const record of stdout.split('\0')) {
    if (!record) continue
    if (record.length < 3 || record[1] !== ' ') {
      throw transferPlanError(`Git returned an invalid index record for Workspace ${workspaceRoot}.`)
    }
    const tag = record[0]
    const hadTrailingSlash = record.endsWith('/')
    const gitPath = record.slice(2).replace(/\/+$/u, '')
    validateManifestPath(gitPath)
    portablePaths.add(gitPath)
    if (tag !== '?') trackedPaths.add(gitPath)
    if (hadTrailingSlash) portableDirectories.add(gitPath)
    const parts = gitPath.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      portableDirectories.add(parts.slice(0, index).join('/'))
      if (tag !== '?') trackedDirectories.add(parts.slice(0, index).join('/'))
    }
  }
  return { portablePaths, portableDirectories, trackedPaths, trackedDirectories, portabilityIssues }
}

async function inspectGitPortabilityIssues(workspaceRoot: string): Promise<string[]> {
  const issues: string[] = []
  try {
    await lstat(join(workspaceRoot, '.git', 'objects', 'info', 'alternates'))
    issues.push('alternate object database')
  } catch (error: unknown) {
    if (!isNodeError(error, 'ENOENT') && !isNodeError(error, 'ENOTDIR')) throw error
  }

  let output = ''
  try {
    const result = await execFile('git', [
      '-C', workspaceRoot,
      'config', '--local', '--get-regexp',
      '^(core\\.(repositoryformatversion|worktree)|extensions\\.(objectformat|refstorage|partialclone|worktreeconfig)|remote\\..*\\.promisor)$',
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
    output = String(result.stdout)
  } catch (error: unknown) {
    if (!isExitCode(error, 1)) {
      throw transferPlanError(`Could not inspect Git portability for Workspace ${workspaceRoot}.`, error)
    }
  }
  for (const line of output.split(/\r?\n/u)) {
    const match = /^(\S+)\s+(.*)$/u.exec(line)
    if (!match?.[1]) continue
    const key = match[1].toLowerCase()
    const value = (match[2] ?? '').trim().toLowerCase()
    if (key === 'core.repositoryformatversion' && value !== '0') issues.push('non-default repository format')
    else if (key === 'core.worktree') issues.push('external Git worktree path')
    else if (key === 'extensions.objectformat' && value !== 'sha1') issues.push('non-default object format')
    else if (key === 'extensions.refstorage' && value !== 'files') issues.push('non-default ref storage')
    else if (key === 'extensions.partialclone' && value) issues.push('partial-clone object dependency')
    else if (key === 'extensions.worktreeconfig' && value === 'true') issues.push('worktree-local Git config')
    else if (key.startsWith('remote.') && key.endsWith('.promisor') && value === 'true') {
      issues.push('promisor remote object dependency')
    }
  }
  return [...new Set(issues)]
}

function isPortableGitWorkspaceEntry(
  index: WorkspaceGitIndex,
  gitPath: string,
  directory: boolean,
): boolean {
  if (gitPath === '.git') return directory
  if (gitPath.startsWith('.git/')) return true
  if (directory) {
    return index.portableDirectories.has(gitPath) || index.portablePaths.has(gitPath)
  }
  return index.portablePaths.has(gitPath)
}

function isTrackedGitWorkspaceEntry(
  index: WorkspaceGitIndex,
  gitPath: string,
  directory: boolean,
): boolean {
  return directory
    ? index.trackedDirectories.has(gitPath)
    : index.trackedPaths.has(gitPath)
}

async function inspectScheduledIssue(
  absolutePath: string,
  relativePath: string,
): Promise<ProjectTransferScheduledIssue | null> {
  const text = await readFile(absolutePath, 'utf8')
  if (Buffer.byteLength(text) > 64 * 1024) return null
  const frontmatter = splitIssueFrontmatter(text)?.frontmatter
  if (!frontmatter) return null
  let value: unknown
  try {
    value = parseYaml(frontmatter)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record['when'] === undefined) return null
  const assignee = record['assignee']
  if (typeof assignee !== 'string' || !assignee.startsWith('@resume-')) return null
  const parts = relativePath.split('/')
  return {
    workspaceId: parts[2] ?? 'unknown',
    issueId: basename(relativePath, '.md'),
    path: relativePath,
    assignee,
  }
}

function splitIssueFrontmatter(raw: string): { frontmatter: string } | null {
  const lines = raw.replace(/^\uFEFF/u, '').split(/\r?\n/u)
  if (lines[0]?.trim() !== '---') return null
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') {
      return { frontmatter: lines.slice(1, index).join('\n') }
    }
  }
  return null
}

function isIssuePath(path: string): boolean {
  return /^workspaces\/(?:workspaces|departed-workspaces)\/[^/]+\/\.alice\/issues\/[^/]+\.md$/u.test(path)
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function hashBuffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

async function measureTree(path: string): Promise<{ files: number; bytes: number }> {
  const info = await lstat(path)
  if (info.isSymbolicLink()) return { files: 1, bytes: 0 }
  if (info.isFile()) return { files: 1, bytes: info.size }
  if (!info.isDirectory()) return { files: 1, bytes: 0 }
  let files = 0
  let bytes = 0
  for (const child of await readdir(path)) {
    const measured = await measureTree(join(path, child))
    files += measured.files
    bytes += measured.bytes
  }
  return { files, bytes }
}

function addExclusion(
  exclusions: Map<ProjectTransferExclusion['reason'], ProjectTransferExclusion>,
  reason: ProjectTransferExclusion['reason'],
  example: string,
  measured: { files: number; bytes: number },
): void {
  const current = exclusions.get(reason) ?? { reason, files: 0, bytes: 0, examples: [] }
  current.files += measured.files
  current.bytes += measured.bytes
  if (current.examples.length < 3) current.examples.push(example)
  exclusions.set(reason, current)
}

export function validateManifestPath(path: string): void {
  if (!path || isAbsolute(path) || path.includes('\\') || /[\u0000-\u001f\u007f-\u009f]/u.test(path)) {
    throw transferPlanError(`Unsafe transfer path: ${JSON.stringify(path)}`)
  }
  const parts = path.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.length > 255)) {
    throw transferPlanError(`Unsafe transfer path: ${JSON.stringify(path)}`)
  }
}

function isPortableSymlink(home: string, path: string, target: string): boolean {
  if (isAbsolute(target) || /[\u0000-\u001f\u007f-\u009f]/u.test(target)) {
    return false
  }
  const resolvedTarget = resolve(dirname(path), target)
  return resolvedTarget === home || resolvedTarget.startsWith(`${home}${sep}`)
}

function pathContains(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function transferPlanError(message: string, cause?: unknown): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
    code: 'ETRANSFERPLAN',
    exitCode: 1,
  })
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}

function isExitCode(error: unknown, code: number): boolean {
  return error !== null
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === code
}
