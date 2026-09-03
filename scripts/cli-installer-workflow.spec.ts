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
  env?: Record<string, string>
}

interface WorkflowJob {
  if?: string
  needs?: string | string[]
  'runs-on'?: string
  outputs?: Record<string, string>
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
    const neutral = workflow.jobs['build-dev-cli-neutral']
    const build = workflow.jobs['build-dev-cli']
    expect(neutral.needs).toBeUndefined()
    expect(neutral['runs-on']).toBe('ubuntu-24.04')
    expect(neutral.if).toBe("github.event_name == 'push'")
    const neutralInstall = neutral.steps?.findIndex(
      (candidate) => candidate.run === "pnpm install --frozen-lockfile --filter='!@traderalice/desktop'",
    ) ?? -1
    const neutralBuild = neutral.steps?.findIndex(
      (candidate) => candidate.name === 'Build platform-neutral server inputs',
    ) ?? -1
    expect(neutralInstall).toBeGreaterThanOrEqual(0)
    expect(neutralBuild).toBeGreaterThan(neutralInstall)
    expect(step(neutral, 'Build platform-neutral server inputs').run).toBe('pnpm build:server')
    const prepareNeutral = step(neutral, 'Prepare commit-bound neutral input receipt').run ?? ''
    expect(prepareNeutral).toContain('prepare-cli-neutral-inputs.mjs prepare')
    expect(prepareNeutral).toContain('--commit "$GITHUB_SHA"')
    const neutralUpload = step(neutral, 'Preserve platform-neutral inputs').with
    expect(neutralUpload).toMatchObject({
      name: 'rolling-dev-neutral-inputs',
      path: 'dist/dev-neutral-inputs',
      'if-no-files-found': 'error',
      'retention-days': 7,
    })
    expect(String(neutralUpload?.name)).not.toMatch(/^dev-cli-/)
    expect(build.needs).toBe('build-dev-cli-neutral')
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
    expect(build.steps?.some((candidate) => candidate.run?.includes('pnpm build:server'))).toBe(false)
    expect(step(build, 'Download platform-neutral inputs').with).toMatchObject({
      name: 'rolling-dev-neutral-inputs',
      path: 'dist/dev-neutral-inputs',
    })
    const verifyNeutral = step(build, 'Verify and install commit-bound neutral inputs').run ?? ''
    expect(verifyNeutral).toContain('prepare-cli-neutral-inputs.mjs verify')
    expect(verifyNeutral).toContain('--commit "$GITHUB_SHA"')
    expect(verifyNeutral).toContain('--install')
    expect(step(build, 'Build native CLI').run).toBe('pnpm build:bun:release')
    const stepNames = build.steps?.map((candidate) => candidate.name)
    const install = build.steps?.findIndex(
      (candidate) => candidate.run === "pnpm install --frozen-lockfile --filter='!@traderalice/desktop'",
    ) ?? -1
    expect(install).toBeGreaterThanOrEqual(0)
    expect(install).toBeLessThan(stepNames?.indexOf('Download platform-neutral inputs') ?? -1)
    expect(stepNames?.indexOf('Download platform-neutral inputs')).toBeLessThan(
      stepNames?.indexOf('Verify and install commit-bound neutral inputs') ?? -1,
    )
    expect(stepNames?.indexOf('Verify and install commit-bound neutral inputs')).toBeLessThan(
      stepNames?.indexOf('Accept multiprocess recovery once per dev commit') ?? -1,
    )
    expect(stepNames?.indexOf('Accept multiprocess recovery once per dev commit')).toBeLessThan(
      stepNames?.indexOf('Build native CLI') ?? -1,
    )
    expect(step(build, 'Preserve accepted dev candidate').with?.name).toBe(
      'dev-cli-${{ matrix.platform }}-${{ matrix.arch }}',
    )
    expect(step(build, 'Preserve accepted dev candidate').with?.['retention-days']).toBe(7)
  })

  it('shares only the reviewed platform-neutral build roots', async () => {
    const { CLI_NEUTRAL_INPUT_ROOTS } = await import('./prepare-cli-neutral-inputs.mjs')
    expect(CLI_NEUTRAL_INPUT_ROOTS).toEqual([
      'ui/dist',
      'packages/connector-protocol/dist',
      'packages/guardian-runtime/dist',
      'packages/ibkr/dist',
      'packages/opentypebb/dist',
      'packages/uta-protocol/dist',
    ])
    expect(CLI_NEUTRAL_INPUT_ROOTS).not.toContain('node_modules')
    expect(CLI_NEUTRAL_INPUT_ROOTS.every((path: string) => !path.includes('bun-release'))).toBe(true)
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

  it('publishes commit-addressed candidates without overwriting accepted bytes', () => {
    const publish = workflow.jobs['publish-dev-cli-candidate']
    expect(publish.needs).toBe('build-dev-cli')
    const prepare = step(publish, 'Validate candidates and prepare candidate receipt').run ?? ''
    expect(prepare).toContain('prepare-cli-dev-assets.mjs')
    expect(prepare).toContain('--installer install')
    const upload = step(publish, 'Publish immutable candidate without overwriting accepted bytes').run ?? ''
    expect(upload).toContain('cli/dev/releases/${GITHUB_SHA}/$(basename "$file")')
    expect(upload).toContain("--if-none-match '*'")
    expect(upload).toContain('Reusing byte-identical immutable object')
    expect(upload).not.toContain('cli/dev/manifest.json')
    expect(upload).not.toContain('openalice-cli-dev-')
    expect(step(publish, 'Preserve candidate activation receipt').with).toMatchObject({
      name: 'dev-channel-receipt',
      'retention-days': 7,
    })
  })

  it('activates only the exact remote dev head and makes stale reruns a no-op', () => {
    const activate = workflow.jobs['activate-dev-cli']
    expect(activate.needs).toBe('publish-dev-cli-candidate')
    expect(activate.outputs?.activated).toContain('steps.activate.outputs.activated')
    const firstCheck = step(activate, 'Check whether candidate is current dev head').run ?? ''
    const finalCheck = step(activate, 'Revalidate dev head before mutable activation').run ?? ''
    for (const check of [firstCheck, finalCheck]) {
      expect(check).toContain('git ls-remote --exit-code origin refs/heads/dev')
      expect(check).toContain('REMOTE_DEV_SHA" != "$GITHUB_SHA')
      expect(check).toContain('current=false')
      expect(check).toContain('activation is a no-op')
    }
    const activation = step(activate, 'Activate manifest and transitional aliases').run ?? ''
    expect(activation).toContain('Compatibility only')
    expect(activation).toContain('cli/dev/${alias}')
    expect(activation).toContain('git ls-remote --exit-code origin refs/heads/dev')
    expect(activation.indexOf('REMOTE_DEV_SHA" != "$GITHUB_SHA')).toBeLessThan(
      activation.indexOf('--key "cli/dev/manifest.json"'),
    )
    expect(activation).toContain('echo "activated=true"')
  })

  it('runs exact-commit live acceptance only after successful activation', () => {
    const live = workflow.jobs['dev-channel-install']
    expect(live.needs).toBe('activate-dev-cli')
    expect(live.if).toContain("needs.activate-dev-cli.result == 'success'")
    expect(live.if).toContain("needs.activate-dev-cli.outputs.activated == 'true'")
    const install = step(live, 'Install raw dev script and dev payload in a clean host')
    expect(install.env?.EXPECTED_COMMIT).toBe("${{ github.event_name == 'push' && github.sha || '' }}")
    expect(install.run).toContain('--expected-commit "$EXPECTED_COMMIT"')
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
