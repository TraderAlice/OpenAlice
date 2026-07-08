import { describe, expect, it } from 'vitest'

import {
  FIRST_RUN_STEP_KEYS,
  buildFirstRunGuideAccess,
  buildFirstRunGuideModel,
  parseFirstRunStepOverride,
} from './first-run-guide-model'
import type { TradingServiceStatus } from '../api/trading'

const liteStatus: TradingServiceStatus = {
  available: false,
  state: 'unavailable',
  mode: 'lite',
  modeSource: 'auto',
  envLocked: false,
  hasUTAConfig: false,
}

const readyPiRuntime = {
  agents: {
    pi: {
      agent: 'pi',
      displayName: 'Pi',
      installed: true,
      binPath: '/vendor/pi/pi',
      status: 'ready',
      ready: true,
      source: 'launcher-vault',
      checkedAt: '2026-07-08T00:00:00.000Z',
      durationMs: 12,
      message: 'Pi replied to the readiness probe.',
    },
  },
  overallReady: true,
  checkedAt: '2026-07-08T00:00:00.000Z',
} as const

describe('buildFirstRunGuideModel', () => {
  it('treats a ready Pi runtime probe as usable', () => {
    const model = buildFirstRunGuideModel({
      agents: [
        { id: 'pi', displayName: 'Pi', kind: 'agent', installed: true },
      ],
      runtimeReadiness: readyPiRuntime,
      credentials: [{ wires: { 'openai-chat': '' } }],
      tradingStatus: liteStatus,
      utas: [],
      loaded: true,
      dismissed: false,
    })

    expect(model.hasAgentRuntime).toBe(true)
    expect(model.hasManagedPi).toBe(true)
    expect(model.hasUsableAiChain).toBe(true)
    expect(model.runtimeLabel).toBe('1 runtime installed')
    expect(model.shouldShow).toBe(true)
    expect(model.aiAccessLabel).toBe('Agent runtime ready')
  })

  it('does not treat a compatible vault credential as usable before a runtime probe succeeds', () => {
    const model = buildFirstRunGuideModel({
      agents: [
        { id: 'pi', displayName: 'Pi', kind: 'agent', installed: true },
      ],
      runtimeReadiness: null,
      credentials: [{ wires: { 'openai-chat': '' } }],
      tradingStatus: liteStatus,
      utas: [],
      loaded: true,
      dismissed: false,
    })

    expect(model.hasAgentRuntime).toBe(true)
    expect(model.hasUsableAiChain).toBe(false)
    expect(model.aiAccessLabel).toBe('Retry runtime test')
  })

  it('shows the guide for a fresh Lite install with missing runtimes', () => {
    const model = buildFirstRunGuideModel({
      agents: [
        { id: 'codex', displayName: 'Codex', kind: 'agent', installed: false },
        { id: 'pi', displayName: 'Pi', kind: 'agent', installed: false },
      ],
      runtimeReadiness: null,
      credentials: [],
      tradingStatus: liteStatus,
      utas: [],
      loaded: true,
      dismissed: false,
    })

    expect(model.shouldShow).toBe(true)
    expect(model.hasAgentRuntime).toBe(false)
    expect(model.hasManagedPi).toBe(false)
    expect(model.runtimeLabel).toBe('Managed Pi runtime not detected')
  })

  it('does not treat Claude or Codex CLI login as ready until a runtime probe exists', () => {
    const model = buildFirstRunGuideModel({
      agents: [
        { id: 'codex', displayName: 'Codex', kind: 'agent', installed: true },
        { id: 'claude', displayName: 'Claude Code', kind: 'agent', installed: true },
      ],
      runtimeReadiness: null,
      credentials: [],
      tradingStatus: liteStatus,
      utas: [],
      loaded: true,
      dismissed: false,
    })

    expect(model.hasAgentRuntime).toBe(true)
    expect(model.hasUsableAiChain).toBe(false)
    expect(model.runtimeRows.map((row) => row.accessLabel)).toEqual([
      'Not checked yet',
      'Not checked yet',
    ])
    expect(model.shouldShow).toBe(true)
  })

  it('stays quiet after dismissal', () => {
    const model = buildFirstRunGuideModel({
      agents: [
        { id: 'pi', displayName: 'Pi', kind: 'agent', installed: true },
      ],
      runtimeReadiness: null,
      credentials: [],
      tradingStatus: liteStatus,
      utas: [],
      loaded: true,
      dismissed: true,
    })

    expect(model.shouldShow).toBe(false)
  })

  it('requires a UTA when onboarding upgrades to readonly or pro without accounts', () => {
    const model = buildFirstRunGuideModel({
      agents: [
        { id: 'pi', displayName: 'Pi', kind: 'agent', installed: true },
      ],
      runtimeReadiness: readyPiRuntime,
      credentials: [{ wires: { 'openai-chat': '' } }],
      tradingStatus: { ...liteStatus, mode: 'readonly', modeSource: 'config', available: true },
      utas: [],
      loaded: true,
      dismissed: false,
    })

    expect(model.needsUTASetup).toBe(true)
  })

  it('does not require UTA setup in upgraded modes once one exists', () => {
    const model = buildFirstRunGuideModel({
      agents: [
        { id: 'pi', displayName: 'Pi', kind: 'agent', installed: true },
      ],
      runtimeReadiness: readyPiRuntime,
      credentials: [{ wires: { 'openai-chat': '' } }],
      tradingStatus: { ...liteStatus, mode: 'pro', modeSource: 'config', available: true, hasUTAConfig: true },
      utas: [],
      loaded: true,
      dismissed: false,
    })

    expect(model.needsUTASetup).toBe(false)
  })
})

describe('parseFirstRunStepOverride', () => {
  it('starts onboarding with language choice', () => {
    expect(FIRST_RUN_STEP_KEYS[0]).toBe('language')
  })

  it('only accepts onboarding step overrides in onboarding test mode', () => {
    expect(parseFirstRunStepOverride('?onboardingStep=broker', false)).toBeNull()
    expect(parseFirstRunStepOverride('?onboardingStep=broker', true)).toBe('broker')
  })

  it('supports short aliases for faster design checks', () => {
    expect(parseFirstRunStepOverride('?step=locale', true)).toBe('language')
    expect(parseFirstRunStepOverride('?step=runtime', true)).toBe('ai')
    expect(parseFirstRunStepOverride('?onboardingStep=uta', true)).toBe('broker')
    expect(parseFirstRunStepOverride('?step=checklist', true)).toBe('finish')
    expect(parseFirstRunStepOverride('?step=unknown', true)).toBeNull()
  })
})

describe('buildFirstRunGuideAccess', () => {
  it('keeps onboarding locked on AI access until a usable runtime chain exists', () => {
    expect(buildFirstRunGuideAccess({ hasUsableAiChain: false })).toEqual({
      canDismiss: false,
      maxReachableStepKey: 'ai',
    })
  })

  it('allows broker setup and dismissal once a usable AI chain exists', () => {
    expect(buildFirstRunGuideAccess({ hasUsableAiChain: true })).toEqual({
      canDismiss: true,
      maxReachableStepKey: 'finish',
    })
  })
})
