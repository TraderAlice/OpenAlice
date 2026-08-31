// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import { officeApi } from '../../api/office'
import {
  DEMO_AUTO_PREDICTION_WORKSPACE_ID,
  DEMO_AUTO_QUANT_WORKSPACE_ID,
  DEMO_CHAT_RESUME_ID,
  DEMO_CHAT_SESSION_ID,
  DEMO_CHAT_WORKSPACE_ID,
  demoChatWorkspace,
} from '../fixtures/workspaces'
import { demoMoversReport, demoWorkspaceFiles } from '../fixtures/inbox'
import { demoIssuesSnapshot } from '../fixtures/issues'
import { inboxHandlers } from './inbox'
import { officeHandlers } from './office'

const server = setupServer(...inboxHandlers, ...officeHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('demo Office handlers', () => {
  it('projects Workspaces and Sessions that exist in the shared demo roster', async () => {
    const response = await fetch(`${baseUrl}/api/office/floor`)
    const body = await response.json() as {
      offices: Array<{
        workspace: { id: string }
        employees: Array<{
          resumeId: string
          sessionRecordId?: string
          drawers: Array<{ path?: string }>
        }>
      }>
    }

    expect(response.status).toBe(200)
    expect(body.offices.map((office) => office.workspace.id)).toEqual([
      DEMO_CHAT_WORKSPACE_ID,
      DEMO_AUTO_QUANT_WORKSPACE_ID,
      DEMO_AUTO_PREDICTION_WORKSPACE_ID,
    ])
    expect(body.offices[0]?.employees[0]?.sessionRecordId).toBe(DEMO_CHAT_SESSION_ID)
    expect(body.offices[0]?.employees[0]?.resumeId).toBe(DEMO_CHAT_RESUME_ID)
    expect(body.offices[0]?.employees).toHaveLength(demoChatWorkspace.sessions.length)
    expect(body.offices[0]?.employees.map((employee) => employee.sessionRecordId)).toEqual(
      demoChatWorkspace.sessions.map((session) => session.id),
    )
    const drawerPath = body.offices[0]?.employees[0]?.drawers[0]?.path
    expect(drawerPath).toBe('rotation/ai-chain-2026-06-02.md')
    expect(demoWorkspaceFiles[drawerPath ?? '']).toBeTruthy()
  })

  it('persists one exact routine follow-up idempotently and resolves it idempotently', async () => {
    const inboxEntryId = 'demo-inbox-morning-1'
    const endpoint = `${baseUrl}/api/office/routine-follow-ups/${inboxEntryId}`
    const readEndpoint = `${baseUrl}/api/inbox/${inboxEntryId}/read`
    await fetch(endpoint, { method: 'DELETE' })
    await fetch(readEndpoint, { method: 'DELETE' })

    try {
      const firstBody = await officeApi.carryRoutineFollowUp(inboxEntryId)
      expect(firstBody.created).toBe(true)
      expect(firstBody.followUp).toMatchObject({
        inboxEntryId,
        issueWorkspaceId: 'demo-ws-auto-quant',
        issueId: 'morning-scan',
      })

      const replay = await fetch(endpoint, { method: 'PUT' })
      const replayBody = await replay.json() as typeof firstBody
      expect(replay.status).toBe(200)
      expect(replayBody).toEqual({ followUp: firstBody.followUp, created: false })

      const originalReportTs = demoMoversReport.ts
      try {
        demoMoversReport.ts = originalReportTs + 1
        const conflict = await fetch(endpoint, { method: 'PUT' })
        expect(conflict.status).toBe(409)
      } finally {
        demoMoversReport.ts = originalReportTs
      }

      const listedBody = await officeApi.listRoutineFollowUps()
      expect(listedBody.followUps).toContainEqual(firstBody.followUp)

      expect(await officeApi.resolveRoutineFollowUp(inboxEntryId))
        .toEqual({ ok: true, removed: true })
      expect(await officeApi.resolveRoutineFollowUp(inboxEntryId))
        .toEqual({ ok: true, removed: false })

      const markedRead = await fetch(readEndpoint, { method: 'PUT' })
      expect(markedRead.status).toBe(200)
      const staleReplay = await fetch(endpoint, { method: 'PUT' })
      expect(staleReplay.status).toBe(409)
      expect(await staleReplay.json()).toMatchObject({
        error: 'routine_report_already_reviewed',
      })
    } finally {
      await fetch(endpoint, { method: 'DELETE' })
      await fetch(readEndpoint, { method: 'DELETE' })
    }
  })

  it('replays an existing demo carry after its Issue stops scheduling', async () => {
    const inboxEntryId = demoMoversReport.id
    const endpoint = `${baseUrl}/api/office/routine-follow-ups/${inboxEntryId}`
    const readEndpoint = `${baseUrl}/api/inbox/${inboxEntryId}/read`
    const issue = demoIssuesSnapshot.workspaces
      .find((workspace) => workspace.wsId === 'demo-ws-auto-quant')
      ?.issues.find((candidate) => candidate.id === 'morning-scan')
    expect(issue?.when).toBeTruthy()
    const originalWhen = issue!.when
    await fetch(endpoint, { method: 'DELETE' })
    await fetch(readEndpoint, { method: 'DELETE' })

    try {
      const first = await officeApi.carryRoutineFollowUp(inboxEntryId)
      delete issue!.when

      const replay = await fetch(endpoint, { method: 'PUT' })
      expect(replay.status).toBe(200)
      expect(await replay.json()).toEqual({ followUp: first.followUp, created: false })
    } finally {
      issue!.when = originalWhen
      await fetch(endpoint, { method: 'DELETE' })
      await fetch(readEndpoint, { method: 'DELETE' })
    }
  })

  it('refuses to invent a decision subject for an ordinary Inbox entry', async () => {
    const response = await fetch(
      `${baseUrl}/api/office/routine-follow-ups/demo-inbox-aapl-q1`,
      { method: 'PUT' },
    )
    expect(response.status).toBe(422)
  })

  it('requires the exact originating Issue to remain scheduled', async () => {
    const endpoint = `${baseUrl}/api/office/routine-follow-ups/${demoMoversReport.id}`
    await fetch(endpoint, { method: 'DELETE' })
    const originalIssueId = demoMoversReport.origin?.issueId
    try {
      demoMoversReport.origin!.issueId = 'rebalance-sizing-review'
      const response = await fetch(endpoint, { method: 'PUT' })
      expect(response.status).toBe(422)
    } finally {
      demoMoversReport.origin!.issueId = originalIssueId
    }
  })
})
