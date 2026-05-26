/**
 * CreateSimulatorSection — collapsible button → inline form for creating
 * a new Mock UTA. Server derives the id from the minted `_instanceId`,
 * so each create lands on a distinct id without the user picking one.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Section } from '../../components/form'
import { useToast } from '../../components/Toast'
import { api } from '../../api'

export function CreateSimulatorSection({ onCreated }: {
  onCreated: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [cash, setCash] = useState('100000')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const submit = async () => {
    const cashNum = Number(cash)
    if (!Number.isFinite(cashNum) || cashNum < 0) {
      toast.error(t('simulator.cashMustBeNonNegative', 'Cash must be a non-negative number'))
      return
    }
    setBusy(true)
    try {
      const finalLabel = name.trim() || 'simulator'
      const created = await api.trading.createUTA({
        label: finalLabel,
        presetId: 'mock-simulator',
        enabled: true,
        guards: [],
        presetConfig: { cash: cashNum },
      })
      await api.trading.reconnectUTA(created.id).catch(() => {})
      toast.success(t('simulator.createdSuccess', 'Created {{label}} ({{id}})', { label: created.label, id: created.id }))
      setOpen(false)
      setName('')
      setCash('100000')
      await onCreated(created.id)
    } catch (err) {
      toast.error(t('simulator.createFailed', 'Create failed: {{error}}', { error: err instanceof Error ? err.message : err }))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-secondary-sm"
      >
        + {t('simulator.newSimulatorAccount', 'New simulator account')}
      </button>
    )
  }

  return (
    <Section
      title={t('simulator.createSimulatorAccount', 'Create simulator account')}
      description={t('simulator.createDescription', 'In-memory only — wiped on dev server restart. For repro & regression testing.')}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <input
          className="px-2 py-1 bg-bg text-text border border-border rounded text-sm outline-none transition-colors focus:border-accent w-48"
          placeholder={t('simulator.namePlaceholder', 'name (e.g. simulator)')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="px-2 py-1 bg-bg text-text border border-border rounded font-mono text-xs outline-none transition-colors focus:border-accent w-32"
          placeholder={t('simulator.cashPlaceholder', 'cash (USD)')}
          value={cash}
          onChange={(e) => setCash(e.target.value)}
        />
        <button disabled={busy} onClick={submit} className="btn-primary-sm">
          {busy ? t('simulator.creating', 'Creating…') : t('common.create')}
        </button>
        <button
          disabled={busy}
          onClick={() => { setOpen(false); setName(''); setCash('100000') }}
          className="btn-secondary-sm"
        >
          {t('common.cancel')}
        </button>
      </div>
    </Section>
  )
}
