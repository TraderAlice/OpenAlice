import type {
  GovernanceBuildDecisionPacketInput,
  GovernanceBuildDecisionPacketResult,
  GovernancePort,
  GovernanceReasonCode,
  GovernanceReplayRuntimeStateInput,
  GovernanceReplayRuntimeStateResult,
  GovernanceValidateDecisionPacketInput,
  GovernanceValidateDecisionPacketResult,
  GovernanceVerifyFreezeManifestInput,
  GovernanceVerifyFreezeManifestResult,
} from '../../core/ports/governance-port.js'

export interface GovernanceServiceDeps {
  port: GovernancePort
}

export interface GovernanceServiceContract {
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
