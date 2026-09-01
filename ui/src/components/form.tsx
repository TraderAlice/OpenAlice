import type { ReactNode } from 'react'

// ==================== Shared class constants ====================

export const inputClass =
  'w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 font-sans text-[13px] text-foreground outline-none transition-[border-color,background-color,box-shadow] duration-150 focus:border-primary/60 focus:shadow-[0_0_0_2px_var(--primary-muted)]'

// ==================== Settings scroll area ====================

interface SettingsScrollAreaProps {
  children: ReactNode
  className?: string
  scroll?: boolean
}

/**
 * The one vertical scroll owner for a Settings category. Settings pages live
 * inside two nested flex shells (TabHost + PageSidebarLayout), so every level
 * must carry `min-h-0` before overflow can work. Keeping the contract here
 * prevents a long form from being clipped by the app-level `overflow-hidden`.
 */
export function SettingsScrollArea({ children, className = '', scroll = true }: SettingsScrollAreaProps) {
  return (
    <div
      data-settings-scroll-area
      className={`min-h-0 flex-1 ${scroll ? 'overflow-y-auto overscroll-contain [scrollbar-gutter:stable]' : ''} ${className}`}
    >
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
    <section id={id} className="border-b border-border/60 py-5 last:border-b-0">
      <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  )
}

// ==================== ConfigSection ====================

interface ConfigSectionProps {
  title: ReactNode
  description?: string
  children: ReactNode
  titleId?: string
  focusableTitle?: boolean
}

export function ConfigSection({
  title,
  description,
  children,
  titleId,
  focusableTitle = false,
}: ConfigSectionProps) {
  return (
    <section className="min-w-0 border-b border-border/60 py-5 last:border-b-0">
      <div className="mb-3 min-w-0">
        <h3
          id={titleId}
          tabIndex={focusableTitle ? -1 : undefined}
          className={`text-[14px] font-semibold text-foreground ${focusableTitle
            ? 'w-fit rounded-sm outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-4 focus:ring-offset-background'
            : ''
          }`}
        >
          {title}
        </h3>
        {description && (
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

// ==================== Field ====================

interface FieldProps {
  label: ReactNode
  description?: string
  controlId?: string
  descriptionId?: string
  children: ReactNode
}

export function Field({
  label,
  description,
  controlId,
  descriptionId,
  children,
}: FieldProps) {
  return (
    <div className="mb-3.5 last:mb-0">
      <label
        htmlFor={controlId}
        className="block text-[13px] text-foreground mb-1.5 font-medium"
      >
        {label}
      </label>
      {children}
      {description && (
        <p id={descriptionId} className="text-[12px] text-muted-foreground/60 mt-1">
          {description}
        </p>
      )}
    </div>
  )
}
