import { mkdtemp, writeFile, mkdir, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { resolveInboxFile } from './inbox-files.js'

it('resolves source files, rejecting missing paths, directories and escaping symlinks', async () => {
  const home = await mkdtemp(join(tmpdir(), 'inbox-files-'))
  try {
    const workspace = join(home, 'source'); await mkdir(workspace)
    await writeFile(join(home, 'private.txt'), 'private')
    await writeFile(join(workspace, 'report.md'), '# Report')
    await symlink(join(home, 'private.txt'), join(workspace, 'leak.txt'))
    expect(await resolveInboxFile(workspace, 'report.md')).toBe(await realpath(join(workspace, 'report.md')))
    for (const path of ['missing.md', '../private.txt', 'leak.txt']) expect(await resolveInboxFile(workspace, path)).toBeNull()
    expect(await resolveInboxFile(undefined, 'report.md')).toBeNull()
  } finally { await rm(home, { recursive: true, force: true }) }
})
