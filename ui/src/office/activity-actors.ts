import type { OfficeRoomSnapshot } from '../api/office'
import { officeCoworkerCast, type OfficeCoworkerSpriteAsset } from './coworker-sprites'
import { officeCoworkerAssignment, officeCoworkerCallsign } from './label'

export interface OfficeActivityActor {
  resumeId: string
  agent: string
  lastSeq: number
  label: string
  assignment?: string
  secondary: string
  asset: OfficeCoworkerSpriteAsset
}

export function officeActivityActors(
  offices: readonly OfficeRoomSnapshot[],
  groupTitle: (workspaceId: string, tag: string) => string,
  retainedAssets: ReadonlyMap<string, OfficeCoworkerSpriteAsset> = new Map(),
): ReadonlyMap<string, OfficeActivityActor> {
  const actors = new Map<string, OfficeActivityActor>()
  for (const office of offices) {
    const cast = officeCoworkerCast(office.employees)
    const roomName = groupTitle(office.workspace.id, office.workspace.tag)
    for (const employee of office.employees) {
      const asset = retainedAssets.get(employee.resumeId) ?? cast.get(employee.resumeId)!
      const label = officeCoworkerCallsign(employee, asset)
      const assignment = officeCoworkerAssignment(employee)
      actors.set(employee.resumeId, {
        resumeId: employee.resumeId,
        agent: employee.agent,
        lastSeq: employee.lastSeq,
        label,
        ...(assignment ? { assignment } : {}),
        secondary: [
          employee.agent,
          employee.name,
          roomName,
        ].filter(Boolean).join(' · '),
        asset,
      })
    }
  }
  return actors
}

/** Turn a retained Session slug into a stable in-world call sign without exposing its raw ID. */
export function officeActivityFallbackLabel(resumeId?: string, agent?: string): string {
  const words = resumeId
    ?.replace(/^resume-/, '')
    .split('-')
    .filter((word) => /^[a-z]+$/i.test(word))
    .slice(0, 3)
  if (words?.length) {
    return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  }
  return agent ? `${agent} agent` : 'Agent'
}
