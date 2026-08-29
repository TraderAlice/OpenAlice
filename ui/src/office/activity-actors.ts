import type { OfficeRoomSnapshot } from '../api/office'
import { officeCoworkerCast, type OfficeCoworkerSpriteAsset } from './coworker-sprites'
import { officeCoworkerLabel } from './label'

export interface OfficeActivityActor {
  resumeId: string
  agent: string
  label: string
  secondary: string
  asset: OfficeCoworkerSpriteAsset
}

export function officeActivityActors(
  offices: readonly OfficeRoomSnapshot[],
  groupTitle: (workspaceId: string, tag: string) => string,
): ReadonlyMap<string, OfficeActivityActor> {
  const actors = new Map<string, OfficeActivityActor>()
  for (const office of offices) {
    const cast = officeCoworkerCast(office.employees)
    const roomName = groupTitle(office.workspace.id, office.workspace.tag)
    for (const employee of office.employees) {
      const label = officeCoworkerLabel(employee)
      actors.set(employee.resumeId, {
        resumeId: employee.resumeId,
        agent: employee.agent,
        label,
        secondary: [
          employee.agent,
          employee.name !== label ? employee.name : null,
          roomName,
        ].filter(Boolean).join(' · '),
        asset: cast.get(employee.resumeId)!,
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
