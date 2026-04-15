/**
 * CodexProvider — AIProvider backed by the local `codex exec` CLI.
 *
 * This provider does not call the OpenAI HTTP APIs directly. Instead, it
 * shells out to Codex CLI, points it at Open Alice's MCP server, and streams
 * Codex JSONL events back into the engine's ProviderEvent pipeline.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Tool } from 'ai'
import { pino } from 'pino'

import type { ProviderResult, ProviderEvent, AIProvider, GenerateOpts } from '../types.js'
import type { SessionEntry } from '../../core/session.js'
import type { ResolvedProfile } from '../../core/config.js'
import { readConnectorsConfig } from '../../core/config.js'
import { toTextHistory } from '../../core/session.js'
import { createChannel } from '../../core/async-channel.js'
import { buildChatHistoryPrompt, DEFAULT_MAX_HISTORY } from '../utils.js'

const logger = pino({
  transport: { target: 'pino/file', options: { destination: 'logs/codex.log', mkdir: true } },
})

const DEFAULT_MODEL = 'gpt-5.4'
const DEFAULT_SANDBOX = 'read-only'
const DEFAULT_MCP_PORT = 3001

interface CodexExecInvocation {
  args: string[]
  cleanup: () => Promise<void>
  env: NodeJS.ProcessEnv
  outputFile: string
}

interface CodexRunResult {
  result: ProviderResult
  stderr: string
}

interface CodexEventState {
  accumulatedText: string
}

function quoteTomlString(value: string): string {
  return JSON.stringify(value)
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

function buildSystemPrompt(instructions: string): string {
  const trimmed = instructions.trim()
  if (!trimmed) return ''
  return [
    '<system_prompt>',
    trimmed,
    '</system_prompt>',
    '',
  ].join('\n')
}

function buildRuntimePrompt(disabledTools?: string[]): string {
  const lines = [
    '<runtime_context>',
    'You are running inside Open Alice through Codex CLI.',
    'Use the connected `openalice` MCP tools when they help.',
  ]
  if (disabledTools && disabledTools.length > 0) {
    lines.push(`The following tools are disabled for this request: ${disabledTools.join(', ')}.`)
    lines.push('Do not call disabled tools.')
  }
  lines.push('</runtime_context>', '')
  return lines.join('\n')
}

export function buildCodexPrompt(opts: {
  instructions: string
  prompt: string
  history: Array<{ role: 'user' | 'assistant'; text: string }>
  historyPreamble?: string
  disabledTools?: string[]
}): string {
  const promptWithHistory = buildChatHistoryPrompt(opts.prompt, opts.history, opts.historyPreamble)
  return [
    buildSystemPrompt(opts.instructions),
    buildRuntimePrompt(opts.disabledTools),
    '<user_request>',
    promptWithHistory,
    '</user_request>',
  ].join('\n')
}

export async function buildCodexExecInvocation(
  prompt: string,
  profile?: ResolvedProfile,
): Promise<CodexExecInvocation> {
  const connectors = await readConnectorsConfig().catch(() => ({ mcp: { port: DEFAULT_MCP_PORT } }))
  const mcpPort = connectors.mcp?.port ?? DEFAULT_MCP_PORT
  const mcpUrl = `http://127.0.0.1:${mcpPort}/mcp`

  const tempDir = await mkdtemp(join(tmpdir(), 'openalice-codex-'))
  const outputFile = join(tempDir, 'last-message.txt')

  const args = [
    'exec',
    prompt,
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    DEFAULT_SANDBOX,
    '--output-last-message',
    outputFile,
    '-C',
    process.cwd(),
    '-c',
    `mcp_servers.openalice.url=${quoteTomlString(mcpUrl)}`,
  ]

  if (profile?.model) {
    args.push('--model', profile.model)
  } else {
    args.push('--model', DEFAULT_MODEL)
  }

  if (profile?.baseUrl) {
    args.push('-c', `openai_base_url=${quoteTomlString(profile.baseUrl)}`)
  }

  const env = { ...process.env }
  delete env.OPENAI_BASE_URL

  if (profile?.loginMethod === 'api-key' && profile.apiKey) {
    env.OPENAI_API_KEY = profile.apiKey
  }

  return {
    args,
    outputFile,
    env,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

function maybeEmitCompletedAgentText(
  item: Record<string, unknown>,
  state: CodexEventState,
  onEvent?: (event: ProviderEvent) => void,
) {
  if (item.type !== 'agent_message' || typeof item.text !== 'string') return

  const fullText = normalizeWhitespace(item.text)
  if (fullText.startsWith(state.accumulatedText)) {
    const delta = fullText.slice(state.accumulatedText.length)
    if (delta) {
      state.accumulatedText = fullText
      onEvent?.({ type: 'text', text: delta })
    }
    return
  }

  if (fullText !== state.accumulatedText) {
    state.accumulatedText = fullText
    onEvent?.({ type: 'text', text: fullText })
  }
}

function handleCodexJsonLine(
  line: string,
  state: CodexEventState,
  onEvent?: (event: ProviderEvent) => void,
) {
  if (!line.trim()) return

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(line) as Record<string, unknown>
  } catch (err) {
    logger.warn({ line, err }, 'codex_json_parse_failed')
    return
  }

  const type = parsed.type
  if (typeof type !== 'string') return

  if (type === 'item.agent_message.delta' || type === 'item/agentMessage/delta') {
    const delta = parsed.delta
    if (typeof delta === 'string' && delta.length > 0) {
      state.accumulatedText += normalizeWhitespace(delta)
      onEvent?.({ type: 'text', text: delta })
    }
    return
  }

  if (type === 'item.completed') {
    const item = parsed.item
    if (!item || typeof item !== 'object') return

    const completedItem = item as Record<string, unknown>
    if (completedItem.type === 'error') {
      logger.warn({ item: completedItem }, 'codex_item_error')
      return
    }

    maybeEmitCompletedAgentText(completedItem, state, onEvent)
  }
}

export class CodexProvider implements AIProvider {
  readonly providerTag = 'codex' as const

  constructor(
    private _getTools: () => Promise<Record<string, Tool>>,
    private getSystemPrompt: () => Promise<string>,
  ) {}

  async ask(prompt: string, profile?: ResolvedProfile): Promise<ProviderResult> {
    const instructions = await this.getSystemPrompt()
    const fullPrompt = buildCodexPrompt({
      instructions,
      prompt,
      history: [],
    })

    const { result } = await this.runCodex(fullPrompt, profile)
    return result
  }

  async *generate(
    entries: SessionEntry[],
    prompt: string,
    opts?: GenerateOpts,
  ): AsyncGenerator<ProviderEvent> {
    const maxHistory = opts?.maxHistoryEntries ?? DEFAULT_MAX_HISTORY
    const history = toTextHistory(entries).slice(-maxHistory)
    const instructions = opts?.systemPrompt ?? await this.getSystemPrompt()
    const fullPrompt = buildCodexPrompt({
      instructions,
      prompt,
      history,
      historyPreamble: opts?.historyPreamble,
      disabledTools: opts?.disabledTools,
    })

    const channel = createChannel<ProviderEvent>()
    const resultPromise = this.runCodex(fullPrompt, opts?.profile, (event) => channel.push(event))

    resultPromise.then(({ result }) => {
      channel.push({ type: 'done', result })
      channel.close()
    }).catch((err) => {
      channel.error(err instanceof Error ? err : new Error(String(err)))
    })

    yield* channel
  }

  private async runCodex(
    prompt: string,
    profile?: ResolvedProfile,
    onEvent?: (event: ProviderEvent) => void,
  ): Promise<CodexRunResult> {
    const invocation = await buildCodexExecInvocation(prompt, profile)
    const child = spawn('codex', invocation.args, {
      cwd: process.cwd(),
      env: invocation.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const state: CodexEventState = { accumulatedText: '' }
    let stderr = ''

    const stdoutDone = new Promise<void>((resolve, reject) => {
      let buffer = ''
      let finished = false

      const finish = () => {
        if (finished) return
        finished = true
        if (buffer.trim()) {
          try {
            handleCodexJsonLine(buffer, state, onEvent)
          } catch (err) {
            reject(err)
            return
          }
        }
        resolve()
      }

      child.stdout.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        buffer += text
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            handleCodexJsonLine(line, state, onEvent)
          } catch (err) {
            reject(err)
            return
          }
        }
      })
      child.stdout.once('end', finish)
      child.stdout.once('close', finish)
      child.stdout.once('error', reject)
    })

    const stderrDone = new Promise<void>((resolve) => {
      const finish = () => resolve()
      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        stderr += text
      })
      child.stderr.once('end', finish)
      child.stderr.once('close', finish)
      child.stderr.once('error', finish)
    })

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => resolve(code ?? 1))
    })

    await Promise.all([stdoutDone, stderrDone])

    if (stderr.trim()) {
      logger.info({ stderr }, 'codex_cli_stderr')
    }

    const outputFileText = await readFile(invocation.outputFile, 'utf8').catch(() => '')
    const finalText = outputFileText.trim() || state.accumulatedText.trim() || '(no output)'

    try {
      if (exitCode !== 0) {
        throw new Error(
          stderr.trim()
            ? `codex exec failed (exit ${exitCode}): ${stderr.trim()}`
            : `codex exec failed with exit code ${exitCode}`,
        )
      }

      return {
        result: { text: finalText, media: [] },
        stderr,
      }
    } finally {
      await invocation.cleanup()
    }
  }
}
