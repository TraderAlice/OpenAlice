/**
 * Worker Preamble — injects the strict Orca orchestration worker contract
 * into every dispatched worker's initial prompt.
 */

export interface WorkerPreambleInput {
  readonly taskId: string
  readonly dispatchId: string
  readonly parentResumeId: string
  readonly workerWorkspaceId: string
  readonly spec: string
}

export function buildWorkerPreamble(input: WorkerPreambleInput): string {
  return [
    '[Orchestration Worker Contract]',
    `Task ID: ${input.taskId}`,
    `Dispatch ID: ${input.dispatchId}`,
    `Parent Session: ${input.parentResumeId}`,
    `Worker Workspace: ${input.workerWorkspaceId}`,
    '',
    'Required protocol — you MUST end every turn with one of these two CLI actions:',
    '1. Need a decision, approval, or clarification from your coordinator:',
    `   alice orchestration ask --dispatch ${input.dispatchId} --body "<question>"`,
    '   Then end your turn immediately. You will be woken automatically when your coordinator replies.',
    '2. Finished (or blocked/inconclusive) and ready to report results:',
    `   alice orchestration worker-done --dispatch ${input.dispatchId} --outcome completed|failed|inconclusive --summary "<summary>" [--evidence "<evidence>"]`,
    '   Then end your turn immediately.',
    '',
    'IMPORTANT: Do NOT exit with plain text without calling `ask` or `worker-done`. Exiting without calling either triggers an escalation (`stopped_without_done`) to your coordinator.',
    '',
    '---',
    '',
    'Task Specification:',
    input.spec,
  ].join('\n')
}
