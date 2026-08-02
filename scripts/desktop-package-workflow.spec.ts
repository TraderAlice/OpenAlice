import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

interface WorkflowStep {
  name?: string
}

interface WorkflowJob {
  name?: string
  needs?: string | string[]
  'runs-on'?: string
  steps?: WorkflowStep[]
}

interface Workflow {
  concurrency?: {
    group?: string
    'cancel-in-progress'?: boolean
  }
  jobs: Record<string, WorkflowJob>
}

const root = resolve(import.meta.dirname, '..')
const workflow = YAML.parse(
  readFileSync(resolve(root, '.github/workflows/desktop-package-smoke.yml'), 'utf8'),
) as Workflow

describe('Desktop Package Smoke workflow critical path', () => {
  it('cancels superseded runs for the same pull request or ref', () => {
    expect(workflow.concurrency).toEqual({
      group: 'desktop-package-smoke-${{ github.event.pull_request.number || github.ref }}',
      'cancel-in-progress': true,
    })
  })

  it('runs Windows Broker Pack acceptance independently of desktop packaging', () => {
    const brokerPacks = workflow.jobs['broker-packs-windows']
    const desktop = workflow.jobs.package
    const brokerPackSteps = [
      'Build optional Broker Packs on Windows',
      'Prove previous-release Broker Pack upgrade on Windows',
    ]

    expect(brokerPacks).toMatchObject({
      name: 'broker-packs windows-latest',
      'runs-on': 'windows-latest',
    })
    expect(brokerPacks.needs).toBeUndefined()
    expect(brokerPacks.steps?.map((step) => step.name)).toEqual(
      expect.arrayContaining(brokerPackSteps),
    )
    expect(desktop.needs).toBeUndefined()
    for (const stepName of brokerPackSteps) {
      expect(desktop.steps?.map((step) => step.name)).not.toContain(stepName)
    }
  })
})
