import { useEffect, useState } from 'react'
import { marketApi, type EquityProfile } from '../../api/market'
import { Card } from './Card'
import { fmtInt } from './format'

interface Props {
  symbol: string
}

export function ProfilePanel({ symbol }: Props) {
  const [profile, setProfile] = useState<EquityProfile | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    marketApi.equity.profile(symbol).then((res) => {
      if (cancelled) return
      if (res.error) setError(res.error)
      setProfile(res.results?.[0] ?? null)
      setProvider(res.provider || null)
    })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [symbol])

  const sector = profile?.sector as string | undefined
  const industry = (profile?.industry_category ?? profile?.industry_group) as string | undefined
  const ceo = profile?.ceo as string | undefined
  const employees = profile?.employees as number | undefined
  const website = profile?.company_url as string | undefined
  const hqCity = profile?.hq_address_city as string | undefined
  const hqState = profile?.hq_state as string | undefined
  const hqCountry = profile?.hq_country as string | undefined
  const desc = (profile?.long_description ?? profile?.short_description) as string | undefined
  const hq = [hqCity, hqState, hqCountry].filter(Boolean).join(', ') || undefined

  const info = [
    provider ? `Source: ${provider}` : 'Source: (unknown)',
    'Endpoint: /api/market-data-v1/equity/profile',
    'Company overview: sector, industry, leadership, location, headcount.',
    'Field coverage varies by provider; blank rows are fields the source doesn\u2019t report.',
  ].join('\n')

  return (
    <Card title="Profile" info={info}>
      {loading && <div className="text-[12px] text-text-muted">Loading…</div>}
      {error && !loading && <div className="text-[12px] text-red-400">{error}</div>}
      {!loading && !error && profile && (
        <div className="flex flex-col gap-3 text-[12px]">
          <dl className="grid grid-cols-[90px_1fr] gap-y-1 gap-x-3">
            <KV label="Sector"    value={sector} />
            <KV label="Industry"  value={industry} />
            <KV label="CEO"       value={ceo} />
            <KV label="Employees" value={employees != null ? fmtInt(employees) : undefined} />
            <KV label="HQ"        value={hq} />
            <KV
              label="Website"
              value={website ? <a className="text-accent hover:underline break-all" href={website} target="_blank" rel="noreferrer">{website.replace(/^https?:\/\//, '')}</a> : undefined}
            />
          </dl>
          {desc && (
            <p className="text-text-muted/80 leading-[1.55] line-clamp-[8]">{desc}</p>
          )}
        </div>
      )}
      {!loading && !error && !profile && (
        <div className="text-[12px] text-text-muted">No profile data.</div>
      )}
    </Card>
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-muted/60">{label}</dt>
      <dd className="text-text truncate">{value ?? <span className="text-text-muted/50">—</span>}</dd>
    </>
  )
}
