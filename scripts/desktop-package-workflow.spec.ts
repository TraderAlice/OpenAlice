import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

interface WorkflowStep {
  if?: string
  name?: string
  run?: string
}

interface WorkflowJob {
  name?: string
  needs?: string | string[]
  'runs-on'?: string
  steps?: WorkflowStep[]
}

interface Workflow {
  on?: {
    workflow_dispatch?: unknown
    pull_request?: { branches?: string[] }
    push?: unknown
  }
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
  it('keeps manual and master-promotion coverage without taxing dev PRs', () => {
    expect(workflow.on).toHaveProperty('workflow_dispatch')
    expect(workflow.on).toHaveProperty('pull_request')
    expect(workflow.on?.pull_request?.branches).toEqual(['master'])
    expect(workflow.on).not.toHaveProperty('push')
  })

  it('cancels superseded runs for the same pull request or ref', () => {
    expect(workflow.concurrency).toEqual({
      group: 'desktop-package-smoke-${{ github.event.pull_request.number || github.ref }}',
      'cancel-in-progress': true,
    })
  })

  it('runs Windows Broker Pack acceptance independently of desktop packaging', () => {
    const preflight = workflow.jobs.preflight
    const brokerPacks = workflow.jobs['broker-packs-windows']
    const desktop = workflow.jobs.package
    const brokerPackSteps = [
      'Build optional Broker Packs on Windows',
      'Prove previous-release Broker Pack upgrade on Windows',
    ]

    expect(preflight).toMatchObject({
      name: 'fast preflight',
      'runs-on': 'ubuntu-latest',
    })
    expect(preflight.needs).toBeUndefined()
    const preflightSteps = preflight.steps?.map((step) => step.name) ?? []
    expect(preflightSteps).toContain('Detect exact beta release preparation')
    expect(preflightSteps).toEqual(expect.arrayContaining([
      'Verify CI workflow contracts',
      'Typecheck root workspace',
    ]))
    for (const stepName of ['Verify CI workflow contracts', 'Typecheck root workspace']) {
      const candidate = preflight.steps?.find((step) => step.name === stepName)
      expect(candidate?.if).toContain("beta_release_prep != 'true'")
    }
    expect(brokerPacks).toMatchObject({
      name: 'broker-packs windows-latest',
      'runs-on': 'windows-latest',
    })
    expect(brokerPacks.needs).toBe('preflight')
    expect(brokerPacks.steps?.map((step) => step.name)).toEqual(
      expect.arrayContaining(brokerPackSteps),
    )
    expect(desktop.needs).toBe('preflight')
    for (const stepName of brokerPackSteps) {
      expect(desktop.steps?.map((step) => step.name)).not.toContain(stepName)
    }
  })

  it('smokes Guardian takeover and existing-owner browser handoff before packaging', () => {
    const steps = workflow.jobs.package.steps ?? []
    const names = steps.map((step) => step.name)
    expect(names).toEqual(expect.arrayContaining([
      'Build Alice + UTA + desktop shell',
      'Smoke Guardian takeover through Electron',
      'Smoke existing-owner browser handoff through Electron',
      'Package unpacked desktop app',
    ]))
    expect(names.indexOf('Build Alice + UTA + desktop shell')).toBeLessThan(
      names.indexOf('Smoke Guardian takeover through Electron'),
    )
    expect(names.indexOf('Smoke Guardian takeover through Electron')).toBeLessThan(
      names.indexOf('Smoke existing-owner browser handoff through Electron'),
    )
    expect(names.indexOf('Smoke existing-owner browser handoff through Electron')).toBeLessThan(
      names.indexOf('Package unpacked desktop app'),
    )
    expect(steps.find((step) => step.name === 'Smoke existing-owner browser handoff through Electron')?.run)
      .toContain('pnpm electron:smoke:existing-owner --skip-build')
  })
})
