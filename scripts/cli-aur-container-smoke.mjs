#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

export const AUR_IMAGES = Object.freeze({
  arm64: {
    platform: 'linux/arm64',
    // The official Arch image is amd64-only. This digest is built from the
    // signature-checked Arch Linux ARM repositories by the audited source at
    // https://github.com/Menci/docker-archlinuxarm.
    image: 'menci/archlinuxarm:base-devel@sha256:e636d0261d62f2f6a3f97e16d71a2ebb9e87f952d696890d1fb0d722f9286163',
  },
  x64: {
    platform: 'linux/amd64',
    image: 'archlinux:base-devel@sha256:a26046b7363dad8e2614858f4313949ae9b05c9c5f31de343a54864b9e20806f',
  },
})

export function runAurContainerSmoke(options) {
  const target = AUR_IMAGES[options.arch]
  if (!target) throw new Error(`unsupported AUR architecture: ${options.arch}`)
  const previousPackageRoot = containerDirectory(options.previousPackage)
  const currentPackageRoot = containerDirectory(options.currentPackage)
  const command = [
    // GitHub and OrbStack containers do not expose Landlock. Pacman 7's
    // download sandbox must be disabled explicitly inside this disposable,
    // digest-pinned acceptance container.
    'pacman --disable-sandbox -Syu --noconfirm nodejs',
    'useradd --create-home builder',
    'install -d -o builder -g builder /tmp/openalice-aur-previous /tmp/openalice-aur-current',
    'cp -a "$PREVIOUS_PACKAGE_ROOT/." /tmp/openalice-aur-previous/',
    'cp -a "$CURRENT_PACKAGE_ROOT/." /tmp/openalice-aur-current/',
    'chown -R builder:builder /tmp/openalice-aur-previous /tmp/openalice-aur-current',
    'su builder -c "cd /tmp/openalice-aur-previous && makepkg --nodeps --noconfirm"',
    'su builder -c "cd /tmp/openalice-aur-current && makepkg --nodeps --noconfirm"',
    'PREVIOUS_BUILT_PACKAGE=$(find /tmp/openalice-aur-previous -maxdepth 1 -name "openalice-bin-*.pkg.tar.*" -print -quit)',
    'CURRENT_BUILT_PACKAGE=$(find /tmp/openalice-aur-current -maxdepth 1 -name "openalice-bin-*.pkg.tar.*" -print -quit)',
    'test -n "$PREVIOUS_BUILT_PACKAGE" -a -n "$CURRENT_BUILT_PACKAGE"',
    [
      'exec /usr/bin/node /work/scripts/cli-system-package-manager-smoke.mjs',
      '--manager aur',
      '--previous-version "$PREVIOUS_VERSION"',
      '--current-version "$CURRENT_VERSION"',
      '--previous-content-identity "$PREVIOUS_CONTENT_IDENTITY"',
      '--current-content-identity "$CURRENT_CONTENT_IDENTITY"',
      '--previous-package "$PREVIOUS_BUILT_PACKAGE"',
      '--current-package "$CURRENT_BUILT_PACKAGE"',
    ].join(' '),
  ].join(' && ')
  const args = [
    'run', '--rm',
    '--platform', target.platform,
    '--env', `PREVIOUS_VERSION=${options.previousVersion}`,
    '--env', `CURRENT_VERSION=${options.currentVersion}`,
    '--env', `PREVIOUS_CONTENT_IDENTITY=${options.previousContentIdentity}`,
    '--env', `CURRENT_CONTENT_IDENTITY=${options.currentContentIdentity}`,
    '--env', `PREVIOUS_PACKAGE_ROOT=${previousPackageRoot}`,
    '--env', `CURRENT_PACKAGE_ROOT=${currentPackageRoot}`,
    '--volume', `${repositoryRoot}:/work:ro`,
    '--workdir', '/work',
    target.image,
    'bash', '-lc', command,
  ]
  const result = spawnSync(options.docker, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    timeout: 20 * 60_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`AUR lifecycle smoke failed (${result.status})`)
}

export function parseArgs(argv) {
  const result = { docker: 'docker' }
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (![
      '--arch', '--previous-version', '--current-version',
      '--previous-content-identity', '--current-content-identity',
      '--previous-package', '--current-package', '--docker',
    ].includes(name) || !value) {
      throw new Error(usage())
    }
    result[name.slice(2).replaceAll('-', '')] = value
  }
  if (!['arm64', 'x64'].includes(result.arch)) throw new Error('--arch must be arm64 or x64')
  for (const field of [
    'previousversion', 'currentversion', 'previouscontentidentity',
    'currentcontentidentity', 'previouspackage', 'currentpackage',
  ]) {
    if (!result[field]) throw new Error(`missing required AUR option: ${field}`)
  }
  for (const field of ['previousversion', 'currentversion']) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(result[field])) {
      throw new Error(`invalid OpenAlice version: ${result[field]}`)
    }
  }
  for (const field of ['previouscontentidentity', 'currentcontentidentity']) {
    if (!/^[a-f0-9]{16}$/.test(result[field])) throw new Error(`invalid content identity: ${result[field]}`)
  }
  return {
    arch: result.arch,
    previousVersion: result.previousversion,
    currentVersion: result.currentversion,
    previousContentIdentity: result.previouscontentidentity,
    currentContentIdentity: result.currentcontentidentity,
    previousPackage: result.previouspackage,
    currentPackage: result.currentpackage,
    docker: result.docker,
  }
}

function containerDirectory(input) {
  const absolute = resolve(repositoryRoot, dirname(input))
  const local = relative(repositoryRoot, absolute)
  if (!local || local === '..' || local.startsWith(`..${sep}`) || !existsSync(resolve(repositoryRoot, input))) {
    throw new Error(`AUR package must exist inside the repository: ${input}`)
  }
  return `/work/${local.split(sep).join('/')}`
}

function usage() {
  return 'Usage: cli-aur-container-smoke.mjs --arch <arm64|x64> --previous-version <version> --current-version <version> --previous-content-identity <hash> --current-content-identity <hash> --previous-package <PKGBUILD> --current-package <PKGBUILD> [--docker <command>]'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runAurContainerSmoke(parseArgs(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`AUR container smoke: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
