/**
 * 0036_codex_56_subscription_model — replace the API-only GPT-5.6 family alias
 * in native Codex subscription launches.
 *
 * OpenAI's API accepts `gpt-5.6` as a moving alias for Sol, but Codex sessions
 * authenticated through a ChatGPT account require the explicit model slug.
 * Keep API-key and Workspace-owned choices untouched: the alias remains valid
 * there and may be intentional.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { Migration } from '../types.js'

const LEGACY_MODEL = 'gpt-5.6'
const CODEX_SUBSCRIPTION_MODEL = 'gpt-5.6-sol'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return undefined
  }
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(tempPath, path)
}

function migratedPreferences(value: unknown): unknown | null {
  if (!isRecord(value)) return null
  const quickChat = value['quickChat']
  if (!isRecord(quickChat)) return null
  const recentLaunch = quickChat['recentLaunch']
  if (
    !isRecord(recentLaunch)
    || recentLaunch['agent'] !== 'codex'
    || recentLaunch['model'] !== LEGACY_MODEL
    || recentLaunch['credentialSlug'] !== null
    || recentLaunch['accessMode'] === 'vault'
  ) return null
  return {
    ...value,
    quickChat: {
      ...quickChat,
      recentLaunch: {
        ...recentLaunch,
        model: CODEX_SUBSCRIPTION_MODEL,
      },
    },
  }
}

function migratedResumeIdentities(value: unknown): unknown | null {
  if (!isRecord(value) || !Array.isArray(value['records'])) return null
  let updated = false
  const records = value['records'].map((candidate) => {
    if (!isRecord(candidate) || candidate['agent'] !== 'codex') return candidate
    const runtimeBinding = candidate['runtimeBinding']
    if (!isRecord(runtimeBinding) || runtimeBinding['model'] !== LEGACY_MODEL) return candidate
    const credential = runtimeBinding['credential']
    if (!isRecord(credential) || credential['source'] !== 'native') return candidate
    updated = true
    return {
      ...candidate,
      runtimeBinding: {
        ...runtimeBinding,
        model: CODEX_SUBSCRIPTION_MODEL,
      },
    }
  })
  return updated ? { ...value, records } : null
}

export async function migrateCodex56SubscriptionModel(input: {
  preferencesPath: string
  resumeIdentitiesPath: string
}): Promise<{ preferencesUpdated: boolean; sessionsUpdated: boolean }> {
  const preferences = migratedPreferences(await readJson(input.preferencesPath))
  if (preferences) await writeAtomic(input.preferencesPath, preferences)

  const resumeIdentities = migratedResumeIdentities(await readJson(input.resumeIdentitiesPath))
  if (resumeIdentities) await writeAtomic(input.resumeIdentitiesPath, resumeIdentities)

  return {
    preferencesUpdated: preferences !== null,
    sessionsUpdated: resumeIdentities !== null,
  }
}

export const migration: Migration = {
  id: '0036_codex_56_subscription_model',
  appVersion: '0.89.3-beta',
  introducedAt: '2026-08-07',
  affects: ['data/preferences.json', 'workspaces/state/resume-identities.json'],
  summary: 'Use the explicit GPT-5.6 Sol slug for native Codex subscription Sessions.',
  rationale:
    'The OpenAI API accepts the bare GPT-5.6 alias, while ChatGPT-authenticated Codex rejects it; old Quick Start presets persisted that incompatible alias.',
  up: async (ctx) => {
    const userDataHome = resolve(ctx.configDir(), '..', '..')
    const launcherRoot = resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(userDataHome, 'workspaces'))
    await migrateCodex56SubscriptionModel({
      preferencesPath: join(ctx.configDir(), '..', 'preferences.json'),
      resumeIdentitiesPath: join(launcherRoot, 'state', 'resume-identities.json'),
    })
  },
}
