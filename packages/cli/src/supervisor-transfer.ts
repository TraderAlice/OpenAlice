import { posix } from 'node:path'

import type { MachineInventory, MachineProjectInventory } from './machine-inventory.ts'
import type { ProjectTransferPlan } from './project-transfer.ts'
import type { ProjectTransferReceipt } from './project-transfer-stream.ts'

export type TransferWizardPhase =
  | 'destination'
  | 'project-key'
  | 'home'
  | 'credentials'
  | 'issue-policy'
  | 'planning'
  | 'review'
  | 'transferring'
  | 'success'
  | 'failed'

export interface SupervisorTransferWizardState {
  phase: TransferWizardPhase
  source: MachineProjectInventory
  destinations: MachineInventory[]
  destinationIndex: number
  projectKey: string
  destinationHome: string
  credentials: 'include' | 'omit'
  issuePolicy: 'keep-blocked' | 'new-then-resume'
  plan: ProjectTransferPlan | null
  receipt: ProjectTransferReceipt | null
  error: string | null
}

export function createSupervisorTransferWizard(
  source: MachineProjectInventory,
  machines: MachineInventory[],
): SupervisorTransferWizardState {
  const destinations = machines.filter((machine) => (
    machine.key !== 'local'
    && machine.connection === 'online'
    && machine.capabilities.transferReceive
    && machine.capabilities.credentialReseal
  ))
  const projectKey = suggestedProjectKey(source.key, destinations[0])
  return {
    phase: 'destination',
    source,
    destinations,
    destinationIndex: 0,
    projectKey,
    destinationHome: suggestedRemoteHome(projectKey, destinations[0]),
    credentials: 'include',
    issuePolicy: 'keep-blocked',
    plan: null,
    receipt: null,
    error: null,
  }
}

export function selectedTransferDestination(
  state: SupervisorTransferWizardState,
): MachineInventory | undefined {
  return state.destinations[state.destinationIndex]
}

export function selectTransferDestination(
  state: SupervisorTransferWizardState,
  machineKey: string,
): void {
  const destinationIndex = state.destinations.findIndex((machine) => machine.key === machineKey)
  if (destinationIndex < 0) return
  const destination = state.destinations[destinationIndex]!
  const projectKey = suggestedProjectKey(state.source.key, destination)
  state.destinationIndex = destinationIndex
  state.projectKey = projectKey
  state.destinationHome = suggestedRemoteHome(projectKey, destination)
}

export function renderTransferPlanReview(plan: ProjectTransferPlan, width: number): string[] {
  const sessionFiles = plan.excluded
    .filter((entry) => entry.reason === 'session-plane' || entry.reason === 'untracked-session-dossier')
    .reduce((sum, entry) => sum + entry.files, 0)
  const credentials = plan.policy.credentials === 'omit'
    ? 'Omitted; integrations need setup'
    : `${plan.credentials.ai.count} AI · ${plan.credentials.broker.count} broker · ${plan.credentials.connector.count} Connector · ${plan.credentials.providerKeys.count} provider`
  const lines = [
    'Review AliceProject transfer',
    '',
    `From      ${plan.source.displayName} (${plan.source.key})`,
    `To        ${plan.destination.machineKey} / ${plan.destination.displayName}`,
    `Home      ${plan.destination.home}`,
    `Portable  ${plan.portable.files} files · ${formatBytes(plan.portable.bytes)}`,
    `Space     ${formatBytes(plan.destination.requiredFreeBytes)} required`,
    `Secrets   ${credentials}`,
    `Sessions  0 imported · ${sessionFiles} runtime file(s) excluded`,
    `Issues    ${plan.scheduledIssues.length} exact owner(s) · ${plan.policy.scheduledIssues}`,
    '',
    'Source stays unchanged. Destination is new; Runtime will not auto-start.',
  ]
  if (plan.blockers.length > 0) {
    lines.push('', 'Blocked:', ...plan.blockers.map((blocker) => `• ${blocker.message}`))
  }
  lines.push('', plan.readyToApply ? 'y / Enter  Transfer · n / Esc  Cancel' : 'Esc  Close')
  return lines.map((line) => truncate(line, width))
}

export function renderTransferResult(
  receipt: ProjectTransferReceipt,
  machineName: string,
  projectName: string,
  width: number,
): string[] {
  return [
    'AliceProject transfer complete',
    '',
    `${machineName} / ${projectName}`,
    receipt.destinationHome,
    `${receipt.files} files · ${formatBytes(receipt.bytes)} · Sessions imported: 0`,
    '',
    'The source remains unchanged. The remote Runtime is stopped.',
    '',
    's  Start · o  Connect/Open · Enter  Done',
  ].map((line) => truncate(line, width))
}

function suggestedProjectKey(sourceKey: string, machine?: MachineInventory): string {
  if (sourceKey !== 'default' && !machine?.projects.some((project) => project.key === sourceKey)) return sourceKey
  const base = `${sourceKey}-copy`.slice(0, 32).replace(/-$/u, '')
  if (!machine?.projects.some((project) => project.key === base)) return base
  return `${sourceKey.slice(0, 27)}-copy2`
}

function suggestedRemoteHome(projectKey: string, machine?: MachineInventory): string {
  const defaultProject = machine?.projects.find((project) => project.isDefault) ?? machine?.projects[0]
  const parent = defaultProject ? posix.dirname(defaultProject.home) : '/home/openalice'
  return posix.join(parent, `.openalice-${projectKey}`)
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value
  return width < 2 ? value.slice(0, width) : `${value.slice(0, width - 1)}…`
}
