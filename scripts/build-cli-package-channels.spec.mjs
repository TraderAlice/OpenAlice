import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { bunReleaseContentIdentity } from './bun-release-content-identity.mjs'
import { buildCliPackageChannels } from './build-cli-package-channels.mjs'

const execFileAsync = promisify(execFile)
const version = '0.90.1'
const releasedAt = '2026-08-30T00:00:00.000Z'
const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('CLI package-manager channel generation', () => {
  it('derives npm, Homebrew, and AUR metadata from all accepted archives', async () => {
    const root = await fixture()
    const output = join(root, 'output')
    const manifest = buildCliPackageChannels({
      inputDir: join(root, 'input'),
      outputDir: output,
      version,
      releasedAt,
      requireAll: true,
    })

    expect(manifest.targets).toHaveLength(4)
    expect(manifest.executableBytesPreserved).toBe(true)
    expect(manifest.assetBaseUrl).toBe(
      `https://github.com/TraderAlice/OpenAlice/releases/download/v${version}`,
    )
    const meta = JSON.parse(await readFile(join(output, 'npm/openalice/package.json'), 'utf8'))
    expect(meta.optionalDependencies).toEqual({
      'openalice-darwin-arm64': version,
      'openalice-darwin-x64': version,
      'openalice-linux-arm64': version,
      'openalice-linux-x64': version,
    })
    const platformExecutable = await readFile(join(
      output,
      `npm/openalice-${process.platform}-${process.arch}/release/bin/openalice`,
    ))
    expect(platformExecutable).toEqual(Buffer.from(`#!/bin/sh\nprintf '${version}\\n'\n`))

    const formula = await readFile(join(output, 'homebrew/openalice.rb'), 'utf8')
    expect(formula.match(/releases\/download\/v0\.90\.1/g)).toHaveLength(4)
    expect(formula).toContain('method\\\":\\\"brew')
    expect(formula).toContain('(share/"openalice/release.json").write(release_metadata)')
    expect(formula).toContain('(share/"openalice/install-source.json").write(content)')
    const pkgbuild = await readFile(join(output, 'aur/PKGBUILD'), 'utf8')
    await expect(execFileAsync('bash', ['-n', join(output, 'aur/PKGBUILD')])).resolves.toBeDefined()
    expect(pkgbuild).toContain("method\": \"aur")
    expect(await readFile(join(output, 'aur/.SRCINFO'), 'utf8')).toContain('pkgname = openalice-bin')
  })

  it('can point system-manager fixtures at the same accepted local archives', async () => {
    const root = await fixture()
    const output = join(root, 'output')
    const assetBaseUrl = `file://${join(root, 'input')}`
    const manifest = buildCliPackageChannels({
      inputDir: join(root, 'input'),
      outputDir: output,
      version,
      releasedAt,
      requireAll: true,
      assetBaseUrl,
    })

    expect(manifest.assetBaseUrl).toBe(assetBaseUrl)
    expect(await readFile(join(output, 'homebrew/openalice.rb'), 'utf8'))
      .toContain(`${assetBaseUrl}/openalice-cli-${version}-darwin-arm64.tar.gz`)
    expect(await readFile(join(output, 'aur/PKGBUILD'), 'utf8'))
      .toContain(`${assetBaseUrl}/openalice-cli-${version}-linux-x64.tar.gz`)
  })

  it('materializes a native npm command and records manager ownership without a download fallback', async () => {
    const root = await fixture()
    const output = join(root, 'output')
    buildCliPackageChannels({
      inputDir: join(root, 'input'),
      outputDir: output,
      version,
      releasedAt,
      requireAll: true,
    })
    const metaRoot = join(output, 'npm/openalice')
    const packageName = `openalice-${process.platform}-${process.arch}`
    await mkdir(join(metaRoot, 'node_modules'), { recursive: true })
    await symlink(join(output, 'npm', packageName), join(metaRoot, 'node_modules', packageName), 'dir')
    await execFileAsync(process.execPath, [join(metaRoot, 'postinstall.mjs')], {
      env: { ...process.env, npm_config_user_agent: 'npm/11.0.0 node/v22.0.0' },
    })

    const installed = await execFileAsync(join(metaRoot, 'bin/openalice'), ['--version'])
    expect(installed.stdout).toBe(`${version}\n`)
    expect(JSON.parse(await readFile(join(metaRoot, 'install-source.json'), 'utf8'))).toMatchObject({
      method: 'npm',
      artifact: { platform: process.platform, arch: process.arch },
    })
    expect(await readFile(join(metaRoot, 'share/openalice/fixture.txt'), 'utf8')).toBe('resource\n')
    expect(await readFile(join(metaRoot, 'postinstall.mjs'), 'utf8')).not.toContain('npm install')
    expect(await readFile(join(metaRoot, 'postinstall.sh'), 'utf8')).toContain('bun/*) exec bun')
    expect(await readFile(join(metaRoot, 'README.md'), 'utf8')).toContain(
      'bun add -g --trust openalice',
    )
  })

  it('allows a current-target npm-only build but requires the full matrix for system managers', async () => {
    const root = await fixture({ targets: [[process.platform, process.arch]] })
    expect(() => buildCliPackageChannels({
      inputDir: join(root, 'input'),
      outputDir: join(root, 'all-output'),
      version,
      releasedAt,
    })).toThrow('require all four')
    expect(() => buildCliPackageChannels({
      inputDir: join(root, 'input'),
      outputDir: join(root, 'npm-output'),
      version,
      releasedAt,
      npmOnly: true,
    })).not.toThrow()
  })
})

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'openalice-cli-channels-'))
  temporaryPaths.push(root)
  const input = join(root, 'input')
  await mkdir(input)
  const targets = options.targets ?? [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'arm64'],
    ['linux', 'x64'],
  ]
  for (const [platform, arch] of targets) {
    const releaseName = `openalice-cli-${version}-${platform}-${arch}`
    const releaseRoot = join(root, releaseName)
    const executable = join(releaseRoot, 'bin/openalice')
    await mkdir(join(releaseRoot, 'bin'), { recursive: true })
    await mkdir(join(releaseRoot, 'share/openalice'), { recursive: true })
    await writeFile(executable, `#!/bin/sh\nprintf '${version}\\n'\n`)
    await chmod(executable, 0o755)
    const resource = join(releaseRoot, 'share/openalice/fixture.txt')
    const license = join(releaseRoot, 'LICENSE')
    const notices = join(releaseRoot, 'THIRD_PARTY_NOTICES.md')
    await writeFile(resource, 'resource\n')
    await writeFile(license, 'license\n')
    await writeFile(notices, 'notices\n')
    const release = {
      schemaVersion: 1,
      product: 'OpenAlice CLI',
      version,
      platform,
      arch,
      bunVersion: '1.4.0',
      executable: 'bin/openalice',
      resourceRoot: 'share/openalice',
      files: [
        fileEntry('bin/openalice', await readFile(executable), 0o755),
        fileEntry('share/openalice/fixture.txt', await readFile(resource)),
        fileEntry('LICENSE', await readFile(license)),
        fileEntry('THIRD_PARTY_NOTICES.md', await readFile(notices)),
      ],
    }
    release.contentIdentity = bunReleaseContentIdentity(release)
    await writeFile(join(releaseRoot, 'release.json'), JSON.stringify(release))
    const archive = join(input, `${releaseName}.tar.gz`)
    await execFileAsync('tar', ['-czf', archive, '-C', root, releaseName])
    const checksum = createHash('sha256').update(await readFile(archive)).digest('hex')
    await writeFile(`${archive}.sha256`, `${checksum}  ${basename(archive)}\n`)
  }
  return root
}

function fileEntry(path, content, mode = 0o644) {
  return {
    path,
    type: 'file',
    bytes: content.length,
    mode,
    sha256: createHash('sha256').update(content).digest('hex'),
  }
}
