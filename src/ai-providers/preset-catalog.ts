/**
 * AI Provider Preset Catalog — Zod-defined preset declarations.
 *
 * This file is the single source of truth for all preset definitions.
 * To add a new provider or update model versions, edit only this file.
 *
 * Each preset declares:
 *   - Metadata (id, label, description, category, hint, defaultName)
 *   - A Zod schema defining the profile fields and their constraints
 *   - A model catalog with human-readable labels
 *   - Fields that should render as password inputs (writeOnly)
 */

import { z } from 'zod'
import type { SdkAdapterDeclaration, SdkAdapterId } from './sdk-adapters.js'

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
 * offers (see `RegionOption.wires`) as its "wire capabilities". Extensible
 * (google-generative-ai etc.) when a runtime needs it.
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

export const WIRE_SHAPE_LABELS: Record<WireShape, string> = {
  anthropic: 'Anthropic (Messages)',
  'openai-chat': 'OpenAI (Chat Completions)',
  'openai-responses': 'OpenAI (Responses)',
}

/**
 * Adapter declaration block for a preset. `available` lists every SDK
 * adapter the preset's credential can drive, each with a builder that
 * maps the credential into that SDK's standard config shape.
 *
 * `test` names the adapter used by the wizard's "Test" button — pick
 * the lightest available so non-subscription presets skip the heavy
 * agent-sdk subprocess.
 */
export interface PresetSdkAdapters {
  available: SdkAdapterDeclaration[]
  test: SdkAdapterId
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
  /** Internal — not exposed to the wizard JSON Schema. Drives the
   *  test-path adapter selection in GenerateRouter.askForTest. */
  sdkAdapters?: PresetSdkAdapters
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
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  ],
  sdkAdapters: {
    available: [
      { id: 'agent-sdk', config: () => ({ loginMethod: 'claudeai' }) },
    ],
    test: 'agent-sdk',
  },
}

export const CLAUDE_API: PresetDef = {
  id: 'claude-api',
  label: 'Claude (API Key)',
  description: 'Pay per token via Anthropic API',
  category: 'official',
  defaultName: 'Claude (API Key)',
  hint: 'Model is switchable here or from the profile list anytime. Opus is ~5× the cost of Sonnet; Haiku is cheapest for high-volume work.',
  zodSchema: z.object({
    backend: z.literal('agent-sdk'),
    loginMethod: z.literal('api-key'),
    model: z.string().default('claude-opus-4-8').describe('Model'),
    apiKey: z.string().min(1).describe('Anthropic API key'),
  }),
  models: [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  regions: [{ id: 'official', label: 'Official (api.anthropic.com)', wires: { anthropic: '' } }],
  writeOnlyFields: ['apiKey'],
  sdkAdapters: {
    available: [
      { id: 'vercel-anthropic', config: (c) => ({ apiKey: c.apiKey, baseURL: c.baseUrl }) },
      { id: 'agent-sdk', config: (c) => ({ apiKey: c.apiKey, baseUrl: c.baseUrl, loginMethod: 'api-key' }) },
    ],
    test: 'vercel-anthropic',
  },
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
    { id: 'gpt-5.4-mini', label: 'GPT 5.4 Mini' },
  ],
  sdkAdapters: {
    available: [
      { id: 'codex', config: () => ({ loginMethod: 'codex-oauth' }) },
    ],
    test: 'codex',
  },
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
    { id: 'gpt-5.4-mini', label: 'GPT 5.4 Mini' },
  ],
  // Same key + base; the shape is how you call it. Responses is OpenAI's
  // current API (what codex speaks); Chat Completions is the legacy shape
  // opencode/pi use.
  regions: [{ id: 'official', label: 'OpenAI (api.openai.com)', wires: { 'openai-responses': '', 'openai-chat': '' } }],
  writeOnlyFields: ['apiKey'],
  sdkAdapters: {
    available: [
      { id: 'vercel-openai', config: (c) => ({ apiKey: c.apiKey, baseURL: c.baseUrl }) },
      { id: 'codex', config: (c) => ({ apiKey: c.apiKey, baseUrl: c.baseUrl, loginMethod: 'api-key' }) },
    ],
    test: 'vercel-openai',
  },
}

// ==================== Official: Gemini ====================

export const GEMINI: PresetDef = {
  id: 'gemini',
  label: 'Google Gemini',
  description: 'Google AI via API key',
  category: 'official',
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
  sdkAdapters: {
    available: [
      { id: 'vercel-google', config: (c) => ({ apiKey: c.apiKey, baseURL: c.baseUrl }) },
    ],
    test: 'vercel-google',
  },
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
  sdkAdapters: {
    available: [
      // MiniMax serves Anthropic API at `/anthropic/v1/messages`.
      // @ai-sdk/anthropic appends `/messages` directly, so the
      // preset must append `/v1` to the user's baseUrl.
      { id: 'vercel-anthropic', config: (c) => ({ apiKey: c.apiKey, baseURL: c.baseUrl ? `${c.baseUrl}/v1` : undefined }) },
      { id: 'agent-sdk', config: (c) => ({ apiKey: c.apiKey, baseUrl: c.baseUrl, loginMethod: 'api-key' }) },
    ],
    test: 'vercel-anthropic',
  },
}

// ==================== Third-party: GLM (Zhipu) ====================

export const GLM: PresetDef = {
  id: 'glm',
  label: 'GLM (Zhipu)',
  description: 'Zhipu GLM models via Claude Agent SDK (Anthropic-compatible)',
  category: 'third-party',
  defaultName: 'GLM',
  hint: 'China console: bigmodel.cn — International console: z.ai. API keys are region-locked. GLM 5.1 is the current flagship, served on both regions.',
  zodSchema: z.object({
    backend: z.literal('agent-sdk'),
    loginMethod: z.literal('api-key'),
    baseUrl: z.string().default('https://open.bigmodel.cn/api/anthropic').describe('API endpoint'),
    model: z.string().default('glm-5.1').describe('Model'),
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
    { id: 'glm-5.1', label: 'GLM 5.1' },
    { id: 'glm-4.7', label: 'GLM 4.7' },
    { id: 'glm-4.5-air', label: 'GLM 4.5 Air' },
  ],
  writeOnlyFields: ['apiKey'],
  sdkAdapters: {
    available: [
      // GLM serves Anthropic API at `/anthropic/v1/messages` (path probe).
      { id: 'vercel-anthropic', config: (c) => ({ apiKey: c.apiKey, baseURL: c.baseUrl ? `${c.baseUrl}/v1` : undefined }) },
      { id: 'agent-sdk', config: (c) => ({ apiKey: c.apiKey, baseUrl: c.baseUrl, loginMethod: 'api-key' }) },
    ],
    test: 'vercel-anthropic',
  },
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
    model: z.string().default('kimi-k2.6').describe('Model'),
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
    { id: 'kimi-k2.6', label: 'Kimi K2.6' },
    { id: 'kimi-k2.5', label: 'Kimi K2.5' },
  ],
  writeOnlyFields: ['apiKey'],
  sdkAdapters: {
    available: [
      // Moonshot serves Anthropic API at `/anthropic/v1/messages` (path probe).
      { id: 'vercel-anthropic', config: (c) => ({ apiKey: c.apiKey, baseURL: c.baseUrl ? `${c.baseUrl}/v1` : undefined }) },
      { id: 'agent-sdk', config: (c) => ({ apiKey: c.apiKey, baseUrl: c.baseUrl, loginMethod: 'api-key' }) },
    ],
    test: 'vercel-anthropic',
  },
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
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (cheap/fast)' },
  ],
  writeOnlyFields: ['apiKey'],
  sdkAdapters: {
    available: [
      // DeepSeek serves Anthropic API at `/anthropic/messages` (no /v1
      // segment), unlike MiniMax/GLM/Kimi which need /v1 appended.
      { id: 'vercel-anthropic', config: (c) => ({ apiKey: c.apiKey, baseURL: c.baseUrl }) },
      { id: 'agent-sdk', config: (c) => ({ apiKey: c.apiKey, baseUrl: c.baseUrl, loginMethod: 'api-key' }) },
    ],
    test: 'vercel-anthropic',
  },
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
  GEMINI,
  MINIMAX,
  GLM,
  KIMI,
  DEEPSEEK,
  CUSTOM,
]
