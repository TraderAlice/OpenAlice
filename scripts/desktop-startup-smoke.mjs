#!/usr/bin/env node
/** Explicit native surface gate. All client state and process groups are disposable. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopDevExecutable, spawnDesktopSmoke, stopDesktopSmoke } from './desktop-smoke-process.mjs'

const appPathIndex = process.argv.indexOf('--app-path')
const appPath = appPathIndex >= 0 ? process.argv[appPathIndex + 1] : null
if (appPathIndex >= 0 && !appPath) throw new Error('--app-path requires the packaged executable')
const connectedHomeIndex = process.argv.indexOf('--connected-home')
const connectedHome = connectedHomeIndex >= 0 ? process.argv[connectedHomeIndex + 1] : null
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
for (const hasRecent of connectedHome ? [false] : [false, true]) {
  const root = await mkdtemp(join(tmpdir(), 'openalice-startup-smoke-'))
  let child
  try {
    const supervisor = join(root, 'supervisor')
    await mkdir(supervisor)
    await writeFile(join(supervisor, 'config.json'), JSON.stringify({ schemaVersion: 2, projects: { default: { name: 'default', home: connectedHome || join(root, 'default') } } }))
    if (hasRecent) await writeFile(join(supervisor, 'startup-target.json'), JSON.stringify({ schemaVersion: 1, target: { machine: 'missing-machine', project: 'main' } }))
    const env = { ...process.env, OPENALICE_SUPERVISOR_HOME: supervisor, OPENALICE_GLOBAL_DIR: join(root, 'global'), OPENALICE_ELECTRON_SMOKE_STARTUP: '1', OPENALICE_ELECTRON_SMOKE_USER_DATA: join(root, 'profile') }
    if (connectedHome) env.OPENALICE_ACCEPTANCE_CONNECTED = '1'
    delete env.OPENALICE_HOME
    delete env.AQ_LAUNCHER_ROOT
    child = spawnDesktopSmoke(appPath ?? desktopDevExecutable(), appPath ? [] : [join(repoRoot, 'dist/electron/main.js')], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += String(data) })
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Startup smoke timed out: ' + output)), 30_000)
      child.once('error', error => { clearTimeout(timeout); reject(error) })
      child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(output)) })
    })
    const receipt = output.split('\n').find(line => line.includes('renderer startup smoke passed'))
    if (!receipt) throw new Error(output)
    console.log(receipt)
    if (hasRecent && !output.includes('missing-machine')) throw new Error('Unavailable Recent was erased')
    console.log(`[startup-smoke] ${connectedHome ? 'connected separated mode' : hasRecent ? 'unavailable Recent' : 'no Recent'} passed; no local project ownership`)
  } finally {
    await stopDesktopSmoke(child)
    await rm(root, { recursive: true, force: true })
  }
}
