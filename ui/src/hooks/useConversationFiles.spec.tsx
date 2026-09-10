// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { conversationReferences, useConversationFiles } from './useConversationFiles'
import type { ConversationItem } from '../components/conversation/types'
const turn = (text: string, key = 'turn'): ConversationItem[] => [{ kind: 'assistant-turn', key, progress: [], final: text, activity: null }]
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
function available() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => ({ path: new URL(url, 'http://localhost').searchParams.get('path') }) })))
}
it('only consumes visible assistant prose with complete, non-code references', () => {
  expect(conversationReferences(turn('[[a.pdf]] `[[code.pdf]]` \\[[escaped.pdf]] [[unfinished'))).toEqual([{ path: 'a.pdf', key: '["turn","a.pdf"]' }])
})
it('renders history without opening; opens live files once and leaves stickers inline', async () => {
  available()
  const open = vi.fn()
  const { result, rerender } = renderHook(({ items }) => useConversationFiles('ws', items, true, open), { initialProps: { items: turn('[[old.pdf]]') } })
  await waitFor(() => expect(result.current.fileHrefs['old.pdf']).toBeTruthy())
  expect(open).not.toHaveBeenCalled()
  rerender({ items: turn('[[old.pdf]] [[new.pdf]] [[sticker/wave.png]]') })
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
  expect(open).toHaveBeenCalledWith('new.pdf')
  rerender({ items: turn('[[old.pdf]] [[new.pdf]] [[sticker/wave.png]] More text [[new.pdf]]') })
  await waitFor(() => expect(result.current.fileHrefs['sticker/wave.png']).toBeTruthy())
  expect(open).toHaveBeenCalledTimes(1)
})
it('ignores late results when the consumer unmounts', async () => {
  let finish!: (value: unknown) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve })))
  const open = vi.fn()
  const { rerender, unmount } = renderHook(({ items }) => useConversationFiles('ws', items, true, open), { initialProps: { items: turn('') } })
  rerender({ items: turn('[[late.pdf]]') })
  unmount()
  await act(async () => finish({ ok: true, json: async () => ({ path: 'late.pdf' }) }))
  expect(open).not.toHaveBeenCalled()
})
it('retries a file that is written after the reference arrives', async () => {
  vi.useFakeTimers()
  const open = vi.fn()
  let exists = false
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: exists, json: async () => ({ path: 'late.pdf' }) })))
  const { rerender } = renderHook(({ items }) => useConversationFiles('ws', items, true, open), { initialProps: { items: turn('') } })
  await act(async () => {})
  rerender({ items: turn('[[late.pdf]]') })
  await act(async () => {})
  expect(open).not.toHaveBeenCalled()
  exists = true
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(open).toHaveBeenCalledWith('late.pdf')
})
