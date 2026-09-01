import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

interface WorkflowStep {
  env?: Record<string, string>
  if?: string
  name?: string
  run?: string
  'timeout-minutes'?: number
}

interface WorkflowJob {
  if?: string
  needs?: string | string[]
  'timeout-minutes'?: number
  steps?: WorkflowStep[]
  strategy?: {
    matrix?: { os?: string[] }
  }
}

interface Workflow {
  on?: {
    push?: { branches?: string[] }
    pull_request?: { branches?: string[] }
  }
  jobs: Record<string, WorkflowJob>
}

const root = resolve(import.meta.dirname, '..')
const workflow = YAML.parse(
  readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'),
) as Workflow
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

function commands(job: WorkflowJob): string[] {
  return job.steps?.flatMap((step) => step.run ? [step.run] : []) ?? []
}

describe('CI workflow fast failure lanes', () => {
  it('leaves dev pushes to the CLI-only rolling publication workflow', () => {
    expect(workflow.on?.push?.branches).toEqual(['master'])
    expect(workflow.on?.pull_request?.branches).toEqual(expect.arrayContaining(['dev', 'master']))
    expect(workflow.jobs['post-merge-dev-smoke']).toBeUndefined()
  })

  it('keeps workflow contracts and root typecheck with the shared build preflight', () => {
    const build = workflow.jobs.build

    expect(commands(build)).toEqual(expect.arrayContaining([
      'pnpm test:workflow-contracts',
      'npx tsc --noEmit',
    ]))
    expect(packageJson.scripts['test:workflow-contracts']).toContain(
      'scripts/classify-beta-release-prep.spec.mjs',
    )
    expect(packageJson.scripts['test:workflow-contracts']).toContain(
      'scripts/ci-workflow.spec.ts',
    )
    expect(packageJson.scripts['test:workflow-contracts']).toContain(
      'scripts/release-workflow.spec.ts',
    )
  })

  it('builds every ordinary candidate but reserves the full root suite for master lanes', () => {
    const build = workflow.jobs.build
    const test = workflow.jobs.test
    const buildStep = build.steps?.find((step) => step.name === 'Build complete workspace')

    expect(build.needs).toBe('change-scope')
    expect(build.if).toContain('!cancelled()')
    expect(buildStep?.if).toContain("needs.change-scope.result != 'success'")
    expect(buildStep?.if).toContain("beta_release_prep != 'true'")
    expect(commands(build)).toContain('pnpm build')
    expect(commands(build)).not.toContain('pnpm test')

    expect(test.needs).toBe('change-scope')
    expect(test.if).toContain("needs.change-scope.result != 'success'")
    expect(test.if).toContain("beta_release_prep != 'true'")
    expect(test.if).toContain("github.base_ref == 'master'")
    expect(commands(test)).toContain('pnpm test')
    expect(commands(test)).not.toContain('pnpm build')
  })

  it('keeps build-and-test successful for intentional dev and beta skips only', () => {
    const aggregate = workflow.jobs['build-and-test']
    const gate = aggregate.steps?.find(
      (step) => step.name === 'Require successful build and test lanes',
    )

    expect(aggregate.if).toContain('always()')
    expect(aggregate.needs).toEqual(['change-scope', 'build', 'test'])
    expect(gate?.env).toMatchObject({
      PREFLIGHT_RESULT: '${{ needs.change-scope.result }}',
      BETA_RELEASE_PREP: '${{ needs.change-scope.outputs.beta_release_prep }}',
      BUILD_RESULT: '${{ needs.build.result }}',
      TEST_RESULT: '${{ needs.test.result }}',
    })
    expect(gate?.run).toContain('[[ "$PREFLIGHT_RESULT" != "success" ]]')
    expect(gate?.run).toContain('[[ "$BETA_RELEASE_PREP" == "true" ]]')
    expect(gate?.run).toContain('[[ "$BUILD_RESULT" == "success" ]]')
    expect(gate?.run).toContain('[[ "$BUILD_RESULT" != "success" ]]')
    expect(gate?.run).toContain('[[ "$TEST_RESULT" == "success" ]]')
    expect(gate?.run).toContain('[[ "$TEST_RESULT" == "skipped" ]]')
  })

  it('bounds cross-platform runners even when a step never reports completion', () => {
    expect(workflow.jobs['cross-platform-test']['timeout-minutes']).toBe(30)
  })

  it('omits hosted platform and dev smokes from dev PRs while keeping full master lanes', () => {
    const crossPlatform = workflow.jobs['cross-platform-test']
    expect(crossPlatform.strategy?.matrix?.os).toEqual(['macos-14', 'windows-latest'])
    const fullBuild = crossPlatform.steps?.find(
      (step) => step.name === 'Build complete workspace for stable and scheduled validation',
    )
    const fullTest = crossPlatform.steps?.find(
      (step) => step.name === 'Run complete suite for stable and scheduled validation',
    )

    expect(crossPlatform.if).toContain("needs.change-scope.result != 'success'")
    expect(crossPlatform.if).toContain("beta_release_prep != 'true'")
    expect(crossPlatform.if).toContain("github.base_ref == 'master'")
    expect(fullBuild?.run).toBe('pnpm build')
    expect(fullTest?.run).toBe('pnpm test')
    expect(crossPlatform.steps?.some(
      (step) => step.name === 'Run native platform contracts for routine integration PRs',
    )).toBe(false)

    const devSmoke = workflow.jobs['dev-smoke']
    expect(devSmoke.if).toContain("needs.change-scope.result != 'success'")
    expect(devSmoke.if).toContain("beta_release_prep != 'true'")
    expect(devSmoke.if).toContain("github.base_ref == 'master'")
  })
})
