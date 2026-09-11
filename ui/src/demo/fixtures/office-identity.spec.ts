import { afterEach, describe, expect, it, vi } from 'vitest'

async function recordedOfficeDutyKeys(): Promise<string[]> {
  const [issues, inbox, registry] = await Promise.all([
    import('./issues'),
    import('./inbox'),
    import('../../office/duty-registry'),
  ])
  const inboxEvidence = inbox.demoInboxEntries.map((entry) => ({
    title: entry.id,
    entry,
  }))
  return [
    ...registry.scheduledIssueHealthDutyRegistration(
      Date.now(),
      issues.demoIssuesSnapshot,
      'ready',
    ).candidates,
    ...registry.inboxUnreadDutyRegistration(
      inboxEvidence,
      'ready',
      issues.demoIssuesSnapshot,
    ).candidates,
  ].map(registry.officeDutyKey)
}

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
})

describe('recorded Office fixture identity', () => {
  it('keeps exact duty keys stable across full reloads on the same local day', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 1, 8, 5, 0, 0))
    vi.resetModules()
    const morning = await recordedOfficeDutyKeys()

    vi.setSystemTime(new Date(2026, 8, 1, 20, 55, 0, 0))
    vi.resetModules()
    const evening = await recordedOfficeDutyKeys()

    expect(evening).toEqual(morning)
  })
})
