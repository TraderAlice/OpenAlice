import { describe, expect, it } from 'vitest'

import { supervisorClipboardPayload } from './supervisor-terminal-clipboard.ts'

describe('Supervisor terminal clipboard', () => {
  it('encodes an explicit OSC 52 clipboard request', () => {
    const payload = supervisorClipboardPayload('Runtime ready')

    expect(payload).toEqual({
      sequence: `\u001b]52;c;${Buffer.from('Runtime ready').toString('base64')}\u0007`,
      text: 'Runtime ready',
      truncated: false,
    })
  })

  it('caps UTF-8 content without splitting a code point', () => {
    const payload = supervisorClipboardPayload('Alice 爱你', 8)

    expect(payload.text).toBe('Alice ')
    expect(Buffer.byteLength(payload.text)).toBe(6)
    expect(payload.truncated).toBe(true)
    expect(payload.sequence).toContain(Buffer.from('Alice ').toString('base64'))
  })
})
