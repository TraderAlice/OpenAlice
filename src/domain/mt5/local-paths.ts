import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export interface JmbMt5Roots {
  bridgeRoot: string
  ledgerRoot: string
  policyRoot: string
  costModelRoot: string
  executionDecisionRoot: string
  executionRoot: string
  researchRoot: string
}

export interface ResolveJmbMt5RootsOptions extends Partial<JmbMt5Roots> {
  commonFilesRoot?: string
  env?: NodeJS.ProcessEnv
  homeDirectory?: string
}

function requireAbsoluteCommonFilesRoot(root: string | undefined): string {
  if (root === undefined || !isAbsolute(root)) {
    throw new Error('An absolute Common Files root is required for JMB MT5 local artifacts.')
  }
  return root
}

function explicitOrDerived(explicit: string | undefined, commonFilesRoot: string, directory: string): string {
  return explicit ?? join(commonFilesRoot, directory)
}

export function resolveJmbMt5Roots(options: ResolveJmbMt5RootsOptions = {}): JmbMt5Roots {
  const env = options.env ?? process.env
  const commonFilesRoot = requireAbsoluteCommonFilesRoot(
    options.commonFilesRoot
      ?? env['OPENALICE_MT5_COMMON_FILES_ROOT']
      ?? (env['APPDATA'] === undefined
        ? undefined
        : join(env['APPDATA'], 'MetaQuotes', 'Terminal', 'Common', 'Files')),
  )
  const homeDirectory = options.homeDirectory ?? homedir()

  return {
    bridgeRoot: explicitOrDerived(options.bridgeRoot, commonFilesRoot, 'OpenAliceMt5BridgeV1'),
    ledgerRoot: explicitOrDerived(options.ledgerRoot, commonFilesRoot, 'OpenAliceMt5TradeLedgerV1'),
    policyRoot: explicitOrDerived(options.policyRoot, commonFilesRoot, 'OpenAliceMt5DemoPolicyV1'),
    costModelRoot: explicitOrDerived(options.costModelRoot, commonFilesRoot, 'OpenAliceMt5CostModelV1'),
    executionDecisionRoot: explicitOrDerived(options.executionDecisionRoot, commonFilesRoot, 'OpenAliceMt5ExecutionDecisionV1'),
    executionRoot: explicitOrDerived(options.executionRoot, commonFilesRoot, 'OpenAliceMt5ExecutionV1'),
    researchRoot: options.researchRoot
      ?? env['OPENALICE_RESEARCH_ROOT']
      ?? join(homeDirectory, '.openalice', 'data', 'research'),
  }
}
