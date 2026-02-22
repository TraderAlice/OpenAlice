import { spawn } from 'node:child_process'
import { pino } from 'pino'
import type { ClaudeCodeConfig, ClaudeCodeResult, ClaudeCodeMessage } from './types.js'
import type { ContentBlock } from '../../core/session.js'
import { logToolCall } from '../log-tool-call.js'

const logger = pino({
  transport: { target: 'pino/file', options: { destination: 'logs/claude-code.log', mkdir: true } },
})

/** Strip base64 image data from tool_result content before persisting to session. */
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

/** Tools pre-approved in normal mode (no Bash). */
const NORMAL_ALLOWED_TOOLS = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  'mcp__open-alice__*',
]

/** Tools pre-approved in evolution mode (includes Bash). */
const EVOLUTION_ALLOWED_TOOLS = [
  'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  'mcp__open-alice__*',
]

/** Extra tools to disallow in normal mode. */
const NORMAL_EXTRA_DISALLOWED = ['Bash']

/** Extra tools to disallow in evolution mode. */
const EVOLUTION_EXTRA_DISALLOWED: string[] = []

/**
 * Spawn `claude -p` as a stateless child process and collect the result.
 *
 * Each invocation is independent — no --resume. The caller is responsible
 * for building the prompt with any conversation context and persisting
 * the result to the session store.
 */
export async function askClaudeCode(
  prompt: string,
  config: ClaudeCodeConfig = {},
): Promise<ClaudeCodeResult> {
  const {
    allowedTools = [],
    disallowedTools = [],
    evolutionMode = false,
    maxTurns = 20,
    cwd = process.cwd(),
    systemPrompt,
    appendSystemPrompt,
    onToolResult,
  } = config

  // Merge: explicit config overrides mode defaults
  const modeAllowed = evolutionMode ? EVOLUTION_ALLOWED_TOOLS : NORMAL_ALLOWED_TOOLS
  const modeDisallowed = evolutionMode ? EVOLUTION_EXTRA_DISALLOWED : NORMAL_EXTRA_DISALLOWED
  const finalAllowed = allowedTools.length > 0 ? allowedTools : modeAllowed
  const finalDisallowed = [...disallowedTools, ...modeDisallowed]

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', String(maxTurns),
  ]

  if (finalAllowed.length > 0) {
    args.push('--allowedTools', ...finalAllowed)
  }

  if (finalDisallowed.length > 0) {
    args.push('--disallowedTools', ...finalDisallowed)
  }

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt)
  }

  if (appendSystemPrompt) {
    args.push('--append-system-prompt', appendSystemPrompt)
  }

  return new Promise<ClaudeCodeResult>((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let buffer = ''
    let stderr = ''
    let resultText = ''
    const messages: ClaudeCodeMessage[] = []

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()

      // Parse complete lines from the JSONL stream
      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)
        if (!line) continue

        try {
          const event = JSON.parse(line)

          // assistant message — extract tool_use blocks
          if (event.type === 'assistant' && event.message?.content) {
            const blocks: ContentBlock[] = []
            for (const block of event.message.content) {
              if (block.type === 'tool_use') {
                logToolCall(block.name, block.input)
                logger.info({ tool: block.name, input: block.input }, 'tool_use')
                blocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
              } else if (block.type === 'text') {
                blocks.push({ type: 'text', text: block.text })
              }
            }
            if (blocks.length > 0) {
              messages.push({ role: 'assistant', content: blocks })
            }
          }

          // user message — extract tool_result blocks
          else if (event.type === 'user' && event.message?.content) {
            const blocks: ContentBlock[] = []
            for (const block of event.message.content) {
              if (block.type === 'tool_result') {
                const content = typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content ?? '')
                const sessionContent = stripImageData(content)
                logger.info({ toolUseId: block.tool_use_id, content: sessionContent.slice(0, 500) }, 'tool_result')
                blocks.push({ type: 'tool_result', tool_use_id: block.tool_use_id, content: sessionContent })
                onToolResult?.({ toolUseId: block.tool_use_id, content })
              }
            }
            if (blocks.length > 0) {
              messages.push({ role: 'user', content: blocks })
            }
          }

          // final result
          else if (event.type === 'result') {
            resultText = event.result ?? ''
            logger.info({ subtype: event.subtype, turns: event.num_turns, durationMs: event.duration_ms }, 'result')
          }
        } catch (err) {
          logger.warn({ line: line.slice(0, 200), error: String(err) }, 'jsonl_parse_error')
        }
      }
    })

    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    child.on('error', (err) => {
      logger.error({ error: err.message }, 'spawn_error')
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`))
    })

    child.on('close', (code) => {
      if (code !== 0) {
        logger.error({ code, stderr: stderr.slice(0, 500) }, 'exit_error')
        return resolve({
          text: `Claude Code exited with code ${code}:\n${stderr || resultText}`,
          ok: false,
          messages,
        })
      }

      // When the final turn is a tool call with no standalone text output,
      // resultText is empty. Fall back to the last assistant text blocks.
      let text = resultText
      if (!text) {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant') {
            text = messages[i].content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map(b => b.text)
              .join('\n')
            if (text) break
          }
        }
      }

      resolve({
        text: text || '(no output)',
        ok: true,
        messages,
      })
    })
  })
}
