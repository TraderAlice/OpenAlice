import { Ellipsis, Laptop, Moon, Plug, Settings, Sun } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useThemeStore, type AppTheme } from '../theme/store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

const THEME_MODES = [
  { mode: 'auto', Icon: Laptop },
  { mode: 'day', Icon: Sun },
  { mode: 'night', Icon: Moon },
] as const satisfies ReadonlyArray<{ mode: AppTheme; Icon: typeof Laptop }>

interface ActivityBarUtilityMenuProps {
  compactRail: boolean
  denseRail: boolean
  onOpenSettings: () => void
  onOpenConnectors: () => void
  connectorsActive?: boolean
  connectorWarnings?: number
}

export function ActivityBarUtilityMenu({
  compactRail,
  denseRail,
  onOpenSettings,
  onOpenConnectors,
  connectorsActive = false,
  connectorWarnings = 0,
}: ActivityBarUtilityMenuProps) {
  const { t } = useTranslation()
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const [menuOpen, setMenuOpen] = useState(false)
  const CurrentThemeIcon = THEME_MODES.find((item) => item.mode === theme)?.Icon ?? Laptop

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger
        render={(
          <button
            type="button"
            aria-label={t('nav.applicationMenu')}
            title={compactRail ? t('nav.applicationMenu') : undefined}
            onClick={() => {
              if (!menuOpen) setMenuOpen(true)
            }}
            className={`oa-application-menu oa-pressable relative flex min-w-0 cursor-pointer items-center rounded-md text-left text-[13px] text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/45 ${
              compactRail
                ? `${denseRail ? 'h-[26px] w-[26px]' : 'h-8 w-8'} justify-center p-0`
                : 'min-h-10 w-full gap-2.5 px-2 py-1.5'
            } ${menuOpen ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/60'}`}
          />
        )}
      >
        <span aria-hidden className={`${denseRail ? 'size-6' : 'size-7'} flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-sidebar-foreground/15 bg-sidebar-accent/60 p-0.5`}>
          <img src="/alice.ico" alt="" draggable={false} className="size-full object-contain" />
        </span>
        {!compactRail && (
          <span className="min-w-0 flex-1 truncate font-medium">{t('nav.yourAlice')}</span>
        )}
        {connectorWarnings > 0 && (
          <span
            role="status"
            aria-label={t('nav.connectorNeedsAttention', { count: connectorWarnings })}
            className={`h-1.5 w-1.5 shrink-0 rounded-full bg-warning ${compactRail ? 'absolute right-1 top-1' : ''}`}
          />
        )}
        {!compactRail && <Ellipsis size={16} strokeWidth={1.75} aria-hidden
          className="oa-application-menu-more shrink-0 text-muted-foreground" />}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="w-[208px] max-w-[calc(100vw-1rem)] rounded-xl border border-border/70 bg-popover p-1.5 shadow-lg ring-0"
      >
        <DropdownMenuItem
          onClick={onOpenSettings}
          className="min-h-9 cursor-pointer gap-2 px-2.5 text-[12px]"
        >
          <Settings size={15} strokeWidth={1.75} aria-hidden />
          <span>{t('nav.item.settings')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onOpenConnectors}
          aria-current={connectorsActive ? 'page' : undefined}
          className="min-h-9 cursor-pointer gap-2 px-2.5 text-[12px]"
        >
          <Plug size={15} strokeWidth={1.75} aria-hidden />
          <span className="flex-1">{t('nav.item.connectors')}</span>
          {connectorWarnings > 0 && (
            <span
              aria-label={t('nav.connectorNeedsAttention', { count: connectorWarnings })}
              className="rounded-full bg-warning px-1.5 text-[10px] tabular-nums text-warning-foreground"
            >
              {connectorWarnings > 99 ? '99+' : connectorWarnings}
            </span>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            aria-label={t('nav.appearanceMenu', { mode: t(`theme.mode.${theme}`) })}
            className="min-h-9 cursor-pointer gap-2 px-2.5 text-[12px] [&>svg:last-child]:ml-1"
          >
            <CurrentThemeIcon size={15} strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t('settings.category.appearance')}</span>
            <span className="shrink-0 text-muted-foreground">{t(`theme.mode.${theme}`)}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-[148px] border border-border/70 bg-popover p-1.5 shadow-lg ring-0">
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => {
                if (THEME_MODES.some((item) => item.mode === value)) {
                  setTheme(value as AppTheme)
                }
              }}
            >
              {THEME_MODES.map(({ mode, Icon }) => (
                <DropdownMenuRadioItem
                  key={mode}
                  value={mode}
                  className="min-h-9 cursor-pointer gap-2 px-2.5 pr-8 text-[12px]"
                >
                  <Icon size={15} strokeWidth={1.75} aria-hidden />
                  <span>{t(`theme.mode.${mode}`)}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
