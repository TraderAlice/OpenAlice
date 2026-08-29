/** Versioned local AliceProject → SSH Machine transfer planner. */
import { createHash, randomUUID } from 'node:crypto'
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
  type ProjectTransferCredentialSummary,
} from './project-transfer-secrets.ts'
import type { SupervisorAliceProjectSummary } from './supervisor-config.ts'

const execFile = promisify(execFileCallback)

export const PROJECT_TRANSFER_SCHEMA_VERSION = 1

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
  const credentialBundle = await readProjectTransferCredentialBundle(sourceHome)
  const credentialSummary = summarizeProjectTransferCredentials(credentialBundle)
  const tracked = input.isGitTracked ?? defaultIsGitTracked
  const exclusions = new Map<ProjectTransferExclusion['reason'], ProjectTransferExclusion>()
  const entries: ProjectTransferEntry[] = []
  const scheduledIssues: ProjectTransferScheduledIssue[] = []
  await walkPortableTree(sourceHome, '', {
    entries,
    exclusions,
    scheduledIssues,
    issuePolicy: input.scheduledIssues ?? null,
    isGitTracked: tracked,
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
  const credentialBytes = credentialsMode === 'include'
    ? Buffer.byteLength(JSON.stringify(credentialBundle))
    : 0
  const requiredFreeBytes = portableBytes
    + credentialBytes
    + Math.max(64 * 1024 * 1024, Math.ceil(portableBytes * 0.05))
  return {
    schemaVersion: PROJECT_TRANSFER_SCHEMA_VERSION,
    transferId: (input.randomId ?? randomUUID)(),
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
}

interface WalkContext {
  entries: ProjectTransferEntry[]
  exclusions: Map<ProjectTransferExclusion['reason'], ProjectTransferExclusion>
  scheduledIssues: ProjectTransferScheduledIssue[]
  issuePolicy: ProjectTransferIssuePolicy | null
  isGitTracked: (workspaceRoot: string, relativePath: string) => Promise<boolean>
  destinationHome: string
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

  const sessionDossier = workspaceSessionDossier(relativePath)
  if (sessionDossier) {
    const tracked = await context.isGitTracked(sessionDossier.workspaceRoot(home), sessionDossier.gitPath)
    if (!tracked) {
      addExclusion(context.exclusions, 'untracked-session-dossier', relativePath, {
        files: info.isDirectory() ? 0 : 1,
        bytes: info.isFile() ? info.size : 0,
      })
      return
    }
  }

  if (info.isSymbolicLink()) {
    const linkTarget = await readlink(absolutePath)
    assertSafeSymlink(home, absolutePath, linkTarget)
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
  if (parts[0] === 'state' || parts[0] === 'runtime' || parts[0] === 'logs') return 'runtime-state'
  if (path === 'sealing.key') return 'machine-local'
  if (path === 'provider-keys.json') return 'credential-plane'
  if (parts[0] === 'workspaces' && parts[1] === 'state') {
    if (['sessions', 'resume-identities.json', 'headless-tasks.json', 'headless-logs',
      'agent-conversations.jsonl', 'agent-runtime.jsonl', 'scrollback',
      'workspace-manager-sessions'].includes(parts[2] ?? '')) return 'session-plane'
  }
  if (parts[0] === 'data' && parts[1] === 'config') {
    if (['accounts.json', 'connectors.json'].includes(parts[2] ?? '')) return 'credential-plane'
    if (['ports.json', 'auth.json'].includes(parts[2] ?? '')) return 'machine-local'
  }
  if (parts[0] === 'data' && parts[1] === 'control') return 'runtime-state'
  return null
}

function transferTransform(
  path: string,
  rewriteIssueOwner: boolean,
): ProjectTransferTransform | undefined {
  if (path === 'workspaces/workspaces.json') return 'workspace-registry-paths'
  if (path === 'workspaces/state/workspace-catalog.json') return 'workspace-catalog-paths'
  if (path === 'data/config/ai-provider-manager.json') return 'strip-ai-credentials'
  if (path === 'data/config/market-data.json') return 'strip-market-provider-keys'
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

async function defaultIsGitTracked(workspaceRoot: string, relativePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFile('git', [
      '-C', workspaceRoot,
      'ls-files', '--error-unmatch', '--', relativePath,
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function inspectScheduledIssue(
  absolutePath: string,
  relativePath: string,
): Promise<ProjectTransferScheduledIssue | null> {
  const text = await readFile(absolutePath, 'utf8')
  if (Buffer.byteLength(text) > 64 * 1024) return null
  const frontmatter = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/u.exec(text)?.[1]
  if (!frontmatter || !/^when\s*:/mu.test(frontmatter)) return null
  const assignee = /^assignee\s*:\s*["']?(@resume-[^\s"']+)["']?\s*$/mu.exec(frontmatter)?.[1]
  if (!assignee) return null
  const parts = relativePath.split('/')
  return {
    workspaceId: parts[2] ?? 'unknown',
    issueId: basename(relativePath, '.md'),
    path: relativePath,
    assignee,
  }
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

function assertSafeSymlink(home: string, path: string, target: string): void {
  if (isAbsolute(target) || /[\u0000-\u001f\u007f-\u009f]/u.test(target)) {
    throw transferPlanError(`Symlink ${relative(home, path)} escapes the AliceProject home.`)
  }
  const resolvedTarget = resolve(dirname(path), target)
  if (resolvedTarget !== home && !resolvedTarget.startsWith(`${home}${sep}`)) {
    throw transferPlanError(`Symlink ${relative(home, path)} escapes the AliceProject home.`)
  }
}

function pathContains(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function transferPlanError(message: string): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message), { code: 'ETRANSFERPLAN', exitCode: 1 })
}
