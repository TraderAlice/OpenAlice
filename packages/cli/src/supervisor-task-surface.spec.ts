import { describe, expect, it } from 'vitest'

import {
  renderSupervisorTaskSurface,
  supervisorTaskSurfaceOptions,
  supervisorUsesTaskStage,
} from './supervisor-task-surface.ts'

describe('Supervisor secondary-task surface', () => {
  const sheet = {
    width: '92%',
    maxHeight: '90%',
    anchor: 'center',
    margin: 1,
  } as const

  it('turns wide tall secondary work into one header-to-console stage', () => {
    const size = { width: 120, height: 32 }
    expect(supervisorUsesTaskStage(size)).toBe(true)
    expect(supervisorTaskSurfaceOptions(size, sheet)).toEqual({
      width: '100%',
      maxHeight: '100%',
      anchor: 'top-left',
      margin: { top: 3, right: 0, bottom: 3, left: 0 },
    })
    const lines = renderSupervisorTaskSurface(['work', 'status'], size)
    expect(lines).toHaveLength(26)
    expect(lines.slice(0, 2)).toEqual(['work', 'status'])
    expect(lines.slice(2).every((line) => line === '')).toBe(true)
  })

  it('keeps the responsive task sheet below either stage boundary', () => {
    for (const size of [
      { width: 99, height: 32 },
      { width: 120, height: 27 },
      { width: 80, height: 24 },
    ]) {
      expect(supervisorUsesTaskStage(size)).toBe(false)
      expect(supervisorTaskSurfaceOptions(size, sheet)).toBe(sheet)
      expect(renderSupervisorTaskSurface(['work'], size)).toEqual(['work'])
    }
  })
})
