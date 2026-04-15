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

// ==================== Types ====================

export interface ModelOption {
  id: string
  label: string
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
  writeOnlyFields?: string[]
}

// ==================== Official: Claude ====================

export const CLAUDE_OAUTH: PresetDef = {
  id: 'claude-oauth',
  label: 'Claude (Subscription)',
  description: 'Use your Claude Pro/Max subscription',
  category: 'official',
  defaultName: 'Claude (Pro/Max)',
  hint: 'Requires Claude Code CLI login. Run `claude login` in your terminal first.',
  zodSchema: z.object({
    backend: z.literal('agent-sdk'),
    loginMethod: z.literal('claudeai'),
    model: z.string().default('claude-sonnet-4-6').describe('Model'),
  }),
  models: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  ],
}

export const CLAUDE_API: PresetDef = {
  id: 'claude-api',
  label: 'Claude (API Key)',
  description: 'Pay per token via Anthropic API',
  category: 'official',
  defaultName: 'Claude (API Key)',
  zodSchema: z.object({
    backend: z.literal('agent-sdk'),
    loginMethod: z.literal('api-key'),
    model: z.string().default('claude-sonnet-4-6').describe('Model'),
    apiKey: z.string().min(1).describe('Anthropic API key'),
  }),
  models: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  writeOnlyFields: ['apiKey'],
}

// ==================== Official: OpenAI Codex ====================

export const CODEX_OAUTH: PresetDef = {
  id: 'codex-oauth',
  label: 'Codex CLI (Subscription)',
  description: 'Use your local Codex CLI login and ChatGPT subscription',
  category: 'official',
  defaultName: 'Codex CLI (Subscription)',
  hint: 'Requires Codex CLI login. Run `codex login` in your terminal first. Open Alice will call local `codex exec` and attach Alice tools over MCP.',
  zodSchema: z.object({
    backend: z.literal('codex'),
    loginMethod: z.literal('codex-oauth'),
    model: z.string().default('gpt-5.4').describe('Model'),
  }),
  models: [
    { id: 'gpt-5.4', label: 'GPT 5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT 5.4 Mini' },
  ],
}

export const CODEX_API: PresetDef = {
  id: 'codex-api',
  label: 'Codex CLI (API Key)',
  description: 'Use local Codex CLI with an OpenAI API key',
  category: 'official',
  defaultName: 'Codex CLI (API Key)',
  zodSchema: z.object({
    backend: z.literal('codex'),
    loginMethod: z.literal('api-key'),
    model: z.string().default('gpt-5.4').describe('Model'),
    apiKey: z.string().min(1).describe('OpenAI API key'),
  }),
  models: [
    { id: 'gpt-5.4', label: 'GPT 5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT 5.4 Mini' },
  ],
  writeOnlyFields: ['apiKey'],
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
    model: z.string().default('gemini-2.5-flash').describe('Model'),
    apiKey: z.string().min(1).describe('Google AI API key'),
  }),
  models: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],
  writeOnlyFields: ['apiKey'],
}

// ==================== Third-party: MiniMax ====================

export const MINIMAX: PresetDef = {
  id: 'minimax',
  label: 'MiniMax',
  description: 'MiniMax models via Claude Agent SDK (Anthropic-compatible)',
  category: 'third-party',
  defaultName: 'MiniMax',
  hint: 'Get your API key at minimaxi.com',
  zodSchema: z.object({
    backend: z.literal('agent-sdk'),
    loginMethod: z.literal('api-key'),
    baseUrl: z.literal('https://api.minimaxi.com/anthropic').describe('MiniMax API endpoint'),
    model: z.string().default('MiniMax-M2.7').describe('Model'),
    apiKey: z.string().min(1).describe('MiniMax API key'),
  }),
  models: [
    { id: 'MiniMax-M2.7', label: 'MiniMax M2.7' },
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
  CUSTOM,
]
