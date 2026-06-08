/**
 * CodexProvider — AIProvider backed by OpenAI Codex models via ChatGPT subscription OAuth.
 *
 * Calls the Responses API at chatgpt.com/backend-api/codex/responses using
 * the standard OpenAI TypeScript SDK. Auth tokens are read from ~/.codex/auth.json
 * (created by `codex login`).
 *
 * Context is managed by us — each call starts fresh (no previous_response_id).
 * Tools are injected via the Responses API `tools` field.
 */

import OpenAI from 'openai'
import type { Tool } from 'ai'
import { pino } from 'pino'

import type { ProviderResult, ProviderEvent, AIProvider, GenerateOpts } from '../types.js'
import type { SessionEntry } from '../../core/session.js'
import type { ResolvedProfile } from '../../core/config.js'
import { toResponsesInput } from '../../core/session.js'
import { readAgentConfig } from '../../core/config.js'
import { getAccessToken, clearTokenCache } from './auth.js'
import { convertTools } from './tool-bridge.js'

const logger = pino({
  transport: { target: 'pino/file', options: { destination: 'logs/codex.log', mkdir: true } },
})

const DEFAULT_OAUTH_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-5.5'

// ==================== Provider ====================

export class CodexProvider implements AIProvider {
  readonly providerTag = 'codex' as const

  constructor(
    private getTools: () => Promise<Record<string, Tool>>,
    private getSystemPrompt: () => Promise<string>,
  ) {}

  /**
   * Create an OpenAI client from a resolved profile.
   *
   * - loginMethod 'codex-oauth' (default): reads ~/.codex/auth.json, hits
   *   ChatGPT subscription endpoint. Usage billed to ChatGPT plan.
   * - loginMethod 'api-key': uses profile apiKey.
   *   Standard OpenAI API billing, or compatible third-party endpoint.
   */
  private async createClient(profile?: ResolvedProfile): Promise<{ client: OpenAI; model: string }> {
    const model = profile?.model ?? DEFAULT_MODEL
    const loginMethod = profile?.loginMethod ?? 'codex-oauth'

    if (loginMethod === 'api-key') {
      const apiKey = profile?.apiKey
      if (!apiKey) throw new Error('Codex api-key mode requires an API key. Configure it in your profile.')
      const baseURL = profile?.baseUrl ?? DEFAULT_API_BASE_URL
      return { client: new OpenAI({ apiKey, baseURL }), model }
    }

    // OAuth mode
    const token = await getAccessToken()
    const baseURL = profile?.baseUrl ?? DEFAULT_OAUTH_BASE_URL
    return { client: new OpenAI({ apiKey: token, baseURL }), model }
  }

  async ask(prompt: string, profile?: ResolvedProfile): Promise<ProviderResult> {
    const { client, model } = await this.createClient(profile)
    const instructions = await this.getSystemPrompt()

    try {
      // Use raw streaming via responses.create({ stream: true }) — NOT
      // responses.stream(). The latter runs a final-response parser
      // (maybeParseResponse) when the stream closes; the ChatGPT subscription
      // endpoint sometimes emits a `response.completed` without the `output`
      // shape that parser expects, crashing with "Cannot read properties of
      // undefined (reading 'map')" even though the text deltas streamed fine.
      // create({ stream: true }) hands back raw events with no final parse.
      const stream = await client.responses.create({
        model,
        instructions,
        input: [{ role: 'user' as const, content: prompt }],
        store: false,
        stream: true,
      })

      let text = ''
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') text += event.delta
        else if (event.type === 'error') throw new Error(`Codex stream error: ${event.message}`)
        else if (event.type === 'response.failed')
          throw new Error(`Codex response failed: ${event.response.error?.message ?? 'unknown error'}`)
      }

      return { text: text || '(no output)', media: [] }
    } catch (err) {
      logger.error({ err }, 'ask_error')
      throw err
    }
  }

  async *generate(
    entries: SessionEntry[],
    prompt: string,
    opts?: GenerateOpts,
  ): AsyncGenerator<ProviderEvent> {
    const { client, model } = await this.createClient(opts?.profile)
    const instructions = opts?.systemPrompt ?? await this.getSystemPrompt()
    const agentConfig = await readAgentConfig()
    const maxSteps = agentConfig.maxSteps

    // Build tools
    const allTools = await this.getTools()
    const tools = convertTools(allTools, opts?.disabledTools)

    // Build structured input from session history + current prompt
    const history = toResponsesInput(entries)
    const input: OpenAI.Responses.ResponseInputItem[] = [
      ...history as OpenAI.Responses.ResponseInputItem[],
      { role: 'user', content: prompt },
    ]

    yield* this.toolLoop(client, model, instructions, input, tools, allTools, maxSteps)
  }

  /**
   * The manual tool loop — sends requests to the Responses API and executes
   * function calls until the model responds with text only or we hit maxSteps.
   */
  private async *toolLoop(
    client: OpenAI,
    model: string,
    instructions: string,
    input: OpenAI.Responses.ResponseInputItem[],
    tools: ReturnType<typeof convertTools>,
    vercelTools: Record<string, Tool>,
    maxSteps: number,
  ): AsyncGenerator<ProviderEvent> {
    let accumulatedText = ''

    for (let step = 0; step < maxSteps; step++) {
      const functionCalls: Array<{
        call_id: string
        name: string
        arguments: string
      }> = []
      let stepText = ''

      try {
        // Raw streaming via create({ stream: true }), not responses.stream() —
        // see ask() for why the stream() helper's final-response parser crashes
        // on the ChatGPT subscription endpoint.
        const stream = await client.responses.create({
          model,
          instructions,
          input,
          tools: tools.length > 0 ? tools : undefined,
          store: false, // Required by ChatGPT subscription endpoint
          stream: true,
        })

        for await (const event of stream) {
          if (event.type === 'response.output_text.delta') {
            yield { type: 'text', text: event.delta }
            stepText += event.delta
          } else if (event.type === 'response.output_item.done') {
            // function_call_arguments.done lacks call_id and name;
            // output_item.done carries the complete function call object.
            const item = (event as any).item
            if (item?.type === 'function_call') {
              functionCalls.push({
                call_id: item.call_id,
                name: item.name,
                arguments: item.arguments,
              })
            }
          } else if (event.type === 'error') {
            throw new Error(`Codex stream error: ${event.message}`)
          } else if (event.type === 'response.failed') {
            throw new Error(`Codex response failed: ${event.response.error?.message ?? 'unknown error'}`)
          } else if (event.type === 'response.incomplete') {
            throw new Error(`Codex response incomplete: ${event.response.incomplete_details?.reason ?? 'unknown reason'}`)
          }
        }
      } catch (err: any) {
        // On 401, clear token cache and surface auth error
        if (err?.status === 401) {
          clearTokenCache()
          const errorText = accumulatedText + stepText +
            '\n\n[Codex auth expired. Run `codex login` to re-authenticate.]'
          yield { type: 'done', result: { text: errorText, media: [] } }
          return
        }
        // Extract all available error detail from OpenAI SDK error
        const errDetail: Record<string, unknown> = {
          message: err?.message,
          status: err?.status,
          type: err?.type,
          code: err?.code,
          param: err?.param,
        }
        // The SDK stores the parsed error body in err.error
        if (err?.error) errDetail.errorBody = err.error
        // Raw response headers can help debug
        if (err?.headers) {
          const h: Record<string, string> = {}
          try { for (const [k, v] of Object.entries(err.headers)) h[k] = String(v) } catch {}
          if (Object.keys(h).length > 0) errDetail.headers = h
        }
        errDetail.model = model
        errDetail.inputItems = input.length
        errDetail.toolCount = tools.length
        logger.error(errDetail, 'responses_api_error')
        const errorText = accumulatedText + stepText +
          `\n\n[Codex API error: ${err?.message ?? 'unknown error'}]`
        yield { type: 'done', result: { text: errorText, media: [] } }
        return
      }

      accumulatedText += stepText

      // No function calls — model is done
      if (functionCalls.length === 0) {
        yield { type: 'done', result: { text: accumulatedText, media: [] } }
        return
      }

      // Execute function calls and build follow-up input
      const toolResults: Array<{ call_id: string; output: string }> = []

      for (const fc of functionCalls) {
        let parsedInput: unknown
        try {
          parsedInput = JSON.parse(fc.arguments)
        } catch {
          parsedInput = {}
        }

        // Yield tool_use event
        yield { type: 'tool_use', id: fc.call_id, name: fc.name, input: parsedInput }
        logger.info({ tool: fc.name, call_id: fc.call_id }, 'tool_use')

        // Execute the tool
        const tool = vercelTools[fc.name]
        let resultContent: string
        if (!tool?.execute) {
          resultContent = JSON.stringify({ error: `Unknown tool: ${fc.name}` })
        } else {
          try {
            const result = await tool.execute(parsedInput, {
              toolCallId: fc.call_id,
              messages: [],
            })
            resultContent = typeof result === 'string' ? result : JSON.stringify(result ?? '')
          } catch (err) {
            resultContent = JSON.stringify({ error: `Tool execution failed: ${err}` })
          }
        }

        // Yield tool_result event
        yield { type: 'tool_result', tool_use_id: fc.call_id, content: resultContent }
        logger.info({ tool: fc.name, call_id: fc.call_id, content: resultContent.slice(0, 300) }, 'tool_result')

        toolResults.push({ call_id: fc.call_id, output: resultContent })
      }

      // Append function calls + outputs to input for next round
      for (const fc of functionCalls) {
        input.push({
          type: 'function_call',
          call_id: fc.call_id,
          name: fc.name,
          arguments: fc.arguments,
        } as OpenAI.Responses.ResponseInputItem)
      }
      for (const tr of toolResults) {
        input.push({
          type: 'function_call_output',
          call_id: tr.call_id,
          output: tr.output,
        } as OpenAI.Responses.ResponseInputItem)
      }
    }

    // Max steps reached
    yield {
      type: 'done',
      result: { text: accumulatedText + '\n\n[Max tool iterations reached]', media: [] },
    }
  }
}
