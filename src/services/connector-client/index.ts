import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, normalize, resolve, sep } from 'node:path'
import {
  ConnectorClient,
  MAX_CONNECTOR_ATTACHMENT_BYTES,
  MAX_CONNECTOR_ATTACHMENTS,
  connectorServiceHealthSchema,
  type ConnectorAttachment,
  type ConnectorServiceHealth,
  type InboxNotification,
} from '@traderalice/connector-protocol'
import type { InboxDoc, InboxEntry, IInboxStore } from '../../core/inbox-store.js'
import { readConnectorServiceEnabled } from '../../core/connector-config.js'
import { probeOptionalCarrier } from '../optional-carrier/health.js'
import {
  normalizeConnectorTextAttachment,
  type ConnectorTextMediaType,
} from './text-attachment.js'

export interface ConnectorBridgeHealth {
  enabled: boolean
  status: 'disabled' | 'healthy' | 'degraded'
  checkedAt?: string
  latencyMs?: number
  reason?: 'not_configured' | 'http_error' | 'invalid_response' | 'timeout' | 'unreachable'
  lastAttemptAt?: string
  lastSuccessAt?: string
  lastError?: string
  service?: ConnectorServiceHealth
}

const state: ConnectorBridgeHealth = { enabled: false, status: 'disabled' }

export function decodeConnectorServiceHealth(value: unknown): ConnectorServiceHealth {
  return connectorServiceHealthSchema.parse(value)
}

export interface InboxConnectorBridgeDeps {
  isEnabled(): Promise<boolean>
  push(notification: InboxNotification): Promise<void>
  warn(message: string): void
  resolveWorkspace?(id: string): { dir: string } | null
}

interface WorkspaceServiceLike {
  registry: { get(id: string): { dir: string } | undefined }
}

export interface InboxAttachmentProjection {
  sourcePath: string
  attachment: ConnectorAttachment
}

export function resolveConnectorUrl(): string {
  return process.env['OPENALICE_CONNECTOR_URL']?.trim()
    || `http://127.0.0.1:${process.env['OPENALICE_CONNECTOR_PORT'] ?? '47334'}`
}

export function startInboxConnectorBridge(
  inboxStore: IInboxStore,
  getWorkspaceService?: () => WorkspaceServiceLike | null,
): () => void {
  const client = new ConnectorClient(resolveConnectorUrl())
  return attachInboxConnectorBridge(inboxStore, {
    isEnabled: readConnectorServiceEnabled,
    push: async (notification) => {
      await client.pushInbox(notification, AbortSignal.timeout(5_000))
    },
    warn: (message) => console.warn('[connector] Inbox notification delivery unavailable:', message),
    ...(getWorkspaceService ? {
      resolveWorkspace: (id) => {
        const workspace = getWorkspaceService()?.registry.get(id)
        return workspace ? { dir: workspace.dir } : null
      },
    } : {}),
  })
}

export function attachInboxConnectorBridge(
  inboxStore: IInboxStore,
  deps: InboxConnectorBridgeDeps,
): () => void {
  return inboxStore.onAppended((entry) => {
    // EventEmitter listeners are synchronous. Never return/throw the network
    // promise into InboxStore.append; durable local write is the hard boundary.
    queueMicrotask(() => { void deliverEntry(entry, deps) })
  })
}

export async function connectorBridgeHealth(): Promise<ConnectorBridgeHealth> {
  const enabled = await readConnectorServiceEnabled()
  state.enabled = enabled
  if (!enabled) {
    state.status = 'disabled'
    delete state.service
    delete state.reason
    delete state.lastError
    return { ...state }
  }
  const probe = await probeOptionalCarrier({
    id: 'connector',
    enabled,
    baseUrl: resolveConnectorUrl(),
    healthPath: '/__connector/health',
    timeoutMs: 2_000,
    decode: decodeConnectorServiceHealth,
  })
  state.checkedAt = probe.checkedAt
  state.latencyMs = probe.latencyMs
  if (probe.phase === 'healthy') {
    state.service = probe.body
    state.status = probe.body?.status === 'healthy' ? 'healthy' : 'degraded'
    delete state.reason
    if (state.status === 'healthy') {
      delete state.lastError
    } else {
      state.lastError = probe.body?.adapters
        .filter((adapter) => adapter.status === 'degraded')
        .map((adapter) => `${adapter.id}: ${adapter.lastError ?? adapter.detail ?? 'degraded'}`)
        .join('; ') || 'One or more connectors are degraded.'
    }
  } else {
    state.status = 'degraded'
    state.reason = probe.reason
    state.lastError = probe.detail ?? probe.reason ?? 'Connector Service health probe failed.'
    delete state.service
  }
  return { ...state }
}

async function deliverEntry(entry: InboxEntry, deps: InboxConnectorBridgeDeps): Promise<void> {
  if (!await deps.isEnabled()) return
  state.enabled = true
  state.lastAttemptAt = new Date().toISOString()
  const attachmentWarnings: string[] = []
  const warnAttachment = (warning: string) => {
    attachmentWarnings.push(warning)
    deps.warn(warning)
  }
  const attachments = await projectInboxAttachments(entry, deps.resolveWorkspace, warnAttachment)
  const notification = toNotification(entry, attachments)
  try {
    await deps.push(notification)
    state.lastSuccessAt = new Date().toISOString()
    if (attachmentWarnings.length > 0) {
      state.status = 'degraded'
      state.lastError = attachmentWarnings.join('; ')
    } else {
      state.status = 'healthy'
      delete state.lastError
    }
  } catch (error) {
    state.status = 'degraded'
    state.lastError = message(error)
    deps.warn(state.lastError)
  }
}

export function toNotification(
  entry: InboxEntry,
  attachments: readonly InboxAttachmentProjection[] = [],
): InboxNotification {
  const docs = entry.docs?.map((doc) => doc.path) ?? []
  const body = [
    entry.comments?.trim(),
    docs.length > 0 ? `Reports:\n${docs.map((path) => `- ${path}`).join('\n')}` : undefined,
  ].filter(Boolean).join('\n\n')
  const baseUrl = process.env['OPENALICE_PUBLIC_URL']?.replace(/\/+$/, '')
  return {
    id: entry.id,
    createdAt: new Date(entry.ts).toISOString(),
    workspaceId: entry.workspaceId,
    ...(entry.workspaceLabel ? { workspaceLabel: entry.workspaceLabel } : {}),
    title: `Inbox update from ${entry.workspaceLabel ?? entry.workspaceId}`,
    body,
    ...(attachments.length > 0 ? { attachments: attachments.map(({ attachment }) => attachment) } : {}),
    ...(baseUrl ? { href: `${baseUrl}/inbox` } : {}),
    ...(entry.origin?.resumeId || entry.origin?.agent ? {
      provenance: {
        ...(entry.origin.resumeId ? { resumeId: entry.origin.resumeId } : {}),
        ...(entry.origin.agent ? { actorLabel: entry.origin.agent } : {}),
      },
    } : {}),
  }
}

/** Project Inbox's live text-report pointers into bounded, verified file
 * bytes before crossing the process boundary. Unsupported or unavailable files
 * remain listed in the text notification and never block the durable Inbox
 * append or the remaining external message. */
export async function projectInboxAttachments(
  entry: InboxEntry,
  resolveWorkspace: InboxConnectorBridgeDeps['resolveWorkspace'],
  warn: (message: string) => void = () => undefined,
): Promise<InboxAttachmentProjection[]> {
  const reportDocs: Array<{ doc: InboxDoc; mediaType: ConnectorTextMediaType }> = []
  for (const doc of entry.docs ?? []) {
    const extension = extname(doc.path).toLowerCase()
    if (extension === '.md' || extension === '.markdown') {
      reportDocs.push({ doc, mediaType: 'text/markdown' })
    } else if (extension === '.html') {
      reportDocs.push({ doc, mediaType: 'text/html' })
    }
  }
  if (reportDocs.length === 0 || !resolveWorkspace) return []

  const workspace = resolveWorkspace(entry.workspaceId)
  if (!workspace) {
    warn(`Workspace unavailable for Inbox attachments: ${entry.workspaceId}`)
    return []
  }

  let workspaceRoot: string
  try {
    workspaceRoot = await realpath(workspace.dir)
  } catch (error) {
    warn(`Workspace path unavailable for Inbox attachments: ${message(error)}`)
    return []
  }

  const projections: InboxAttachmentProjection[] = []
  const usedNames = new Set<string>()
  for (const { doc, mediaType } of reportDocs.slice(0, MAX_CONNECTOR_ATTACHMENTS)) {
    try {
      const target = await resolveSafeWorkspaceFile(workspaceRoot, doc.path)
      const info = await stat(target)
      if (!info.isFile()) throw new Error('not a regular file')
      if (info.size > MAX_CONNECTOR_ATTACHMENT_BYTES) {
        throw new Error(`file exceeds ${MAX_CONNECTOR_ATTACHMENT_BYTES} bytes`)
      }
      const content = await readFile(target)
      const sourceDigest = createHash('sha256').update(content).digest('hex')
      const delivery = normalizeConnectorTextAttachment(content, mediaType)
      if (delivery.warning) warn(`Inbox attachment encoding unchanged (${doc.path}): ${delivery.warning}`)
      if (delivery.content.byteLength > MAX_CONNECTOR_ATTACHMENT_BYTES) {
        throw new Error(`encoding-normalized file exceeds ${MAX_CONNECTOR_ATTACHMENT_BYTES} bytes`)
      }
      const filename = uniqueFilename(basename(doc.path), usedNames)
      projections.push({
        sourcePath: doc.path,
        attachment: {
          filename,
          mediaType: delivery.mediaType,
          sizeBytes: delivery.content.byteLength,
          contentSha256: createHash('sha256').update(delivery.content).digest('hex'),
          source: {
            sizeBytes: content.byteLength,
            contentSha256: sourceDigest,
            ...(delivery.detectedEncoding ? { detectedEncoding: delivery.detectedEncoding } : {}),
            ...(delivery.detectionConfidence !== undefined
              ? { detectionConfidence: delivery.detectionConfidence }
              : {}),
          },
          contentBase64: delivery.content.toString('base64'),
        },
      })
    } catch (error) {
      warn(`Inbox attachment skipped (${doc.path}): ${message(error)}`)
    }
  }
  if (reportDocs.length > MAX_CONNECTOR_ATTACHMENTS) {
    warn(`Inbox attachment limit reached; skipped ${reportDocs.length - MAX_CONNECTOR_ATTACHMENTS} file(s)`)
  }
  return projections
}

async function resolveSafeWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<string> {
  const clean = normalize(relativePath)
  if (!clean || clean === '.' || isAbsolute(clean) || clean === '..' || clean.startsWith(`..${sep}`)) {
    throw new Error('path escapes Workspace')
  }
  const target = await realpath(resolve(workspaceRoot, clean))
  if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${sep}`)) {
    throw new Error('symlink target escapes Workspace')
  }
  return target
}

function uniqueFilename(input: string, used: Set<string>): string {
  const candidate = input.trim() || 'report.md'
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }
  const extension = extname(candidate)
  const stem = candidate.slice(0, candidate.length - extension.length)
  let index = 2
  while (used.has(`${stem}-${index}${extension}`)) index += 1
  const unique = `${stem}-${index}${extension}`
  used.add(unique)
  return unique
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
