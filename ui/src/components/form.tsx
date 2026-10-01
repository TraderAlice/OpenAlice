import type { ReactNode } from 'react'
import { ContextHelp } from './ContextHelp'

// ==================== Shared class constants ====================

export const inputClass =
  'oa-field-control h-11 w-full min-w-0 rounded-lg border border-input bg-background px-4 py-2 font-sans text-base leading-6 text-foreground outline-none transition-[border-color,background-color,box-shadow] duration-[var(--motion-fast)] [transition-timing-function:var(--motion-ease-out)] placeholder:text-muted-foreground motion-reduce:transition-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50'

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
    <section id={id} className="oa-config-section rounded-2xl bg-secondary p-5 sm:p-6">
      <h3 className="text-lg leading-6 font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">{description}</p>
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
  help?: string
  accessory?: ReactNode
  children?: ReactNode
  titleId?: string
  focusableTitle?: boolean
  className?: string
}

export function ConfigSection({
  id,
  title,
  description,
  help,
  accessory,
  children,
  titleId,
  focusableTitle = false,
  className = '',
}: ConfigSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={`oa-config-section min-w-0 rounded-2xl bg-secondary p-5 sm:p-6 ${className}`}
    >
      <div className={`min-w-0 ${children ? 'mb-5' : ''}`}>
        <div className="flex min-h-6 min-w-0 items-center gap-2">
          <h3
            id={titleId}
            tabIndex={focusableTitle ? -1 : undefined}
            className={`text-lg font-semibold text-foreground ${focusableTitle
              ? 'w-fit rounded-sm outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]'
              : ''
            }`}
          >
            {title}
          </h3>
          {help && <ContextHelp label={typeof title === 'string' ? title : undefined}>{help}</ContextHelp>}
          {accessory && <div className="ml-auto flex shrink-0 items-center gap-2">{accessory}</div>}
        </div>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">{description}</p>
        )}
      </div>
      {children && <div className="min-w-0">{children}</div>}
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
        className="block text-sm text-foreground mb-1.5 font-medium"
      >
        {label}
      </label>
      {children}
      {description && (
        <p id={descriptionId} className="mt-1 text-sm leading-5 text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  )
}
