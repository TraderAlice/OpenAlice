import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

interface WorkflowStep {
  name?: string
  run?: string
}

const root = resolve(import.meta.dirname, '..')
const workflow = YAML.parse(
  readFileSync(resolve(root, '.github/workflows/cli-channel-authority.yml'), 'utf8'),
) as {
  on: Record<string, unknown>
  permissions: Record<string, string>
  jobs: Record<string, {
    'timeout-minutes'?: number
    steps?: WorkflowStep[]
  }>
}

describe('Public CLI channel authority workflow', () => {
  it('is a bounded manual read-only rehearsal', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.preflight['timeout-minutes']).toBe(5)
  })

  it('requires a selection and calls the non-publishing preflight', () => {
    const steps = workflow.jobs.preflight.steps ?? []
    expect(steps.find((step) => step.name === 'Require at least one selected channel')?.run)
      .toContain('Select at least one public CLI channel')
    expect(steps.find((step) => step.name === 'Verify selected channel authority without publishing')?.run)
      .toBe('node scripts/preflight-public-cli-authority.mjs')
    expect(steps.map((step) => step.run ?? '').join('\n')).not.toMatch(/npm publish|git push|gh release/)
  })
})
