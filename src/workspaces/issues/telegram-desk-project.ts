import { ConnectorClient } from '@traderalice/connector-protocol'

import { resolveConnectorUrl } from '../../services/connector-client/index.js'
import type { IssueComment } from './comments.js'
import { isTelegramConnectorIssue } from './declaration.js'

export const TELEGRAM_NO_REPLY_TAG = '[[no-reply]]'

export function containsTelegramNoReply(text: string): boolean {
  return text.includes(TELEGRAM_NO_REPLY_TAG)
}

export function shouldProjectDeskComment(
  issue: { telegramConnector?: true },
  comment: IssueComment,
): boolean {
  return isTelegramConnectorIssue(issue)
    && comment.via !== 'telegram'
    && !containsTelegramNoReply(comment.markdown)
}

export async function projectDeskComment(
  issue: { telegramConnector?: true },
  comment: IssueComment,
  client: ConnectorClient = new ConnectorClient(resolveConnectorUrl()),
): Promise<void> {
  if (!shouldProjectDeskComment(issue, comment)) return
  await client.sendOwnerMessage({
    id: `desk-${comment.id}`,
    adapterId: 'telegram',
    text: comment.markdown.slice(0, 4096),
  }, AbortSignal.timeout(5_000))
}
