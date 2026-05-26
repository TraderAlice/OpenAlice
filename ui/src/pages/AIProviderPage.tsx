import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type Profile, type AIBackend, type Preset } from '../api'
import type { Credential, SdkAdapterInfo, SdkAdapterId } from '../api/types'
import { SaveIndicator } from '../components/SaveIndicator'
import { Field, inputClass } from '../components/form'
import { useSchemaForm, type SchemaField } from '../hooks/useSchemaForm'
import type { SaveStatus } from '../hooks/useAutoSave'
import { PageHeader } from '../components/PageHeader'
import { PageLoading } from '../components/StateViews'
import { CredentialCard, type TestState as CredTestState } from '../components/credentials/CredentialCard'
import { SdkAdapterCard } from '../components/credentials/SdkAdapterCard'

// ==================== Icons ====================

const BACKEND_ICONS: Record<AIBackend, React.ReactNode> = {
  'agent-sdk': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 1 4 4v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V6a4 4 0 0 1 4-4z" /><path d="M8 8v2a4 4 0 0 0 8 0V8" /><path d="M12 14v4" /><path d="M8 22h8" /><circle cx="9" cy="5.5" r="0.5" fill="currentColor" stroke="none" /><circle cx="15" cy="5.5" r="0.5" fill="currentColor" stroke="none" /></svg>,
  'codex': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /><line x1="14" y1="4" x2="10" y2="20" /></svg>,
  'vercel-ai-sdk': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
}

function getSchemaConst(schema: Preset['schema'], field: string): unknown {
  const props = schema?.properties as Record<string, { const?: unknown }> | undefined
  return props?.[field]?.const
}

function getModelOptions(profile: Profile, presets: Preset[]): Array<{ id: string; label: string }> {
  const preset = presets.find(p => p.id === profile.preset)
  if (!preset) return []
  const props = preset.schema?.properties as Record<string, { oneOf?: Array<{ const: string; title: string }> }> | undefined
  const oneOf = props?.model?.oneOf
  if (!oneOf) return []
  return oneOf.map(o => ({ id: o.const, label: o.title }))
}

// ==================== Main Page ====================

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; error?: string }

type Selection = { kind: 'credential'; slug: string } | { kind: 'sdk'; id: SdkAdapterId } | null

export function AIProviderPage() {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<Record<string, Profile> | null>(null)
  const [credentials, setCredentials] = useState<Record<string, Credential>>({})
  const [activeProfile, setActiveProfile] = useState('')
  const [presets, setPresets] = useState<Preset[]>([])
  const [adapters, setAdapters] = useState<SdkAdapterInfo[]>([])
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})
  const [selection, setSelection] = useState<Selection>(null)

  useEffect(() => {
    api.config.getProfiles().then(({ profiles: p, credentials: c, activeProfile: a }) => {
      setProfiles(p); setCredentials(c); setActiveProfile(a)
    }).catch(() => {})
    api.config.getPresets().then(({ presets: p }) => setPresets(p)).catch(() => {})
    api.config.getSdkAdapters().then(({ adapters: a }) => setAdapters(a)).catch(() => {})
  }, [])

  // ============== Derived data ==============

  /** presetId → adapter ids it can drive (test default first). */
  const presetToAdapters = useMemo(() => {
    const map: Record<string, Array<{ id: SdkAdapterId; isTestDefault: boolean }>> = {}
    for (const a of adapters) {
      for (const p of a.presets) {
        if (!map[p.presetId]) map[p.presetId] = []
        map[p.presetId].push({ id: a.id, isTestDefault: p.isTestDefault })
      }
    }
    // Sort: test default first
    for (const list of Object.values(map)) {
      list.sort((x, y) => Number(y.isTestDefault) - Number(x.isTestDefault))
    }
    return map
  }, [adapters])

  /** Group profiles by their credentialSlug. Profiles without slug land under '__inline'. */
  const profilesByCredential = useMemo(() => {
    const map: Record<string, Array<[string, Profile]>> = {}
    if (!profiles) return map
    for (const [slug, profile] of Object.entries(profiles)) {
      const key = profile.credentialSlug ?? '__inline'
      if (!map[key]) map[key] = []
      map[key].push([slug, profile])
    }
    return map
  }, [profiles])

  /** Adapter ids reachable from a credential — derived via the credential's profiles' presets. */
  const credentialToAdapters = useMemo(() => {
    const map: Record<string, Array<{ id: SdkAdapterId; isTestDefault: boolean }>> = {}
    for (const credSlug of Object.keys(credentials)) {
      const profilesUsing = profilesByCredential[credSlug] ?? []
      const seen = new Map<SdkAdapterId, boolean>()
      for (const [, profile] of profilesUsing) {
        if (!profile.preset) continue
        for (const a of presetToAdapters[profile.preset] ?? []) {
          // Take test-default if any path marks it
          if (!seen.has(a.id) || a.isTestDefault) seen.set(a.id, a.isTestDefault)
        }
      }
      map[credSlug] = [...seen.entries()]
        .map(([id, isTestDefault]) => ({ id, isTestDefault }))
        .sort((x, y) => Number(y.isTestDefault) - Number(x.isTestDefault))
    }
    return map
  }, [credentials, profilesByCredential, presetToAdapters])

  /** Map presetId → credential slug (any one) where the user has a credential matching that preset. */
  const configuredPresetMap = useMemo(() => {
    const map: Record<string, string> = {}
    if (!profiles) return map
    for (const [slug, profile] of Object.entries(profiles)) {
      if (profile.preset && profile.credentialSlug) map[profile.preset] = profile.credentialSlug
    }
    return map
  }, [profiles])

  // ============== Selection & dim logic ==============

  const isCredentialDimmed = (credSlug: string): boolean => {
    if (!selection || selection.kind !== 'sdk') return false
    const compatible = credentialToAdapters[credSlug] ?? []
    return !compatible.some(a => a.id === selection.id)
  }

  const isAdapterDimmed = (adapterId: SdkAdapterId): boolean => {
    if (!selection || selection.kind !== 'credential') return false
    const compatible = credentialToAdapters[selection.slug] ?? []
    return !compatible.some(a => a.id === adapterId)
  }

  const toggleSelectCredential = (slug: string) => {
    setSelection(s => (s && s.kind === 'credential' && s.slug === slug ? null : { kind: 'credential', slug }))
  }
  const toggleSelectAdapter = (id: SdkAdapterId) => {
    setSelection(s => (s && s.kind === 'sdk' && s.id === id ? null : { kind: 'sdk', id }))
  }

  // ============== Profile actions ==============

  const handleSetActive = async (slug: string) => {
    try { await api.config.setActiveProfile(slug); setActiveProfile(slug) } catch {}
  }

  const handleDelete = async (slug: string) => {
    if (!profiles) return
    try {
      await api.config.deleteProfile(slug)
      const { profiles: p, credentials: c, activeProfile: a } = await api.config.getProfiles()
      setProfiles(p); setCredentials(c); setActiveProfile(a)
      setEditingSlug(null)
    } catch {}
  }

  const handleCreateSave = async (name: string, profile: Profile) => {
    await api.config.createProfile(name, profile)
    // Re-fetch so credentialSlug + credentials map reflect server-side eager extraction
    const { profiles: p, credentials: c, activeProfile: a } = await api.config.getProfiles()
    setProfiles(p); setCredentials(c); setActiveProfile(a)
  }

  const handleProfileUpdate = async (slug: string, profile: Profile) => {
    await api.config.updateProfile(slug, profile)
    const { profiles: p, credentials: c } = await api.config.getProfiles()
    setProfiles(p); setCredentials(c)
  }

  const handleTest = async (slug: string, profile: Profile) => {
    setTestStates(s => ({ ...s, [slug]: { status: 'testing' } }))
    try {
      const result = await api.config.testProfile(profile)
      if (result.ok) {
        setTestStates(s => ({ ...s, [slug]: { status: 'ok' } }))
        setTimeout(() => setTestStates(s => ({ ...s, [slug]: { status: 'idle' } })), 2500)
      } else {
        setTestStates(s => ({ ...s, [slug]: { status: 'fail', error: result.error } }))
        setTimeout(() => setTestStates(s => ({ ...s, [slug]: { status: 'idle' } })), 6000)
      }
    } catch (err) {
      setTestStates(s => ({ ...s, [slug]: { status: 'fail', error: err instanceof Error ? err.message : 'Test failed' } }))
      setTimeout(() => setTestStates(s => ({ ...s, [slug]: { status: 'idle' } })), 6000)
    }
  }

  const handleInlineModelChange = async (slug: string, newModel: string) => {
    if (!profiles) return
    const profile = profiles[slug]
    if (!profile) return
    const updated = { ...profile, model: newModel }
    setProfiles((p) => p ? { ...p, [slug]: updated } : p)
    try {
      await api.config.updateProfile(slug, updated)
    } catch {
      setProfiles((p) => p ? { ...p, [slug]: profile } : p)
    }
  }

  if (!profiles) return <div className="flex flex-col flex-1 min-h-0"><PageHeader title={t('aiProvider.title')} description={t('aiProvider.description', 'Manage AI provider credentials and view available SDKs.')} /><PageLoading /></div>

  // Profiles that have NO credentialSlug (transitional / inline-only) — render as a fallback group
  const inlineProfiles = profilesByCredential['__inline'] ?? []

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('aiProvider.title')} description={t('aiProvider.description', 'Manage AI provider credentials and view available SDKs.')} />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
        <div
          className="max-w-[1200px] mx-auto grid gap-6"
          style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}
          onClick={() => setSelection(null)}
        >
          {/* ============== Credentials column ============== */}
          <section onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[13px] font-semibold text-text uppercase tracking-wide">{t('aiProvider.credentials', 'Credentials')}</h2>
              <button
                onClick={() => setShowCreate(true)}
                className="text-[11px] px-2 py-1 rounded-md border border-border text-text-muted hover:text-accent hover:border-accent transition-colors"
              >
                {t('aiProvider.add', '+ Add')}
              </button>
            </div>
            <div className="space-y-3">
              {Object.entries(credentials).map(([credSlug, cred]) => {
                const profilesUsing = profilesByCredential[credSlug] ?? []
                const sel = selection?.kind === 'credential' && selection.slug === credSlug
                return (
                  <CredentialCard
                    key={credSlug}
                    slug={credSlug}
                    credential={cred}
                    profiles={profilesUsing.map(([pSlug, profile]) => ({
                      slug: pSlug,
                      profile,
                      isActive: pSlug === activeProfile,
                      testState: testStates[pSlug] ?? { status: 'idle' as const } as CredTestState,
                    }))}
                    presets={presets}
                    availableAdapters={credentialToAdapters[credSlug] ?? []}
                    selected={sel}
                    dimmed={isCredentialDimmed(credSlug)}
                    onSelect={() => toggleSelectCredential(credSlug)}
                    onSetActive={handleSetActive}
                    onTest={handleTest}
                    onEditProfile={(pSlug) => setEditingSlug(pSlug)}
                    onModelChange={async (pSlug, model) => handleInlineModelChange(pSlug, model)}
                  />
                )
              })}

              {inlineProfiles.length > 0 && (
                <div className="mt-2 p-3 rounded-lg border border-dashed border-border bg-bg-tertiary/30">
                  <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">{t('aiProvider.inlineOnlyProfiles', 'Inline-only profiles (no credential record)')}</div>
                  <div className="text-[11px] text-text-muted">
                    {inlineProfiles.map(([slug]) => slug).join(', ')}
                  </div>
                  <div className="text-[10px] text-text-muted/70 mt-1">
                    {t('aiProvider.inlineProfilesHint', "These profiles still work via inline fallback. They'll be linked to credential records the next time they're saved or after the 0003 migration runs.")}
                  </div>
                </div>
              )}

              {Object.keys(credentials).length === 0 && inlineProfiles.length === 0 && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="w-full p-4 rounded-xl border-2 border-dashed border-border text-text-muted hover:border-accent/50 hover:text-accent transition-all text-[13px] font-medium"
                >
                  {t('aiProvider.addFirstCredential', '+ Add your first credential')}
                </button>
              )}
            </div>
          </section>

          {/* ============== SDKs column ============== */}
          <section onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[13px] font-semibold text-text uppercase tracking-wide">{t('aiProvider.availableSDKs', 'Available SDKs')}</h2>
              <span className="text-[10px] text-text-muted">{t('aiProvider.readOnly', 'read-only')}</span>
            </div>
            <div className="space-y-3">
              {adapters.map((adapter) => {
                const sel = selection?.kind === 'sdk' && selection.id === adapter.id
                return (
                  <SdkAdapterCard
                    key={adapter.id}
                    adapter={adapter}
                    configuredPresetMap={configuredPresetMap}
                    selected={sel}
                    dimmed={isAdapterDimmed(adapter.id)}
                    onSelect={() => toggleSelectAdapter(adapter.id)}
                    onConfigurePreset={() => setShowCreate(true)}
                  />
                )
              })}
            </div>
          </section>
        </div>
      </div>

      {editingSlug && profiles[editingSlug] && (
        <ProfileEditModal slug={editingSlug} profile={profiles[editingSlug]} presets={presets}
          isActive={editingSlug === activeProfile}
          onSave={(p) => handleProfileUpdate(editingSlug, p)}
          onDelete={() => handleDelete(editingSlug)} onClose={() => setEditingSlug(null)} />
      )}
      {showCreate && <ProfileCreateModal presets={presets} existingNames={Object.keys(profiles)} onSave={handleCreateSave} onClose={() => setShowCreate(false)} />}
    </div>
  )
}

// ==================== Modal Shell ====================

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-[15px] font-semibold text-text">{title}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}

// ==================== Schema-driven Field Renderer ====================

function SchemaFormFields({ fields, formData, setField, existingProfile }: {
  fields: SchemaField[]
  formData: Record<string, string>
  setField: (key: string, value: string) => void
  existingProfile?: Profile
}) {
  const { t } = useTranslation()
  return (
    <>
      {fields.map((field) => {
        const value = formData[field.key] ?? ''
        const label = field.required ? field.title : `${field.title} ${t('aiProvider.optional', '(optional)')}`
        const hasExisting = existingProfile && field.key === 'apiKey' && !!(existingProfile as unknown as Record<string, unknown>)[field.key]

        if (field.type === 'select') {
          return (
            <Field key={field.key} label={label} description={field.description}>
              <select className={inputClass} value={value} onChange={(e) => setField(field.key, e.target.value)}>
                {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          )
        }

        if (field.type === 'password') {
          return (
            <Field key={field.key} label={label} description={field.description}>
              <div className="relative">
                <input className={inputClass} type="password" value={value} onChange={(e) => setField(field.key, e.target.value)}
                  placeholder={hasExisting ? t('aiProvider.configuredLeaveEmpty', '(configured — leave empty to keep)') : t('aiProvider.enterValue', 'Enter value')} />
                {hasExisting && !value && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-green">{t('aiProvider.active', 'active')}</span>}
              </div>
            </Field>
          )
        }

        return (
          <Field key={field.key} label={label} description={field.description}>
            <input className={inputClass} value={value} onChange={(e) => setField(field.key, e.target.value)}
              placeholder={field.defaultValue ?? ''} />
          </Field>
        )
      })}
    </>
  )
}

// ==================== Edit Modal ====================

function ProfileEditModal({ slug, profile, presets, isActive, onSave, onDelete, onClose }: {
  slug: string; profile: Profile; presets: Preset[]; isActive: boolean
  onSave: (profile: Profile) => Promise<void>; onDelete: () => void; onClose: () => void
}) {
  const { t } = useTranslation()
  // Lookup preset by profile.preset field — no more reverse matching
  const preset = presets.find(p => p.id === profile.preset) ?? presets.find(p => p.category === 'custom')!

  const profileData: Record<string, string> = {}
  for (const [k, v] of Object.entries(profile)) {
    if (v !== undefined && v !== null) profileData[k] = String(v)
  }

  const { fields, formData, setField, getSubmitData, validate } = useSchemaForm(preset.schema, profileData)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; response?: string; error?: string } | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

  const buildSubmitData = () => {
    const data = getSubmitData()
    if (!data.apiKey && profile.apiKey) data.apiKey = profile.apiKey
    data.preset = profile.preset
    return data as unknown as Profile
  }

  const handleSave = async () => {
    const error = validate()
    if (error) return
    setStatus('saving')
    try {
      await onSave(buildSubmitData())
      setStatus('saved')
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => { setStatus('idle'); onClose() }, 1000)
    } catch { setStatus('error') }
  }

  const handleTest = async () => {
    const error = validate()
    if (error) return
    setTesting(true); setTestResult(null)
    try {
      const result = await api.config.testProfile(buildSubmitData())
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal title={t('aiProvider.edit', 'Edit: {{slug}}', { slug })} onClose={onClose}>
      <div className="space-y-3">
        {preset.hint && <p className="text-[11px] text-text-muted bg-bg-tertiary rounded-lg p-3 leading-relaxed">{preset.hint}</p>}
        <SchemaFormFields fields={fields} formData={formData} setField={setField} existingProfile={profile} />
        {testing && <p className="text-[12px] text-text-muted">{t('aiProvider.testingConnection', 'Testing connection…')}</p>}
        {testResult && (
          <div className={`text-[12px] rounded-lg p-3 ${testResult.ok ? 'bg-green/10 text-green' : 'bg-red/10 text-red'}`}>
            {testResult.ok ? t('aiProvider.connected', 'Connected: "{{response}}"', { response: testResult.response?.slice(0, 100) }) : t('aiProvider.failed', 'Failed: {{error}}', { error: testResult.error })}
          </div>
        )}
        <div className="flex items-center gap-2 pt-2 border-t border-border mt-4">
          <button onClick={handleSave} className="btn-primary">{t('common.save', 'Save')}</button>
          <button onClick={handleTest} disabled={testing} className="text-[12px] px-3 py-1.5 rounded-md border border-border text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors disabled:opacity-50">
            {testing ? t('aiProvider.testing', 'Testing…') : t('aiProvider.test', 'Test')}
          </button>
          <SaveIndicator status={status} onRetry={handleSave} />
          <div className="flex-1" />
          {!isActive && <button onClick={onDelete} className="text-[12px] text-red hover:underline">{t('common.delete', 'Delete')}</button>}
        </div>
      </div>
    </Modal>
  )
}

// ==================== Create Modal ====================

function ProfileCreateModal({ presets, existingNames, onSave, onClose }: {
  presets: Preset[]; existingNames: string[]
  onSave: (name: string, profile: Profile) => Promise<void>; onClose: () => void
}) {
  const { t } = useTranslation()
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; response?: string; error?: string } | null>(null)
  const [error, setError] = useState('')

  const existingSet = new Set(existingNames)

  const { fields, formData, setField, getSubmitData, validate } = useSchemaForm(
    selectedPreset?.schema,
  )

  const selectPreset = (preset: Preset) => {
    // If official preset already configured, don't open create form
    if (preset.defaultName && existingSet.has(preset.defaultName)) return
    setSelectedPreset(preset)
    setName(preset.defaultName)
    setTestResult(null)
    setError('')
  }

  const isOfficialPreset = selectedPreset ? !!selectedPreset.defaultName : false

  const handleCreate = async () => {
    if (!selectedPreset) return
    const trimmedName = name.trim()
    if (!trimmedName) { setError('Profile name is required'); return }
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setError(''); setTestResult(null)
    const data = getSubmitData()
    data.preset = selectedPreset.id
    const profileData = data as unknown as Profile

    // Test connectivity (don't save yet — user must confirm)
    setTesting(true)
    try {
      const result = await api.config.testProfile(profileData)
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!selectedPreset) return
    const trimmedName = name.trim()
    if (!trimmedName) return
    const data = getSubmitData()
    data.preset = selectedPreset.id
    setSaving(true); setError('')
    try {
      await onSave(trimmedName, data as unknown as Profile)
      setSaving(false)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      setSaving(false)
    }
  }

  const officialPresets = presets.filter(p => p.category === 'official')
  const thirdPartyPresets = presets.filter(p => p.category === 'third-party')
  const customPreset = presets.find(p => p.category === 'custom')

  const renderPresetCard = (p: Preset) => {
    const alreadyExists = !!p.defaultName && existingSet.has(p.defaultName)
    return (
      <button key={p.id} onClick={() => selectPreset(p)} disabled={alreadyExists}
        className={`flex items-start gap-2.5 p-3 rounded-lg border transition-all text-left ${
          alreadyExists
            ? 'border-border bg-bg-secondary/50 opacity-50 cursor-not-allowed'
            : 'border-border bg-bg hover:bg-bg-tertiary hover:border-accent/40'
        }`}>
        <div className="text-text-muted mt-0.5">{BACKEND_ICONS[getSchemaConst(p.schema, 'backend') as AIBackend ?? 'vercel-ai-sdk']}</div>
        <div>
          <p className="text-[12px] font-medium text-text">{p.label}</p>
          <p className="text-[10px] text-text-muted mt-0.5 leading-snug">
            {alreadyExists ? t('aiProvider.alreadyConfigured', 'Already configured — edit from the list') : p.description}
          </p>
        </div>
      </button>
    )
  }

  return (
    <Modal title={selectedPreset ? t('aiProvider.newPreset', 'New: {{label}}', { label: selectedPreset.label }) : t('aiProvider.newProfile', 'New Profile')} onClose={onClose}>
      {!selectedPreset ? (
        <div className="space-y-4">
          {officialPresets.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-text-muted mb-2 uppercase tracking-wider">{t('aiProvider.official', 'Official')}</p>
              <div className="grid grid-cols-2 gap-2">{officialPresets.map(renderPresetCard)}</div>
            </div>
          )}
          {thirdPartyPresets.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-text-muted mb-2 uppercase tracking-wider">{t('aiProvider.thirdParty', 'Third Party')}</p>
              <div className="grid grid-cols-2 gap-2">{thirdPartyPresets.map(renderPresetCard)}</div>
            </div>
          )}
          {customPreset && (
            <button onClick={() => selectPreset(customPreset)} className="w-full p-3 rounded-lg border border-dashed border-border hover:border-accent/40 hover:bg-bg-tertiary transition-all text-left">
              <p className="text-[12px] font-medium text-text">{t('aiProvider.custom', '+ Custom')}</p>
              <p className="text-[10px] text-text-muted mt-0.5">{customPreset.description}</p>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {selectedPreset.hint && <p className="text-[11px] text-text-muted bg-bg-tertiary rounded-lg p-3 leading-relaxed">{selectedPreset.hint}</p>}
          <Field label={t('aiProvider.profileName', 'Profile Name')}>
            {isOfficialPreset ? (
              <p className="text-[13px] text-text py-2">{name}</p>
            ) : (
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('aiProvider.profileNamePlaceholder', 'Enter a name for this profile')} autoFocus />
            )}
          </Field>
          <SchemaFormFields fields={fields} formData={formData} setField={setField} />
          {error && <p className="text-[12px] text-red">{error}</p>}
          {/* Test result */}
          {testing && <p className="text-[12px] text-text-muted">{t('aiProvider.testingConnection', 'Testing connection...')}</p>}
          {testResult && (
            <div className={`text-[12px] rounded-lg p-3 ${testResult.ok ? 'bg-green/10 text-green' : 'bg-red/10 text-red'}`}>
              {testResult.ok ? t('aiProvider.connected', 'Connected: "{{response}}"', { response: testResult.response?.slice(0, 100) }) : t('aiProvider.failed', 'Failed: {{error}}', { error: testResult.error })}
            </div>
          )}
          <div className="flex items-center gap-2 pt-2 border-t border-border mt-4">
            {testResult?.ok ? (
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? t('aiProvider.saving', 'Saving...') : t('common.save', 'Save')}
              </button>
            ) : (
              <button onClick={handleCreate} disabled={testing} className="btn-primary">
                {testing ? t('aiProvider.testing', 'Testing...') : t('aiProvider.testConnection', 'Test Connection')}
              </button>
            )}
            <button onClick={() => setSelectedPreset(null)} className="btn-secondary">{t('common.back', 'Back')}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
