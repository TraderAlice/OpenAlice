import { expect, it } from 'vitest'
import { parseNativeModels, parseNativeModelText, queryNativeModels } from './native-model-discovery.js'

it('preserves native aliases and per-model effort menus without leaking raw metadata', () => {
  expect(parseNativeModels('claude', [{ value: 'opus[1m]', displayName: 'Opus', supportsAdaptiveThinking: true, supportedEffortLevels: ['low', 'max'], apiKey: 'secret' }])).toEqual([
    { id: 'opus[1m]', label: 'Opus', semantics: { reasoning: { mode: 'adaptive', supported: true, efforts: ['low', 'max'] } } },
  ])
  expect(parseNativeModels('codex', [{ model: 'private', supportedReasoningEfforts: [{ reasoningEffort: 'ultra' }], defaultReasoningEffort: 'high' }])[0]).toMatchObject({ semantics: { reasoning: { efforts: ['ultra'] } } })
  expect(parseNativeModels('claude', [{ value: 'haiku', supportsEffort: false }])[0]?.semantics?.reasoning).toEqual({ efforts: [] })
})
it('retains OMP qualified selectors and reasoning metadata, including explicit unsupported', () => {
  expect(parseNativeModels('omp', [{ provider: 'custom', id: 'model', selector: 'alias/model', reasoning: false, thinking: ['high'], contextWindow: 1024, headers: { secret: 'secret' } }])).toEqual([
    { id: 'alias/model', label: 'alias/model', semantics: { contextWindow: 1024, reasoning: { supported: false, mode: 'none', efforts: [] } } },
  ])
  expect(parseNativeModels('omp', [])).toEqual([])
  expect(() => parseNativeModels('omp', [{ id: 'no-provider' }])).toThrow()
})
it('uses Pi thinking mappings without treating null tiers as supported', () => {
  const model = parseNativeModels('pi', [{ provider: 'test', id: 'r', reasoning: true, thinkingLevelMap: { off: null, minimal: null, xhigh: 'high', max: null } }])[0]!
  expect(model.semantics?.reasoning?.efforts).toEqual(['low', 'medium', 'high', 'xhigh'])
})
it('keeps opencode variants and strips request headers and endpoints', () => {
  const text = 'custom/m\n' + JSON.stringify({ id: 'm', providerID: 'custom', headers: { Authorization: 'secret' }, capabilities: { reasoning: true }, variants: { low: {}, high: {}, vendorSpecific: {} }, limit: { context: 2000, output: 100 } }, null, 2) + '\n'
  expect(parseNativeModelText('opencode', text)).toEqual([{ id: 'custom/m', label: 'custom/m', semantics: { contextWindow: 2000, maxOutputTokens: 100, reasoning: { supported: true, efforts: ['low', 'high'] } } }])
  expect(() => parseNativeModelText('opencode', 'broken output')).toThrow()
})
it('parses text directories without turning banners or login failures into models', () => {
  expect(parseNativeModelText('cursor', 'Available models\n\nauto - Auto (current, default)\n')).toEqual([{ id: 'auto', label: 'Auto' }])
  expect(parseNativeModelText('grok', 'Default model: grok-4.6\n  * grok-4.6 (default)\n  - grok-4.5')).toHaveLength(2)
  expect(parseNativeModelText('agy', 'Fetching available models...\ngemini-high\tGemini High')).toEqual([{ id: 'gemini-high', label: 'Gemini High' }])
  expect(() => parseNativeModelText('cursor', 'Please login')).toThrow()
})
it('queries a protocol without sending a prompt and cleans up a persistent child', async () => {
  const script = `process.stdin.on('data', raw => { const frame=JSON.parse(raw); if(frame.type !== 'get_available_models' || process.env.PWD !== process.cwd())process.exit(2);process.stdout.write(JSON.stringify({models:[]})+'\\n'); }); setInterval(()=>{}, 1000)`
  expect(await queryNativeModels({ argv: [process.execPath, '-e', script], cwd: process.cwd(), initial: { type: 'get_available_models' }, onFrame: (frame) => parseNativeModels('pi', frame.models) })).toEqual([])
})
it('redacts child failures and rejects malformed output', async () => {
  await expect(queryNativeModels({ argv: [process.execPath, '-e', "console.error('secret');process.exit(1)"], cwd: process.cwd(), parse: () => [] })).rejects.toThrow('Could not load native models')
  await expect(queryNativeModels({ argv: [process.execPath, '-e', "console.log('invalid')"], cwd: process.cwd(), parse: (s) => parseNativeModelText('cursor', s) })).rejects.not.toThrow('invalid')
})
