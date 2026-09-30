import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptPath = resolve(import.meta.dirname, 'windows-source-dev.ps1')
const powershellPath = join(
  process.env['SystemRoot'] ?? 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
)

function runPowerShell(root: string, args: string[] = []) {
  return spawnSync(powershellPath, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath, '-Root', root, ...args,
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
}

describe.skipIf(process.platform !== 'win32')('Windows source-dev PowerShell CLI', () => {
  it('defaults to read-only Status for an isolated root and task name', () => {
    const disposableRoot = mkdtempSync(join(tmpdir(), 'openalice-source-dev-cli-'))
    const statusRoot = join(disposableRoot, 'status')
    mkdirSync(statusRoot)

    try {
      // Status only reads this GUID-named task; it never targets a user task.
      const taskName = 'OpenAliceSourceDevTest-' + randomUUID()
      const statusResult = runPowerShell(statusRoot, [
        '-TaskName', taskName, '-WebPort', '0', '-UiPort', '0',
      ])

      expect(statusResult.error).toBeUndefined()
      expect(statusResult.signal).toBeNull()
      expect(statusResult.status).toBe(0)
      const status = JSON.parse(statusResult.stdout.trim()) as {
        task: string
        root: string
        webReady: boolean
        uiReady: boolean
        installStamp: boolean
      }
      expect(status.task).toBe('missing')
      expect(status.root.toLowerCase()).toBe(statusRoot.toLowerCase())
      expect(status.webReady).toBe(false)
      expect(status.uiReady).toBe(false)
      expect(status.installStamp).toBe(false)
    } finally {
      rmSync(disposableRoot, { recursive: true, force: true })
    }
  })

  it('does not identify a sibling checkout as this root when selecting source processes', () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-source-match-'))
    try {
      const sibling = root + '-copy'
      const taskName = 'OpenAliceSourceDevTest-' + randomUUID()
      const expression = ". '" + scriptPath.replaceAll("'", "''") + "' -Root '" + root.replaceAll("'", "''") + "' -TaskName '" + taskName + "' -WebPort 0 -UiPort 0 | Out-Null; " +
        "function Get-CimInstance { @([pscustomobject]@{ ProcessId = 991; CommandLine = 'node.exe " + sibling.replaceAll("'", "''") + "\\src\\main.ts' }, [pscustomobject]@{ ProcessId = 992; CommandLine = 'node.exe " + root.replaceAll("'", "''") + "\\src\\main.ts' }) }; " +
        '@(Get-SourceProcesses | ForEach-Object { $_.ProcessId })'
      const result = spawnSync(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', expression], { encoding: 'utf8', timeout: 30_000, windowsHide: true })
      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe('992')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('removes an absent task on rollback despite an old task backup in the root', () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-task-rollback-'))
    try {
      const stateDir = join(root, '.openalice-source-dev')
      mkdirSync(stateDir)
      writeFileSync(join(stateDir, 'previous-task.xml'), '<Task>unrelated old task</Task>')
      const taskName = 'OpenAliceSourceDevTest-' + randomUUID()
      const expression = ". '" + scriptPath.replaceAll("'", "''") + "' -Root '" + root.replaceAll("'", "''") + "' -TaskName '" + taskName + "' -WebPort 0 -UiPort 0 | Out-Null; " +
        "function Stop-SourceProcesses {}; function Register-ScheduledTask { throw 'stale backup used' }; " +
        'function Unregister-ScheduledTask { $script:removed = $true }; $previousTaskWasRunning = $false; ' +
        "Restore-PreviousTask; if ($script:removed) { 'removed' } else { 'not removed' }"
      const result = spawnSync(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', expression], { encoding: 'utf8', timeout: 30_000, windowsHide: true })
      expect(result.status).toBe(0)
      expect(result.stdout.trim().split(/\r?\n/).at(-1)).toBe('removed')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
