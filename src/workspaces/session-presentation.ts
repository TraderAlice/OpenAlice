import type { HeadlessTaskRecord } from './headless-task-registry.js';
import type { SessionCreatedBy } from './session-metadata.js';
import { sessionPreferredTitle, type SessionRecord } from './session-registry.js';

const ISSUE_ID_SPLIT = /[-_]+/u;
const PREVIEW_TITLE_LIMIT = 120;

type PresentationRecord = Pick<
  SessionRecord,
  'resumeId' | 'name' | 'surface' | 'sourceRunId' | 'title' | 'fallbackTitle'
>;

type PresentationExecution = Pick<HeadlessTaskRecord, 'trigger' | 'inquiry' | 'output'>;

export interface SessionPresentationInput {
  readonly record: PresentationRecord;
  readonly createdBy?: SessionCreatedBy;
  readonly latestExecution?: PresentationExecution | null;
  /** Optional live Issue-title resolver. The readable Issue id remains the safe fallback. */
  readonly issueTitleFor?: (workspaceId: string, issueId: string) => string | undefined;
}

/**
 * Public, read-side Session title projection.
 *
 * Persisted launcher/native titles remain untouched. Structured product
 * provenance wins only when it proves that the stored launch title belongs to
 * an Issue or reconstructed inquiry; direct and interactive prompts retain the
 * historical title contract.
 */
export function projectSessionPresentationTitle(input: SessionPresentationInput): string | undefined {
  const { record, createdBy, latestExecution } = input;

  if (createdBy?.kind === 'issue') {
    return issueTitle(input, createdBy.workspaceId, createdBy.issueId);
  }

  if (createdBy?.kind === 'conversation') {
    const subject = createdBy.subject;
    if (subject?.kind === 'issue') {
      return issueTitle(input, subject.workspaceId, subject.issueId);
    }
    const question = normalizedPreview(latestExecution?.inquiry?.question);
    if (question) return question;
  }

  // Before immutable birth provenance shipped, a headless launcher record and
  // its execution registry still formed a structured pair. Restrict this
  // fallback to headless-born records so a later scheduled turn cannot rename
  // an ordinary interactive conversation.
  const mayUseExecutionSource = createdBy?.kind === 'headless'
    || (!createdBy && (record.surface === 'headless' || Boolean(record.sourceRunId)));
  if (mayUseExecutionSource) {
    const subject = latestExecution?.inquiry?.subject;
    if (subject?.kind === 'issue') {
      return issueTitle(input, subject.workspaceId, subject.issueId);
    }
    if (latestExecution?.trigger?.kind === 'issue') {
      return issueTitle(input, latestExecution.trigger.workspaceId, latestExecution.trigger.issueId);
    }
    const question = normalizedPreview(latestExecution?.inquiry?.question);
    if (question) return question;
  }

  const stored = sessionPreferredTitle(record);
  if (stored) return stored;

  const assistantPreview = normalizedPreview(latestExecution?.output?.assistantPreview);
  if (assistantPreview) return assistantPreview;
  return undefined;
}

export function readableIssueIdentity(issueId: string): string {
  const trimmed = issueId.trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split(ISSUE_ID_SPLIT).filter(Boolean);
  if (parts.length === 0) return trimmed;
  return parts.map(titleCaseIssuePart).join(' ');
}

function issueTitle(
  input: SessionPresentationInput,
  workspaceId: string,
  issueId: string,
): string {
  const liveTitle = input.issueTitleFor?.(workspaceId, issueId)?.trim();
  return liveTitle || readableIssueIdentity(issueId);
}

function normalizedPreview(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/gu, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > PREVIEW_TITLE_LIMIT
    ? `${normalized.slice(0, PREVIEW_TITLE_LIMIT - 1)}…`
    : normalized;
}

function titleCaseIssuePart(part: string): string {
  if (part.length === 0) return part;
  if (part === part.toUpperCase() && /[A-Za-z]/u.test(part)) return part;
  if (!/[A-Za-z]/u.test(part)) return part;
  return part.charAt(0).toUpperCase() + part.slice(1);
}
