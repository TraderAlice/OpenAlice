import type { OfficeFloorEmployee } from '../api/office'

export function officeCoworkerLabel(
  employee: Pick<OfficeFloorEmployee, 'name' | 'title' | 'displayName'>,
): string {
  return employee.displayName?.trim() || employee.title?.trim() || employee.name
}
