import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

export function ReconnectButton({ variant }: { variant: 'crypto' | 'securities' }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const handleReconnect = async () => {
    setStatus('loading')
    setMessage('')
    try {
      const result = variant === 'crypto'
        ? await api.trading.reconnectCrypto()
        : await api.trading.reconnectSecurities()
      if (result.success) {
        setStatus('success')
        setMessage(result.message || 'Connected')
        timerRef.current = setTimeout(() => setStatus('idle'), 3000)
      } else {
        setStatus('error')
        setMessage(result.error || 'Connection failed')
      }
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Connection failed')
    }
  }

  return (
    <div className="flex items-center gap-3 mt-3">
      <button
        onClick={handleReconnect}
        disabled={status === 'loading'}
        className="px-3 py-1.5 text-[13px] font-medium rounded-md border border-border hover:bg-bg-tertiary disabled:opacity-50 transition-colors"
      >
        {status === 'loading' ? 'Connecting...' : 'Reconnect'}
      </button>
      {status === 'success' && <span className="text-[12px] text-green">{message}</span>}
      {status === 'error' && <span className="text-[12px] text-red">{message}</span>}
    </div>
  )
}
