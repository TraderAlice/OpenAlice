import type {
  GovernanceBuildDecisionPacketInput,
  GovernanceBuildDecisionPacketResult,
  GovernanceReasonCode,
  GovernanceReplayRuntimeStateInput,
  GovernanceReplayRuntimeStateResult,
  GovernanceValidateDecisionPacketInput,
  GovernanceValidateDecisionPacketResult,
  GovernanceVerifyFreezeManifestInput,
  GovernanceVerifyFreezeManifestResult,
} from '../../core/ports/governance-port.js'
import type {
  GovernanceServiceContract,
  GovernanceServiceDeps,
} from './types.js'

export class GovernanceService implements GovernanceServiceContract {
  constructor(private readonly deps: GovernanceServiceDeps) {}

  buildDecisionPacket(
    input: GovernanceBuildDecisionPacketInput,
  ): Promise<GovernanceBuildDecisionPacketResult> {
    return this.deps.port.buildDecisionPacket(input)
  }

  validateDecisionPacket(
    input: GovernanceValidateDecisionPacketInput,
  ): Promise<GovernanceValidateDecisionPacketResult> {
    return this.deps.port.validateDecisionPacket(input)
  }

  replayRuntimeState(
    input: GovernanceReplayRuntimeStateInput,
  ): Promise<GovernanceReplayRuntimeStateResult> {
    return this.deps.port.replayRuntimeState(input)
  }

  verifyFreezeManifest(
    input: GovernanceVerifyFreezeManifestInput,
  ): Promise<GovernanceVerifyFreezeManifestResult> {
    return this.deps.port.verifyFreezeManifest(input)
  }

  listReasonCodes(): Promise<GovernanceReasonCode[]> {
    return this.deps.port.listReasonCodes()
  }
}

export function createGovernanceService(
  deps: GovernanceServiceDeps,
): GovernanceServiceContract {
  return new GovernanceService(deps)
}
