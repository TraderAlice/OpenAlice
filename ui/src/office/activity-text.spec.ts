import { describe, expect, it } from 'vitest'

import { officeActivityExcerpt, officeActivityText } from './activity-text'

describe('Office activity text', () => {
  it('keeps a full cleaned result while deriving a compact floor excerpt', () => {
    const source = `## Result\n**Filed** the [report](/report.md). ${'Evidence '.repeat(40)}`
    const full = officeActivityText(source)

    expect(full).toContain('Result Filed the report.')
    expect(full?.length).toBeGreaterThan(180)
    expect(officeActivityExcerpt(source)).toHaveLength(180)
    expect(officeActivityExcerpt(source)?.endsWith('…')).toBe(true)
  })
})
