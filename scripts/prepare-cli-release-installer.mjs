#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const RELEASE_VERSION_SOURCE = 'OPENALICE_INSTALLER_RELEASE_VERSION="${OPENALICE_INSTALLER_RELEASE_VERSION:-}"'
const UPDATE_CHANNEL_SOURCE = 'OPENALICE_INSTALLER_UPDATE_CHANNEL="${OPENALICE_INSTALLER_UPDATE_CHANNEL:-}"'

export function prepareCliReleaseInstaller(version, path) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid OpenAlice release version: ${version}`)
  }
  const input = readFileSync(path, 'utf8')
  if (!input.includes(RELEASE_VERSION_SOURCE)) {
    throw new Error('installer release-version placeholder is missing')
  }
  if (!input.includes(UPDATE_CHANNEL_SOURCE)) {
    throw new Error('installer update-channel placeholder is missing')
  }
  writeFileSync(path, input
    .replace(
      RELEASE_VERSION_SOURCE,
      `OPENALICE_INSTALLER_RELEASE_VERSION="\${OPENALICE_INSTALLER_RELEASE_VERSION:-${version}}"`,
    )
    .replace(
      UPDATE_CHANNEL_SOURCE,
      'OPENALICE_INSTALLER_UPDATE_CHANNEL="${OPENALICE_INSTALLER_UPDATE_CHANNEL:-stable}"',
    ))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, path] = process.argv.slice(2)
  if (!version || !path) {
    console.error('Usage: prepare-cli-release-installer.mjs <version> <installer-path>')
    process.exit(2)
  }
  prepareCliReleaseInstaller(version, path)
}
