import {
  ConnectorClient,
  artifactFailureMessage,
  isConnectorActionExpired,
  type ConnectorArtifactDelivery,
  type ConnectorArtifactFailure,
  type ConnectorArtifactRequest,
  type ConnectorUtaFailure,
  type ConnectorUtaPresentation,
  type ConnectorUtaRequest,
} from '@traderalice/connector-protocol'
import type { IInboxStore } from '../../core/inbox-store.js'
import { readConnectorServiceEnabled } from '../../core/connector-config.js'
import type { TradingModePolicy } from '../trading-mode.js'
import type { UTAManagerSDK } from '../uta-client/index.js'
import { projectInboxDoc, resolveConnectorUrl } from './index.js'
import { processConnectorUtaRequests } from './uta-review.js'

interface WorkspaceServiceLike {
  registry: { get(id: string): { dir: string } | undefined }
}

export interface ConnectorActionBridgeDeps {
  isEnabled(): Promise<boolean>
  drainActions(): Promise<ConnectorArtifactRequest[]>
  deliverArtifact(delivery: ConnectorArtifactDelivery): Promise<void>
  failArtifact(failure: ConnectorArtifactFailure): Promise<void>
  warn(message: string): void
  resolveWorkspace?(id: string): { dir: string } | null
  now?: () => number
  drainUtaActions?: () => Promise<ConnectorUtaRequest[]>
  presentUta?: (presentation: ConnectorUtaPresentation) => Promise<void>
  failUta?: (failure: ConnectorUtaFailure) => Promise<void>
  utaManager?: UTAManagerSDK
  tradingModePolicy?: () => TradingModePolicy
  warnUta?: (message: string) => void
}

export function startConnectorActionBridge(
  inboxStore: IInboxStore,
  getWorkspaceService?: () => WorkspaceServiceLike | null,
  options: {
    intervalMs?: number
    client?: ConnectorClient
    utaManager?: UTAManagerSDK
    tradingModePolicy?: () => TradingModePolicy
  } = {},
): () => void {
  const client = options.client ?? new ConnectorClient(resolveConnectorUrl())
  const intervalMs = options.intervalMs ?? 1_500
  const stop = attachConnectorActionBridge(inboxStore, {
    isEnabled: readConnectorServiceEnabled,
    drainActions: () => client.drainActions(AbortSignal.timeout(5_000)),
    deliverArtifact: async (delivery) => {
      await client.deliverArtifact(delivery, AbortSignal.timeout(15_000))
    },
    failArtifact: async (failure) => {
      await client.failArtifact(failure, AbortSignal.timeout(5_000))
    },
    warn: (message) => console.warn('[connector] Inbox file request failed:', message),
    ...(getWorkspaceService ? {
      resolveWorkspace: (id) => {
        const workspace = getWorkspaceService()?.registry.get(id)
        return workspace ? { dir: workspace.dir } : null
      },
    } : {}),
    ...(options.utaManager && options.tradingModePolicy ? {
      drainUtaActions: () => client.drainUtaActions(AbortSignal.timeout(5_000)),
      presentUta: async (presentation) => {
        await client.presentUta(presentation, AbortSignal.timeout(15_000))
      },
      failUta: async (failure) => {
        await client.failUta(failure, AbortSignal.timeout(5_000))
      },
      utaManager: options.utaManager,
      tradingModePolicy: options.tradingModePolicy,
      warnUta: (message) => console.warn('[connector] UTA review request failed:', message),
    } : {}),
  }, intervalMs)
  return stop
}

export function attachConnectorActionBridge(
  inboxStore: IInboxStore,
  deps: ConnectorActionBridgeDeps,
  intervalMs = 1_500,
): () => void {
  let stopped = false
  let running = false
  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      await processConnectorArtifactRequests(inboxStore, deps)
      if (
        deps.drainUtaActions
        && deps.presentUta
        && deps.failUta
        && deps.utaManager
        && deps.tradingModePolicy
      ) {
        await processConnectorUtaRequests({
          isEnabled: deps.isEnabled,
          drainUtaActions: deps.drainUtaActions,
          presentUta: deps.presentUta,
          failUta: deps.failUta,
          warn: deps.warnUta ?? deps.warn,
          utaManager: deps.utaManager,
          tradingModePolicy: deps.tradingModePolicy,
          now: deps.now,
        })
      }
    } catch (error) {
      deps.warn(error instanceof Error ? error.message : String(error))
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => { void tick() }, intervalMs)
  timer.unref?.()
  void tick()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

export async function processConnectorArtifactRequests(
  inboxStore: IInboxStore,
  deps: ConnectorActionBridgeDeps,
): Promise<void> {
  if (!await deps.isEnabled()) return
  const requests = await deps.drainActions()
  const now = deps.now?.() ?? Date.now()
  for (const request of requests) {
    await fulfillArtifactRequest(inboxStore, deps, request, now)
  }
}

async function fulfillArtifactRequest(
  inboxStore: IInboxStore,
  deps: ConnectorActionBridgeDeps,
  request: ConnectorArtifactRequest,
  now: number,
): Promise<void> {
  const fail = async (reason: ConnectorArtifactFailure['reason'], displayName?: string) => {
    const failure: ConnectorArtifactFailure = {
      requestId: request.requestId,
      connectorId: request.connectorId,
      entryId: request.entryId,
      docIndex: request.docIndex,
      reason,
      message: artifactFailureMessage(reason, displayName),
    }
    try {
      await deps.failArtifact(failure)
    } catch (error) {
      deps.warn(error instanceof Error ? error.message : String(error))
    }
  }

  if (isConnectorActionExpired(request.createdAt, now)) {
    await fail('expired')
    return
  }

  const entry = await inboxStore.get(request.entryId)
  if (!entry) {
    await fail('entry_not_found')
    return
  }

  const displayName = entry.docs?.[request.docIndex]?.path
    ?.replace(/\\/g, '/')
    .split('/')
    .at(-1)
    ?.trim() || undefined
  const projection = await projectInboxDoc(entry, request.docIndex, deps.resolveWorkspace, deps.warn)
  if (!projection.ok) {
    await fail(projection.reason, displayName)
    return
  }

  try {
    await deps.deliverArtifact({
      requestId: request.requestId,
      connectorId: request.connectorId,
      entryId: request.entryId,
      docIndex: request.docIndex,
      attachment: projection.attachment,
    })
  } catch (error) {
    deps.warn(error instanceof Error ? error.message : String(error))
    await fail('delivery_failed', displayName)
  }
}
