import type { ReactNode } from 'react'

// ==================== Shared class constants ====================

export const inputClass =
  'w-full min-w-0 px-3 py-2 bg-background text-foreground border border-border rounded-lg font-sans text-sm outline-none transition-all duration-200 focus:border-primary/60 focus:shadow-[0_0_0_1px_var(--primary-muted)]'

// ==================== Settings scroll area ====================

interface SettingsScrollAreaProps {
  children: ReactNode
  className?: string
}

/**
 * The one vertical scroll owner for a Settings category. Settings pages live
 * inside two nested flex shells (TabHost + PageSidebarLayout), so every level
 * must carry `min-h-0` before overflow can work. Keeping the contract here
 * prevents a long form from being clipped by the app-level `overflow-hidden`.
 */
export function SettingsScrollArea({ children, className = '' }: SettingsScrollAreaProps) {
  return (
    <div
      data-settings-scroll-area
      className={`min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] ${className}`}
    >
      {children}
    </div>
  )
}

// ==================== Card ====================

interface CardProps {
  children: ReactNode
  className?: string
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`bg-secondary/50 border border-border/60 rounded-xl p-5 transition-colors hover:border-primary/20 ${className}`}>
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
        <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          {title}
        </h3>
        {description && (
          <p className="text-[13px] text-muted-foreground/70 mb-4 leading-relaxed">{description}</p>
        )}
        {children}
      </div>
    </Card>
  )
}

// ==================== ConfigSection ====================

/** Two-column settings layout once the whole app shell has genuine room. */
interface ConfigSectionProps {
  title: string
  description?: string
  children: ReactNode
}

export function ConfigSection({ title, description, children }: ConfigSectionProps) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 border-b border-border/60 py-6 last:border-b-0 xl:grid-cols-[240px_minmax(0,1fr)] xl:gap-10">
      <div className="min-w-0 xl:pt-0.5">
        <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-[13px] text-muted-foreground/70 mt-1.5 leading-relaxed">{description}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
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
      <label className="block text-[13px] text-foreground mb-1.5 font-medium">{label}</label>
      {children}
      {description && (
        <p className="text-[12px] text-muted-foreground/60 mt-1">{description}</p>
      )}
    </div>
  )
}
