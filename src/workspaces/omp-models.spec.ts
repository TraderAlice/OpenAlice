import { expect, it } from 'vitest'
import { parseOmpModels } from './omp-models.js'

it('keeps native provider-qualified selectors and projects only display fields', () => {
  expect(parseOmpModels(JSON.stringify({ models: [
    { provider: 'custom', id: 'model', selector: 'custom/model', name: 'My model', apiKey: 'never-return' },
    { provider: 'other', id: 'model' },
  ] }))).toEqual([
    { id: 'custom/model', label: 'My model (custom)' },
    { id: 'other/model', label: 'other/model' },
  ])
  expect(parseOmpModels('{"models":[]}')).toEqual([])
  expect(() => parseOmpModels('{"models":[{"id":"incomplete"}]}')).toThrow()
})
