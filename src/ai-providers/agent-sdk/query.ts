/**
 * Agent SDK query wrapper — encapsulates `query()` with env injection and result collection.
 *
 * API key comes from `readAIProviderConfig().apiKeys.anthropic`, injected via
 * `env: { ANTHROPIC_API_KEY }`. Per-channel overrides take precedence.
 */

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { createWriteStream, mkdirSync } from 'node:fs'
import { pino } from 'pino'
import type { ContentBlock } from '../../core/session.js'

// Config is now resolved via profile system — override carries all needed values

const logger = pino({
  transport: { target: 'pino/file', options: { destination: 'logs/agent-sdk.log', mkdir: true } },
})

// ==================== Types ====================

export interface AgentSdkConfig {
  allowedTools?: string[]
  disallowedTools?: string[]
  evolutionMode?: boolean
  maxTurns?: number
  cwd?: string
  systemPrompt?: string
  appendSystemPrompt?: string
  /** Called for each tool_use block in the stream. */
  onToolUse?: (toolUse: { id: string; name: string; input: unknown }) => void
  /** Called for each tool_result in the stream. */
  onToolResult?: (toolResult: { toolUseId: string; content: string }) => void
  /** Called for each intermediate text block in the stream. */
  onText?: (text: string) => void
}

export interface AgentSdkOverride {
  model?: string
  apiKey?: string
  baseUrl?: string
  loginMethod?: 'api-key' | 'claudeai'
}

export interface AgentSdkMessage {
  role: 'assistant' | 'user'
  content: ContentBlock[]
}

export interface AgentSdkResult {
  text: string
  ok: boolean
  messages: AgentSdkMessage[]
}

// ==================== Tool lists ====================

const NORMAL_ALLOWED_TOOLS = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  'mcp__open-alice__*',
]

const EVOLUTION_ALLOWED_TOOLS = [
  'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  'mcp__open-alice__*',
]

const NORMAL_EXTRA_DISALLOWED = ['Bash']
const EVOLUTION_EXTRA_DISALLOWED: string[] = []

// ==================== Strip image data ====================

function stripImageData(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return raw
    let changed = false
    const cleaned = parsed.map((item: Record<string, unknown>) => {
      if (item.type === 'image' && (item.source as Record<string, unknown>)?.data) {
        changed = true
        return { type: 'text', text: '[Image saved to disk — use Read tool to view the file]' }
      }
      return item
    })
    return changed ? JSON.stringify(cleaned) : raw
  } catch { return raw }
}

// ==================== Error classification ====================

type ErrorClass = 'auth' | 'model' | 'unknown'

const AUTH_PATTERNS = [
  /\b401\b/,
  /\binvalid[_\s-]?api[_\s-]?key\b/i,
  /\bauthentication\b/i,
  /\bunauthor(?:ized|ised)\b/i,
  /\bpermission[_\s-]denied\b/i,
  /\bx-api-key\b/i,
]

const MODEL_PATTERNS = [
  /\bmodel[_\s-]not[_\s-]found\b/i,
  /\binvalid[_\s-]?model\b/i,
  /\bunknown[_\s-]?model\b/i,
  /\bmodel\s+.+?\s+(?:does\s+not\s+exist|is\s+not\s+(?:a\s+)?valid)\b/i,
]

function classifyError(details: Record<string, unknown>): ErrorClass {
  const haystack = [details.message, details.stderr, details.stdout]
    .filter((x): x is string => typeof x === 'string')
    .join('\n')
  if (AUTH_PATTERNS.some(p => p.test(haystack))) return 'auth'
  if (MODEL_PATTERNS.some(p => p.test(haystack))) return 'model'
  return 'unknown'
}

// ==================== Public ====================

/**
 * Call Agent SDK `query()` and collect the result.
 *
 * Each invocation is independent (persistSession: false). The caller manages
 * session persistence via SessionStore, matching the Claude Code CLI provider pattern.
 */
export async function askAgentSdk(
  prompt: string,
  config: AgentSdkConfig = {},
  override?: AgentSdkOverride,
  mcpServer?: McpSdkServerConfigWithInstance,
): Promise<AgentSdkResult> {
  const {
    allowedTools = [],
    disallowedTools = [],
    evolutionMode = false,
    maxTurns = 20,
    cwd = process.cwd(),
    systemPrompt,
    onToolUse,
    onToolResult,
    onText,
  } = config

  // Merge: explicit config overrides mode defaults
  const modeAllowed = evolutionMode ? EVOLUTION_ALLOWED_TOOLS : NORMAL_ALLOWED_TOOLS
  const modeDisallowed = evolutionMode ? EVOLUTION_EXTRA_DISALLOWED : NORMAL_EXTRA_DISALLOWED
  const finalAllowed = allowedTools.length > 0 ? allowedTools : modeAllowed
  const finalDisallowed = [...disallowedTools, ...modeDisallowed]

  // Build env with authentication — override carries resolved profile values
  const loginMethod = override?.loginMethod ?? 'api-key'
  const isOAuthMode = loginMethod === 'claudeai'

  const env: Record<string, string | undefined> = { ...process.env }
  // Allow spawning inside an existing Claude Code session
  delete env.CLAUDECODE
  if (isOAuthMode) {
    // Force OAuth by removing any inherited API key
    delete env.ANTHROPIC_API_KEY
    delete env.CLAUDE_CODE_SIMPLE
  } else {
    const apiKey = override?.apiKey
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey
    // Force API key mode — disable OAuth even if local login exists
    env.CLAUDE_CODE_SIMPLE = '1'
  }
  const baseUrl = override?.baseUrl
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl

  // Opt-in debug: set ALICE_SDK_DEBUG=1 to turn on the SDK's verbose stderr
  // + capture every child-process stderr chunk into logs/agent-sdk-debug.log.
  // This is what surfaces the actual outbound HTTP URLs the CLI hits.
  const debugEnabled = process.env.ALICE_SDK_DEBUG === '1'
  let debugStream: ReturnType<typeof createWriteStream> | null = null
  if (debugEnabled) {
    env.DEBUG_CLAUDE_AGENT_SDK = '1'
    try { mkdirSync('logs', { recursive: true }) } catch { /* ok */ }
    debugStream = createWriteStream('logs/agent-sdk-debug.log', { flags: 'a' })
    debugStream.write(
      `\n===== ${new Date().toISOString()} | ` +
      `loginMethod=${loginMethod} model=${override?.model} baseUrl=${baseUrl ?? '(default)'} =====\n`,
    )
  }

  // MCP servers
  const mcpServers: Record<string, any> = {}
  if (mcpServer) {
    mcpServers['open-alice'] = mcpServer
  }

  const messages: AgentSdkMessage[] = []
  let resultText = ''
  let ok = true

  try {
    for await (const event of sdkQuery({
      prompt,
      options: {
        cwd,
        env,
        model: override?.model ?? 'claude-opus-4-7',
        maxTurns,
        allowedTools: finalAllowed,
        disallowedTools: finalDisallowed,
        mcpServers,
        systemPrompt,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        ...(loginMethod === 'claudeai' ? { forceLoginMethod: 'claudeai' as const } : {}),
        ...(debugStream ? { stderr: (chunk: string) => debugStream!.write(chunk) } : {}),
      },
    })) {
      // assistant message — extract tool_use + text blocks
      if (event.type === 'assistant' && 'message' in event) {
        const msg = (event as any).message
        if (msg?.content) {
          const blocks: ContentBlock[] = []
          for (const block of msg.content) {
            if (block.type === 'tool_use') {
              logger.info({ tool: block.name, input: block.input }, 'tool_use')
              blocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
              onToolUse?.({ id: block.id, name: block.name, input: block.input })
            } else if (block.type === 'text') {
              blocks.push({ type: 'text', text: block.text })
              onText?.(block.text)
            }
          }
          if (blocks.length > 0) {
            messages.push({ role: 'assistant', content: blocks })
          }
        }
      }

      // user message — extract tool_result blocks
      else if (event.type === 'user' && 'message' in event) {
        const msg = (event as any).message
        const content = msg?.content
        if (Array.isArray(content)) {
          const blocks: ContentBlock[] = []
          for (const block of content) {
            if (block.type === 'tool_result') {
              const raw = typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content ?? '')
              const sessionContent = stripImageData(raw)
              logger.info({ toolUseId: block.tool_use_id, content: sessionContent.slice(0, 500) }, 'tool_result')
              blocks.push({ type: 'tool_result', tool_use_id: block.tool_use_id, content: sessionContent })
              onToolResult?.({ toolUseId: block.tool_use_id, content: raw })
            }
          }
          if (blocks.length > 0) {
            messages.push({ role: 'user', content: blocks })
          }
        }
      }

      // result — final text
      else if (event.type === 'result') {
        const result = event as any
        if (result.subtype === 'success') {
          resultText = result.result ?? ''
        } else {
          ok = false
          resultText = result.errors?.join('\n') ?? `Agent SDK error: ${result.subtype}`
          // Log failed results with all available detail
          const resultDetail = { subtype: result.subtype, errors: result.errors, result: result.result }
          const classification = classifyError({
            message: resultText,
            stderr: Array.isArray(result.errors) ? result.errors.join('\n') : undefined,
          })
          logger.error({ ...resultDetail, classification, turns: result.num_turns, durationMs: result.duration_ms }, 'result_error')
          if (classification === 'auth') {
            console.warn('[agent-sdk] Auth failed — check your API key / baseUrl in the active profile')
          } else if (classification === 'model') {
            console.warn('[agent-sdk] Model not available on this endpoint — check the region / model combo')
          } else {
            console.error('[agent-sdk] Non-success result:', resultDetail)
          }
        }
        // Full result metadata — surfaces the model the server actually ran,
        // so we can verify provider routing against the configured profile.
        const modelUsed = result.model ?? result.response?.model ?? result.usage?.model
        logger.info({
          subtype: result.subtype,
          model: modelUsed,
          usage: result.usage,
          totalCostUsd: result.total_cost_usd,
          sessionId: result.session_id,
          turns: result.num_turns,
          durationMs: result.duration_ms,
        }, 'result')
        const usageStr = result.usage ? ` in=${result.usage.input_tokens ?? '?'} out=${result.usage.output_tokens ?? '?'}` : ''
        console.info(`[agent-sdk] result: model=${modelUsed ?? '(unreported)'} subtype=${result.subtype}${usageStr}`)
      }
    }
  } catch (err) {
    // Extract as much detail as possible from the error
    const errObj = err instanceof Error ? err : new Error(String(err))
    const details: Record<string, unknown> = {
      message: errObj.message,
      stack: errObj.stack,
    }
    // SDK errors may carry stderr/stdout/cause as extra properties
    for (const key of ['stderr', 'stdout', 'cause', 'code', 'signal'] as const) {
      if ((errObj as any)[key] != null) details[key] = (errObj as any)[key]
    }
    // Enumerate any non-standard properties on the error object
    const extraKeys = Object.keys(errObj).filter(k => !(k in details))
    for (const k of extraKeys) details[k] = (errObj as any)[k]

    const classification = classifyError(details)
    logger.error({ ...details, classification }, 'query_error')
    if (classification === 'auth') {
      // User-fixable: don't scream, just hint. Full detail already in logs/agent-sdk.log.
      console.warn('[agent-sdk] Auth failed — check your API key / baseUrl in the active profile')
    } else if (classification === 'model') {
      console.warn('[agent-sdk] Model not available on this endpoint — check the region / model combo')
    } else {
      console.error('[agent-sdk] Claude Code process error:', details)
    }
    ok = false
    const stderrHint = details.stderr ? `\nstderr: ${details.stderr}` : ''
    resultText = `Agent SDK error: ${errObj.message}${stderrHint}`
  } finally {
    debugStream?.end()
  }

  // Fallback: if result is empty, extract last assistant text
  if (!resultText && ok) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        resultText = messages[i].content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map(b => b.text)
          .join('\n')
        if (resultText) break
      }
    }
  }

  return {
    text: resultText || '(no output)',
    ok,
    messages,
  }
}
