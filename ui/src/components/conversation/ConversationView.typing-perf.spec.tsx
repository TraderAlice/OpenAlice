// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const itemRender = vi.fn()

vi.mock('./ConversationTranscript', () => ({
  ConversationTranscriptItem: (props: {
    readonly item: { readonly key: string }
  }) => {
    itemRender(props.item.key)
    return <div data-testid={`item-${props.item.key}`}>{props.item.key}</div>
  },
}))

import { ConversationView } from './ConversationView'

beforeEach(() => {
  itemRender.mockClear()
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
})
afterEach(cleanup)

describe('conversation draft isolation', () => {
  it('does not re-render transcript rows while the draft changes', () => {
    render(<ConversationView
      items={[
        { kind: 'user', key: 'u1', content: [{ kind: 'markdown', text: 'hello' }] },
        { kind: 'assistant-turn', key: 'a1', progress: [], final: 'world', activity: null },
      ]}
      revision={1}
      busy={false}
      ready
      send={async () => undefined}
      placeholder="Ask…"
      empty="Ready"
    />)
    expect(itemRender).toHaveBeenCalledTimes(2)
    itemRender.mockClear()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'next turn' } })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'next turn please' } })

    expect(itemRender).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('next turn please')
  })
})
