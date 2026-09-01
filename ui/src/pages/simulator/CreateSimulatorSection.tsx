/**
 * CreateSimulatorSection — collapsible button → inline form for creating
 * a new Mock UTA. Server derives the id from the minted `_instanceId`,
 * so each create lands on a distinct id without the user picking one.
 */

import { useState } from 'react'
import { Section, inputClass } from '../../components/form'
import { useToast } from '../../components/Toast'
import { api } from '../../api'
import { Button } from '../../components/ui/button'

export function CreateSimulatorSection({ onCreated }: {
  onCreated: (id: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [cash, setCash] = useState('100000')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const submit = async () => {
    const cashNum = Number(cash)
    if (!Number.isFinite(cashNum) || cashNum < 0) {
      toast.error('Cash must be a non-negative number')
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
        readOnly: false,
        asVendor: true,
      })
      await api.trading.reconnectUTA(created.id).catch(() => {})
      toast.success(`Created ${created.label} (${created.id})`)
      setOpen(false)
      setName('')
      setCash('100000')
      await onCreated(created.id)
    } catch (err) {
      toast.error(`Create failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        variant="outline"
        size="sm"
      >
        + New simulator account
      </Button>
    )
  }

  return (
    <Section
      title="Create simulator account"
      description="The development server restart clears this account."
    >
      <div className="flex items-center gap-2 flex-wrap">
        <input
          className={`${inputClass} min-h-8 w-48 py-1 text-sm`}
          placeholder="name (e.g. simulator)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={`${inputClass} min-h-8 w-32 py-1 font-mono text-xs`}
          placeholder="cash (USD)"
          value={cash}
          onChange={(e) => setCash(e.target.value)}
        />
        <Button disabled={busy} onClick={submit} size="sm">
          {busy ? 'Creating…' : 'Create'}
        </Button>
        <Button
          disabled={busy}
          onClick={() => { setOpen(false); setName(''); setCash('100000') }}
          variant="outline"
          size="sm"
        >
          Cancel
        </Button>
      </div>
    </Section>
  )
}
