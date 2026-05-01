import { Field, inputClass } from '../form'
import type { SchemaField } from '../../hooks/useSchemaForm'

/**
 * Render a list of useSchemaForm fields as form widgets.
 * Used by both the create wizard and the edit dialog.
 */
export function SchemaFormFields({ fields, formData, setField, showSecrets }: {
  fields: SchemaField[]
  formData: Record<string, string>
  setField: (key: string, value: string) => void
  showSecrets: boolean
}) {
  return (
    <div className="space-y-3">
      {fields.map(f => {
        const value = formData[f.key] ?? f.defaultValue ?? ''
        switch (f.type) {
          case 'select':
            return (
              <Field key={f.key} label={f.title}>
                <select className={inputClass} value={value} onChange={(e) => setField(f.key, e.target.value)}>
                  {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {f.description && <p className="text-[11px] text-text-muted/60 mt-1">{f.description}</p>}
              </Field>
            )
          case 'password':
            return (
              <Field key={f.key} label={f.title}>
                <input
                  className={inputClass}
                  type={showSecrets ? 'text' : 'password'}
                  value={value}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={f.required ? 'Required' : ''}
                />
                {f.description && <p className="text-[11px] text-text-muted/60 mt-1">{f.description}</p>}
              </Field>
            )
          case 'text':
          default:
            return (
              <Field key={f.key} label={f.title}>
                <input
                  className={inputClass}
                  type="text"
                  value={value}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={f.required ? 'Required' : ''}
                />
                {f.description && <p className="text-[11px] text-text-muted/60 mt-1">{f.description}</p>}
              </Field>
            )
        }
      })}
    </div>
  )
}
