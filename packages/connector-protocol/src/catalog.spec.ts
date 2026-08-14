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
      expect(definition.capabilities).toEqual(['inbox', 'settings'])
      expect(definition.fields.some((field) => field.learnedBy === 'link')).toBe(true)
      expect(definition.fields.filter((field) => field.learnedBy === 'link').every((field) => !field.required)).toBe(true)
      expect(definition.fields.some((field) => field.key === 'inboxPush' && field.group === 'preferences')).toBe(true)
    }
  })
})
