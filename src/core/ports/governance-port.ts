export type GovernanceVerdict = 'GO' | 'GO_WITH_CONSTRAINTS' | 'NO_GO'

export interface GovernanceReasonCode {
  code: string
  severity: 'hard' | 'soft'
  description?: string
}

export interface GovernanceBuildDecisionPacketInput {
  campaignId: string
  outDir: string
  freezeManifestPath?: string
  allowMissingSoft?: boolean
}

export interface GovernanceBuildDecisionPacketResult {
  ok: boolean
  packetDir: string
  missingArtifacts: string[]
  exitCode: number
}

export interface GovernanceValidateDecisionPacketInput {
  packetDir: string
  thresholdsPath?: string
  freezeManifestPath?: string
}

export interface GovernanceValidateDecisionPacketResult {
  ok: boolean
  verdict: GovernanceVerdict
  reasonCodes: string[]
  exitCode: number
}

export interface GovernanceReplayRuntimeStateInput {
  stateLogPath: string
  stateSpecVersion?: string
}

export interface GovernanceReplayRuntimeStateResult {
  ok: boolean
  deterministic: boolean
  violations: string[]
  exitCode: number
}

export interface GovernanceVerifyFreezeManifestInput {
  manifestPath: string
  schemaPath?: string
}

export interface GovernanceVerifyFreezeManifestResult {
  ok: boolean
  issues: string[]
  exitCode: number
}

export interface GovernancePort {
  buildDecisionPacket(
    input: GovernanceBuildDecisionPacketInput,
  ): Promise<GovernanceBuildDecisionPacketResult>

  validateDecisionPacket(
    input: GovernanceValidateDecisionPacketInput,
  ): Promise<GovernanceValidateDecisionPacketResult>

  replayRuntimeState(
    input: GovernanceReplayRuntimeStateInput,
  ): Promise<GovernanceReplayRuntimeStateResult>

  verifyFreezeManifest(
    input: GovernanceVerifyFreezeManifestInput,
  ): Promise<GovernanceVerifyFreezeManifestResult>

  listReasonCodes(): Promise<GovernanceReasonCode[]>
}
