/**
 * AI Provider Preset Catalog — the suggestion backbone for the credential vault.
 *
 * Single source of truth for provider presets: each declares metadata, a model
 * catalog (suggestions, not a lock), the regions × per-wire-shape endpoints a
 * key can authenticate against, and which fields render as password inputs. The
 * in-process provider stack is gone — these are pure form-fill suggestions now.
 */

import { z } from 'zod'

// ==================== Types ====================

export interface ModelOption {
  id: string
  label: string
}

/**
 * The wire protocol a runtime speaks to an endpoint. First-class because a
 * provider often exposes the SAME key behind multiple, mutually-incompatible
 * shapes (Anthropic Messages vs OpenAI Chat Completions vs OpenAI Responses),
 * each at a different endpoint URL. A credential captures every shape its region
 * offers (see `RegionOption.wires`) as its "wire capabilities".
 */
export type WireShape = 'anthropic' | 'openai-chat' | 'openai-responses'

/**
 * A region (or "the official endpoint") a provider's key can authenticate
 * against, with the per-wire-shape endpoint URLs available there. One key
 * (= one region) speaks ALL these shapes — they differ only by URL — so a
 * credential created for this region captures the whole `wires` map and thereby
 * declares its wire capabilities. (`''` ⇒ the shape's official endpoint.)
 */
export interface RegionOption {
  id: string
  label: string
  wires: Partial<Record<WireShape, string>>
}

export interface PresetDef {
  id: string
  label: string
  description: string
  category: 'official' | 'third-party' | 'custom'
  hint?: string
  defaultName: string
  zodSchema: z.ZodType
  models?: ModelOption[]
  /**
   * Regions this provider's key can authenticate against, each carrying the
   * per-wire-shape endpoint URLs available there. The create form: pick a region
   * → the credential captures all of that region's wires. Absent for `custom`
   * (free-form).
   */
  regions?: RegionOption[]
  writeOnlyFields?: string[]
}

// ==================== Official: Claude ====================

export const CLAUDE_OAUTH: PresetDef = {
  id: 'claude-oauth',
  label: 'Claude (Subscription)',
  description: 'Use your Claude Pro/Max subscription',
  category: 'official',
  defaultName: 'Claude (Pro/Max)',
  hint: 'Requires Claude Code CLI login — run `claude login` in your terminal first. Model is switchable here or from the profile list anytime; Opus is most capable but burns subscription quota faster, so consider Sonnet for routine work.',
  zodSchema: z.object({
    backend: z.literal('agent-sdk'),
    loginMethod: z.literal('claudeai'),
    model: z.string().default('claude-opus-4-8').describe('Model'),
  }),
  models: [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  ],
}

export const CLAUDE_API: PresetDef = {
  id: 'claude-api',
  label: 'Claude (API Key)',
  description: 'Pay per token via Anthropic API',
  category: 'official',
  defaultName: 'Claude (API Key)',
  hint: 'Model is switchable here or from the profile list anytime. Opus is ~5× the cost of Sonnet.',
  zodSchema: z.object({
    backend: z.literal('agent-sdk'),
    loginMethod: z.literal('api-key'),
    model: z.string().default('claude-opus-4-8').describe('Model'),
    apiKey: z.string().min(1).describe('Anthropic API key'),
  }),
  models: [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  ],
  regions: [{ id: 'official', label: 'Official (api.anthropic.com)', wires: { anthropic: '' } }],
  writeOnlyFields: ['apiKey'],
}

// ==================== Official: OpenAI Codex ====================

export const CODEX_OAUTH: PresetDef = {
  id: 'codex-oauth',
  label: 'OpenAI Codex (Subscription)',
  description: 'Use your ChatGPT subscription',
  category: 'official',
  defaultName: 'OpenAI Codex (Subscription)',
  hint: 'Requires Codex CLI login. Run `codex login` in your terminal first.',
  zodSchema: z.object({
    backend: z.literal('codex'),
    loginMethod: z.literal('codex-oauth'),
    model: z.string().default('gpt-5.5').describe('Model'),
  }),
  models: [
    { id: 'gpt-5.5', label: 'GPT 5.5' },
    { id: 'gpt-5.4', label: 'GPT 5.4' },
  ],
}

export const CODEX_API: PresetDef = {
  id: 'codex-api',
  label: 'OpenAI (API Key)',
  description: 'Pay per token via OpenAI API',
  category: 'official',
  defaultName: 'OpenAI (API Key)',
  zodSchema: z.object({
    backend: z.literal('codex'),
    loginMethod: z.literal('api-key'),
    model: z.string().default('gpt-5.5').describe('Model'),
    apiKey: z.string().min(1).describe('OpenAI API key'),
  }),
  models: [
    { id: 'gpt-5.5', label: 'GPT 5.5' },
    { id: 'gpt-5.4', label: 'GPT 5.4' },
  ],
  // Same key + base; the shape is how you call it. Responses is OpenAI's
  // current API (what codex speaks); Chat Completions is the legacy shape
  // opencode/pi use.
  regions: [{ id: 'official', label: 'OpenAI (api.openai.com)', wires: { 'openai-responses': '', 'openai-chat': '' } }],
  writeOnlyFields: ['apiKey'],
}

// ==================== Third-party: Gemini ====================

export const GEMINI: PresetDef = {
  id: 'gemini',
  label: 'Google Gemini',
  description: 'Google AI via API key',
  category: 'third-party',
  defaultName: 'Google Gemini',
  zodSchema: z.object({
    backend: z.literal('vercel-ai-sdk'),
    provider: z.literal('google'),
    model: z.string().default('gemini-3.5-flash').describe('Model'),
    apiKey: z.string().min(1).describe('Google AI API key'),
  }),
  models: [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
  // Google's OpenAI-compatibility layer (the native google-generative-ai wire
  // isn't a supported shape yet). Reachable by opencode/pi.
  regions: [{ id: 'default', label: 'Google', wires: { 'openai-chat': 'https://generativelanguage.googleapis.com/v1beta/openai/' } }],
  writeOnlyFields: ['apiKey'],
}

// ==================== Third-party: MiniMax ====================

export const MINIMAX: PresetDef = {
  id: 'minimax',
  label: 'MiniMax',
  description: 'MiniMax models via Claude Agent SDK (Anthropic-compatible)',
  category: 'third-party',
  defaultName: 'MiniMax',
  hint: 'China console: minimaxi.com — International console: minimax.io. API keys are region-locked. MiniMax authenticates via Authorization: Bearer; the international endpoint (api.minimax.io) rejects x-api-key.',
  zodSchema: z.object({
    backend: z.literal('agent-sdk'),
    loginMethod: z.literal('api-key'),
    baseUrl: z.string().default('https://api.minimaxi.com/anthropic').describe('API endpoint'),
    // MiniMax's documented integration uses Authorization: Bearer for every
    // endpoint, and the international site (api.minimax.io) only accepts
    // Bearer. Default to it so both endpoints work without the user having to
    // know the split. Surfaced to the per-workspace config's "Apply" path.
    authMode: z.enum(['x-api-key', 'bearer']).default('bearer').describe('Auth header'),
    model: z.string().default('MiniMax-M3').describe('Model'),
    apiKey: z.string().min(1).describe('MiniMax API key'),
  }),
  regions: [
    { id: 'china', label: 'China (minimaxi.com)', wires: {
      anthropic: 'https://api.minimaxi.com/anthropic', 'openai-chat': 'https://api.minimaxi.com/v1',
    } },
    { id: 'intl', label: 'International (minimax.io)', wires: {
      anthropic: 'https://api.minimax.io/anthropic', 'openai-chat': 'https://api.minimax.io/v1',
    } },
  ],
  models: [
    { id: 'MiniMax-M3', label: 'MiniMax M3' },
    { id: 'MiniMax-M2.7', label: 'MiniMax M2.7' },
  ],
  writeOnlyFields: ['apiKey'],
}

// ==================== Third-party: GLM (Zhipu) ====================

export const GLM: PresetDef = {
  id: 'glm',
  label: 'GLM (Zhipu)',
  description: 'Zhipu GLM models via Claude Agent SDK (Anthropic-compatible)',
  category: 'third-party',
  defaultName: 'GLM',
  hint: 'China console: bigmodel.cn — International console: z.ai. API keys are region-locked. GLM 5.2 is the current flagship, served on both regions.',
  zodSchema: z.object({
    backend: z.literal('agent-sdk'),
    loginMethod: z.literal('api-key'),
    baseUrl: z.string().default('https://open.bigmodel.cn/api/anthropic').describe('API endpoint'),
    model: z.string().default('glm-5.2').describe('Model'),
    apiKey: z.string().min(1).describe('GLM API key'),
  }),
  regions: [
    { id: 'china', label: 'China (bigmodel.cn)', wires: {
      anthropic: 'https://open.bigmodel.cn/api/anthropic', 'openai-chat': 'https://open.bigmodel.cn/api/paas/v4',
    } },
    { id: 'intl', label: 'International (z.ai)', wires: {
      anthropic: 'https://api.z.ai/api/anthropic', 'openai-chat': 'https://api.z.ai/api/paas/v4',
    } },
  ],
  models: [
    { id: 'glm-5.2', label: 'GLM 5.2' },
  ],
  writeOnlyFields: ['apiKey'],
}

// ==================== Third-party: Kimi (Moonshot) ====================

// Moonshot officially pushes OpenAI Chat Completions as the primary integration
// path; we route via their secondary Anthropic-compat endpoint
// (api.moonshot.*/anthropic) to stay on agent-sdk. Our codex backend speaks
// the OpenAI Responses API, which Moonshot's direct endpoints do not
// implement, so codex isn't a viable alternative here.
export const KIMI: PresetDef = {
  id: 'kimi',
  label: 'Kimi (Moonshot)',
  description: 'Moonshot Kimi models via Claude Agent SDK (Anthropic-compatible)',
  category: 'third-party',
  defaultName: 'Kimi',
  hint: 'China console: platform.moonshot.cn — International console: platform.moonshot.ai. API keys are region-locked.',
  zodSchema: z.object({
    backend: z.literal('agent-sdk'),
    loginMethod: z.literal('api-key'),
    baseUrl: z.string().default('https://api.moonshot.cn/anthropic').describe('API endpoint'),
    model: z.string().default('kimi-k2.7-code').describe('Model'),
    apiKey: z.string().min(1).describe('Moonshot API key'),
  }),
  regions: [
    { id: 'china', label: 'China (moonshot.cn)', wires: {
      anthropic: 'https://api.moonshot.cn/anthropic', 'openai-chat': 'https://api.moonshot.cn/v1',
    } },
    { id: 'intl', label: 'International (moonshot.ai)', wires: {
      anthropic: 'https://api.moonshot.ai/anthropic', 'openai-chat': 'https://api.moonshot.ai/v1',
    } },
  ],
  models: [
    { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
    { id: 'kimi-k2.6', label: 'Kimi K2.6' },
  ],
  writeOnlyFields: ['apiKey'],
}

// ==================== Third-party: DeepSeek ====================

export const DEEPSEEK: PresetDef = {
  id: 'deepseek',
  label: 'DeepSeek',
  description: 'DeepSeek models via Claude Agent SDK (Anthropic-compatible)',
  category: 'third-party',
  defaultName: 'DeepSeek',
  hint: 'Get your API key at platform.deepseek.com. Single platform — no regional split. Cached prompt input is heavily discounted ($0.03/M).',
  zodSchema: z.object({
    backend: z.literal('agent-sdk'),
    loginMethod: z.literal('api-key'),
    baseUrl: z.string().default('https://api.deepseek.com/anthropic').describe('API endpoint'),
    model: z.string().default('deepseek-v4-pro').describe('Model'),
    apiKey: z.string().min(1).describe('DeepSeek API key'),
  }),
  regions: [
    { id: 'default', label: 'DeepSeek', wires: {
      anthropic: 'https://api.deepseek.com/anthropic', 'openai-chat': 'https://api.deepseek.com',
    } },
  ],
  models: [
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (flagship)' },
  ],
  writeOnlyFields: ['apiKey'],
}

// ==================== Third-party: LongCat (Meituan) ====================

export const LONGCAT: PresetDef = {
  id: 'longcat',
  label: 'LongCat (Meituan)',
  description: 'Meituan LongCat via OpenAI-compatible and Anthropic APIs',
  category: 'third-party',
  defaultName: 'LongCat',
  hint: 'Declares LongCat\'s OpenAI-compatible and Anthropic endpoints. Use Claude/OpenCode/Pi for this credential unless LongCat adds a Responses-compatible endpoint later.',
  zodSchema: z.object({
    backend: z.literal('vercel-ai-sdk'),
    provider: z.literal('openai-compatible'),
    baseUrl: z.string().default('https://api.longcat.chat/openai').describe('API endpoint'),
    model: z.string().default('LongCat-2.0').describe('Model'),
    apiKey: z.string().min(1).describe('LongCat API key'),
  }),
  regions: [
    { id: 'default', label: 'LongCat (api.longcat.chat)', wires: {
      'openai-chat': 'https://api.longcat.chat/openai',
      anthropic: 'https://api.longcat.chat/anthropic',
    } },
  ],
  models: [
    { id: 'LongCat-2.0', label: 'LongCat 2.0' },
  ],
  writeOnlyFields: ['apiKey'],
}

// ==================== Custom ====================

export const CUSTOM: PresetDef = {
  id: 'custom',
  label: 'Custom',
  description: 'Full control — any provider, model, and endpoint',
  category: 'custom',
  defaultName: '',
  zodSchema: z.object({
    backend: z.enum(['agent-sdk', 'codex', 'vercel-ai-sdk']).default('vercel-ai-sdk').describe('Backend engine'),
    provider: z.string().optional().default('openai').describe('SDK provider (for Vercel AI SDK)'),
    loginMethod: z.string().optional().default('api-key').describe('Authentication method'),
    model: z.string().describe('Model ID'),
    baseUrl: z.string().optional().describe('Custom API endpoint (leave empty for official)'),
    apiKey: z.string().optional().describe('API key'),
  }),
  // No `regions` — Custom is free-form: the form lets the user pick any wire
  // shape and type the endpoint URL by hand.
  writeOnlyFields: ['apiKey'],
}

// ==================== All presets (ordered) ====================

export const PRESET_CATALOG: PresetDef[] = [
  CLAUDE_OAUTH,
  CLAUDE_API,
  CODEX_OAUTH,
  CODEX_API,
  MINIMAX,
  GLM,
  KIMI,
  DEEPSEEK,
  LONGCAT,
  GEMINI,
  CUSTOM,
]

/**
 * The capable-flagship model to seed a fresh injection with when a credential
 * has no remembered `lastModel` yet (keyed by `CredentialVendor`). This is only
 * the very-first-run default — once a model is run it's remembered on the cred —
 * so it favors the most capable tier (a trading agent wants the flagship, not a
 * fast/cheap variant), mirroring the preset model lists. `custom` has no
 * canonical model (free-form), so it's absent and the caller falls back to
 * "let the runtime decide".
 */
export const DEFAULT_MODEL_BY_VENDOR: Record<string, string> = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-5.5',
  google: 'gemini-2.5-pro',
  minimax: 'MiniMax-M3',
  glm: 'glm-5.2',
  kimi: 'kimi-k2.7-code',
  deepseek: 'deepseek-v4-pro',
  longcat: 'LongCat-2.0',
}
