/** Canonical identities shared by macro navigation and the initial News coverage. */
export const NEWS_COUNTRIES = [
  { code: 'US', slug: 'united_states', label: 'United States' },
  { code: 'CN', slug: 'china', label: 'China' },
  { code: 'JP', slug: 'japan', label: 'Japan' },
  { code: 'DE', slug: 'germany', label: 'Germany' },
  { code: 'GB', slug: 'united_kingdom', label: 'United Kingdom' },
  { code: 'IN', slug: 'india', label: 'India' },
  { code: 'BR', slug: 'brazil', label: 'Brazil' },
  { code: 'CA', slug: 'canada', label: 'Canada' },
  { code: 'IR', slug: 'iran', label: 'Iran' },
  { code: 'RU', slug: 'russia', label: 'Russia' },
  { code: 'AE', slug: 'united_arab_emirates', label: 'United Arab Emirates' },
  { code: 'QA', slug: 'qatar', label: 'Qatar' },
  { code: 'IL', slug: 'israel', label: 'Israel' },
  { code: 'HT', slug: 'haiti', label: 'Haiti' },
  { code: 'SV', slug: 'el_salvador', label: 'El Salvador' },
] as const

export function newsCountryCode(value: string): string | undefined {
  return NEWS_COUNTRIES.find(country => country.code === value.toUpperCase() || country.slug === value.toLowerCase())?.code
}
