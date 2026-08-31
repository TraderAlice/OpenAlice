// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
      scope: 'session',
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

beforeEach(() => window.sessionStorage.clear())
afterEach(() => window.sessionStorage.clear())

describe('Office cadence excursion', () => {
  it('round-trips the captured evidence instead of only its subject identity', () => {
    const captured = duty()
    rememberOfficeCadenceExcursion({ duty: captured })

    expect(readOfficeCadenceExcursion()).toEqual({ duty: captured })
    clearOfficeCadenceExcursion()
    expect(readOfficeCadenceExcursion()).toBeNull()
  })

  it('fails closed when the stored candidate cannot render a complete dossier', () => {
    window.sessionStorage.setItem('openalice:office-cadence-excursion:v2', JSON.stringify({
      duty: {
        kind: 'cadence',
        id: 'broken',
        receipt: { kind: 'evidence', subjectKey: 'subject', fingerprint: 'fingerprint' },
      },
    }))

    expect(readOfficeCadenceExcursion()).toBeNull()
  })
})
