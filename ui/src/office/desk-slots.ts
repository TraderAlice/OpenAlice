import type { OfficeFloorEmployee } from '../api/office'
import { OFFICE_MIN_DESKS } from './furniture'

export function deskSlotsForOffice(
  employees: readonly OfficeFloorEmployee[],
  min = OFFICE_MIN_DESKS,
): Array<OfficeFloorEmployee | null> {
  const slots: Array<OfficeFloorEmployee | null> = [...employees]
  while (slots.length < min) slots.push(null)
  return slots
}

export function visibleEmployeesForOffice(
  employees: readonly OfficeFloorEmployee[],
  limit = 4,
): OfficeFloorEmployee[] {
  return employeesForOffice(employees).slice(0, limit)
}

export function stableDeskSlotsForOffice(
  employees: readonly OfficeFloorEmployee[],
  previousResumeIds: readonly (string | null)[],
  limit = 4,
): Array<OfficeFloorEmployee | null> {
  const visible = visibleEmployeesForOffice(employees, limit)
  const visibleById = new Map(visible.map((employee) => [employee.resumeId, employee]))
  const slots = previousResumeIds.slice(0, limit).map((resumeId) => (
    resumeId ? visibleById.get(resumeId) ?? null : null
  ))
  while (slots.length < limit) slots.push(null)

  const placed = new Set(slots.flatMap((employee) => employee ? [employee.resumeId] : []))
  for (const employee of visible) {
    if (placed.has(employee.resumeId)) continue
    const vacancy = slots.indexOf(null)
    if (vacancy < 0) break
    slots[vacancy] = employee
    placed.add(employee.resumeId)
  }

  return slots
}

export function employeesForOffice(
  employees: readonly OfficeFloorEmployee[],
): OfficeFloorEmployee[] {
  return [...employees]
    .sort((a, b) => Number(a.mood === 'idle') - Number(b.mood === 'idle'))
}
