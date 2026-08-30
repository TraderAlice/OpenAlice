import { describe, expect, it } from 'vitest'
import { BUILTIN_CONNECTOR_DEFINITIONS } from './catalog.js'
import { connectorDefinitionSchema } from './types.js'

describe('built-in connector setup metadata', () => {
  it('marks owner identity as output learned from /link', () => {
    for (const definition of BUILTIN_CONNECTOR_DEFINITIONS) {
      expect(() => connectorDefinitionSchema.parse(definition)).not.toThrow()
      expect(definition.commands.some((command) => command.name === 'link')).toBe(true)
      expect(definition.commands.some((command) => command.name === 'inbox')).toBe(true)
      expect(definition.commands.some((command) => command.name === 'settings')).toBe(true)
      expect(definition.commands.some((command) => command.name === 'uta')).toBe(true)
      expect(definition.capabilities).toEqual(
        definition.id === 'telegram' || definition.id === 'feishu'
          ? ['inbox', 'settings', 'uta', 'desk']
          : ['inbox', 'settings', 'uta'],
      )
      expect(definition.fields.some((field) => field.learnedBy === 'link')).toBe(true)
      expect(definition.fields.filter((field) => field.learnedBy === 'link').every((field) => !field.required)).toBe(true)
      expect(definition.fields.some((field) => field.key === 'inboxPush' && field.group === 'preferences')).toBe(true)
      expect(definition.setupLinks?.length).toBeGreaterThan(0)
      expect(definition.setupLinks?.every((link) => link.url.startsWith('https://'))).toBe(true)
    }
  })

  it('constrains Feishu and Lark to catalog-owned platform choices', () => {
    const definition = BUILTIN_CONNECTOR_DEFINITIONS.find((item) => item.id === 'feishu')
    const domain = definition?.fields.find((field) => field.key === 'domain')

    expect(domain?.options?.map((option) => option.value)).toEqual(['feishu', 'lark'])
    expect(domain?.defaultValue).toBe('feishu')
  })
})
