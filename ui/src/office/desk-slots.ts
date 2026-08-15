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
