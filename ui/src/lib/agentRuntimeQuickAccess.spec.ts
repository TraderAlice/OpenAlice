import { describe, expect, it } from 'vitest'

import type { AgentInfo } from '../components/workspace/api'
import {
  canAddAgentRuntimeQuickAccess,
  projectAgentRuntimeQuickAccess,
} from './agentRuntimeQuickAccess'

const capabilities: AgentInfo['capabilities'] = {
  parallelPerCwd: true,
  resumeLast: true,
  resumeById: true,
  transcriptDiscovery: 'none',
}

function agent(
  id: string,
  installed = true,
  kind: AgentInfo['kind'] = 'agent',
): AgentInfo {
  return { id, displayName: id, kind, installed, capabilities }
}

const catalog = [
  agent('claude'),
  agent('codex', false),
  agent('cursor'),
  agent('agy'),
  agent('grok'),
  agent('omp'),
  agent('opencode'),
  agent('pi'),
  agent('shell', true, 'utility'),
]

describe('projectAgentRuntimeQuickAccess', () => {
  it('fills four installed slots from pinned ids, then recent, then registry order', () => {
    const projected = projectAgentRuntimeQuickAccess(catalog, ['pi', 'missing', 'codex', 'grok'], 'opencode')
    expect(projected.primary.map((item) => item.id)).toEqual(['pi', 'grok', 'opencode', 'claude'])
    expect(projected.others.map((item) => item.id)).toEqual(['codex', 'cursor', 'agy', 'omp'])
    expect(projected.installed.map((item) => item.id)).toEqual([
      'claude', 'cursor', 'agy', 'grok', 'omp', 'opencode', 'pi',
    ])
    expect(projected.notInstalled.map((item) => item.id)).toEqual(['codex'])
    expect(projected.catalog.some((item) => item.id === 'shell')).toBe(false)
  })

  it('never auto-fills an uninstalled runtime into primary', () => {
    const projected = projectAgentRuntimeQuickAccess(catalog, ['codex'], 'codex')
    expect(projected.primary.map((item) => item.id)).toEqual(['claude', 'cursor', 'agy', 'grok'])
    expect(projected.primary.every((item) => item.installed !== false)).toBe(true)
  })

  it('keeps a later selected runtime out of primary unless it already qualifies', () => {
    const projected = projectAgentRuntimeQuickAccess(catalog, ['pi'], null)
    expect(projected.primary.map((item) => item.id)).toEqual(['pi', 'claude', 'cursor', 'agy'])
    expect(projected.others.map((item) => item.id)).toContain('opencode')
  })

  it('lets stale uninstalled pins remain listed without occupying a fallback slot', () => {
    const projected = projectAgentRuntimeQuickAccess(catalog, ['codex', 'pi'], null)
    expect(projected.primary.map((item) => item.id)).toEqual(['pi', 'claude', 'cursor', 'agy'])
    expect(canAddAgentRuntimeQuickAccess(['codex', 'pi'], agent('codex', false))).toBe(true)
    expect(canAddAgentRuntimeQuickAccess(['pi'], agent('codex', false))).toBe(false)
    expect(canAddAgentRuntimeQuickAccess(['pi'], agent('claude'))).toBe(true)
  })
})
