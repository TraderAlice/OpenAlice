/**
 * The Alice Project's optional Telegram phone-desk Issue.
 *
 * One file, one Project. Generic issue create/update cannot set the flag.
 * Settings enable-chat is the only writer.
 */
import { createIssue, updateIssueFields, type MutateResult } from './mutate.js'
import {
  isTelegramConnectorIssue,
  readWorkspaceIssues,
  type IssueRecord,
} from './declaration.js'

export const TELEGRAM_CONNECTOR_ISSUE_ID = 'telegram-phone-desk'

export const TELEGRAM_CONNECTOR_DEFAULT_WHEN = { kind: 'every' as const, every: '4h' }

/** Product-supported heartbeat choices. Keep this invariant in the domain:
 * Settings is the ordinary writer, but direct HTTP callers must not be able to
 * persist a cadence the product cannot subsequently represent. */
export const TELEGRAM_CONNECTOR_CADENCES = ['1h', '2h', '4h', '8h', '12h', '24h'] as const
export type TelegramConnectorCadence = typeof TELEGRAM_CONNECTOR_CADENCES[number]

export function isTelegramConnectorCadence(value: string): value is TelegramConnectorCadence {
  return TELEGRAM_CONNECTOR_CADENCES.some((cadence) => cadence === value)
}

export const TELEGRAM_CONNECTOR_DEFAULT_WHAT = [
  'You are the Telegram phone desk for this Workspace.',
  '',
  'On each scheduled wake, read this Issue\'s recent comments (the chat with the human).',
  'If the human needs a message, write that message as your reply.',
  'If there is nothing to say, reply with [[no-reply]] and a brief reason.',
].join('\n')

export interface TelegramConnectorDesk {
  wsId: string
  issue: IssueRecord
}

export async function findTelegramConnectorDesks(
  workspaces: readonly { id: string; dir: string }[],
): Promise<TelegramConnectorDesk[]> {
  const found: TelegramConnectorDesk[] = []
  for (const workspace of workspaces) {
    const read = await readWorkspaceIssues(workspace.dir)
    if (!read.ok) continue
    for (const issue of read.issues) {
      if (isTelegramConnectorIssue(issue)) found.push({ wsId: workspace.id, issue })
    }
  }
  return found.sort((left, right) =>
    left.wsId.localeCompare(right.wsId) || left.issue.id.localeCompare(right.issue.id),
  )
}

export function extraTelegramConnectorDeskKeys(
  desks: readonly TelegramConnectorDesk[],
): Set<string> {
  return new Set(desks.slice(1).map((desk) => `${desk.wsId}:${desk.issue.id}`))
}

export async function createTelegramConnectorDesk(
  workspace: { id: string; dir: string },
  workspaces: readonly { id: string; dir: string }[],
): Promise<
  | { ok: true; issue: IssueRecord }
  | { ok: false; reason: 'conflict'; id: string; wsId: string }
  | { ok: false; reason: 'invalid'; error: string }
> {
  const existing = await findTelegramConnectorDesks(workspaces)
  if (existing[0]) {
    return { ok: false, reason: 'conflict', id: existing[0].issue.id, wsId: existing[0].wsId }
  }

  const local = await readWorkspaceIssues(workspace.dir)
  const leftover = local.ok
    ? local.issues.find((issue) => issue.id === TELEGRAM_CONNECTOR_ISSUE_ID)
    : undefined
  if (leftover) {
    const revived = await updateIssueFields(workspace.dir, leftover.id, {
      status: leftover.status === 'canceled' ? 'todo' : leftover.status,
      when: leftover.when ?? TELEGRAM_CONNECTOR_DEFAULT_WHEN,
      telegramConnector: true,
    }, { allowTelegramConnector: true })
    if (!revived.ok) {
      return revived.reason === 'invalid'
        ? revived
        : { ok: false, reason: 'invalid', error: 'Telegram phone desk could not be re-enabled' }
    }
    return { ok: true, issue: revived.issue }
  }

  const created = await createIssue(workspace.dir, {
    id: TELEGRAM_CONNECTOR_ISSUE_ID,
    title: 'Telegram phone desk',
    assignee: '@new-then-resume',
    when: TELEGRAM_CONNECTOR_DEFAULT_WHEN,
    what: TELEGRAM_CONNECTOR_DEFAULT_WHAT,
    telegramConnector: true,
  }, { allowTelegramConnector: true })
  if (!created.ok && created.reason === 'conflict') {
    return { ok: false, reason: 'invalid', error: `issue ${created.id} already exists` }
  }
  return created
}

export async function updateTelegramConnectorDesk(
  wsDir: string,
  id: string,
  patch: { what?: string; when?: { kind: 'every'; every: TelegramConnectorCadence } },
): Promise<MutateResult> {
  if (patch.when && !isTelegramConnectorCadence(patch.when.every)) {
    return {
      ok: false,
      reason: 'invalid',
      error: `Unsupported Telegram phone-desk cadence: ${patch.when.every}`,
    }
  }
  return updateIssueFields(wsDir, id, patch)
}

export async function disableTelegramConnectorDesk(
  wsDir: string,
  id: string,
): Promise<MutateResult> {
  return updateIssueFields(
    wsDir,
    id,
    { status: 'canceled', telegramConnector: null },
    { allowTelegramConnector: true },
  )
}
