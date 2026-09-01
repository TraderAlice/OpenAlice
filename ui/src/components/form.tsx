import type { ReactNode } from 'react'

// ==================== Shared class constants ====================

export const inputClass =
  'oa-field-control h-8 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1.5 font-sans text-[13px] leading-[18px] text-foreground outline-none transition-[border-color,background-color,box-shadow] duration-[var(--motion-fast)] [transition-timing-function:var(--motion-ease-out)] placeholder:text-muted-foreground focus:border-ring focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--ring)_35%,transparent)] motion-reduce:transition-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50'

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
  id?: string
  title: ReactNode
  description?: string
  children: ReactNode
  titleId?: string
  focusableTitle?: boolean
  className?: string
}

export function ConfigSection({
  id,
  title,
  description,
  children,
  titleId,
  focusableTitle = false,
  className = '',
}: ConfigSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={`min-w-0 border-b border-border/60 py-5 last:border-b-0 ${className}`}
    >
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
        <p id={descriptionId} className="mt-1 text-[12px] leading-5 text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  )
}
