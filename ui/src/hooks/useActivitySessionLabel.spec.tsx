// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useActivitySessionLabel } from './useWorkspaceData'
vi.mock('../contexts/workspaces-context', () => ({ useWorkspaces: () => ({ workspaces: [{ id: 'desk', sessions: [
  { id: 'first', resumeId: 'native-first', agent: 'grok', title: 'First report', name: 'g1' },
  { id: 'second', resumeId: 'native-second', agent: 'grok', title: 'Second report', displayName: 'Researcher', name: 'g2' },
] }] }) }))
it('resolves the exact publishing session rather than any session using its runtime', () => {
  const { result } = renderHook(useActivitySessionLabel)
  expect(result.current({ workspaceId: 'desk', sessionRecordId: 'first', agent: 'grok' })).toBe('First report')
  expect(result.current({ workspaceId: 'desk', resumeId: 'native-second', agent: 'grok' })).toBe('Researcher')
  expect(result.current({ workspaceId: 'other', sessionRecordId: 'first', agent: 'grok' })).toBeNull()
  expect(result.current({ workspaceId: 'desk', agent: 'grok' })).toBeNull()
  expect(result.current({ workspaceId: 'desk', sessionRecordId: 'missing', resumeId: 'native-second', agent: 'grok' })).toBeNull()
})
