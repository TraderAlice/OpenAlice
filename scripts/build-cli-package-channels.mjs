#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  CLI_RELEASE_TARGETS,
  validateCliReleaseArchive,
} from './prepare-cli-dev-assets.mjs'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const repository = 'TraderAlice/OpenAlice'
const npmMetaName = 'openalice'

export function buildCliPackageChannels({
  inputDir,
  outputDir,
  version,
  releasedAt,
  requireAll = false,
  npmOnly = false,
  assetBaseUrl,
}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid OpenAlice version: ${version}`)
  }
  const releasedAtDate = new Date(releasedAt)
  if (!Number.isFinite(releasedAtDate.getTime())) {
    throw new Error(`invalid release timestamp: ${releasedAt}`)
  }
  const releaseTimestamp = releasedAtDate.toISOString()
  const resolvedAssetBaseUrl = normalizeAssetBaseUrl(assetBaseUrl, version)
  const inputRoot = resolve(inputDir)
  const outputRoot = resolve(outputDir)
  assertSafeOutputRoot(outputRoot, inputRoot)
  rmSync(outputRoot, { recursive: true, force: true })
  mkdirSync(outputRoot, { recursive: true })

  const targets = []
  for (const [platform, arch] of CLI_RELEASE_TARGETS) {
    const archivePath = join(inputRoot, `openalice-cli-${version}-${platform}-${arch}.tar.gz`)
    if (!existsSync(archivePath)) continue
    const validated = validateCliReleaseArchive({ archivePath, version, platform, arch })
    targets.push({ platform, arch, archivePath, ...validated })
  }
  if (targets.length === 0) throw new Error('no native CLI release archives were found')
  if (requireAll && targets.length !== CLI_RELEASE_TARGETS.length) {
    throw new Error(`all ${CLI_RELEASE_TARGETS.length} native CLI targets are required; found ${targets.length}`)
  }
  if (!npmOnly && targets.length !== CLI_RELEASE_TARGETS.length) {
    throw new Error('Homebrew and AUR generation require all four native CLI targets')
  }

  const npm = buildNpmPackages({ outputRoot, version, targets })
  let homebrew = null
  let aur = null
  if (!npmOnly) {
    homebrew = buildHomebrewFormula({
      outputRoot,
      version,
      targets,
      assetBaseUrl: resolvedAssetBaseUrl,
    })
    aur = buildAurPackage({
      outputRoot,
      version,
      releasedAt: releaseTimestamp,
      targets,
      assetBaseUrl: resolvedAssetBaseUrl,
    })
  }
  const manifest = {
    schemaVersion: 1,
    version,
    releasedAt: releaseTimestamp,
    assetBaseUrl: resolvedAssetBaseUrl,
    executableBytesPreserved: true,
    targets: targets.map(({ platform, arch, checksum, metadata }) => ({
      platform,
      arch,
      sha256: checksum,
      contentIdentity: metadata.contentIdentity,
      npmPackage: platformPackageName(platform, arch),
    })),
    npm,
    ...(homebrew ? { homebrew } : {}),
    ...(aur ? { aur } : {}),
  }
  writeJson(join(outputRoot, 'cli-package-channels.json'), manifest)
  return manifest
}

function buildNpmPackages({ outputRoot, version, targets }) {
  const npmRoot = join(outputRoot, 'npm')
  mkdirSync(npmRoot, { recursive: true })
  const optionalDependencies = {}
  const platformPackages = []
  for (const target of targets) {
    const name = platformPackageName(target.platform, target.arch)
    optionalDependencies[name] = version
    const packageRoot = join(npmRoot, name)
    const releaseRoot = join(packageRoot, 'release')
    mkdirSync(releaseRoot, { recursive: true })
    execFileSync('tar', [
      '-xzf', target.archivePath,
      '-C', releaseRoot,
      '--strip-components=1',
    ])
    writeJson(join(packageRoot, 'package.json'), {
      name,
      version,
      description: `OpenAlice native CLI for ${target.platform}-${target.arch}`,
      license: 'AGPL-3.0-only',
      repository: { type: 'git', url: `git+https://github.com/${repository}.git` },
      os: [target.platform],
      cpu: [target.arch],
      files: ['release'],
      publishConfig: { access: 'public' },
      openalice: {
        platform: target.platform,
        arch: target.arch,
        artifactSha256: target.checksum,
        contentIdentity: target.metadata.contentIdentity,
      },
    })
    platformPackages.push(name)
  }

  const metaRoot = join(npmRoot, npmMetaName)
  mkdirSync(join(metaRoot, 'bin'), { recursive: true })
  writeJson(join(metaRoot, 'package.json'), {
    name: npmMetaName,
    version,
    description: 'OpenAlice native local Runtime and Workspace CLI',
    license: 'AGPL-3.0-only',
    repository: { type: 'git', url: `git+https://github.com/${repository}.git` },
    homepage: 'https://openalice.ai',
    bin: { openalice: './bin/openalice' },
    scripts: { postinstall: 'sh ./postinstall.sh' },
    os: [...new Set(targets.map(({ platform }) => platform))],
    cpu: [...new Set(targets.map(({ arch }) => arch))],
    files: ['bin', 'postinstall.sh', 'postinstall.mjs', 'LICENSE', 'README.md'],
    optionalDependencies,
    publishConfig: { access: 'public' },
  })
  copyFileSync(join(repositoryRoot, 'LICENSE'), join(metaRoot, 'LICENSE'))
  writeFileSync(join(metaRoot, 'README.md'), npmReadme(version))
  writeFileSync(join(metaRoot, 'postinstall.sh'), npmPostinstallLauncherSource())
  writeFileSync(join(metaRoot, 'postinstall.mjs'), npmPostinstallSource())
  const placeholder = join(metaRoot, 'bin', 'openalice')
  writeFileSync(placeholder, '#!/bin/sh\necho "OpenAlice native package installation did not finish." >&2\nexit 1\n')
  chmodSync(placeholder, 0o755)
  return { metaPackage: npmMetaName, platformPackages }
}

function npmPostinstallLauncherSource() {
  return `#!/bin/sh
set -eu

case "\${npm_config_user_agent-}" in
  bun/*) exec bun ./postinstall.mjs ;;
  *) exec node ./postinstall.mjs ;;
esac
`
}

function buildHomebrewFormula({ outputRoot, version, targets, assetBaseUrl }) {
  const formulaRoot = join(outputRoot, 'homebrew')
  mkdirSync(formulaRoot, { recursive: true })
  const formulaPath = join(formulaRoot, 'openalice.rb')
  const blocks = targets.map((target) => homebrewTargetBlock(version, target, assetBaseUrl)).join('\n')
  writeFileSync(formulaPath, `# typed: false
# frozen_string_literal: true

# Generated from accepted OpenAlice native release archives. DO NOT EDIT.
require "json"
require "time"

class Openalice < Formula
  desc "Local trading workspace for native coding-agent CLIs"
  homepage "https://openalice.ai"
  version "${version}"
  license "AGPL-3.0-only"

${blocks}
end
`)
  return { formula: 'homebrew/openalice.rb', tap: 'traderalice/tap' }
}

function homebrewTargetBlock(version, target, assetBaseUrl) {
  const osBlock = target.platform === 'darwin' ? 'on_macos' : 'on_linux'
  const cpu = target.arch === 'arm64'
    ? 'Hardware::CPU.arm? && Hardware::CPU.is_64_bit?'
    : 'Hardware::CPU.intel? && Hardware::CPU.is_64_bit?'
  const url = releaseAssetUrl(assetBaseUrl, target.archiveName)
  const provenance = {
    schemaVersion: 3,
    repository,
    cliVersion: version,
    selector: { kind: 'version', value: `v${version}` },
    installerUrl: 'https://github.com/TraderAlice/homebrew-tap',
    updateChannel: 'stable',
    method: 'brew',
    artifact: { platform: target.platform, arch: target.arch, sha256: target.checksum },
  }
  const json = JSON.stringify(provenance).replaceAll('"', '\\"')
  return `  ${osBlock} do
    if ${cpu}
      url "${url}"
      sha256 "${target.checksum}"

      def install
        release = buildpath
        release_metadata = (release/"release.json").read
        bin.install release/"bin/openalice"
        share.install release/"share/openalice"
        prefix.install release/"release.json"
        (share/"openalice/release.json").write(release_metadata)
        prefix.install release/"THIRD_PARTY_NOTICES.md"
        metadata = JSON.parse("${json}")
        metadata["installedAt"] = Time.now.utc.iso8601
        content = JSON.pretty_generate(metadata) + "\\n"
        (prefix/"install-source.json").write(content)
        (share/"openalice/install-source.json").write(content)
      end
    end
  end
`
}

function buildAurPackage({ outputRoot, version, releasedAt, targets, assetBaseUrl }) {
  const aurRoot = join(outputRoot, 'aur')
  mkdirSync(aurRoot, { recursive: true })
  const linuxArm = requireTarget(targets, 'linux', 'arm64')
  const linuxX64 = requireTarget(targets, 'linux', 'x64')
  const pkgver = version.replaceAll('-', '_')
  const pkgbuild = `# Maintainer: TraderAlice
# Generated from accepted OpenAlice native release archives. DO NOT EDIT.

pkgname=openalice-bin
pkgver=${pkgver}
_upstream_version=${shellQuote(version)}
pkgrel=1
pkgdesc='Local trading workspace for native coding-agent CLIs'
arch=('aarch64' 'x86_64')
url='https://github.com/${repository}'
license=('AGPL-3.0-only')
depends=('glibc')
provides=('openalice')
conflicts=('openalice')
options=('!debug' '!strip')
source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::${releaseAssetUrl(assetBaseUrl, linuxArm.archiveName)}")
sha256sums_aarch64=('${linuxArm.checksum}')
source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::${releaseAssetUrl(assetBaseUrl, linuxX64.archiveName)}")
sha256sums_x86_64=('${linuxX64.checksum}')

package() {
  local openalice_arch artifact_sha
  case "$CARCH" in
    aarch64)
      openalice_arch=arm64
      artifact_sha='${linuxArm.checksum}'
      ;;
    x86_64)
      openalice_arch=x64
      artifact_sha='${linuxX64.checksum}'
      ;;
    *) return 1 ;;
  esac
  local release_dir="$srcdir/openalice-cli-\${_upstream_version}-linux-$openalice_arch"
  install -Dm755 "$release_dir/bin/openalice" "$pkgdir/usr/bin/openalice"
  install -d "$pkgdir/usr/share/openalice"
  cp -a "$release_dir/share/openalice/." "$pkgdir/usr/share/openalice/"
  install -Dm644 "$release_dir/release.json" "$pkgdir/usr/share/openalice/release.json"
  install -Dm644 "$release_dir/LICENSE" "$pkgdir/usr/share/licenses/openalice/LICENSE"
  install -Dm644 "$release_dir/THIRD_PARTY_NOTICES.md" "$pkgdir/usr/share/licenses/openalice/THIRD_PARTY_NOTICES.md"
  cat >"$pkgdir/usr/share/openalice/install-source.json" <<EOF
{
  "schemaVersion": 3,
  "repository": "${repository}",
  "cliVersion": "${version}",
  "selector": { "kind": "version", "value": "v${version}" },
  "installerUrl": "https://aur.archlinux.org/packages/openalice-bin",
  "updateChannel": "stable",
  "method": "aur",
  "artifact": { "platform": "linux", "arch": "$openalice_arch", "sha256": "$artifact_sha" },
  "installedAt": "${releasedAt}"
}
EOF
}
`
  writeFileSync(join(aurRoot, 'PKGBUILD'), pkgbuild)
  writeFileSync(join(aurRoot, '.SRCINFO'), aurSrcinfo({
    version,
    pkgver,
    linuxArm,
    linuxX64,
    assetBaseUrl,
  }))
  return { package: 'openalice-bin', files: ['aur/PKGBUILD', 'aur/.SRCINFO'] }
}

function aurSrcinfo({ version, pkgver, linuxArm, linuxX64, assetBaseUrl }) {
  return `pkgbase = openalice-bin
\tpkgdesc = Local trading workspace for native coding-agent CLIs
\tpkgver = ${pkgver}
\tpkgrel = 1
\turl = https://github.com/${repository}
\tarch = aarch64
\tarch = x86_64
\tlicense = AGPL-3.0-only
\tdepends = glibc
\tprovides = openalice
\tconflicts = openalice
\toptions = !debug
\toptions = !strip
\tsource_aarch64 = openalice-bin_${pkgver}_aarch64.tar.gz::${releaseAssetUrl(assetBaseUrl, linuxArm.archiveName)}
\tsha256sums_aarch64 = ${linuxArm.checksum}
\tsource_x86_64 = openalice-bin_${pkgver}_x86_64.tar.gz::${releaseAssetUrl(assetBaseUrl, linuxX64.archiveName)}
\tsha256sums_x86_64 = ${linuxX64.checksum}

pkgname = openalice-bin
`
}

function npmPostinstallSource() {
  return `#!/usr/bin/env node
import childProcess from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const packageRoot = path.dirname(fileURLToPath(import.meta.url))
const platform = os.platform()
const arch = os.arch()
if (!['darwin', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch)) {
  throw new Error('OpenAlice npm packages currently support macOS and Linux on arm64 or x64.')
}
const packageName = 'openalice-' + platform + '-' + arch
const packageJsonPath = require.resolve(packageName + '/package.json')
const nativePackageRoot = path.dirname(packageJsonPath)
const nativePackage = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
const releaseRoot = path.join(nativePackageRoot, 'release')
const executable = path.join(packageRoot, 'bin', 'openalice')
const share = path.join(packageRoot, 'share')

replaceFile(path.join(releaseRoot, 'bin', 'openalice'), executable)
replaceDirectoryLink(path.join(releaseRoot, 'share'), share)
fs.copyFileSync(path.join(releaseRoot, 'release.json'), path.join(packageRoot, 'release.json'))

const userAgent = process.env.npm_config_user_agent || ''
const method = userAgent.startsWith('bun/') ? 'bun' : userAgent.startsWith('npm/') ? 'npm' : null
if (!method) throw new Error('Install OpenAlice with npm or Bun so update ownership is unambiguous.')
const metadata = nativePackage.openalice
if (!metadata || metadata.platform !== platform || metadata.arch !== arch) {
  throw new Error('OpenAlice platform package metadata does not match ' + platform + '-' + arch + '.')
}
const installSource = {
  schemaVersion: 3,
  repository: '${repository}',
  cliVersion: nativePackage.version,
  selector: { kind: 'version', value: 'v' + nativePackage.version },
  installerUrl: 'https://www.npmjs.com/package/openalice',
  updateChannel: 'stable',
  method,
  artifact: {
    platform,
    arch,
    sha256: metadata.artifactSha256,
  },
  installedAt: new Date().toISOString(),
}
atomicWrite(path.join(packageRoot, 'install-source.json'), JSON.stringify(installSource, null, 2) + '\\n')
const result = childProcess.spawnSync(executable, ['--version'], {
  encoding: 'utf8',
  env: { ...process.env, OPENALICE_APP_HOME: path.join(share, 'openalice') },
})
if (result.status !== 0 || result.stdout.trim() !== nativePackage.version) {
  throw new Error('OpenAlice native executable verification failed: ' + (result.stderr || result.stdout))
}

function replaceFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.rmSync(destination, { force: true })
  try {
    fs.linkSync(source, destination)
  } catch {
    fs.copyFileSync(source, destination)
  }
  fs.chmodSync(destination, 0o755)
}

function replaceDirectoryLink(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true })
  fs.symlinkSync(path.relative(path.dirname(destination), source), destination, 'dir')
}

function atomicWrite(destination, content) {
  const temporary = destination + '.next.' + process.pid
  fs.writeFileSync(temporary, content, { mode: 0o644 })
  fs.renameSync(temporary, destination)
}
`
}

function npmReadme(version) {
  return `# OpenAlice CLI\n\nNative OpenAlice ${version} for macOS and Linux.\n\nInstall with npm:\n\n\`\`\`bash\nnpm install -g openalice\n\`\`\`\n\nOr install with Bun's explicit lifecycle-script trust:\n\n\`\`\`bash\nbun add -g --trust openalice\n\`\`\`\n\nThe install step selects the matching accepted platform package. The resulting \`openalice\` command is the native Bun-compiled executable and runs without the package manager or a host Node.js process. Agent Runtimes remain user-owned.\n`
}

function platformPackageName(platform, arch) {
  return `openalice-${platform}-${arch}`
}

function releaseAssetUrl(assetBaseUrl, archiveName) {
  return `${assetBaseUrl}/${archiveName}`
}

function normalizeAssetBaseUrl(value, version) {
  const candidate = value?.trim()
    || `https://github.com/${repository}/releases/download/v${version}`
  const url = new URL(candidate)
  if (!['https:', 'http:', 'file:'].includes(url.protocol)) {
    throw new Error(`unsupported CLI package asset URL protocol: ${url.protocol}`)
  }
  return candidate.replace(/\/$/, '')
}

function requireTarget(targets, platform, arch) {
  const target = targets.find((candidate) => candidate.platform === platform && candidate.arch === arch)
  if (!target) throw new Error(`missing required target ${platform}-${arch}`)
  return target
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function assertSafeOutputRoot(outputRoot, inputRoot) {
  if (
    outputRoot === parse(outputRoot).root
    || outputRoot === homedir()
    || outputRoot === repositoryRoot
    || outputRoot === inputRoot
    || inputRoot.startsWith(`${outputRoot}/`)
    || outputRoot.startsWith(`${inputRoot}/`)
  ) {
    throw new Error(`refusing unsafe CLI package output directory: ${outputRoot}`)
  }
}

function parseArgs(argv) {
  const options = { requireAll: false, npmOnly: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--require-all') options.requireAll = true
    else if (arg === '--npm-only') options.npmOnly = true
    else if (['--input-dir', '--output-dir', '--version', '--released-at', '--asset-base-url'].includes(arg)) {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      options[arg.slice(2).replaceAll('-', '')] = value
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  if (!options.inputdir || !options.outputdir || !options.version || !options.releasedat) {
    throw new Error('Usage: build-cli-package-channels.mjs --input-dir <dir> --output-dir <dir> --version <version> --released-at <iso> [--asset-base-url <url>] [--require-all] [--npm-only]')
  }
  return {
    inputDir: options.inputdir,
    outputDir: options.outputdir,
    version: options.version,
    releasedAt: options.releasedat,
    requireAll: options.requireAll,
    npmOnly: options.npmOnly,
    assetBaseUrl: options.assetbaseurl,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(buildCliPackageChannels(parseArgs(process.argv.slice(2))))}\n`)
  } catch (error) {
    process.stderr.write(`build CLI package channels: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
