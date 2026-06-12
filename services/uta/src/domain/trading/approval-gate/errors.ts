export type ApprovalGateErrorCode =
  | 'approval_gate_config_invalid'
  | 'approval_gate_ticket_invalid'
  | 'approval_gate_ticket_expired'
  | 'approval_gate_ticket_missing'
  | 'approval_gate_ticket_ambiguous'
  | 'approval_gate_pending_commit_missing'
  | 'approval_gate_commit_binding_failed'
  | 'approval_gate_operation_denied'
  | 'approval_gate_notional_unproven'
  | 'approval_gate_notional_exceeded'
  | 'approval_gate_exit_plan_missing'
  | 'approval_gate_cancel_symbol_unknown'

export class ApprovalGateError extends Error {
  readonly name = 'ApprovalGateError'
  readonly gate = 'approvalGate'

  constructor(
    readonly code: ApprovalGateErrorCode,
    message: string,
    readonly details: Record<string, string | number | boolean> = {},
  ) {
    super(message)
  }
}

export function isApprovalGateError(error: unknown): error is ApprovalGateError {
  return error instanceof ApprovalGateError ||
    (
      typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'ApprovalGateError' &&
      typeof (error as { code?: unknown }).code === 'string'
    )
}
