import type { ReactNode } from 'react'

// ==================== Shared class constants ====================

export const inputClass =
  'w-full px-2.5 py-2 bg-bg text-text border border-border rounded-md font-sans text-sm outline-none transition-colors focus:border-accent'

// ==================== Section ====================

interface SectionProps {
  id?: string
  title: string
  description?: string
  children: ReactNode
}

export function Section({ id, title, description, children }: SectionProps) {
  return (
    <div id={id}>
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-3">
        {title}
      </h3>
      {description && (
        <p className="text-[12px] text-text-muted mb-3 -mt-1">{description}</p>
      )}
      {children}
    </div>
  )
}

// ==================== Field ====================

interface FieldProps {
  label: string
  children: ReactNode
}

export function Field({ label, children }: FieldProps) {
  return (
    <div className="mb-3">
      <label className="block text-[13px] text-text-muted mb-1">{label}</label>
      {children}
    </div>
  )
}
