/**
 * One phone-desk Issue per connector. The execution specimen is shared;
 * each adapter owns its own work item, comments, and Session.
 *
 * Generic issue create/update cannot set the flag. Settings enable-chat
 * on that connector card is the only writer.
 */
import { createIssue, updateIssueFields, type MutateResult } from './mutate.js'
import {
  isConnectorDeskIssue,
  readWorkspaceIssues,
  type IssueRecord,
} from './declaration.js'

export const CONNECTOR_DESK_DEFAULT_WHEN = { kind: 'every' as const, every: '4h' }

export const CONNECTOR_DESK_CADENCES = ['1h', '2h', '4h', '8h', '12h', '24h'] as const
export type ConnectorDeskCadence = typeof CONNECTOR_DESK_CADENCES[number]

/** @deprecated Use {@link CONNECTOR_DESK_CADENCES}. */
export const TELEGRAM_CONNECTOR_CADENCES = CONNECTOR_DESK_CADENCES
export type TelegramConnectorCadence = ConnectorDeskCadence

export function connectorDeskIssueId(connectorId: string): string {
  return `${connectorId}-phone-desk`
}

export function isConnectorDeskCadence(value: string): value is ConnectorDeskCadence {
  return CONNECTOR_DESK_CADENCES.some((cadence) => cadence === value)
}

/** @deprecated Use {@link isConnectorDeskCadence}. */
export function isTelegramConnectorCadence(value: string): value is ConnectorDeskCadence {
  return isConnectorDeskCadence(value)
}

export function connectorDeskDefaultWhat(label: string): string {
  return [
    `You are the ${label} phone desk for this Workspace.`,
    '',
    'On each scheduled wake, read this Issue\'s recent comments (the chat with the human).',
    'If the human needs a message, write that message as your reply.',
    'If there is nothing to say, reply with [[no-reply]] and a brief reason.',
  ].join('\n')
}

export const TELEGRAM_CONNECTOR_ISSUE_ID = connectorDeskIssueId('telegram')
export const TELEGRAM_CONNECTOR_DEFAULT_WHEN = CONNECTOR_DESK_DEFAULT_WHEN
export const TELEGRAM_CONNECTOR_DEFAULT_WHAT = connectorDeskDefaultWhat('Telegram')

export interface ConnectorDesk {
  wsId: string
  connectorId: string
  issue: IssueRecord
}

/** @deprecated Use {@link ConnectorDesk}. */
export type TelegramConnectorDesk = ConnectorDesk

export async function findConnectorDesks(
  workspaces: readonly { id: string; dir: string }[],
  connectorId?: string,
): Promise<ConnectorDesk[]> {
  const found: ConnectorDesk[] = []
  for (const workspace of workspaces) {
    const read = await readWorkspaceIssues(workspace.dir)
    if (!read.ok) continue
    for (const issue of read.issues) {
      if (!isConnectorDeskIssue(issue)) continue
      if (connectorId && issue.connectorDesk !== connectorId) continue
      found.push({ wsId: workspace.id, connectorId: issue.connectorDesk, issue })
    }
  }
  return found.sort((left, right) =>
    left.connectorId.localeCompare(right.connectorId)
    || left.wsId.localeCompare(right.wsId)
    || left.issue.id.localeCompare(right.issue.id),
  )
}

export async function findTelegramConnectorDesks(
  workspaces: readonly { id: string; dir: string }[],
): Promise<ConnectorDesk[]> {
  return findConnectorDesks(workspaces, 'telegram')
}

/** Project-wide extras after the first desk for each connector. */
export function extraConnectorDeskKeys(desks: readonly ConnectorDesk[]): Set<string> {
  const extras = new Set<string>()
  const seen = new Set<string>()
  for (const desk of desks) {
    if (seen.has(desk.connectorId)) extras.add(`${desk.wsId}:${desk.issue.id}`)
    else seen.add(desk.connectorId)
  }
  return extras
}

/** @deprecated Use {@link extraConnectorDeskKeys}. */
export function extraTelegramConnectorDeskKeys(desks: readonly ConnectorDesk[]): Set<string> {
  return extraConnectorDeskKeys(desks)
}

export async function createConnectorDesk(
  connectorId: string,
  label: string,
  workspace: { id: string; dir: string },
  workspaces: readonly { id: string; dir: string }[],
): Promise<
  | { ok: true; issue: IssueRecord }
  | { ok: false; reason: 'conflict'; id: string; wsId: string }
  | { ok: false; reason: 'invalid'; error: string }
> {
  const existing = await findConnectorDesks(workspaces, connectorId)
  if (existing[0]) {
    return { ok: false, reason: 'conflict', id: existing[0].issue.id, wsId: existing[0].wsId }
  }

  const reservedId = connectorDeskIssueId(connectorId)
  const local = await readWorkspaceIssues(workspace.dir)
  const leftover = local.ok
    ? local.issues.find((issue) => issue.id === reservedId)
    : undefined
  if (leftover) {
    const revived = await updateIssueFields(workspace.dir, leftover.id, {
      status: leftover.status === 'canceled' ? 'todo' : leftover.status,
      when: leftover.when ?? CONNECTOR_DESK_DEFAULT_WHEN,
      connectorDesk: connectorId,
      ...(leftover.commentPrompt ? {} : { commentPrompt: '{comment}' }),
    }, { allowConnectorDesk: true })
    if (!revived.ok) {
      return revived.reason === 'invalid'
        ? revived
        : { ok: false, reason: 'invalid', error: `${label} phone desk could not be re-enabled` }
    }
    return { ok: true, issue: revived.issue }
  }

  const created = await createIssue(workspace.dir, {
    id: reservedId,
    title: `${label} phone desk`,
    assignee: '@new-then-resume',
    when: CONNECTOR_DESK_DEFAULT_WHEN,
    what: connectorDeskDefaultWhat(label),
    commentPrompt: '{comment}',
    connectorDesk: connectorId,
  }, { allowConnectorDesk: true })
  if (!created.ok && created.reason === 'conflict') {
    return { ok: false, reason: 'invalid', error: `issue ${created.id} already exists` }
  }
  return created
}

export async function createTelegramConnectorDesk(
  workspace: { id: string; dir: string },
  workspaces: readonly { id: string; dir: string }[],
): Promise<
  | { ok: true; issue: IssueRecord }
  | { ok: false; reason: 'conflict'; id: string; wsId: string }
  | { ok: false; reason: 'invalid'; error: string }
> {
  return createConnectorDesk('telegram', 'Telegram', workspace, workspaces)
}

export async function updateConnectorDesk(
  wsDir: string,
  id: string,
  patch: { what?: string; when?: { kind: 'every'; every: string } },
): Promise<MutateResult> {
  if (patch.when && !isConnectorDeskCadence(patch.when.every)) {
    return {
      ok: false,
      reason: 'invalid',
      error: `Unsupported phone-desk cadence: ${patch.when.every}`,
    }
  }
  return updateIssueFields(wsDir, id, patch)
}

export async function updateTelegramConnectorDesk(
  wsDir: string,
  id: string,
  patch: { what?: string; when?: { kind: 'every'; every: string } },
): Promise<MutateResult> {
  return updateConnectorDesk(wsDir, id, patch)
}

export async function disableConnectorDesk(
  wsDir: string,
  id: string,
): Promise<MutateResult> {
  return updateIssueFields(
    wsDir,
    id,
    { status: 'canceled', connectorDesk: null },
    { allowConnectorDesk: true },
  )
}

export async function disableTelegramConnectorDesk(
  wsDir: string,
  id: string,
): Promise<MutateResult> {
  return disableConnectorDesk(wsDir, id)
}
