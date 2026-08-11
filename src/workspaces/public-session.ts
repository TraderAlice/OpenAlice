import type { ModelReasoningEffort } from '../ai-providers/model-semantics.js';
import type { SessionRuntimeBinding } from './cli-adapter.js';
import { sessionPreferredTitle, type SessionRecord } from './session-registry.js';

export interface PublicSessionRuntime {
  readonly credentialSource: 'native' | 'vault' | 'workspace';
  readonly credentialSlug?: string;
  readonly model?: string;
  readonly reasoningEffort?: ModelReasoningEffort;
}

export interface PublicSession {
  readonly id: string;
  readonly wsId: string;
  readonly agent: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lastActiveAt: string;
  readonly state: 'running' | 'paused';
  readonly surface: 'terminal' | 'webpi';
  readonly resumeId: string;
  readonly pid: number | null;
  readonly startedAt: number | null;
  readonly title: string | null;
  readonly sourceRunId: string | null;
  readonly runtime?: PublicSessionRuntime;
}

interface LiveSessionProjection {
  readonly pid: number | null;
  readonly startedAt: number;
}

export interface PublicSessionProjectionContext {
  readonly terminal?: LiveSessionProjection | null;
  readonly webPi?: LiveSessionProjection | null;
  readonly runtimeBinding?: SessionRuntimeBinding | null;
}

/**
 * Canonical secret-free Session projection shared by every Workspace API.
 * Missing runtime metadata stays missing: callers must not reinterpret an
 * unknown historical binding as an explicit native/runtime-default choice.
 */
export function projectPublicSession(
  record: SessionRecord,
  context: PublicSessionProjectionContext = {},
): PublicSession {
  const terminal = context.terminal ?? null;
  const webPi = context.webPi ?? null;
  const binding = context.runtimeBinding ?? null;

  return {
    id: record.id,
    wsId: record.wsId,
    agent: record.agent,
    name: record.name,
    createdAt: record.createdAt,
    lastActiveAt: record.lastActiveAt,
    state: record.state === 'running' && (terminal || webPi) ? 'running' : 'paused',
    surface: webPi ? 'webpi' : (record.surface ?? 'terminal'),
    resumeId: record.resumeId,
    pid: terminal?.pid ?? webPi?.pid ?? null,
    startedAt: terminal?.startedAt ?? webPi?.startedAt ?? null,
    title: sessionPreferredTitle(record) ?? null,
    sourceRunId: record.sourceRunId ?? null,
    ...(binding
      ? {
          runtime: {
            credentialSource: binding.credential.source,
            ...(binding.credential.source === 'vault'
              ? { credentialSlug: binding.credential.credentialSlug }
              : {}),
            ...(binding.model ? { model: binding.model } : {}),
            ...(binding.reasoningEffort ? { reasoningEffort: binding.reasoningEffort } : {}),
          },
        }
      : {}),
  };
}
