import type { AgentAvailability } from './agent-detect.js';
import type { CliAdapter } from './cli-adapter.js';
import type { HeadlessTaskResult } from './headless-task.js';

export const RUNTIME_READINESS_PROMPT =
  'Reply with a short greeting. Do not use tools.';

export const RUNTIME_READINESS_TIMEOUT_MS = 45_000;

export type AgentRuntimeReadinessStatus =
  | 'unknown'
  | 'checking'
  | 'ready'
  | 'not_installed'
  | 'auth_required'
  | 'provider_required'
  | 'output_unrecognized'
  | 'timeout'
  | 'failed';

export type AgentRuntimeReadinessSource =
  | 'global-login'
  | 'global-config'
  | 'launcher-vault'
  | 'workspace-override'
  | 'managed-runtime'
  | 'unknown';

export type AgentRuntimeRepairTarget =
  | 'runtime-install'
  | 'cli-login'
  | 'ai-provider'
  | 'retry';

export interface AgentRuntimeReadinessRow {
  readonly agent: string
  readonly displayName: string
  readonly installed: boolean
  readonly binPath: string | null
  readonly status: AgentRuntimeReadinessStatus
  readonly ready: boolean
  readonly source: AgentRuntimeReadinessSource
  readonly checkedAt: string | null
  readonly durationMs: number | null
  readonly repairTarget?: AgentRuntimeRepairTarget
  readonly message?: string;
}

export interface AgentRuntimeReadinessSnapshot {
  readonly agents: Record<string, AgentRuntimeReadinessRow>
  readonly overallReady: boolean
  readonly checkedAt: string | null;
}

export function initialRuntimeReadinessRow(
  adapter: CliAdapter,
  availability: AgentAvailability | undefined,
): AgentRuntimeReadinessRow {
  const installed = availability?.installed ?? true;
  return {
    agent: adapter.id,
    displayName: adapter.displayName,
    installed,
    binPath: availability?.path ?? null,
    status: installed ? 'unknown' : 'not_installed',
    ready: false,
    source: 'unknown',
    checkedAt: null,
    durationMs: null,
    ...(installed ? {} : {
      repairTarget: 'runtime-install' as const,
      message: `${adapter.displayName} is not installed or not on PATH.`,
    }),
  };
}

export function checkingRuntimeReadinessRow(row: AgentRuntimeReadinessRow): AgentRuntimeReadinessRow {
  return {
    ...row,
    status: 'checking',
    ready: false,
    source: 'unknown',
    message: 'Checking runtime with a headless probe.',
  };
}

export function snapshotRuntimeReadiness(
  adapters: readonly CliAdapter[],
  availability: Record<string, AgentAvailability>,
  cache: ReadonlyMap<string, AgentRuntimeReadinessRow>,
): AgentRuntimeReadinessSnapshot {
  const rows = adapters.map((adapter) =>
    cache.get(adapter.id) ?? initialRuntimeReadinessRow(adapter, availability[adapter.id]),
  );
  const checked = rows
    .map((row) => row.checkedAt)
    .filter((value): value is string => value !== null)
    .sort();
  return {
    agents: Object.fromEntries(rows.map((row) => [row.agent, row])),
    overallReady: rows.some((row) => row.ready),
    checkedAt: checked.at(-1) ?? null,
  };
}

export function notInstalledRuntimeReadinessRow(
  adapter: CliAdapter,
  availability: AgentAvailability | undefined,
): AgentRuntimeReadinessRow {
  return {
    agent: adapter.id,
    displayName: adapter.displayName,
    installed: false,
    binPath: availability?.path ?? null,
    status: 'not_installed',
    ready: false,
    source: 'unknown',
    checkedAt: new Date().toISOString(),
    durationMs: null,
    repairTarget: 'runtime-install',
    message: `${adapter.displayName} is not installed or not on PATH.`,
  };
}

export function readyRuntimeReadinessRow(opts: {
  readonly adapter: CliAdapter
  readonly availability: AgentAvailability | undefined
  readonly source: AgentRuntimeReadinessSource
  readonly durationMs: number;
}): AgentRuntimeReadinessRow {
  return {
    agent: opts.adapter.id,
    displayName: opts.adapter.displayName,
    installed: true,
    binPath: opts.availability?.path ?? null,
    status: 'ready',
    ready: true,
    source: opts.source,
    checkedAt: new Date().toISOString(),
    durationMs: opts.durationMs,
    message: `${opts.adapter.displayName} replied to the readiness probe.`,
  };
}

export function failedRuntimeReadinessRow(opts: {
  readonly adapter: CliAdapter
  readonly availability: AgentAvailability | undefined
  readonly result: HeadlessTaskResult
  readonly source?: AgentRuntimeReadinessSource;
}): AgentRuntimeReadinessRow {
  const status = classifyRuntimeReadinessFailure(opts.result);
  return {
    agent: opts.adapter.id,
    displayName: opts.adapter.displayName,
    installed: true,
    binPath: opts.availability?.path ?? null,
    status,
    ready: false,
    source: opts.source ?? 'unknown',
    checkedAt: new Date().toISOString(),
    durationMs: opts.result.durationMs,
    repairTarget: repairTargetForStatus(status, opts.adapter.id),
    message: summarizeRuntimeReadinessFailure(opts.result, status),
  };
}

export function classifyRuntimeReadinessFailure(
  result: Pick<HeadlessTaskResult, 'killed' | 'exitCode' | 'stdoutTail' | 'stderrTail' | 'assistantText'>,
): AgentRuntimeReadinessStatus {
  if (result.killed) return 'timeout';
  const text = `${result.stderrTail}\n${result.stdoutTail}`.toLowerCase();
  if (/\b(unauthorized|unauthorised|forbidden|401|403|oauth|log in|login|sign in|signin|auth|authentication|not authenticated)\b/.test(text)) {
    return 'auth_required';
  }
  if (/(api[_ -]?key|base[_ -]?url|missing key|no key|no provider|missing provider|provider (?:is )?required|missing model|no model configured|model (?:is )?required|openai_api_key|anthropic_api_key)/.test(text)) {
    return 'provider_required';
  }
  if (result.exitCode !== 0) return 'failed';
  if (!result.assistantText?.trim()) return 'output_unrecognized';
  return 'failed';
}

export function runtimeProbeSucceeded(result: HeadlessTaskResult): boolean {
  if (result.killed || result.exitCode !== 0) return false;
  return Boolean(result.assistantText?.trim());
}

function repairTargetForStatus(
  status: AgentRuntimeReadinessStatus,
  agentId: string,
): AgentRuntimeRepairTarget {
  if (status === 'auth_required') {
    return agentId === 'claude' || agentId === 'codex' ? 'cli-login' : 'ai-provider';
  }
  if (status === 'provider_required') return 'ai-provider';
  if (status === 'not_installed') return 'runtime-install';
  return 'retry';
}

function summarizeRuntimeReadinessFailure(
  result: HeadlessTaskResult,
  status: AgentRuntimeReadinessStatus,
): string {
  if (status === 'timeout') {
    return 'The runtime did not finish the readiness probe before the timeout.';
  }
  if (status === 'output_unrecognized') {
    return 'The runtime exited successfully, but OpenAlice could not read an assistant reply from its structured output.';
  }
  const tail = `${result.stderrTail || result.stdoutTail}`.trim().replace(/\s+/g, ' ');
  const detail = tail ? ` ${tail.slice(0, 280)}` : '';
  if (status === 'auth_required') {
    return `The runtime appears to need CLI login or authentication.${detail}`;
  }
  if (status === 'provider_required') {
    return `The runtime appears to need provider or API-key configuration.${detail}`;
  }
  return `The runtime readiness probe failed.${detail}`;
}
