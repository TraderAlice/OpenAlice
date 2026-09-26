import type { ConversationItem } from '../conversation/types'
import type { WebSessionPhase, WebSessionSnapshot } from './api'

const USER_TURN_THRESHOLD = 12
const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000
const DISMISS_MIN_EXTRA_TURNS = 6

export type ContextContinueSection = 'assumptions' | 'conclusions' | 'open' | 'next'

export interface ContextContinueSuggestion {
  readonly id: string
  readonly section: ContextContinueSection
  readonly text: string
}

export const CONTEXT_CONTINUE_SCAFFOLD = `## 前提 / 假设

## 已有结论

## 未决问题

## 下一步
`

export function countUserTurns(items: readonly ConversationItem[]): number {
  return items.filter((item) => item.kind === 'user').length
}

export function countToolSteps(items: readonly ConversationItem[]): number {
  let count = 0
  for (const item of items) {
    if (item.kind === 'assistant-turn' && item.activity) count += item.activity.steps.length
  }
  return count
}

export function dismissStorageKey(sessionId: string): string {
  return `oa.context-continue.dismissed.${sessionId}`
}

export function readDismissState(sessionId: string, storage: Pick<Storage, 'getItem'> = localStorage): { at: number; userTurns: number } | null {
  try {
    const raw = storage.getItem(dismissStorageKey(sessionId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at?: unknown; userTurns?: unknown }
    if (typeof parsed.at !== 'number' || typeof parsed.userTurns !== 'number') return null
    return { at: parsed.at, userTurns: parsed.userTurns }
  } catch {
    return null
  }
}

export function writeDismissState(sessionId: string, userTurns: number, storage: Pick<Storage, 'setItem'> = localStorage, now = Date.now()): void {
  storage.setItem(dismissStorageKey(sessionId), JSON.stringify({ at: now, userTurns }))
}

export function shouldOfferContextContinue(input: {
  readonly source?: string
  readonly phase?: WebSessionPhase
  readonly items: readonly ConversationItem[]
  readonly sessionId: string
  readonly now?: number
  readonly storage?: Pick<Storage, 'getItem'>
}): boolean {
  if (input.source !== 'auto-quant') return false
  if (input.phase && input.phase !== 'idle') return false
  const userTurns = countUserTurns(input.items)
  const tools = countToolSteps(input.items)
  if (userTurns < USER_TURN_THRESHOLD && tools < 20) return false
  const dismissed = readDismissState(input.sessionId, input.storage)
  if (!dismissed) return true
  const now = input.now ?? Date.now()
  if (now - dismissed.at < DISMISS_COOLDOWN_MS && userTurns < dismissed.userTurns + DISMISS_MIN_EXTRA_TURNS) {
    return false
  }
  return true
}

/** Soft heuristic cards — never overwrite the user's draft. */
export function buildAliceSuggestions(items: readonly ConversationItem[]): ContextContinueSuggestion[] {
  const suggestions: ContextContinueSuggestion[] = []
  const blob = items.map((item) => {
    if (item.kind === 'user') return item.content.map((block) => block.kind === 'markdown' ? block.text : '').join('\n')
    if (item.kind === 'assistant-turn') {
      const finals = item.final ?? ''
      const tools = item.activity?.steps.map((step) => `${step.name}: ${step.summary ?? ''}`).join('\n') ?? ''
      return `${finals}\n${tools}`
    }
    return ''
  }).join('\n')

  const symbols = [...new Set(blob.match(/\b\d{6}\.(?:SH|SZ|BJ)\b|\b[A-Z]{1,5}\b/g) ?? [])]
    .filter((symbol) => !['A', 'B', 'TODO', 'API', 'GUI', 'TUI', 'SMA', 'MACD', 'RSI', 'EIA', 'WTI'].includes(symbol))
    .slice(0, 6)
  if (symbols.length > 0) {
    suggestions.push({
      id: 'symbols',
      section: 'assumptions',
      text: `研究涉及的标的/符号：${symbols.join('、')}`,
    })
  }

  const tools = countToolSteps(items)
  if (tools >= 8) {
    suggestions.push({
      id: 'tool-outcomes',
      section: 'conclusions',
      text: `本对话有约 ${tools} 次工具调用——把已验证的数字、回测结果和失败实验各写一条，避免新对话重跑无效路径。`,
    })
  }

  const openQuestions = [...blob.matchAll(/[？?]\s*$/gm)].length
    + (blob.match(/(?:未决|待确认|还不确定|仍需)/g)?.length ?? 0)
  if (openQuestions > 0) {
    suggestions.push({
      id: 'open-qs',
      section: 'open',
      text: '把仍未拍板的规则/样本区间/对照基准列成短句，方便下一轮直接回答。',
    })
  }

  suggestions.push({
    id: 'next-focus',
    section: 'next',
    text: '下一轮只追一个最优先问题；其余先放进「未决」或明确写「本轮不讨论」。',
  })

  return suggestions
}

export function applySuggestionToDraft(draft: string, suggestion: ContextContinueSuggestion): string {
  const heading = sectionHeading(suggestion.section)
  const needle = `## ${heading}`
  const idx = draft.indexOf(needle)
  if (idx < 0) {
    return `${draft.trimEnd()}\n\n${needle}\n\n- ${suggestion.text}\n`
  }
  const after = idx + needle.length
  const nextHeading = draft.indexOf('\n## ', after)
  const end = nextHeading < 0 ? draft.length : nextHeading
  const block = draft.slice(after, end)
  if (block.includes(suggestion.text)) return draft
  const insertion = `\n\n- ${suggestion.text}`
  return `${draft.slice(0, end).replace(/\s*$/, '')}${insertion}\n${draft.slice(end)}`
}

function sectionHeading(section: ContextContinueSection): string {
  switch (section) {
    case 'assumptions': return '前提 / 假设'
    case 'conclusions': return '已有结论'
    case 'open': return '未决问题'
    case 'next': return '下一步'
  }
}

export function isWebSessionReady(snapshot: Pick<WebSessionSnapshot, 'phase'> | null | undefined): boolean {
  return snapshot?.phase === 'idle' || snapshot?.phase === 'stopped'
}

export function isWebSessionBusy(snapshot: Pick<WebSessionSnapshot, 'phase'> | null | undefined): boolean {
  const phase = snapshot?.phase
  return phase === 'starting' || phase === 'working' || phase === 'awaiting-input'
}

export function checkpointRelativePath(now: Date, entropy: string): string {
  const day = now.toISOString().slice(0, 10)
  return `reports/checkpoints/checkpoint-${day}-${entropy}.md`
}

export function buildCheckpointWritePrompt(path: string, title: string, consensus: string): string {
  return [
    `Write the following research checkpoint exactly to \`${path}\` for "${title}", then stop.`,
    'Do not continue researching or open new tool calls after the file is written.',
    '',
    '```markdown',
    consensus.trim(),
    '```',
  ].join('\n')
}

export function buildContinuePrompt(path: string, title: string, consensus?: string): string {
  const body = [
    `Continue the AutoQuant research titled "${title}".`,
    `Treat [[${path}]] as the source of truth for what we already decided.`,
    'Do not re-litigate settled points unless the checkpoint marks them as open.',
    'Start from the Next steps section and ask only if a critical fact is missing.',
  ]
  if (consensus?.trim()) {
    body.push('', 'Checkpoint substance (also written to the file when available):', '', consensus.trim())
  }
  return body.join('\n')
}

export interface ArchiveAndContinueRow {
  readonly workspaceId: string
  readonly resumeId: string
  readonly title: string
  readonly session: { readonly id: string; readonly state: string; readonly surface?: string; readonly agent?: string }
}

export interface ArchiveAndContinueDeps {
  readonly supportsWeb: boolean
  readonly openWebSession: (wsId: string, sessionId: string) => Promise<void>
  readonly promptWebSession: (wsId: string, sessionId: string, message: string) => Promise<WebSessionSnapshot>
  readonly getWebSession: (wsId: string, sessionId: string, since?: number) => Promise<WebSessionSnapshot | null>
  readonly readWorkspaceFile: (wsId: string, path: string) => Promise<{ kind: string; content?: string }>
  readonly pauseSession: (wsId: string, sessionId: string) => Promise<unknown>
  readonly setSessionPresence: (wsId: string, resumeId: string, presence: 'archived') => Promise<unknown>
  readonly openLanding: (initialPrompt: string) => void
  readonly now?: Date
  readonly entropy?: string
  readonly settleTimeoutMs?: number
  readonly pollMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly consensus: string
}

export async function runArchiveAndContinue(
  row: ArchiveAndContinueRow,
  deps: ArchiveAndContinueDeps,
): Promise<{ checkpointPath: string; wroteCheckpoint: boolean }> {
  const now = deps.now ?? new Date()
  const entropy = deps.entropy ?? Math.random().toString(36).slice(2, 8)
  const checkpointPath = checkpointRelativePath(now, entropy)
  const consensus = deps.consensus.trim()
  const continuePrompt = buildContinuePrompt(checkpointPath, row.title, consensus)
  let wroteCheckpoint = false

  const canPrompt = deps.supportsWeb
    && row.session.surface === 'webpi'
    && row.session.state === 'running'
    && consensus.length > 0

  if (canPrompt) {
    await deps.promptWebSession(row.workspaceId, row.session.id, buildCheckpointWritePrompt(checkpointPath, row.title, consensus))
    const timeout = deps.settleTimeoutMs ?? 45_000
    const pollMs = deps.pollMs ?? 400
    const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const snap = await deps.getWebSession(row.workspaceId, row.session.id)
      const file = await deps.readWorkspaceFile(row.workspaceId, checkpointPath)
      if (file.kind === 'ok' && typeof file.content === 'string' && file.content.trim().length > 0) {
        wroteCheckpoint = true
        break
      }
      if (snap && isWebSessionReady(snap) && Date.now() > deadline - timeout + 2_000) {
        // Agent returned to idle without the file; still continue with embedded consensus.
        break
      }
      await sleep(pollMs)
    }
  }

  if (row.session.state === 'running') {
    await deps.pauseSession(row.workspaceId, row.session.id)
  }
  await deps.setSessionPresence(row.workspaceId, row.resumeId, 'archived')
  deps.openLanding(continuePrompt)
  return { checkpointPath, wroteCheckpoint }
}
