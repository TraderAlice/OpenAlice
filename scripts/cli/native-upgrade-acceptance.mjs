import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { bunReleaseContentIdentity } from './bun-release-content-identity.mjs'

const execute = promisify(execFile)

/** Real server lifecycle across two same-version resource revisions, isolated from user state. */
export async function acceptNativeUpgrade({ executablePath, scratch, env, home }) {
  const source = dirname(dirname(executablePath))
  const original = JSON.parse(await readFile(join(source, 'release.json'), 'utf8'))
  const root = join(scratch, 'upgrade-install')
  const releases = join(root, 'cli/releases')
  await mkdir(releases, { recursive: true })
  const old = structuredClone(original)
  const marker = Buffer.from('previous resource revision\n')
  old.files.push({path: 'upgrade-fixture.txt', type: 'file', bytes: marker.length, mode: 0o644, sha256: createHash('sha256').update(marker).digest('hex')})
  old.contentIdentity = bunReleaseContentIdentity(old)
  const names = [old, original].map(metadata => `${metadata.version}-${metadata.contentIdentity}`)
  for (const [index, metadata] of [old, original].entries()) {
    const release = join(releases, names[index])
    await cp(source, release, {recursive: true})
    if (index === 0) await writeFile(join(release, 'upgrade-fixture.txt'), marker)
    await writeFile(join(release, 'release.json'), JSON.stringify(metadata))
  }
  const activationPath = join(root, 'cli/activation.json')
  let activeEnv
  let binary
  const invoke = async args => execute(binary, ['server', ...args, '--home', home], {env: activeEnv, timeout: 120_000, maxBuffer: 2 * 1024 * 1024})
  try {
    for (const [index, name] of names.entries()) {
      await rm(join(root, 'cli/current'), {force: true})
      await symlink(join('releases', name), join(root, 'cli/current'))
      const release = join(releases, name)
      activeEnv = {...env, OPENALICE_INSTALL_ROOT: root, OPENALICE_RELEASE_DIR: release, OPENALICE_APP_HOME: join(release, 'share/openalice')}
      delete activeEnv.OPENALICE_RUNTIME_CONTENT_IDENTITY
      delete activeEnv.OPENALICE_CONTENT_IDENTITY
      binary = join(release, 'bin/openalice')
      await writeFile(activationPath, JSON.stringify({schemaVersion: 1, activeRelease: name, previousRelease: index ? names[0] : null, productVersion: original.version, state: 'pending', activatedAt: new Date().toISOString()}))
      await invoke(['start', '--port', env.OPENALICE_WEB_PORT, '--wait', '90'])
      const status = JSON.parse((await invoke(['status', '--json'])).stdout)
      if (status.provider?.contentIdentity !== [old, original][index].contentIdentity || status.pendingActivation) throw new Error('Native server did not activate the installed content')
      if (JSON.parse(await readFile(activationPath, 'utf8')).state !== 'confirmed') throw new Error('Native activation remained pending')
      await invoke(['stop', '--wait', '30'])
    }
  } finally {
    if (binary) await invoke(['stop', '--wait', '30']).catch(() => undefined)
  }
  return {sameVersion: original.version, previous: old.contentIdentity, current: original.contentIdentity, confirmed: true}
}
