/** Record age is not feed latency: sessions, bar boundaries and publication rules differ. */
export interface BarFreshness {
  earliestRecordAt: string | null
  earliestTimestampKind: 'instant' | 'date' | 'unknown'
  earliestTimezone: string | null
  latestTimezone: string | null
  timestampMeaning: 'provider_bar_timestamp'
  delay: {
    status: 'possible' | 'unknown'
    estimatedSeconds: number | null
    basis: 'source_classification' | 'insufficient_evidence' | 'historical_request' | 'no_records'
    explanation: string
  }
  fetchedAt: string
  latestRecordAt: string | null
  timestampKind: 'instant' | 'date' | 'unknown'
  recordAgeSeconds: number | null
  historical: boolean
}

export function describeBarFreshness(latest: string, historical: boolean, now = new Date(), context: { earliest?: string; capability?: string } = {}): BarFreshness {
  const instant = /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(latest) && Number.isFinite(Date.parse(latest))
  const timestampKind = instant ? 'instant' : /^\d{4}-\d{2}-\d{2}$/.test(latest) ? 'date' : 'unknown'
  const age = instant ? (now.getTime() - Date.parse(latest)) / 1000 : null
  const earliest = context.earliest ?? latest
  const kind = (value: string): BarFreshness['timestampKind'] =>
    /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)) ? 'instant'
      : /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'date' : 'unknown'
  const timezone = (value: string) => kind(value) === 'instant' ? value.match(/(Z|[+-]\d{2}:?\d{2})$/i)![1] : null
  const basis = !latest ? 'no_records' : historical ? 'historical_request'
    : context.capability === 'delayed' ? 'source_classification' : 'insufficient_evidence'
  return {
    earliestRecordAt: earliest || null, earliestTimestampKind: kind(earliest),
    earliestTimezone: timezone(earliest), latestTimezone: timezone(latest),
    timestampMeaning: 'provider_bar_timestamp',
    delay: {
      status: basis === 'source_classification' ? 'possible' : 'unknown', estimatedSeconds: null, basis,
      explanation: basis === 'historical_request' ? 'Historical request; record age is not a live delay signal.'
        : basis === 'no_records' ? 'No returned records to assess.'
        : `${basis === 'source_classification' ? 'OpenAlice classifies this source as potentially delayed; this is not a per-response provider declaration. ' : ''}Record age is not feed latency. Trading sessions and bar timestamp boundaries are not verified; actual delay is unknown.`,
    },
    fetchedAt: now.toISOString(), latestRecordAt: latest || null, timestampKind,
    recordAgeSeconds: age !== null && age >= 0 ? Math.floor(age) : null,
    historical,
  }
}
