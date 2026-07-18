import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { AppearancePreferences, RgbHex, ThemeVariant } from '../../api/themes'
import { projectColorPolicy } from '../../theme/colorPolicy'
import { terminalThemeProfileForVariant, type TerminalThemeRgb } from '../workspace/terminalThemeProfile'

interface ThemeCrossSurfacePreviewProps {
  variant: ThemeVariant
  appearance: AppearancePreferences
}

/**
 * Isolated Settings preview for the reviewed #16 and #18 consumer classes.
 * It projects the candidate directly and never mutates the active theme store.
 */
export function ThemeCrossSurfacePreview({ variant, appearance }: ThemeCrossSurfacePreviewProps) {
  const { t } = useTranslation()
  const policy = useMemo(() => projectColorPolicy(variant, appearance), [appearance, variant])
  const terminal = useMemo(() => terminalThemeProfileForVariant(variant), [variant])
  const tokens = variant.tokens

  const up = policy['--oa-market-up']!
  const down = policy['--oa-market-down']!
  const volumeUp = policy['--oa-market-volume-up']!
  const volumeDown = policy['--oa-market-volume-down']!
  const chartStyle = {
    background: policy['--oa-chart-background'],
    color: policy['--oa-chart-axis-text'],
    borderColor: policy['--oa-chart-axis-border'],
  }

  return (
    <section
      className="space-y-4 rounded-lg border border-border p-4"
      data-testid="theme-cross-surface-preview"
      data-inventory-contract="#16:193;#18:83"
      aria-label={t('settings.themeManager.crossSurfacePreview.title')}
    >
      <header>
        <h4 className="text-sm font-semibold" style={{ color: tokens.bodyText }}>
          {t('settings.themeManager.crossSurfacePreview.title')}
        </h4>
        <p className="text-xs" style={{ color: tokens.mutedText }}>
          {t('settings.themeManager.crossSurfacePreview.description')}
        </p>
      </header>

      <PreviewGroup title={t('settings.themeManager.crossSurfacePreview.application')} owner="#16">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Sample label={t('settings.themeManager.crossSurfacePreview.surface')} background={tokens.pageBackground} color={tokens.bodyText} />
          <Sample label={t('settings.themeManager.crossSurfacePreview.textHierarchy')} background={tokens.cardSurface} color={tokens.strongText}>
            <span style={{ color: tokens.mutedText }}>{t('settings.themeManager.crossSurfacePreview.mutedText')}</span>
          </Sample>
          <Sample label={t('settings.themeManager.crossSurfacePreview.hover')} background={tokens.hoverSurface} color={tokens.bodyText} />
          <Sample label={t('settings.themeManager.crossSurfacePreview.active')} background={tokens.activeSurface} color={tokens.bodyText} />
          <Sample label={t('settings.themeManager.crossSurfacePreview.selection')} background={tokens.selection} color={tokens.bodyText} />
          <Sample
            label={t('settings.themeManager.crossSurfacePreview.focus')}
            background={tokens.cardSurface}
            color={tokens.bodyText}
            style={{ boxShadow: `inset 0 0 0 2px ${tokens.focusRing}` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="status-preview">
          <Status label={t('settings.themeManager.crossSurfacePreview.success')} color={policy['--oa-status-success']!} />
          <Status label={t('settings.themeManager.crossSurfacePreview.warning')} color={policy['--oa-status-warning']!} />
          <Status label={t('settings.themeManager.crossSurfacePreview.danger')} color={policy['--oa-status-danger']!} />
          <Status label={t('settings.themeManager.crossSurfacePreview.info')} color={policy['--oa-status-info']!} />
        </div>
      </PreviewGroup>

      <PreviewGroup title={t('settings.themeManager.crossSurfacePreview.market')} owner="#18">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)]">
          <div className="rounded-md border p-3" style={chartStyle} data-testid="market-chart-preview">
            <svg viewBox="0 0 360 142" role="img" aria-label={t('settings.themeManager.crossSurfacePreview.chart')} className="h-36 w-full">
              <rect width="360" height="142" fill={policy['--oa-chart-background']} />
              {[28, 58, 88, 118].map((y) => <line key={y} x1="0" x2="360" y1={y} y2={y} stroke={policy['--oa-chart-grid']} />)}
              <line x1="48" x2="48" y1="8" y2="122" stroke={policy['--oa-chart-axis-border']} />
              <line x1="48" x2="350" y1="122" y2="122" stroke={policy['--oa-chart-axis-border']} />
              <path d="M50 96 L92 72 L134 81 L176 48" fill="none" stroke={up} strokeWidth="3" />
              <path d="M176 48 L218 67 L260 52 L304 84 L346 70" fill="none" stroke={down} strokeWidth="3" />
              <Candle x={86} open={82} close={62} high={48} low={97} color={up} hollow />
              <Candle x={142} open={60} close={86} high={49} low={101} color={down} />
              <Candle x={198} open={78} close={55} high={40} low={91} color={up} hollow />
              <Candle x={254} open={55} close={83} high={45} low={96} color={down} />
              <rect x="78" y="106" width="16" height="16" fill={volumeUp} />
              <rect x="134" y="111" width="16" height="11" fill={volumeDown} />
              <rect x="190" y="102" width="16" height="20" fill={volumeUp} />
              <rect x="246" y="108" width="16" height="14" fill={volumeDown} />
              <text x="4" y="18" fill={policy['--oa-chart-axis-text']} fontSize="10">102.4</text>
            </svg>
          </div>
          <div className="grid content-start gap-2 text-xs">
            <MarketCue label={t('settings.themeManager.crossSurfacePreview.pnlUp')} cue="▲ +1.82%" color={up} />
            <MarketCue label={t('settings.themeManager.crossSurfacePreview.pnlDown')} cue="▼ −0.74%" color={down} />
            <MarketCue label={t('settings.themeManager.crossSurfacePreview.buy')} cue="＋ BUY" color={policy['--oa-market-buy']!} />
            <MarketCue label={t('settings.themeManager.crossSurfacePreview.sell')} cue="− SELL" color={policy['--oa-market-sell']!} />
          </div>
        </div>
      </PreviewGroup>

      <PreviewGroup title={t('settings.themeManager.crossSurfacePreview.risk')} owner="#18-invariant">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" data-testid="risk-preview">
          {(['destructive', 'permissionDenied', 'tradeConfirm', 'brokerFailure', 'riskBlocked'] as const).map((key) => (
            <div
              key={key}
              className="rounded-md border p-2 text-xs"
              style={{
                color: policy['--oa-risk-destructive'],
                background: policy['--oa-risk-background'],
                borderColor: policy['--oa-risk-border'],
              }}
            >
              <span aria-hidden="true">⚠ </span>{t(`settings.themeManager.crossSurfacePreview.${key}`)}
            </div>
          ))}
        </div>
      </PreviewGroup>

      <PreviewGroup title={t('settings.themeManager.crossSurfacePreview.terminal')} owner="#17">
        <div
          className="rounded-md border p-3 font-mono text-xs"
          style={{ background: rgbHex(terminal.background), color: rgbHex(terminal.foreground), borderColor: tokens.border }}
        >
          <span style={{ color: rgbHex(terminal.cursorColor) }}>▌</span>
          <span style={{ background: rgbHex(terminal.selectionBackground), color: rgbHex(terminal.selectionForeground) }}>
            {t('settings.themeManager.crossSurfacePreview.terminalSelection')}
          </span>
        </div>
        <ColorGrid label={t('settings.themeManager.base16Label')} colors={paletteColors(variant)} start={0} testId="base16-preview-grid" />
        <ColorGrid label={t('settings.themeManager.ansiLabel')} colors={terminal.palette.map(rgbHex)} start={0} testId="ansi-preview-grid" />
        <ColorGrid label={t('settings.themeManager.extendedAnsiLabel')} colors={terminal.extendedAnsi.map(rgbHex)} start={16} testId="extended-ansi-preview-grid" />
      </PreviewGroup>
    </section>
  )
}

function PreviewGroup({ title, owner, children }: { title: string; owner: string; children: ReactNode }) {
  return <section className="space-y-2" data-inventory-owner={owner}><h5 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h5>{children}</section>
}

function Sample(props: { label: string; background: string; color: string; children?: ReactNode; style?: CSSProperties }) {
  return <div className="min-h-14 rounded-md border border-border p-2 text-xs" style={{ background: props.background, color: props.color, ...props.style }}><strong>{props.label}</strong>{props.children && <div>{props.children}</div>}</div>
}

function Status({ label, color }: { label: string; color: string }) {
  return <div className="rounded-md border p-2 text-xs" style={{ borderColor: color, color }}><span aria-hidden="true">● </span>{label}</div>
}

function MarketCue({ label, cue, color }: { label: string; cue: string; color: string }) {
  return <div className="flex items-center justify-between rounded-md border border-border p-2"><span className="text-text-muted">{label}</span><strong style={{ color }}>{cue}</strong></div>
}

function Candle(props: { x: number; open: number; close: number; high: number; low: number; color: string; hollow?: boolean }) {
  const top = Math.min(props.open, props.close)
  const height = Math.abs(props.close - props.open)
  return <g><line x1={props.x} x2={props.x} y1={props.high} y2={props.low} stroke={props.color} strokeWidth="2" /><rect x={props.x - 6} y={top} width="12" height={height} fill={props.hollow ? 'none' : props.color} stroke={props.color} strokeWidth="2" /></g>
}

function ColorGrid(props: { label: string; colors: readonly string[]; start: number; testId: string }) {
  return <div><p className="mb-1 text-[10px] font-semibold uppercase text-text-muted">{props.label}</p><div className="flex flex-wrap gap-1" data-testid={props.testId}>{props.colors.map((color, index) => <span key={`${props.start + index}-${color}`} data-color={color} data-color-index={props.start + index} className="h-5 w-5 rounded-sm border border-border/40" style={{ background: color }} title={`${props.start + index}: ${color}`} />)}</div></div>
}

function paletteColors(variant: ThemeVariant): string[] {
  return Object.entries(variant.palette)
    .filter(([slot]) => /^base(?:0[0-9A-F]|1[0-7])$/.test(slot))
    .map(([, color]) => color)
}

function rgbHex(rgb: TerminalThemeRgb): RgbHex {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}` as RgbHex
}
