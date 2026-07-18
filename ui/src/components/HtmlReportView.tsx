/**
 * Isolated renderer for Agent-authored static HTML reports.
 *
 * HTML reports are presentation assets, not trusted application UI. They run
 * in an origin-less sandbox with no scripts, forms, navigation, or network.
 * Inline CSS, SVG, and data images remain available so a self-contained report
 * can keep its intended visual hierarchy without reaching outside OpenAlice.
 */

import DOMPurify from 'dompurify'
import { useMemo } from 'react'

import { useThemeStore } from '../theme/store'
import { useEffectiveTheme } from '../theme/useEffectiveTheme'
import { projectSemanticConsumerVariables } from '../theme/semanticConsumers'

const REPORT_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "font-src data:",
  "form-action 'none'",
  "frame-src 'none'",
  "img-src data:",
  "media-src data:",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
].join('; ')

interface HtmlReportTheme {
  background: string
  text: string
}

function reportBaseStyle(theme: HtmlReportTheme): string {
  if (![theme.background, theme.text].every((color) => /^#[0-9a-f]{6}$/i.test(color))) {
    throw new Error('HTML report theme colors must be resolved RGB hex values')
  }
  return `
  html { background: ${theme.background}; color: ${theme.text}; }
  body {
    box-sizing: border-box;
    margin: 0;
    min-width: 0;
    padding: 24px;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  *, *::before, *::after { box-sizing: inherit; }
  img, svg, video, canvas { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre { max-width: 100%; overflow: auto; }
  @media (max-width: 640px) { body { padding: 16px; } }
`
}

const FORBIDDEN_TAGS = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'link',
  'base',
  'meta',
] as const

/** Build the exact srcdoc handed to the sandboxed iframe. Exported so the
 * security contract can be tested without relying on browser iframe loading. */
export function createSandboxedHtmlReportDocument(source: string, theme: HtmlReportTheme): string {
  const sanitized = DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style'],
    FORBID_TAGS: [...FORBIDDEN_TAGS],
  })
  const report = new DOMParser().parseFromString(sanitized, 'text/html')

  // DOMPurify removes executable attributes. This second pass owns resource
  // policy: self-contained reports may use data URLs and in-document anchors,
  // but must never turn opening an Inbox item into an external request.
  for (const element of report.querySelectorAll<HTMLElement>('[src], [srcset], [poster], [background]')) {
    const sourceUrl = element.getAttribute('src')?.trim()
    if (sourceUrl && !sourceUrl.toLowerCase().startsWith('data:')) element.removeAttribute('src')
    element.removeAttribute('srcset')
    element.removeAttribute('poster')
    element.removeAttribute('background')
  }
  for (const element of report.querySelectorAll<HTMLElement>('[href], [xlink\\:href]')) {
    const href = (element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '').trim()
    if (!href.startsWith('#')) {
      element.removeAttribute('href')
      element.removeAttribute('xlink:href')
    }
  }

  const csp = report.createElement('meta')
  csp.httpEquiv = 'Content-Security-Policy'
  csp.content = REPORT_CSP
  const baseStyle = report.createElement('style')
  baseStyle.textContent = reportBaseStyle(theme)
  report.head.prepend(baseStyle)
  report.head.prepend(csp)

  return `<!doctype html>\n${report.documentElement.outerHTML}`
}

export function HtmlReportView({
  path,
  content,
  resolvedTheme,
}: {
  path: string
  content: string
  /** Explicit resolved colors are used by isolated renderers/tests only. */
  resolvedTheme?: HtmlReportTheme
}) {
  const families = useThemeStore((state) => state.families)
  const appearance = useThemeStore((state) => state.appearance)
  const mode = useEffectiveTheme()
  const variant = families.find((family) => family.id === appearance?.activeFamilyId)?.variants[mode]
  if (variant === undefined && resolvedTheme === undefined) {
    throw new Error('HTML report cannot render without a resolved active theme')
  }
  const semantic = variant === undefined ? undefined : projectSemanticConsumerVariables(variant.palette)
  const reportTheme = resolvedTheme ?? {
    background: semantic!['--color-html-report-view-on-strong-background-color'],
    text: semantic!['--color-html-report-view-muted-color'],
  }
  const srcDoc = useMemo(
    () => createSandboxedHtmlReportDocument(content, reportTheme),
    [content, reportTheme.background, reportTheme.text],
  )

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-[var(--color-html-report-view-on-strong-bg)] shadow-sm">
      <iframe
        title={`HTML report: ${path}`}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        className="block h-[min(70vh,720px)] min-h-[420px] w-full border-0 bg-[var(--color-html-report-view-on-strong-bg)]"
      />
    </div>
  )
}
