import { createHash } from 'node:crypto'
import { readFileSync, copyFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function readDevBrokerCatalog(inputDir, { commit, version, platform, arch }, outputDir) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid dev broker commit')
  const name = `OpenAlice-Broker-Packs-${version}-${platform}-${arch}.json`
  const catalog = JSON.parse(readFileSync(join(inputDir, name), 'utf8'))
  const engines = ['ccxt', 'alpaca', 'ibkr', 'leverup', 'longbridge']
    .filter(engine => !(engine === 'longbridge' && platform === 'win32' && arch === 'arm64'))
  if (catalog.schemaVersion !== 1 || catalog.sourceCommit !== commit || catalog.openAliceVersion !== version
      || catalog.platform !== platform || catalog.arch !== arch || !Array.isArray(catalog.packs)
      || catalog.packs.map(p => p.engine).sort().join() !== engines.sort().join()) {
    throw new Error('Dev broker catalog does not match CLI candidate')
  }
  for (const asset of catalog.packs) {
    const expectedFile = `OpenAlice-Broker-${asset.engine}-${version}-${platform}-${arch}.tgz`
    if (asset.file !== expectedFile || asset.version !== version || asset.apiVersion !== 1
        || asset.entry !== 'dist/index.js' || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error('Invalid dev broker asset metadata')
    }
    const bytes = readFileSync(join(inputDir, expectedFile))
    if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw new Error(`Dev broker checksum mismatch: ${expectedFile}`)
    }
    if (outputDir) copyFileSync(join(inputDir, expectedFile), join(outputDir, expectedFile))
  }
  if (outputDir) copyFileSync(join(inputDir, name), join(outputDir, name))
  return catalog
}

/** The catalog is covered by the CLI archive checksum/content identity. */
export async function writeDevBrokerBinding(resourceRoot, options) {
  if (!options.commit) return
  const catalog = readDevBrokerCatalog(options.inputDir, options)
  await writeFile(join(resourceRoot, 'broker-pack-source.json'), JSON.stringify({
    schemaVersion: 1, commit: options.commit, catalog,
  }, null, 2) + '\n')
}
