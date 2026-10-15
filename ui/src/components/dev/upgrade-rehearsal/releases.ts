import {
  identityLabel,
  type ReleaseChannel,
  type ReleaseIdentity,
} from '@traderalice/update-lifecycle'
import snapshot from './release-snapshot.json'
export interface SimRelease extends ReleaseIdentity {
  id: string
  stage: number
}
export interface Publication {
  records: SimRelease[]
  heads: Partial<Record<ReleaseChannel, string>>
}
export const publicationStages = [
  'Built',
  'Verified',
  'Published',
  'Channel active',
]
export function initialPublication(): Publication {
  return {
    records: [
      { id: 'stable:0.94.1', channel: 'stable', version: '0.94.1', stage: 3 },
    ],
    heads: { stable: 'stable:0.94.1' },
  }
}
export function createRelease(
  p: Publication,
  channel: ReleaseChannel,
): Publication {
  const stable =
    p.records.filter((r) => r.channel === 'stable').at(-1)?.version ?? '0.94.1'
  const patch = Number(stable.split('.')[2]) + 1
  const base = `0.94.${patch}`
  const commit =
    channel === 'dev'
      ? (p.records.filter((r) => r.channel === 'dev').length + 1)
          .toString(16)
          .padStart(7, '0').padEnd(40, '0')
      : undefined
  const version =
    channel === 'stable'
      ? base
      : channel === 'beta'
        ? `${base}-beta.${p.records.filter((r) => r.version.startsWith(base + '-beta.')).length + 1}`
        : stable
  const identity = { channel, version, commit }
  const record = {
    ...identity,
    id: `${channel}:${identityLabel(identity)}`,
    stage: 0,
  }
  return { ...p, records: [...p.records, record] }
}
export function advanceRelease(p: Publication, id: string): Publication {
  const record = p.records.find((r) => r.id === id)
  if (!record || record.stage === 3) return p
  const stage = record.stage + 1
  return {
    records: p.records.map((r) => (r.id === id ? { ...r, stage } : r)),
    heads: stage === 3 ? { ...p.heads, [record.channel]: id } : p.heads,
  }
}
export function head(p: Publication, channel: ReleaseChannel) {
  return p.records.find((r) => r.id === p.heads[channel]) ?? null
}
export function releaseAssets(r: ReleaseIdentity): string[] {
  if (r.channel === 'dev') {
    // Current dev publication differs from the captured stable inventory:
    // prepare-cli-dev-assets.mjs + dev-broker-binding.mjs include six catalogs,
    // including Windows ARM64 (all engines except longbridge).
    const prefix = `cli/dev/releases/${r.commit}/`
    const files = ['install', 'install.ps1']
    for (const platform of ['darwin', 'linux', 'win32'])
      for (const arch of ['arm64', 'x64']) {
        const archive = `openalice-cli-${r.version}-${platform}-${arch}.tar.gz`
        files.push(
          archive,
          `${archive}.sha256`,
          `OpenAlice-Broker-Packs-${r.version}-${platform}-${arch}.json`,
        )
        for (const engine of [
          'ccxt',
          'alpaca',
          'ibkr',
          'leverup',
          'longbridge',
        ]) {
          if (
            engine === 'longbridge' &&
            platform === 'win32' &&
            arch === 'arm64'
          )
            continue
          files.push(
            `OpenAlice-Broker-${engine}-${r.version}-${platform}-${arch}.tgz`,
          )
        }
      }
    return files.map((file) => prefix + file)
  }
  return snapshot.assets
    .filter(
      (a) =>
        r.channel === 'stable' ||
        (!(
          a.name.startsWith('openalice-') &&
          !a.name.startsWith('openalice-cli-')
        ) &&
          ![
            'cli-package-channels.json',
            'npm-publish-order.json',
            'PKGBUILD',
            'openalice.rb',
          ].includes(a.name)),
    )
    .map((a) =>
      a.name
        .replaceAll('0.94.1', r.version)
        .replace(/^latest/, r.channel === 'beta' ? 'beta' : 'latest'),
    )
}

/** Display only: persisted identities and artifact paths always retain full commits. */
export function displayVersion(value: string): string {
  return value.replace(/(\+dev\.[a-f0-9]{7})[a-f0-9]+$/, '$1')
}
