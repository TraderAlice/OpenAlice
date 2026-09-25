import type { PresetModel } from '../api'
import { runtimeEffortOptions } from '../components/issue-runtime-options'
import { catalogModelOptions, useModelCatalog } from './useModelCatalog'

/** One credential-scoped snapshot owns model selection and all its capabilities. */
export function useProviderModels(input: {
  request: Parameters<typeof useModelCatalog>[0]
  model: string | null
  fallback: readonly PresetModel[]
  agent?: string | null
  persistedSettings?: boolean
}) {
  const catalog = useModelCatalog(input.request)
  const models = catalogModelOptions(catalog.models, input.fallback)
  const selectedModel = models.find((model) => model.id === input.model) ?? null
  const semantics = selectedModel?.semantics ?? null
  let efforts = runtimeEffortOptions({
    agent: input.agent ?? null, semantics,
    modelKnown: semantics?.reasoning !== undefined, model: input.model,
  })
  if (input.persistedSettings) {
    efforts = semantics?.reasoning?.efforts ?? []
    if (input.agent === 'claude') efforts = efforts.filter((effort) => ['low', 'medium', 'high', 'xhigh'].includes(effort))
  }
  if (semantics?.reasoning?.mode === 'none' || semantics?.reasoning?.supported === false) efforts = []
  return { ...catalog, models, selectedModel, semantics, reasoning: semantics?.reasoning, effortOptions: efforts }
}
