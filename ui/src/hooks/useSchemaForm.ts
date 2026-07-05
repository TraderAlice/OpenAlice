/**
 * useSchemaForm — parses a JSON Schema into form field descriptors and manages form state.
 *
 * Separates const fields (hidden, auto-merged on submit) from editable fields.
 * Components just iterate `fields` and render by `type`.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { JsonSchema, JsonSchemaProperty } from '../api/types'

// ==================== Types ====================

export interface SchemaField {
  key: string
  type: 'text' | 'password' | 'select' | 'boolean'
  title: string
  description?: string
  required: boolean
  options?: Array<{ value: string; label: string }>
  defaultValue?: string
}

interface UseSchemaFormResult {
  /** Editable fields (const fields excluded). */
  fields: SchemaField[]
  /** Current form values for editable fields. */
  formData: Record<string, string>
  /** Update a single field value. */
  setField: (key: string, value: string) => void
  /** Get submit-ready data: editable values + const values merged. */
  getSubmitData: () => Record<string, unknown>
  /** Validate required fields. Returns error message or null. */
  validate: () => string | null
}

// ==================== Hook ====================

export function useSchemaForm(
  schema: JsonSchema | undefined,
  initialValues?: Record<string, string>,
): UseSchemaFormResult {
  // Parse schema into const values and editable field descriptors
  const { constValues, fieldDefs, defaults, booleanKeys } = useMemo(() => {
    const consts: Record<string, unknown> = {}
    const fields: SchemaField[] = []
    const defs: Record<string, string> = {}

    const props = (schema?.properties ?? {}) as Record<string, JsonSchemaProperty>
    const required = new Set((schema?.required as string[]) ?? [])

    for (const [key, prop] of Object.entries(props)) {
      // const → hidden, value auto-merged
      if (prop.const !== undefined) {
        consts[key] = prop.const
        continue
      }

      const title = prop.title ?? key.charAt(0).toUpperCase() + key.slice(1)
      const isRequired = required.has(key)

      // Determine field type
      if (prop.writeOnly) {
        fields.push({ key, type: 'password', title, description: prop.description, required: isRequired })
      } else if (prop.oneOf) {
        const options = prop.oneOf.map(o => ({ value: o.const, label: o.title }))
        fields.push({ key, type: 'select', title, description: prop.description, required: isRequired, options })
      } else if (prop.enum) {
        const options = prop.enum.map(v => ({ value: v, label: v }))
        fields.push({ key, type: 'select', title, description: prop.description, required: isRequired, options })
      } else if (prop.type === 'boolean') {
        // Stored in string form-state as 'true'/'false'; getSubmitData
        // converts back to a real boolean. Rendered as a checkbox.
        fields.push({ key, type: 'boolean', title, description: prop.description, required: isRequired, defaultValue: String(prop.default ?? false) })
      } else {
        fields.push({ key, type: 'text', title, description: prop.description, required: isRequired, defaultValue: prop.default !== undefined ? String(prop.default) : undefined })
      }

      // Collect defaults. Booleans always seed (a checkbox/toggle is never
      // "unset"), so even a required boolean with no .default() lands in form
      // state and submits a real `false` rather than going missing.
      if (prop.type === 'boolean') {
        defs[key] = String(prop.default ?? false)
      } else if (prop.default !== undefined) {
        defs[key] = String(prop.default)
      }
    }

    const booleanKeys = new Set(fields.filter(f => f.type === 'boolean').map(f => f.key))
    return { constValues: consts, fieldDefs: fields, defaults: defs, booleanKeys }
  }, [schema])

  // Form state — reset when schema changes (e.g. user picks a different preset)
  const [formData, setFormData] = useState<Record<string, string>>(() => ({
    ...defaults,
    ...(initialValues ?? {}),
  }))

  // Re-initialize when defaults change (schema switch)
  const prevDefaults = useRef(defaults)
  useEffect(() => {
    if (prevDefaults.current !== defaults) {
      prevDefaults.current = defaults
      setFormData({ ...defaults, ...(initialValues ?? {}) })
    }
  }, [defaults, initialValues])

  const setField = useCallback((key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }))
  }, [])

  const getSubmitData = useCallback((): Record<string, unknown> => {
    const result: Record<string, unknown> = { ...constValues }
    for (const [key, value] of Object.entries(formData)) {
      if (key.endsWith('__custom')) continue
      // Boolean fields carry 'true'/'false' strings in form state — emit a
      // real boolean (always, incl. false) so the backend z.boolean() schema
      // accepts it. NB: z.coerce.boolean() can't be used backend-side because
      // Boolean('false') === true.
      if (booleanKeys.has(key)) { result[key] = value === 'true'; continue }
      if (value !== '' && value !== undefined) result[key] = value
    }
    return result
  }, [constValues, formData, booleanKeys])

  const validate = useCallback((): string | null => {
    for (const field of fieldDefs) {
      if (field.required && !formData[field.key]?.trim()) {
        return `${field.title} is required`
      }
    }
    return null
  }, [fieldDefs, formData])

  return { fields: fieldDefs, formData, setField, getSubmitData, validate }
}
