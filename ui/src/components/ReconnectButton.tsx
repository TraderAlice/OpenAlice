import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

export function ReconnectButton({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const handleReconnect = async () => {
    setStatus('loading')
    setMessage('')
    try {
      const result = await api.trading.reconnectUTA(accountId)
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

  // No outer margin here — spacing belongs to the call site (this rides in
  // the page-header action row AND in the edit dialog; a baked-in mt-3 was
  // what knocked the header buttons out of alignment).
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleReconnect}
        disabled={status === 'loading'}
        className="btn-secondary-sm"
      >
        {status === 'loading' ? 'Connecting...' : 'Reconnect'}
      </button>
      {status === 'success' && <span className="text-[12px] text-green">{message}</span>}
      {status === 'error' && <span className="text-[12px] text-red">{message}</span>}
    </div>
  )
}
