import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

interface WorkflowStep {
  if?: string
  name?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
}

interface WorkflowJob {
  if?: string
  needs?: string | string[]
  'timeout-minutes'?: number
  steps?: WorkflowStep[]
  strategy?: {
    matrix?: {
      include?: Array<{ os?: string; platform?: string; arch?: string }>
    }
  }
}

const root = resolve(import.meta.dirname, '..')
const workflow = YAML.parse(
  readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8'),
) as {
  on: {
    workflow_dispatch?: {
      inputs?: Record<string, {
        required?: boolean
        type?: string
        options?: string[]
      }>
    }
  }
  concurrency?: {
    group?: string
    'cancel-in-progress'?: boolean
  }
  jobs: Record<string, WorkflowJob>
}

function step(job: WorkflowJob, name: string): WorkflowStep {
  const found = job.steps?.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`release workflow step is missing: ${name}`)
  return found
}

function needs(job: WorkflowJob): string[] {
  if (!job.needs) return []
  return Array.isArray(job.needs) ? job.needs : [job.needs]
}

describe('Release workflow critical path', () => {
  it('requires an explicit tag/package release decision instead of publishing on master push', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflow.on.workflow_dispatch?.inputs).toMatchObject({
      operation: {
        required: true,
        type: 'choice',
        options: ['release', 'mirror'],
      },
      tag: {
        required: true,
        type: 'string',
      },
      channel: {
        required: true,
        type: 'choice',
        options: ['beta', 'stable'],
      },
    })
    expect(workflow.concurrency).toEqual({
      group: 'openalice-release-publication',
      'cancel-in-progress': false,
    })

    const plan = step(workflow.jobs.release, 'Validate release intent and version authority').run ?? ''
    expect(plan).toContain('refs/heads/master')
    expect(plan).toContain("require('./package.json').version")
    expect(plan).toContain("require('./packages/cli/package.json').version")
    expect(plan).toContain('Release tag already exists')
    expect(plan).toContain("RELEASE_CHANNEL\" = \"stable")
    expect(plan).toContain("RELEASE_CHANNEL\" = \"beta")
    expect(plan).toContain('does not match channel')

    for (const name of [
      'Create beta tag and GitHub prerelease from accepted candidates',
      'Create stable tag and GitHub Release from accepted candidates',
    ]) {
      expect(step(workflow.jobs['publish-release'], name).with?.target_commitish)
        .toBe('${{ needs.release.outputs.source_sha }}')
    }
  })

  it('selects the previous release from the same channel', () => {
    const plan = step(workflow.jobs.release, 'Validate release intent and version authority').run ?? ''
    expect(plan).toContain('git for-each-ref --merged="$SOURCE_SHA" --sort=-version:refname')
    expect(plan).toContain('PREVIOUS_TAG_PATTERN')
    expect(plan).not.toContain('git describe --tags')
    expect(step(workflow.jobs.release, 'Generate release notes').run)
      .toContain('${{ steps.plan.outputs.previous_tag }}')
  })

  it('keeps existing-tag mirror repair distinct from new release creation', () => {
    const plan = step(workflow.jobs.release, 'Validate release intent and version authority').run ?? ''
    expect(plan).toContain('Mirror repair requires an existing release tag')
    expect(workflow.jobs['mirror-release-assets'].if).toContain(
      "needs.release.outputs.operation == 'mirror'",
    )
  })

  it('bounds native candidate jobs without weakening downstream gates', () => {
    expect(workflow.jobs['build-desktop']['timeout-minutes']).toBe(45)
    expect(workflow.jobs['build-broker-packs']['timeout-minutes']).toBe(30)
    expect(workflow.jobs['build-cli-release']['timeout-minutes']).toBe(45)
  })

  it('builds native Broker Packs outside the desktop package jobs', () => {
    const desktop = workflow.jobs['build-desktop']
    const brokerPacks = workflow.jobs['build-broker-packs']

    expect(desktop.steps?.map((candidate) => candidate.name)).not.toContain('Build optional Broker Packs')
    expect(brokerPacks.strategy?.matrix?.include).toEqual([
      { os: 'macos-14', arch: 'arm64' },
      { os: 'macos-15-intel', arch: 'x64' },
      { os: 'windows-latest', arch: 'x64' },
      { os: 'ubuntu-latest', arch: 'x64' },
    ])
    expect(step(brokerPacks, 'Preserve Broker Packs').with?.['name']).toBe(
      'broker-packs-${{ runner.os }}-${{ matrix.arch }}',
    )
  })

  it('preserves desktop candidates before running retriable N-1 acceptance', () => {
    const desktop = workflow.jobs['build-desktop']
    const upgrade = workflow.jobs['accept-desktop-upgrade']

    expect(step(desktop, 'Preserve desktop release candidate').uses).toBe('actions/upload-artifact@v4')
    expect(desktop.steps?.map((candidate) => candidate.name)).not.toContain(
      'Prove final desktop artifact upgrades previous release state',
    )
    expect(needs(upgrade)).toEqual(['release', 'build-desktop'])
    expect(step(upgrade, 'Restore desktop release candidate').uses).toBe('actions/download-artifact@v4')
    expect(step(upgrade, 'Prove final desktop artifact upgrades previous release state')).toBeDefined()
  })

  it('keeps publication gated on both candidate builds and upgrade receipts', () => {
    expect(needs(workflow.jobs['publish-release'])).toEqual(expect.arrayContaining([
      'preflight-public-cli-authority',
      'build-desktop',
      'accept-desktop-upgrade',
      'build-broker-packs',
      'build-cli-release',
      'build-cli-package-channels',
      'accept-cli-homebrew',
      'accept-cli-aur',
      'accept-cli-legacy-cutover',
      'cli-installer-acceptance',
    ]))
    expect(workflow.jobs['publish-release'].if).toContain(
      "needs.preflight-public-cli-authority.result == 'success'",
    )
  })

  it('preflights every enabled public CLI channel before creating the release', () => {
    const preflight = workflow.jobs['preflight-public-cli-authority']
    expect(needs(preflight)).toEqual(['release'])
    expect(preflight['timeout-minutes']).toBe(5)
    const verify = step(preflight, 'Verify every opted-in public channel before release publication')
    expect(verify.if).toContain("needs.release.outputs.channel == 'stable'")
    expect(verify.run).toBe('node scripts/preflight-public-cli-authority.mjs')
    for (const job of [
      'build-desktop',
      'cli-installer-acceptance',
      'build-cli-release',
      'build-broker-packs',
    ]) {
      expect(needs(workflow.jobs[job])).toContain('preflight-public-cli-authority')
    }
  })

  it('installs the remote smoke parser before release installer acceptance', () => {
    const steps = workflow.jobs['cli-installer-acceptance'].steps ?? []
    const pnpm = steps.findIndex((candidate) => candidate.uses === 'pnpm/action-setup@v6')
    const node = steps.findIndex((candidate) => candidate.uses === 'actions/setup-node@v7')
    const install = steps.findIndex((candidate) => candidate.run === 'pnpm install --frozen-lockfile --filter @traderalice/openalice-cli')
    const remote = steps.findIndex((candidate) => candidate.name === 'Exercise candidate installer through managed SSH remote')

    expect(pnpm).toBeGreaterThanOrEqual(0)
    expect(node).toBeGreaterThan(pnpm)
    expect(steps[node]?.with?.cache).toBe('pnpm')
    expect(install).toBeGreaterThan(node)
    expect(remote).toBeGreaterThan(install)
  })

  it('does not activate stable package-manager channels before CDN verification', () => {
    const verification = workflow.jobs['verify-public-cli-channels']
    expect(needs(verification)).toContain('mirror-release-assets')
    expect(verification.if).toContain("needs.mirror-release-assets.result == 'success'")
  })

  it('publishes the four accepted native CLI archives and checksums', () => {
    const nativeCli = workflow.jobs['build-cli-release']
    const publication = workflow.jobs['publish-release']

    expect(nativeCli.strategy?.matrix?.include).toEqual([
      { os: 'macos-14', platform: 'darwin', arch: 'arm64' },
      { os: 'macos-15-intel', platform: 'darwin', arch: 'x64' },
      { os: 'ubuntu-24.04', platform: 'linux', arch: 'x64' },
      { os: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64' },
    ])
    expect(nativeCli.steps?.some((candidate) => candidate.uses === 'oven-sh/setup-bun@v2')).toBe(true)
    expect(step(nativeCli, 'Build Alice and native CLI').run).toContain('build:bun-runtime:feasibility')
    expect(step(nativeCli, 'Preserve accepted native CLI').with?.name).toBe(
      'cli-release-${{ matrix.platform }}-${{ matrix.arch }}',
    )
    for (const name of [
      'Create beta tag and GitHub prerelease from accepted candidates',
      'Create stable tag and GitHub Release from accepted candidates',
    ]) {
      expect(step(publication, name).with?.files).toContain('dist/release-cli/*.tar.gz.sha256')
    }
  })

  it('accepts manager installs and derives every channel from accepted archives', () => {
    const nativeCli = workflow.jobs['build-cli-release']
    const channels = workflow.jobs['build-cli-package-channels']
    const homebrew = workflow.jobs['accept-cli-homebrew']
    const linuxbrew = workflow.jobs['accept-cli-linuxbrew']
    const aur = workflow.jobs['accept-cli-aur']

    const npmAndBun = step(nativeCli, 'Accept npm and Bun installs from the native candidate').run ?? ''
    expect(npmAndBun).toContain('--manager npm')
    expect(npmAndBun).toContain('--manager bun')
    expect(needs(channels)).toEqual(['release', 'build-cli-release'])
    expect(channels.if).toContain("needs.release.outputs.channel == 'stable'")
    expect(step(channels, 'Derive package-manager metadata from accepted archives').run)
      .toContain('--require-all')
    expect(homebrew.strategy?.matrix?.include).toEqual([
      { os: 'macos-14', arch: 'arm64' },
      { os: 'macos-15-intel', arch: 'x64' },
    ])
    expect(homebrew.if).toContain("needs.release.outputs.channel == 'stable'")
    expect(step(homebrew, 'Install and run the accepted archive through Homebrew').run)
      .toContain('--manager brew')
    expect(step(homebrew, 'Install and run the accepted archive through Homebrew').run)
      .toContain('prepare-cli-previous-release.mjs')
    expect(linuxbrew.strategy?.matrix?.include).toEqual([
      { os: 'ubuntu-24.04', arch: 'x64' },
      { os: 'ubuntu-24.04-arm', arch: 'arm64' },
    ])
    expect(linuxbrew.if).toContain("needs.release.outputs.channel == 'stable'")
    expect(step(linuxbrew, 'Install and run the accepted archive through Linuxbrew').run)
      .toContain('cli-linuxbrew-smoke.mjs')
    expect(aur.strategy?.matrix?.include).toEqual([
      { os: 'ubuntu-24.04', arch: 'x64' },
      { os: 'ubuntu-24.04-arm', arch: 'arm64' },
    ])
    expect(aur.if).toContain("needs.release.outputs.channel == 'stable'")
    expect(step(aur, 'Build, install, and run the generated AUR package').run)
      .toContain('cli-aur-container-smoke.mjs')
    const cutover = workflow.jobs['accept-cli-legacy-cutover']
    expect(needs(cutover)).toEqual(['release', 'build-cli-release'])
    const cutoverRun = step(cutover, 'Replace the published legacy CLI with the accepted native candidate').run ?? ''
    expect(cutoverRun).toContain('cli-legacy-cutover-smoke.mjs')
    expect(cutoverRun).toContain('--channel "${{ needs.release.outputs.channel }}"')
  })

  it('publishes npm platform packages before the stable meta package', () => {
    const npm = workflow.jobs['publish-cli-npm']
    expect(needs(npm)).toEqual([
      'release',
      'publish-release',
      'build-cli-package-channels',
      'verify-public-cli-channels',
    ])
    expect(npm.if).toContain("needs.verify-public-cli-channels.result == 'success'")
    expect(npm.if).toContain("needs.release.outputs.channel == 'stable'")
    const publish = step(npm, 'Publish platform packages before the meta package').run ?? ''
    expect(publish.indexOf('packages.slice(0,-1)')).toBeLessThan(publish.indexOf('packages.at(-1)'))
  })

  it('verifies public release bytes before activating external package channels', () => {
    const verify = workflow.jobs['verify-public-cli-channels']
    const publication = workflow.jobs['publish-release']
    expect(needs(verify)).toEqual([
      'release',
      'publish-release',
      'build-cli-package-channels',
      'mirror-release-assets',
    ])
    expect(step(verify, 'Verify accepted archives are publicly readable and unchanged').run)
      .toContain('verify-public-cli-channels.mjs')
    expect(step(verify, 'Compare public metadata with the accepted publication inputs').run)
      .toContain('cmp dist/cli-package-channels/cli-package-channels/homebrew/openalice.rb')
    const stageSrcinfo = step(publication, 'Stage GitHub-safe AUR metadata asset')
    expect(stageSrcinfo.if).toBe("needs.release.outputs.channel == 'stable'")
    expect(stageSrcinfo.run).toContain(
      'aur/.SRCINFO dist/release-cli-packages/cli-package-channels/aur/openalice-bin.SRCINFO',
    )
    const stableFiles = step(
      publication,
      'Create stable tag and GitHub Release from accepted candidates',
    ).with?.files
    const betaFiles = step(
      publication,
      'Create beta tag and GitHub prerelease from accepted candidates',
    ).with?.files
    expect(stableFiles).toContain('aur/openalice-bin.SRCINFO')
    expect(stableFiles).not.toContain('aur/.SRCINFO')
    expect(betaFiles).not.toContain('openalice-bin.SRCINFO')
    expect(betaFiles).not.toContain('aur/.SRCINFO')

    const acceptedInputs = step(
      workflow.jobs['build-cli-package-channels'],
      'Preserve package-manager publication inputs',
    )
    expect(acceptedInputs.with?.path).toContain('aur/.SRCINFO')
    expect(acceptedInputs.with?.path).not.toContain('openalice-bin.SRCINFO')
    expect(acceptedInputs.with?.['include-hidden-files']).toBe(true)

    const compare = step(verify, 'Compare public metadata with the accepted publication inputs').run ?? ''
    expect(compare).toContain('--pattern openalice-bin.SRCINFO')
    expect(compare).toContain('aur/.SRCINFO dist/public-cli-channels/openalice-bin.SRCINFO')
    expect(compare).not.toContain('--pattern .SRCINFO')

    const homebrew = workflow.jobs['publish-cli-homebrew']
    expect(needs(homebrew)).toContain('verify-public-cli-channels')
    expect(homebrew.if).toContain("vars.OPENALICE_PUBLISH_HOMEBREW == 'true'")
    expect(homebrew.if).toContain("needs.release.outputs.channel == 'stable'")
    const tapCheckout = homebrew.steps?.find((candidate) => candidate.uses === 'actions/checkout@v7')
    expect(tapCheckout?.with?.repository).toBe('TraderAlice/homebrew-tap')
    expect(step(homebrew, 'Activate the verified formula in the TraderAlice tap').run)
      .toContain('git diff --cached --quiet')

    const aur = workflow.jobs['publish-cli-aur']
    expect(needs(aur)).toContain('verify-public-cli-channels')
    expect(aur.if).toContain("vars.OPENALICE_PUBLISH_AUR == 'true'")
    expect(aur.if).toContain("needs.release.outputs.channel == 'stable'")
    const aurCheckout = step(aur, 'Check out the AUR package repository').run ?? ''
    expect(aurCheckout).toContain('AUR_KNOWN_HOSTS')
    expect(aurCheckout).not.toContain('ssh-keyscan')
    const activateAur = step(aur, 'Activate the verified package metadata in AUR').run ?? ''
    expect(activateAur).toContain(
      'dist/cli-package-channels/cli-package-channels/aur/.SRCINFO aur/.SRCINFO',
    )
    expect(activateAur).not.toContain('openalice-bin.SRCINFO')
    expect(activateAur).toContain('git diff --cached --quiet')
  })

  it('keeps beta mirrors away from stable aliases', () => {
    const mirror = workflow.jobs['mirror-release-assets']
    const installerBuild = workflow.jobs['build-cli-installer']
    const installer = step(mirror, 'Verify release-owned CLI installer').run ?? ''
    const upload = step(mirror, 'Mirror release assets to Cloudflare R2').run ?? ''
    const verify = step(mirror, 'Verify CDN metadata').run ?? ''

    expect(step(installerBuild, 'Freeze and verify the accepted installer bytes').run)
      .toContain('sha256sum "$installer" > "${installer}.sha256"')
    expect(step(workflow.jobs['publish-release'], 'Create beta tag and GitHub prerelease from accepted candidates').with?.files)
      .toContain('dist/release-cli-installer/OpenAlice-*-install.sha256')
    expect(installer).toContain('sha256sum -c "${installer}.sha256"')
    expect(installer).toContain('Mirror repair requires a channel-aware Release')
    expect(mirror.steps?.some((candidate) => candidate.name === 'Publish generated release metadata and installer'))
      .toBe(false)
    expect(step(mirror, 'Keep mirror repair on the active channel release').if)
      .toContain("needs.release.outputs.operation == 'mirror'")
    expect(step(mirror, 'Snapshot stable aliases before a beta mirror').if)
      .toContain("needs.release.outputs.channel == 'beta'")
    expect(upload).toContain('s3://${R2_BUCKET}/beta/manifest.json')
    expect(upload).not.toContain('s3://${R2_BUCKET}/beta/install')
    expect(upload).toContain('s3://${R2_BUCKET}/install')
    expect(upload).toContain('if [ "$RELEASE_OPERATION" = "release" ]')
    expect(upload).toContain('--exclude "install"')
    expect(upload).toContain('--exclude "OpenAlice-*-install"')
    expect(upload).toContain('--exclude "OpenAlice-*-install.sha256"')
    expect(upload).toContain('aws s3api head-object')
    expect(upload).toContain('cmp "$installer" "$existing"')
    expect(upload).toContain('if [ "$RELEASE_CHANNEL" = "stable" ]')
    expect(verify).toContain('cmp /tmp/openalice-stable-before.sha256 /tmp/openalice-stable-after.sha256')
    expect(verify).toContain('MANIFEST_PATH="beta/manifest.json"')
    expect(verify).toContain('MANIFEST_PATH="manifest.json"')
    expect(verify).toContain('--channel "$RELEASE_CHANNEL"')
    expect(verify).toContain('INSTALL_URL="${BASE_URL}/install"')
    expect(verify).toContain('grep -Fq "Channel         stable (latest)"')
    expect(verify).not.toContain('Updates[[:space:]]+stable')
  })
})
