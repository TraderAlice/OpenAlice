import type { ReactNode } from 'react'

// ==================== Shared class constants ====================

export const inputClass =
  'w-full px-3 py-2 bg-bg text-text border border-border rounded-lg font-sans text-sm outline-none transition-all duration-200 focus:border-accent/60 focus:shadow-[0_0_0_1px_var(--color-accent-dim)]'

// ==================== Card ====================

interface CardProps {
  children: ReactNode
  className?: string
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`bg-bg-secondary/50 border border-border/60 rounded-xl p-5 transition-colors hover:border-accent/20 ${className}`}>
      {children}
    </div>
  )
}

// ==================== Section ====================

interface SectionProps {
  id?: string
  title: ReactNode
  description?: string
  children: ReactNode
}

export function Section({ id, title, description, children }: SectionProps) {
  return (
    <Card>
      <div id={id}>
        <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-1">
          {title}
        </h3>
        {description && (
          <p className="text-[13px] text-text-muted/70 mb-4 leading-relaxed">{description}</p>
        )}
        {children}
      </div>
    </Card>
  )
}

// ==================== ConfigSection ====================

/** Two-column settings layout: title + description on the left, controls on the right. */
interface ConfigSectionProps {
  title: string
  description?: string
  children: ReactNode
}

export function ConfigSection({ title, description, children }: ConfigSectionProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-1 md:gap-10 py-6 border-b border-border/60 last:border-b-0">
      <div className="mb-3 md:mb-0 md:pt-0.5">
        <h3 className="text-[14px] font-semibold text-text">{title}</h3>
        {description && (
          <p className="text-[13px] text-text-muted/70 mt-1.5 leading-relaxed">{description}</p>
        )}
      </div>
      <div>{children}</div>
    </div>
  )
}

// ==================== Field ====================

interface FieldProps {
  label: string
  description?: string
  children: ReactNode
}

export function Field({ label, description, children }: FieldProps) {
  return (
    <div className="mb-3.5 last:mb-0">
      <label className="block text-[13px] text-text mb-1.5 font-medium">{label}</label>
      {children}
      {description && (
        <p className="text-[12px] text-text-muted/60 mt-1">{description}</p>
      )}
    </div>
  )
}
