export interface MachinePlan {
  id: string
  mode: 'add' | 'upgrade'
  machine: { key: string | null; label: string; sshTarget: string }
  project: { key: string; displayName: string } | null
  platform: string
  activeVersion: string | null
  installedVersion: string
  targetVersion: string
  runtime: string
  actions: string[]
  blocker: string | null
  deferredUpdate: boolean
  expiresAt: string
}

export interface MachineOperation {
  id: string
  planId: string
  mode: 'add' | 'upgrade'
  phase: 'running' | 'succeeded' | 'failed'
  stage: 'checking' | 'installing' | 'verifying-install' | 'preparing-source' | 'restarting' | 'verifying'
  startedAt: string
  error: string | null
}

export type MachinePlanInput = {
  mode: 'add' | 'upgrade'
  sshTarget?: string
  label?: string
  sshPort?: number
  identityFile?: string
  machineKey?: string
  projectKey?: string
}

