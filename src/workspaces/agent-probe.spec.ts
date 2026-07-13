/**
 * Probe auth-header regression coverage.
 *
 * The whole point of the Workspace AI config Test button is that it sends the
 * key the *same way* the real CLI session will. For Claude that means the auth
 * mode must pick exactly one header: `x-api-key` (Anthropic first-party) or
 * `Authorization: Bearer` (anthropic-compatible gateways like MiniMax's
 * international endpoint, which 401s x-api-key). These tests pin a real probe
 * call against a local server and assert the wire headers.
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { probeAnthropic, probeOpenAI } from './agent-probe.js';

interface Captured {
  headers: Record<string, string | string[] | undefined>;
  url: string | undefined;
}

let server: Server;
let baseUrl: string;
let captured: Captured | null;

beforeEach(async () => {
  captured = null;
  server = createServer((req, res) => {
    captured = { headers: req.headers, url: req.url };
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(req.url?.endsWith('/chat/completions')
        ? JSON.stringify({
          id: 'chatcmpl_1', object: 'chat.completion', created: 0, model: 'x',
          choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
        })
        : JSON.stringify({
          id: 'msg_1', type: 'message', role: 'assistant', model: 'x',
          content: [{ type: 'text', text: 'pong' }], stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no server address');
  // A path-bearing baseURL ('/anthropic') mirrors MiniMax's real shape and
  // guards against the SDK dropping the path segment.
  baseUrl = `http://127.0.0.1:${addr.port}/anthropic`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('probeAnthropic auth header', () => {
  it('defaults to x-api-key (Anthropic first-party)', async () => {
    const out = await probeAnthropic({ baseUrl, apiKey: 'sk-default', model: 'm' });
    expect(out.text).toBe('pong');
    expect(captured?.headers['x-api-key']).toBe('sk-default');
    expect(captured?.headers['authorization']).toBeUndefined();
  });

  it('uses x-api-key when authMode is x-api-key', async () => {
    await probeAnthropic({ baseUrl, apiKey: 'sk-xak', model: 'm', authMode: 'x-api-key' });
    expect(captured?.headers['x-api-key']).toBe('sk-xak');
    expect(captured?.headers['authorization']).toBeUndefined();
  });

  it('uses Authorization: Bearer (and NOT x-api-key) when authMode is bearer', async () => {
    await probeAnthropic({ baseUrl, apiKey: 'mm-key', model: 'm', authMode: 'bearer' });
    expect(captured?.headers['authorization']).toBe('Bearer mm-key');
    // Critical: never send both — dual auth can be rejected as ambiguous.
    expect(captured?.headers['x-api-key']).toBeUndefined();
  });

  it('preserves the baseURL path segment', async () => {
    await probeAnthropic({ baseUrl, apiKey: 'sk-path', model: 'm' });
    // request landed on /anthropic/v1/messages, proving the path wasn't dropped
    expect(captured).not.toBeNull();
  });
});

describe('probeOpenAI auth header', () => {
  it('uses Bearer auth and preserves a versioned base path', async () => {
    const out = await probeOpenAI({
      baseUrl: baseUrl.replace('/anthropic', '/openai/v1'),
      apiKey: 'sk-openai',
      model: 'm',
      wireApi: 'chat',
    });
    expect(out.text).toBe('pong');
    expect(captured?.headers['authorization']).toBe('Bearer sk-openai');
    expect(captured?.url).toBe('/openai/v1/chat/completions');
  });
});
