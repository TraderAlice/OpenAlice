export { GovernanceService, createGovernanceService } from './governance-service.js'
export type { GovernanceServiceContract, GovernanceServiceDeps } from './types.js'
export { createGovernanceGatedDispatcher, enforceGovernanceReleaseGate } from './trading-gate.js'
