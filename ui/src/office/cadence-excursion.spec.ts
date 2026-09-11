// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OfficeCadenceDutyCandidate } from './duty-registry'
import {
  clearOfficeCadenceExcursion,
  readOfficeCadenceExcursion,
  rememberOfficeCadenceExcursion,
} from './cadence-excursion'

function duty(): OfficeCadenceDutyCandidate {
  return {
    id: 'scheduled-issue-health:ws-a:weekly-review',
    registrationId: 'scheduled-issue-health',
    kind: 'cadence',
    count: 1,
    destination: {
      kind: 'issue',
      workspaceId: 'ws-a',
      issueId: 'weekly-review',
      targetId: 'operations',
    },
    receipt: {
      kind: 'evidence',
      subjectKey: '["scheduled-issue","ws-a","weekly-review"]',
      fingerprint: 'captured-a',
      scope: 'office-day',
    },
    cadence: {
      workspaceId: 'ws-a',
      workspaceTag: 'weekly',
      issueId: 'weekly-review',
      title: 'Review weekly report',
      priority: 'high',
      assignee: '@new-each-run',
      when: { kind: 'every', every: '1w' },
      health: {
        state: 'failed',
        message: 'Latest scheduled run failed.',
        latestTaskId: 'run-a',
      },
    },
  }
}

beforeEach(clearOfficeCadenceExcursion)
afterEach(() => {
  clearOfficeCadenceExcursion()
  vi.restoreAllMocks()
})

describe('Office cadence excursion', () => {
  it('keeps captured evidence in renderer memory without creating another persistence owner', () => {
    const writeStorage = vi.spyOn(Storage.prototype, 'setItem')
    const captured = duty()
    rememberOfficeCadenceExcursion({ duty: captured })

    expect(readOfficeCadenceExcursion()).toEqual({ duty: captured })
    expect(writeStorage).not.toHaveBeenCalled()
    clearOfficeCadenceExcursion()
    expect(readOfficeCadenceExcursion()).toBeNull()
  })

  it('replaces the navigation capture without reading a legacy session value', () => {
    const readStorage = vi.spyOn(Storage.prototype, 'getItem')
    const first = duty()
    const second = {
      ...first,
      receipt: { ...first.receipt, fingerprint: 'captured-b' },
    }

    rememberOfficeCadenceExcursion({ duty: first })
    rememberOfficeCadenceExcursion({ duty: second })

    expect(readOfficeCadenceExcursion()).toEqual({ duty: second })
    expect(readStorage).not.toHaveBeenCalled()
  })
})
