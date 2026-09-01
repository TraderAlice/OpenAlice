/**
 * Full-screen login gate — shown when `/api/auth/status` reports
 * `authed:false` and `tokenConfigured:true`.
 *
 * The single input is the admin token printed on the backend's first run.
 * On submit we POST `/api/auth/login`; the backend sets the cookie via
 * Set-Cookie and we re-check status to flip the AuthContext to 'authed'.
 *
 * Intentionally no styling library, no logo, no marketing. This is the
 * smallest thing that unblocks a Docker / LAN / public deployment.
 */

import { useState, useRef, useEffect, type FormEvent } from 'react'
import { useAuth } from './AuthContext'
import { login } from './api'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/button'
import { inputClass } from '../components/form'

export function LoginPage() {
  const { t } = useTranslation()
  const { refresh } = useAuth()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return
    setBusy(true); setError(null)
    const result = await login(token.trim())
    if (!result.ok) {
      setError(result.error ?? t('auth.loginFailed'))
      setBusy(false)
      return
    }
    await refresh()
    // AuthContext flips to 'authed'; this component unmounts.
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-[400px] rounded-lg border border-border bg-card px-6 py-7 shadow-sm">
        <img src="/alice.ico" alt="" aria-hidden draggable={false} className="mb-4 size-8 object-contain" />
        <h1 className="text-[18px] font-semibold text-foreground mb-1">{t('auth.heading')}</h1>
        <p className="text-[12px] text-muted-foreground leading-relaxed mb-5">
          {t('auth.instruction')}
          {' '}
          <span className="text-foreground-faint">
            Find it in the backend logs after <code className="font-mono">pnpm dev</code> /
            {' '}<code className="font-mono">docker run</code>, or rotate via
            {' '}<code className="font-mono">rm data/config/auth.json</code> and restart.
          </span>
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-muted-foreground">
              {t('auth.adminTokenLabel')}
            </label>
            <input
              ref={inputRef}
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={busy}
              className={`${inputClass} h-9 font-mono`}
              placeholder="xKUT78dNUcRVDwoyDsUUROqffPJV8-..."
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/35 bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive" role="alert">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={busy || !token.trim()}
            className="w-full"
            size="lg"
          >
            {busy ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
        </form>
      </div>
    </div>
  )
}

export function NoTokenPage() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-[460px] rounded-lg border border-border bg-card px-6 py-7">
        <img src="/alice.ico" alt="" aria-hidden draggable={false} className="mb-4 size-8 object-contain" />
        <h1 className="text-[18px] font-semibold text-foreground mb-2">{t('auth.noTokenHeading')}</h1>
        <p className="text-[13px] text-foreground leading-relaxed mb-3">
          The backend did not generate <code className="font-mono">data/config/auth.json</code>.
          This usually means bootstrap was skipped via <code className="font-mono">OPENALICE_DISABLE_AUTH=1</code>,
          or the file was created empty.
        </p>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Stop the backend, delete <code className="font-mono">data/config/auth.json</code> if it exists,
          unset <code className="font-mono">OPENALICE_DISABLE_AUTH</code>, and restart. The first-run
          token will be printed to stdout.
        </p>
      </div>
    </div>
  )
}
