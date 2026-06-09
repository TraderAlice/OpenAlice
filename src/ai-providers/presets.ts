/**
 * AI Provider Presets — serialization layer.
 *
 * Reads preset definitions from preset-catalog.ts and converts
 * their Zod schemas to JSON Schema for the frontend.
 *
 * Post-processing:
 *   - Model fields: enum → oneOf + const + title (labeled dropdowns)
 *   - API key fields: marked writeOnly (password inputs)
 */

import { z } from 'zod'
import { PRESET_CATALOG, type PresetDef, type WireShape } from './preset-catalog.js'

// ==================== Serialized Preset (sent to frontend) ====================

/** A region + the per-wire-shape endpoints it offers — drives the form. */
export interface SerializedRegion {
  id: string
  label: string
  wires: Partial<Record<WireShape, string>>
}

export interface SerializedPreset {
  id: string
  label: string
  description: string
  category: 'official' | 'third-party' | 'custom'
  hint?: string
  defaultName: string
  schema: Record<string, unknown>
  /** Regions × their per-shape endpoints — the form's region picker + the wire
   *  capabilities a credential created here will declare. */
  regions?: SerializedRegion[]
}

// ==================== Schema post-processing ====================

function buildJsonSchema(def: PresetDef): Record<string, unknown> {
  const raw = z.toJSONSchema(def.zodSchema) as Record<string, unknown>
  const props = (raw.properties ?? {}) as Record<string, Record<string, unknown>>

  // Replace the model field with a labeled oneOf when the catalog provides one.
  // (baseUrl is no longer a schema-driven field — endpoints come from `regions`.)
  if (def.models?.length && props['model']) {
    const oneOf = def.models.map(o => ({ const: o.id, title: o.label }))
    const { enum: _e, ...rest } = props['model']
    props['model'] = { ...rest, oneOf }
  }

  // Mark writeOnly fields
  for (const field of def.writeOnlyFields ?? []) {
    if (props[field]) props[field].writeOnly = true
  }

  raw.properties = props
  return raw
}

// ==================== Exported ====================

export const BUILTIN_PRESETS: SerializedPreset[] = PRESET_CATALOG.map(def => ({
  id: def.id,
  label: def.label,
  description: def.description,
  category: def.category,
  hint: def.hint,
  defaultName: def.defaultName,
  schema: buildJsonSchema(def),
  ...(def.regions ? { regions: def.regions } : {}),
}))
