import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('isolates default global Git ignores while preserving repository ignores', () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-git-isolation-'))
  try {
    const repository = join(root, 'repository')
    const xdg = join(root, 'xdg')
    mkdirSync(join(repository, '.codex'), { recursive: true })
    mkdirSync(join(xdg, 'git'), { recursive: true })
    writeFileSync(join(xdg, 'git', 'ignore'), '.codex/\n')
    writeFileSync(join(repository, '.codex', 'tracked.md'), 'workspace guidance\n')
    writeFileSync(join(repository, '.gitignore'), 'generated.txt\n')
    writeFileSync(join(repository, 'generated.txt'), 'generated\n')
    const config = join(root, 'empty-gitconfig')
    writeFileSync(config, '')
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: xdg,
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_NOSYSTEM: '1',
      OPENALICE_TEST_HOME: join(root, 'test-home'),
    }
    const git = (args: string[]) => execFileSync('git', args, { cwd: repository, env, encoding: 'utf8' })
    git(['init', '-q'])
    const args = ['ls-files', '--others', '--exclude-standard']
    // Prove the inherited default ignore affects this fixture before setup.
    expect(git(args).trim().split('\n')).toEqual(['.gitignore'])
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { execFileSync } from 'node:child_process'
      await import(${JSON.stringify(new URL('../../../vitest.setup.ts', import.meta.url).href)})
      process.stdout.write(execFileSync('git', ${JSON.stringify(args)}, { encoding: 'utf8' }))
    `], { cwd: repository, env, encoding: 'utf8' })
    expect(output.trim().split('\n')).toEqual(['.codex/tracked.md', '.gitignore'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
