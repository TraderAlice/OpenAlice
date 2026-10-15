import { expect, it } from 'vitest'
import { selectWorkspaceUpdateGuidance } from './guidance'

it('guides to manual updates while leaving automatic active-work waits in place', () => {
  const workspaces = [
    { id: 'chat', template: 'chat', upgradeAvailable: { to: '1.8.9' } },
    { id: 'aq', template: 'auto-quant-v2', upgradeAvailable: { to: '0.8.32' } },
    { id: 'ap', template: 'auto-prediction', upgradeAvailable: { to: '0.4.1' } },
    { id: 'other', template: 'unmanaged', upgradeAvailable: { to: '9.0.0' } },
  ]
  const result = selectWorkspaceUpdateGuidance(workspaces, [
    { workspaceId: 'chat', phase: 'available', toVersion: '1.8.9' },
    { workspaceId: 'aq', phase: 'blocked', toVersion: '0.8.32', reason: 'active_runtime' },
    { workspaceId: 'ap', phase: 'available', toVersion: '0.4.1' },
  ], { autoUpdateAutoQuant: true, autoUpdateAutoPrediction: true })
  expect(result).toEqual({ workspaceIds: ['chat'], needsAttentionWorkspaceIds: [] })
})

it('separates manual blockers and failures from available updates', () => {
  const workspaces = [
    { id: 'aq', template: 'auto-quant-v2', upgradeAvailable: { to: '0.8.32' } },
    { id: 'ap', template: 'auto-prediction', upgradeAvailable: { to: '0.4.1' } },
  ]
  expect(selectWorkspaceUpdateGuidance(workspaces, [
    { workspaceId: 'aq', phase: 'blocked', toVersion: '0.8.32', reason: 'active_runtime, merge_conflicts' },
    { workspaceId: 'ap', phase: 'failed', toVersion: '0.4.1', reason: 'source unavailable' },
  ], { autoUpdateAutoQuant: true, autoUpdateAutoPrediction: true })).toEqual({
    workspaceIds: [], needsAttentionWorkspaceIds: ['aq', 'ap'],
  })
  expect(selectWorkspaceUpdateGuidance(workspaces, [
    { workspaceId: 'aq', phase: 'available', toVersion: '0.8.32' },
  ], { autoUpdateAutoQuant: false, autoUpdateAutoPrediction: true }).workspaceIds).toEqual(['aq'])
})
