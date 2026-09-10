// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ConversationTranscriptItem } from './ConversationTranscript'
afterEach(cleanup)
it('keeps sent prose literal without turning syntax into links or blocks', () => {
  const text = '第一行\n[[reports/demo.md]] **bold** [link](https://example.com) <b>literal</b>'
  const { container } = render(<ConversationTranscriptItem working={false} item={{ kind: 'user', key: 'user', content: [{ kind: 'markdown', text }] }} />)
  const body = container.querySelector('.conversation-message-body')!
  expect(body.textContent).toBe(text)
  expect(body.querySelector('a, strong, b, .markdown-file-card')).toBeNull()
})
it('continues to render assistant Markdown', () => {
  const { container } = render(<ConversationTranscriptItem working={false} item={{ kind: 'assistant-turn', key: 'assistant', progress: [], final: '**bold**', activity: null }} />)
  expect(container.querySelector('strong')?.textContent).toBe('bold')
})
