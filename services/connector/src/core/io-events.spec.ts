import { describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from './adapter.js'
import { createConnectorIOEvent, pseudonymizeExternalId, type ConnectorIOEvent, type ConnectorIORecorder } from './io-events.js'

class MemoryRecorder implements ConnectorIORecorder {
  readonly events: ConnectorIOEvent[] = []
  async record(input: Parameters<ConnectorIORecorder['record']>[0]): Promise<void> {
    this.events.push(createConnectorIOEvent(input))
  }
}

describe('Connector command I/O recording', () => {
  it('records normalized input and reply while pseudonymizing platform identities', async () => {
    const recorder = new MemoryRecorder()
    const commands = new CommandRegistry('telegram', recorder)
    commands.register('status', async ({ reply }) => reply('healthy'))
    const reply = vi.fn(async () => undefined)

    await commands.execute({ connectorId: 'telegram', command: '/STATUS', userId: '42', chatId: '99', reply })

    expect(recorder.events.map((event) => event.stage)).toEqual(['command.received', 'command.replied'])
    expect(recorder.events[0]?.payload).toEqual({
      command: 'status',
      user: pseudonymizeExternalId('42'),
      chat: pseudonymizeExternalId('99'),
    })
    expect(JSON.stringify(recorder.events)).not.toContain('"42"')
    expect(JSON.stringify(recorder.events)).not.toContain('"99"')
    expect(reply).toHaveBeenCalledWith('healthy')
  })

  it('does not let a broken recorder break command handling', async () => {
    const commands = new CommandRegistry('discord', { record: async () => { throw new Error('disk full') } })
    const handler = vi.fn(async () => undefined)
    commands.register('status', handler)
    await expect(commands.execute({ connectorId: 'discord', command: 'status', userId: '1', reply: async () => undefined }))
      .resolves.toBe(true)
    expect(handler).toHaveBeenCalledOnce()
  })
})
