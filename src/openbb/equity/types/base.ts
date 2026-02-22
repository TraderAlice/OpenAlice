/**
 * OpenBB response envelope — mirrors OBBject from openbb_core.
 * Every endpoint returns data wrapped in this structure.
 */
export interface OBBjectResponse<T> {
  results: T[]
  provider: string | null
  warnings: string[] | null
  chart: unknown | null
  extra: Record<string, unknown>
}
