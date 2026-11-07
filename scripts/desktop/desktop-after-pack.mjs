import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extractFile } from '@electron/asar'

// extraResources removes matching inputs from app.asar, including package.json.
// Project only product identity into the physical resource tree after packing;
// the archive retains the authoritative Electron entrypoint and dependencies.
export default async function afterPack(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  const { name, version, type } = JSON.parse(extractFile(join(resources, 'app.asar'), 'package.json').toString())
  await writeFile(join(resources, 'runtime', 'package.json'), `${JSON.stringify({ name, version, type }, null, 2)}\n`)
}
