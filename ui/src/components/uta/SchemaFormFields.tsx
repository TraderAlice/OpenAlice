import { Select } from '@/components/ui/select'
import { Field, inputClass } from '../form'
import { Toggle } from '../Toggle'
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
          case 'boolean':
            return (
              <label key={f.key} className="flex items-start gap-2 cursor-pointer select-none">
                <Toggle
                  ariaLabel={f.title}
                  size="sm"
                  checked={value === 'true'}
                  onChange={(v) => setField(f.key, v ? 'true' : 'false')}
                />
                <span>
                  <span className="text-sm text-foreground">{f.title}</span>
                  {f.description && <p className="text-sm text-muted-foreground/60 mt-0.5">{f.description}</p>}
                </span>
              </label>
            )
          case 'select':
            return (
              <Field key={f.key} label={f.title}>
                <Select aria-label={f.title} value={value} onValueChange={(selectedValue) => setField(f.key, selectedValue)}
                  options={f.options?.map(o => ({ value: o.value, label: o.label })) ?? []}
                />
                {f.description && <p className="text-sm text-muted-foreground/60 mt-1">{f.description}</p>}
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
                {f.description && <p className="text-sm text-muted-foreground/60 mt-1">{f.description}</p>}
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
                {f.description && <p className="text-sm text-muted-foreground/60 mt-1">{f.description}</p>}
              </Field>
            )
        }
      })}
    </div>
  )
}
