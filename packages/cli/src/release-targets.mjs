// Product identities use Node/Bun platform names, including win32 on ARM64.
export const POSIX_CLI_TARGETS = Object.freeze([
  ['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'arm64'], ['linux', 'x64'],
])
export const WINDOWS_CLI_TARGETS = Object.freeze([['win32', 'arm64'], ['win32', 'x64']])
export const CLI_RELEASE_TARGETS = Object.freeze([...POSIX_CLI_TARGETS, ...WINDOWS_CLI_TARGETS])

export function isCliTarget(platform, arch) {
  return CLI_RELEASE_TARGETS.some(([os, cpu]) => os === platform && cpu === arch)
}

export function cliExecutableName(platform) {
  return platform === 'win32' ? 'openalice.exe' : 'openalice'
}

export function cliArchiveName(version, platform, arch) {
  if (!isCliTarget(platform, arch)) throw new Error(`Unsupported CLI target: ${platform}-${arch}`)
  if (!/^(?:dev|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.test(version)) {
    throw new Error(`Invalid CLI version: ${version}`)
  }
  return `openalice-cli-${version}-${platform}-${arch}.tar.gz`
}
