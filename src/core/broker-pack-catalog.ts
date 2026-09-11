import type { InstallableBrokerEngine } from './broker-packs.js'

export interface BrokerPackRequirement {
  libc?: { family: 'glibc'; minVersion: string }
}

export interface BrokerPackReleaseAsset {
  engine: InstallableBrokerEngine
  version: string
  apiVersion: number
  file: string
  sha256: string
  size: number
  entry: string
  requirements?: BrokerPackRequirement
}

export interface BrokerPackReleaseCatalog {
  schemaVersion: 1
  openAliceVersion: string
  platform: NodeJS.Platform
  arch: string
  sourceCommit?: string
  generatedAt: string
  packs: BrokerPackReleaseAsset[]
}

export function brokerPackCatalogFileName(version: string, platform = process.platform, arch = process.arch): string {
  return `OpenAlice-Broker-Packs-${safeAssetPart(version)}-${safeAssetPart(platform)}-${safeAssetPart(arch)}.json`
}

export function brokerPackArchiveFileName(
  version: string,
  engine: InstallableBrokerEngine,
  platform = process.platform,
  arch = process.arch,
): string {
  return `OpenAlice-Broker-${safeAssetPart(engine)}-${safeAssetPart(version)}-${safeAssetPart(platform)}-${safeAssetPart(arch)}.tgz`
}

function safeAssetPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-')
}


/** Longbridge has no Windows ARM64 native binding. Other engines are portable. */
export function supportedBrokerPackEngines(platform = process.platform, arch = process.arch): InstallableBrokerEngine[] {
  return (['ccxt', 'alpaca', 'ibkr', 'leverup', 'longbridge'] as InstallableBrokerEngine[])
    .filter(engine => !(engine === 'longbridge' && platform === 'win32' && arch === 'arm64'))
}
