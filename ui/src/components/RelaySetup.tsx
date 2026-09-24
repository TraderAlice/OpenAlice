import { useState } from 'react'
import { Cable, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from './ui/button'
import { RelayConnectionChooser } from './RelayConnectionChooser'
import type { RelayStatus } from '../hooks/useRelayConnection'

export function RelaySetup({ status }: { status: RelayStatus }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [returning, setReturning] = useState(false)
  const [returnError, setReturnError] = useState<string | null>(null)
  const desktopConnection = window.openAlice?.desktopConnection
  return <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
    <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Server className="size-5" aria-hidden /></div>
      <h1 className="mt-5 text-2xl font-semibold text-foreground">{t('settings.backendConnection.noActiveTarget', 'Connect to an AliceProject')}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('settings.backendConnection.noActiveDescription', 'This local relay has no active backend. Choose a running Project on this computer or a registered SSH Machine. Switching here affects every tab connected to this relay.')}</p>
      <Button className="mt-6" onClick={() => setOpen(true)}><Cable className="size-4" aria-hidden />{t('settings.backendConnection.change')}</Button>
      {desktopConnection && <Button className="ml-2 mt-6" variant="outline" disabled={returning} onClick={() => {
        setReturning(true)
        setReturnError(null)
        void desktopConnection.returnIntegrated().catch((cause: unknown) => {
          setReturnError(cause instanceof Error ? cause.message : String(cause))
          setReturning(false)
        })
      }}>{returning ? t('settings.backendConnection.checking') : t('settings.backendConnection.returnIntegrated', 'Use local integrated mode')}</Button>}
      {returnError && <p role="alert" className="mt-3 text-sm text-destructive">{returnError}</p>}
      <p className="mt-5 text-xs text-muted-foreground">{t('settings.backendConnection.startFirst', 'If a Project is stopped, start it from OpenAlice CLI before connecting.')}</p>
    </section>
    <RelayConnectionChooser open={open} onOpenChange={setOpen} initialStatus={status} />
  </main>
}
