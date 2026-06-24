import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ActivitySection } from '../tabs/types'

/**
 * Per-activity secondary-sidebar width.
 *
 * History (why this exists): the layout was forked from VSCode, where the
 * secondary sidebar is a dependent of the ActivityBar — fixed rail →
 * fixed sidebar, ONE width for all. After the pivot to a Linear model the
 * secondary sidebar became a dependent of the main content instead, so a
 * single locked width across every activity is wrong: a flat Settings
 * category list wants ~220px, a dense Market search list wants ~300px.
 *
 * This store gives each ActivitySection its own width — a tuned default
 * (below) plus the user's last manual resize, persisted independently per
 * activity. App.tsx applies it imperatively via the panel's `resize()` on
 * activity switch (no Group remount, so the main panel's tabs stay alive).
 *
 * Defaults are seeded from a per-sidebar content audit; clamp matches the
 * Panel's min/max (200/420).
 */

export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 420
const FALLBACK_WIDTH = 260

/** Tuned natural default width (px) per activity, from the content audit. */
export const SIDEBAR_DEFAULT_WIDTH: Partial<Record<ActivitySection, number>> = {
  chat: 260,
  inbox: 260,
  tracked: 232,
  workspaces: 300,
  'trading-as-git': 280,
  settings: 220,
  dev: 220,
  market: 300,
  portfolio: 220,
  automation: 220,
}

interface SidebarWidthState {
  /** User's last manually-resized width per activity. Absent → use default. */
  widths: Partial<Record<string, number>>
}

interface SidebarWidthActions {
  /** Persist a user resize for an activity (clamped to the panel bounds). */
  setWidth: (activity: ActivitySection, px: number) => void
}

export const useSidebarWidth = create<SidebarWidthState & SidebarWidthActions>()(
  persist(
    (set) => ({
      widths: {},
      setWidth: (activity, px) =>
        set((s) => ({
          widths: {
            ...s.widths,
            [activity]: Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(px))),
          },
        })),
    }),
    { name: 'openalice.sidebar-width.v1', version: 1 },
  ),
)

/** Resolve the width to use for an activity: user resize > tuned default > fallback. */
export function resolveSidebarWidth(
  activity: ActivitySection | null | undefined,
  widths: Partial<Record<string, number>>,
): number {
  if (!activity) return FALLBACK_WIDTH
  return widths[activity] ?? SIDEBAR_DEFAULT_WIDTH[activity] ?? FALLBACK_WIDTH
}
