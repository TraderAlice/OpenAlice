/**
 * Per-workspace AI provider probes — used by the Workspace AI config modal's
 * Test button. Sends a minimal "Hi" prompt to verify baseUrl + apiKey + model
 * end-to-end. Returns the model's reply text on success so the UI can show
 * "the AI actually spoke back."
 *
 * Lives in `src/workspaces/` rather than inlined in the route so future
 * surfaces (Telegram /workspace test, CLI) can reuse the same probe.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import type { WireShape } from '../ai-providers/preset-catalog.js';

export interface ProbeResult {
  text: string;
}

const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com';
const DEFAULT_GOOGLE_GENERATIVE_AI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
export const PROBE_TIMEOUT_MS = 20_000;

export interface ClaudeProbeInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * Which HTTP header carries the key. `x-api-key` is Anthropic's first-party
   * standard (the default); `bearer` sends `Authorization: Bearer <key>`,
   * which is what most anthropic-compatible *gateways* expect (MiniMax's
   * international endpoint, OpenRouter-style proxies, etc.). Mirrors the
   * ANTHROPIC_API_KEY vs ANTHROPIC_AUTH_TOKEN split the real session uses.
   */
  authMode?: 'x-api-key' | 'bearer';
}

export interface CodexProbeInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  wireApi: 'chat' | 'responses';
}

export interface GoogleProbeInput {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Does this error mean the model MANDATES extended thinking? Some reasoning
 *  models (e.g. Kimi k2.7) 400 with "invalid thinking: only type=enabled is
 *  allowed for this model" when the request omits thinking — they can't run it
 *  disabled. We detect that to retry with thinking on, rather than enabling it
 *  for every model (Claude/GLM/etc. don't need it and some reject the param). */
function isThinkingRequiredError(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | undefined;
  return e?.status === 400 && typeof e?.message === 'string' && /thinking/i.test(e.message);
}

export async function probeAnthropic(input: ClaudeProbeInput): Promise<ProbeResult> {
  // `authToken` makes the SDK send `Authorization: Bearer`; `apiKey` makes it
  // send `x-api-key`. Pick exactly one — sending both can trip gateways that
  // reject ambiguous auth, and Anthropic's own API now 401s OAuth-via-Bearer.
  // The SDK silently falls back to the ambient ANTHROPIC_API_KEY /
  // ANTHROPIC_AUTH_TOKEN env vars when the matching option is `undefined`, so
  // pin the unused credential to `null` (null skips the env fallback) to keep
  // the wire carrying the configured key only.
  const client = input.authMode === 'bearer'
    ? new Anthropic({ authToken: input.apiKey, apiKey: null, baseURL: input.baseUrl, timeout: PROBE_TIMEOUT_MS, maxRetries: 0 })
    : new Anthropic({ apiKey: input.apiKey, authToken: null, baseURL: input.baseUrl, timeout: PROBE_TIMEOUT_MS, maxRetries: 0 });

  const extract = (msg: Anthropic.Message): string => msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  try {
    const msg = await client.messages.create({
      model: input.model,
      // Enough room for a reasoning model to finish thinking AND emit a visible
      // reply on a trivial prompt — a tiny budget gets spent entirely on reasoning,
      // leaving empty content (the "(empty reply)" the user saw). One-off per Test.
      max_tokens: 512,
      messages: [{ role: 'user', content: 'Hi' }],
    });
    return { text: extract(msg) };
  } catch (err) {
    if (!isThinkingRequiredError(err)) throw err;
    // Thinking-mandatory model: retry with it enabled. budget_tokens must be
    // < max_tokens and Anthropic's floor is 1024, so bump max_tokens to match.
    const msg = await client.messages.create({
      model: input.model,
      max_tokens: 2048,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      messages: [{ role: 'user', content: 'Hi' }],
    });
    return { text: extract(msg) };
  }
}

export async function probeOpenAI(input: CodexProbeInput): Promise<ProbeResult> {
  const client = new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseUrl,
    timeout: PROBE_TIMEOUT_MS,
    maxRetries: 0,
  });
  if (input.wireApi === 'responses') {
    const resp = await client.responses.create({
      model: input.model,
      input: 'Hi',
      max_output_tokens: 512,
    });
    return { text: resp.output_text ?? '' };
  }
  const resp = await client.chat.completions.create({
    model: input.model,
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 512,
  });
  const choice = resp.choices[0]?.message as { content?: string | null; reasoning_content?: string | null } | undefined;
  // Prefer the final answer; fall back to the reasoning trace so a reasoning
  // model that returned only thinking still shows it spoke (not "(empty reply)").
  const text = choice?.content?.trim() || choice?.reasoning_content?.trim() || '';
  return { text };
}

/**
 * Probe Google's native Generative Language API. New Google AI Studio keys use
 * the `AQ.` authorization-key format and must be sent as `x-goog-api-key`;
 * routing them through the OpenAI compatibility layer turns them into Bearer
 * tokens and can fail with ACCESS_TOKEN_TYPE_UNSUPPORTED. This request mirrors
 * the native wire Pi and opencode use after credential injection.
 */
export async function probeGoogleGenerativeAi(input: GoogleProbeInput): Promise<ProbeResult> {
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  const model = input.model.replace(/^models\//, '');
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Hi' }] }],
        generationConfig: { maxOutputTokens: 64 },
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`Connection timed out after ${PROBE_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  }

  const raw = await response.text();
  let payload: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  } = {};
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    // Preserve a short non-JSON response below without leaking request data.
  }
  if (!response.ok) {
    const detail = payload.error?.message?.trim() || raw.trim().slice(0, 500) || response.statusText;
    throw new Error(`Google Gemini ${response.status}: ${detail}`);
  }
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('') ?? '';
  return { text };
}

/**
 * Single dispatcher: probe an endpoint by its wire shape. The one place that
 * maps WireShape → prober — both the credential-vault test
 * (`/api/config/credentials/test`) and the per-workspace test
 * (`/api/workspaces/:id/agent-config/:agent/test`) go through here, so "Test"
 * means the same thing everywhere. An empty baseUrl falls back to the shape's
 * official endpoint.
 */
export async function probeByWireShape(
  wireShape: WireShape,
  input: { baseUrl?: string; apiKey: string; model: string; authMode?: 'x-api-key' | 'bearer' },
): Promise<ProbeResult> {
  switch (wireShape) {
    case 'anthropic':
      return probeAnthropic({
        baseUrl: input.baseUrl?.trim() || DEFAULT_ANTHROPIC_BASE,
        apiKey: input.apiKey,
        model: input.model,
        authMode: input.authMode ?? 'x-api-key',
      });
    case 'google-generative-ai':
      return probeGoogleGenerativeAi({
        baseUrl: input.baseUrl?.trim() || DEFAULT_GOOGLE_GENERATIVE_AI_BASE,
        apiKey: input.apiKey,
        model: input.model,
      });
    case 'openai-chat':
      return probeOpenAI({ baseUrl: input.baseUrl?.trim() || DEFAULT_OPENAI_BASE, apiKey: input.apiKey, model: input.model, wireApi: 'chat' });
    case 'openai-responses':
      return probeOpenAI({ baseUrl: input.baseUrl?.trim() || DEFAULT_OPENAI_BASE, apiKey: input.apiKey, model: input.model, wireApi: 'responses' });
  }
}
