/**
 * Embedded SSE/SZSE trading-day overrides for cn-paper session checks.
 *
 * Default: Mon–Fri open, Sat–Sun closed.
 * Only weekday holidays are listed here. Weekend make-up opens go in
 * {@link CN_WEEKEND_OPEN} when an exchange explicitly schedules one.
 *
 * Coverage: 2025–2026 (SSE holiday notices / trade_cal). Refresh yearly.
 */

/** Weekday dates when A-shares are closed (YYYY-MM-DD, Asia/Shanghai). */
export const CN_WEEKDAY_HOLIDAYS: readonly string[] = [
  // —— 2025 ——
  '2025-01-01',
  // Spring Festival
  '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31',
  '2025-02-03', '2025-02-04',
  // Qingming
  '2025-04-04',
  // Labour Day
  '2025-05-01', '2025-05-02', '2025-05-05',
  // Dragon Boat
  '2025-06-02',
  // National Day
  '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-06', '2025-10-07', '2025-10-08',
  // —— 2026 ——
  '2026-01-01', '2026-01-02',
  // Spring Festival
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23',
  // Qingming
  '2026-04-06',
  // Labour Day
  '2026-05-01', '2026-05-04', '2026-05-05',
  // Dragon Boat
  '2026-06-19',
  // National Day
  '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07',
]

/** Sat/Sun dates when the exchange is open (rare). */
export const CN_WEEKEND_OPEN: readonly string[] = []
