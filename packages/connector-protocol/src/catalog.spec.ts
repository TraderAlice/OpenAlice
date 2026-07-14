import { describe, expect, it } from 'vitest'
import { BUILTIN_CONNECTOR_DEFINITIONS } from './catalog.js'
import { connectorDefinitionSchema } from './types.js'

describe('built-in connector setup metadata', () => {
  it('marks owner identity as output learned from /link', () => {
    for (const definition of BUILTIN_CONNECTOR_DEFINITIONS) {
      expect(() => connectorDefinitionSchema.parse(definition)).not.toThrow()
      expect(definition.commands.some((command) => command.name === 'link')).toBe(true)
      expect(definition.fields.some((field) => field.learnedBy === 'link')).toBe(true)
      expect(definition.fields.filter((field) => field.learnedBy === 'link').every((field) => !field.required)).toBe(true)
    }
  })
})
