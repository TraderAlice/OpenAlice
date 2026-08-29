import type { OfficeFloorEmployee } from '../api/office'
import { officeCoworkerSpriteForAgent, type OfficeCoworkerSpriteAsset } from './coworker-sprites'

export function officeCoworkerLabel(
  employee: Pick<OfficeFloorEmployee, 'name' | 'title' | 'displayName'>,
): string {
  return employee.displayName?.trim() || employee.title?.trim() || employee.name
}

function humanizeCoworkerIdentity(identity: string): string {
  return identity
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Stable in-world identity. Explicit user naming wins; auto-generated task titles do not. */
export function officeCoworkerCallsign(
  employee: Pick<OfficeFloorEmployee, 'agent' | 'resumeId' | 'displayName'>,
  asset?: OfficeCoworkerSpriteAsset,
): string {
  const explicitName = employee.displayName?.trim()
  if (explicitName) return explicitName
  const resolvedAsset = asset ?? officeCoworkerSpriteForAgent(employee.agent, employee.resumeId)
  return humanizeCoworkerIdentity(resolvedAsset.id)
}

export function officeCoworkerAssignment(
  employee: Pick<OfficeFloorEmployee, 'title' | 'displayName' | 'name'>,
): string | null {
  const title = employee.title?.trim()
  if (!title || title === employee.displayName?.trim() || title === employee.name) return null
  return title
}
