#!/usr/bin/env node
/**
 * One-shot: write shortenSessionChromeTitle() results into each Session
 * dossier's displayName under OPENALICE_HOME (default ~/.openalice).
 *
 * Usage:
 *   pnpm exec tsx scripts/batch-session-display-names.ts
 *   pnpm exec tsx scripts/batch-session-display-names.ts --dry-run
 */
import fs from 'node:fs'
import path from 'node:path'

import {
  SESSION_CHROME_TITLE_MAX,
  shortenSessionChromeTitle,
} from '../ui/src/components/workspace/display.ts'

const dryRun = process.argv.includes('--dry-run')
const home = process.env.OPENALICE_HOME
  || path.join(process.env.USERPROFILE || process.env.HOME || '', '.openalice')
const workspacesRoot = path.join(home, 'workspaces')
const sessionsStateDir = path.join(workspacesRoot, 'state', 'sessions')
const workspacesJson = path.join(workspacesRoot, 'workspaces.json')

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

type WorkspaceRow = { id: string; dir: string }
type SessionRecord = {
  name: string
  resumeId: string
  agent: string
  title?: string
  fallbackTitle?: string
}
type Dossier = {
  version: 1
  resumeId: string
  agent: string
  ai?: unknown
  displayName?: string
}

const registry = readJson(workspacesJson) as { workspaces?: WorkspaceRow[] }
const wsById = new Map((registry.workspaces || []).map((w) => [w.id, w]))

let updated = 0
let skipped = 0

for (const file of fs.readdirSync(sessionsStateDir).filter((name) => name.endsWith('.json'))) {
  const wsId = file.replace(/\.json$/u, '')
  const ws = wsById.get(wsId)
  if (!ws?.dir) {
    console.warn(`skip ${file}: workspace dir missing from workspaces.json`)
    continue
  }
  const state = readJson(path.join(sessionsStateDir, file)) as { records?: SessionRecord[] }
  for (const record of state.records || []) {
    // Native title wins, then launch-time prompt — same order as sessionPreferredTitle.
    const raw = String(record.title || record.fallbackTitle || record.name || '').trim()
    if (!raw) {
      skipped += 1
      continue
    }
    const short = shortenSessionChromeTitle(raw)
    if (!short) {
      skipped += 1
      continue
    }
    // Do not persist a still-overlong Latin leftover — leave chrome to SpacedTruncate.
    const normalizedRaw = raw.replace(/\s+/g, ' ').trim()
    if (short === normalizedRaw && [...short].length > SESSION_CHROME_TITLE_MAX) {
      console.log(`· ${wsId}/${record.name}: (no compact form, skip)`)
      skipped += 1
      continue
    }
    const dossierPath = path.join(ws.dir, '.alice', 'sessions', `${record.resumeId}.json`)
    let dossier: Dossier
    if (fs.existsSync(dossierPath)) {
      dossier = readJson(dossierPath) as Dossier
      if (dossier.resumeId !== record.resumeId || dossier.agent !== record.agent) {
        console.warn(`skip ${record.resumeId}: dossier identity mismatch`)
        skipped += 1
        continue
      }
    } else {
      dossier = { version: 1, resumeId: record.resumeId, agent: record.agent }
    }
    const prev = typeof dossier.displayName === 'string' ? dossier.displayName : ''
    if (prev === short) {
      console.log(`= ${wsId}/${record.name}: ${short}`)
      skipped += 1
      continue
    }
    console.log(`${dryRun ? '~' : '*'} ${wsId}/${record.name}: ${prev ? `${prev} → ` : ''}${short}`)
    if (!dryRun) {
      writeJson(dossierPath, {
        version: 1,
        resumeId: dossier.resumeId,
        agent: dossier.agent,
        ...(dossier.ai ? { ai: dossier.ai } : {}),
        displayName: short,
      })
    }
    updated += 1
  }
}

console.log(`\n${dryRun ? 'dry-run ' : ''}updated=${updated} unchanged/skipped=${skipped} home=${home}`)
