import { describe, expect, it } from 'vitest'
import { spawnDesktopSmoke, stopDesktopSmoke } from './desktop-smoke-process.mjs'

function alive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

describe('desktop smoke process cleanup', () => {
  it.skipIf(process.platform === 'win32')('reaps helpers after the Electron parent exits', async () => {
    const grandchildProgram = 'setInterval(() => {}, 1000)'
    const parentProgram = `
      const { spawn } = require('node:child_process')
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildProgram)}], { stdio: 'ignore' })
      console.log(child.pid)
      setTimeout(() => process.exit(0), 50)
    `
    const parent = spawnDesktopSmoke(process.execPath, ['-e', parentProgram], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let helperPid = null
    try {
      helperPid = await new Promise((resolve, reject) => {
        parent.stdout.once('data', (chunk) => resolve(Number(chunk.toString().trim())))
        parent.once('error', reject)
      })
      if (parent.exitCode === null && parent.signalCode === null) {
        await new Promise((resolve) => parent.once('exit', resolve))
      }
      expect(alive(helperPid)).toBe(true)
      await stopDesktopSmoke(parent, 2_000)
      expect(alive(helperPid)).toBe(false)
    } finally {
      await stopDesktopSmoke(parent, 1_000)
    }
  }, 10_000)
})
