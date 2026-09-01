import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

interface WorkflowStep {
  name?: string
  if?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
}

interface WorkflowJob {
  if?: string
  needs?: string | string[]
  steps?: WorkflowStep[]
  strategy?: {
    matrix?: {
      include?: Array<{ os?: string; platform?: string; arch?: string }>
    }
  }
}

const root = resolve(import.meta.dirname, '..')
const workflow = YAML.parse(
  readFileSync(resolve(root, '.github/workflows/cli-installer-smoke.yml'), 'utf8'),
) as {
  on?: {
    push?: { branches?: string[] }
    pull_request?: { branches?: string[] }
  }
  jobs: Record<string, WorkflowJob>
}

function step(job: WorkflowJob, name: string): WorkflowStep {
  const found = job.steps?.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`CLI installer workflow step is missing: ${name}`)
  return found
}

describe('CLI installer dev publication workflow', () => {
  it('owns every dev push while reserving hosted PR acceptance for master', () => {
    expect(workflow.on?.push?.branches).toEqual(['dev'])
    expect(workflow.on?.pull_request?.branches).toEqual(['master'])
  })

  it('keeps master and manual acceptance behind the trusted preflight', () => {
    const feasibility = workflow.jobs['bun-cli-feasibility']
    const checkoutInstall = workflow.jobs['checkout-install']
    const checkoutRemote = workflow.jobs['checkout-remote']

    for (const job of [feasibility, checkoutRemote]) {
      expect(job.if).toContain("github.event_name != 'pull_request' || github.base_ref == 'master'")
      expect(job.if).toContain("needs.release-prep-scope.result != 'success'")
      expect(job.if).toContain("beta_release_prep != 'true'")
    }
    expect(checkoutInstall.if).not.toContain("github.base_ref == 'master'")
    expect(checkoutInstall.if).toContain("needs.release-prep-scope.result != 'success'")
    expect(checkoutInstall.if).toContain("beta_release_prep != 'true'")
  })

  it('builds all four supported native targets with the pinned Bun version', () => {
    const build = workflow.jobs['build-dev-cli']
    expect(build.strategy?.matrix?.include).toEqual([
      { os: 'macos-14', platform: 'darwin', arch: 'arm64' },
      { os: 'macos-15-intel', platform: 'darwin', arch: 'x64' },
      { os: 'ubuntu-24.04', platform: 'linux', arch: 'x64' },
      { os: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64' },
    ])
    expect(build.steps?.some((candidate) => candidate.uses === 'oven-sh/setup-bun@v2')).toBe(true)
    expect(step(build, 'Accept multiprocess recovery once per dev commit')).toMatchObject({
      if: "matrix.platform == 'linux' && matrix.arch == 'x64'",
      run: 'pnpm build:bun-runtime:feasibility',
    })
    expect(step(build, 'Build Alice server').run).toBe('pnpm build:server')
    expect(step(build, 'Build native CLI').run).toBe('pnpm build:bun:release')
    const stepNames = build.steps?.map((candidate) => candidate.name)
    expect(stepNames?.indexOf('Build Alice server')).toBeLessThan(
      stepNames?.indexOf('Accept multiprocess recovery once per dev commit') ?? -1,
    )
    expect(stepNames?.indexOf('Accept multiprocess recovery once per dev commit')).toBeLessThan(
      stepNames?.indexOf('Build native CLI') ?? -1,
    )
    expect(step(build, 'Preserve accepted dev candidate').with?.name).toBe(
      'dev-cli-${{ matrix.platform }}-${{ matrix.arch }}',
    )
  })

  it('accepts native npm and Bun installs on PR macOS and Linux hosts', () => {
    const build = workflow.jobs['bun-cli-feasibility']
    const acceptance = step(build, 'Accept npm and Bun installs from the current native candidate').run ?? ''
    expect(acceptance).toContain('--manager npm')
    expect(acceptance).toContain('--manager bun')
    expect(acceptance).toContain('--npm-only')
  })

  it('keeps dev publication on the packaging lane instead of release acceptance', () => {
    const build = workflow.jobs['build-dev-cli']
    expect(build.steps?.some((candidate) => candidate.name?.includes('npm and Bun'))).toBe(false)
    expect(workflow.jobs['accept-dev-linuxbrew']).toBeUndefined()
    expect(workflow.jobs['accept-dev-aur']).toBeUndefined()
    expect(workflow.jobs['accept-dev-legacy-cutover']).toBeUndefined()
  })

  it('validates candidates before uploading immutable assets and fixed aliases', () => {
    const publish = workflow.jobs['publish-dev-cli']
    expect(publish.needs).toBe('build-dev-cli')
    const prepare = step(publish, 'Validate candidates and prepare channel aliases').run ?? ''
    expect(prepare).toContain('prepare-cli-dev-assets.mjs')
    expect(prepare).toContain('--installer install')
    const upload = step(publish, 'Publish immutable candidates and activate dev aliases').run ?? ''
    expect(upload.indexOf('cli/dev/releases/${GITHUB_SHA}')).toBeGreaterThanOrEqual(0)
    expect(upload.indexOf('aliases/*.tar.gz')).toBeLessThan(upload.indexOf('aliases/*.sha256'))
    expect(upload.indexOf('aliases/*.sha256')).toBeLessThan(upload.indexOf('manifest.json'))
  })

  it('runs the live network install only after a successful push publication', () => {
    const live = workflow.jobs['dev-channel-install']
    expect(live.needs).toBe('publish-dev-cli')
    expect(live.if).toContain("needs.publish-dev-cli.result == 'success'")
  })

  it('installs the remote smoke parser before running the checkout fixture', () => {
    const steps = workflow.jobs['checkout-remote'].steps ?? []
    const pnpm = steps.findIndex((candidate) => candidate.uses === 'pnpm/action-setup@v6')
    const node = steps.findIndex((candidate) => candidate.uses === 'actions/setup-node@v7')
    const install = steps.findIndex((candidate) => candidate.run === 'pnpm install --frozen-lockfile --filter @traderalice/openalice-cli')
    const smoke = steps.findIndex((candidate) => candidate.name === 'Exercise clean SSH host fixture')

    expect(pnpm).toBeGreaterThanOrEqual(0)
    expect(node).toBeGreaterThan(pnpm)
    expect(steps[node]?.with?.cache).toBe('pnpm')
    expect(install).toBeGreaterThan(node)
    expect(smoke).toBeGreaterThan(install)
  })
})
