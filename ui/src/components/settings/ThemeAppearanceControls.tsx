import type { AppearanceMode, ThemeFamily, ThemeVariantMode } from '../../api/themes'
import {
  familySupportsAppearanceMode,
  type ThemeManagerAppearanceAction,
  type ThemeManagerAppearanceState,
} from './themeManagerState'

interface ThemeAppearanceControlsProps {
  readonly state: ThemeManagerAppearanceState
  readonly families: readonly ThemeFamily[]
  readonly dispatch: (action: ThemeManagerAppearanceAction) => void
  readonly disabled?: boolean
  readonly labels: ThemeAppearanceControlLabels
}

export interface ThemeAppearanceControlLabels {
  readonly family: string
  readonly mode: string
  readonly modes: Readonly<Record<AppearanceMode, string>>
  readonly systemRequiresBothVariants: string
  readonly terminal: { readonly title: string; readonly behavior: string; readonly follow: string; readonly override: string; readonly family: string; readonly variant: string }
  readonly marketColors: string
  readonly marketDirection: string
  readonly statusColors: string
  readonly colorSource: { readonly protected: string; readonly theme: string }
  readonly directions: { readonly greenUp: string; readonly redUp: string }
}

export function ThemeAppearanceControls({ state, families, dispatch, labels, disabled = false }: ThemeAppearanceControlsProps) {
  const draft = state.draft
  const activeFamily = families.find((family) => family.id === draft.activeFamilyId)
  const terminal = draft.terminal
  const terminalFamily = terminal.mode === 'override'
    ? families.find((family) => family.id === terminal.familyId)
    : undefined

  return (
    <div className="space-y-4" data-testid="theme-appearance-controls">
      <label className="block text-xs font-medium text-text">
        {labels.family}
        <select
          className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text"
          value={draft.activeFamilyId}
          disabled={disabled}
          onChange={(event) => dispatch({ type: 'select-family', familyId: event.target.value, families })}
        >
          {families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
        </select>
      </label>

      <ChoiceGroup
        legend={labels.mode}
        value={draft.mode}
        choices={(['system', 'light', 'dark'] as const).map((mode) => ({
          value: mode,
          label: labels.modes[mode],
          disabled: disabled || activeFamily === undefined || !familySupportsAppearanceMode(activeFamily, mode),
        }))}
        onChange={(mode) => dispatch({ type: 'select-mode', mode, families })}
      />
      {activeFamily !== undefined && !familySupportsAppearanceMode(activeFamily, 'system') && (
        <p className="text-xs text-text-muted" role="note">{labels.systemRequiresBothVariants}</p>
      )}

      <fieldset className="space-y-2 rounded-md border border-border p-3">
        <legend className="px-1 text-xs font-medium text-text">{labels.terminal.title}</legend>
        <ChoiceGroup
          legend={labels.terminal.behavior}
          hideLegend
          value={draft.terminal.mode}
          choices={[
            { value: 'follow' as const, label: labels.terminal.follow, disabled },
            { value: 'override' as const, label: labels.terminal.override, disabled },
          ]}
          onChange={(mode) => {
            if (mode === 'follow') dispatch({ type: 'terminal-follow' })
            else dispatch({ type: 'terminal-override-family', familyId: terminalFamily?.id ?? activeFamily?.id ?? families[0]?.id ?? '', families })
          }}
        />
        {draft.terminal.mode === 'override' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-text">
              {labels.terminal.family}
              <select
                className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text"
                value={draft.terminal.familyId}
                disabled={disabled}
                onChange={(event) => dispatch({ type: 'terminal-override-family', familyId: event.target.value, families })}
              >
                {families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-text">
              {labels.terminal.variant}
              <select
                className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text"
                value={draft.terminal.variant}
                disabled={disabled}
                onChange={(event) => dispatch({
                  type: 'terminal-override-variant',
                  variant: event.target.value as ThemeVariantMode,
                  families,
                })}
              >
                {(['light', 'dark'] as const).map((mode) => (
                  <option key={mode} value={mode} disabled={terminalFamily?.variants[mode] === undefined}>
                    {labels.modes[mode]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </fieldset>

      <ChoiceGroup
        legend={labels.marketColors}
        value={draft.marketColors}
        choices={[
          { value: 'protected' as const, label: labels.colorSource.protected, disabled },
          { value: 'theme' as const, label: labels.colorSource.theme, disabled },
        ]}
        onChange={(value) => dispatch({ type: 'market-colors', value })}
      />
      <ChoiceGroup
        legend={labels.marketDirection}
        value={draft.marketDirection}
        choices={[
          { value: 'green-up-red-down' as const, label: labels.directions.greenUp, disabled },
          { value: 'red-up-green-down' as const, label: labels.directions.redUp, disabled },
        ]}
        onChange={(value) => dispatch({ type: 'market-direction', value })}
      />
      <ChoiceGroup
        legend={labels.statusColors}
        value={draft.statusColors}
        choices={[
          { value: 'protected' as const, label: labels.colorSource.protected, disabled },
          { value: 'theme' as const, label: labels.colorSource.theme, disabled },
        ]}
        onChange={(value) => dispatch({ type: 'status-colors', value })}
      />
    </div>
  )
}

function ChoiceGroup<T extends string>(props: {
  readonly legend: string
  readonly hideLegend?: boolean
  readonly value: T
  readonly choices: readonly { readonly value: T; readonly label: string; readonly disabled: boolean }[]
  readonly onChange: (value: T) => void
}) {
  return (
    <fieldset>
      <legend className={props.hideLegend ? 'sr-only' : 'mb-1.5 text-xs font-medium text-text'}>{props.legend}</legend>
      <div className="flex flex-wrap gap-2">
        {props.choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            disabled={choice.disabled}
            aria-pressed={props.value === choice.value}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${props.value === choice.value
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border text-text-muted hover:text-text'} disabled:cursor-not-allowed disabled:opacity-40`}
            onClick={() => props.onChange(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
