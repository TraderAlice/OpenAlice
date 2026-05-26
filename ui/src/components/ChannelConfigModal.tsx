import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import type { Profile } from '../api/types'
import type { ChannelListItem } from '../api/channels'
import type { ToolInfo } from '../api/tools'

interface ChannelConfigModalProps {
  /** Existing channel for edit mode. Undefined → create mode. */
  channel?: ChannelListItem
  onClose: () => void
  onSaved: (channel: ChannelListItem) => void
}

export function ChannelConfigModal({ channel, onClose, onSaved }: ChannelConfigModalProps) {
  const { t } = useTranslation()
  const isCreate = !channel

  const [label, setLabel] = useState(channel?.label ?? '')
  const [systemPrompt, setSystemPrompt] = useState(channel?.systemPrompt ?? '')
  const [profile, setProfile] = useState(channel?.profile ?? '')
  const [disabledTools, setDisabledTools] = useState<Set<string>>(new Set(channel?.disabledTools ?? []))
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.tools.load().then(({ inventory }) => setTools(inventory)).catch(() => {})
    api.config.getProfiles().then(({ profiles: p }) => setProfiles(p)).catch(() => {})
  }, [])

  const handleSave = async () => {
    setError('')
    if (isCreate && !label.trim()) {
      setError(t('channel.nameRequired', 'Name is required'))
      return
    }
    setSaving(true)
    try {
      if (isCreate) {
        const { channel: created } = await api.channels.create({
          label: label.trim(),
          ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
          ...(profile ? { profile } : {}),
          ...(disabledTools.size > 0 ? { disabledTools: [...disabledTools] } : {}),
        })
        onSaved(created)
      } else {
        const { channel: updated } = await api.channels.update(channel!.id, {
          label: label.trim() || channel!.label,
          systemPrompt: systemPrompt.trim() || undefined,
          profile: profile || undefined,
          disabledTools: disabledTools.size > 0 ? [...disabledTools] : undefined,
        })
        onSaved(updated)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('channel.failedToSave', 'Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  const toggleTool = (name: string) => {
    setDisabledTools((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const inputClass = 'w-full px-3 py-2 text-[13px] rounded-lg border border-border bg-bg-secondary text-text focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-[15px] font-semibold text-text">
            {isCreate ? t('channel.newChannel', 'New Channel') : t('channel.configureChannel', 'Configure Channel')}
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">{t('channel.channelName', 'Channel Name')}</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={isCreate ? 'e.g. Strategy Research' : undefined}
              className={inputClass}
              autoFocus={isCreate}
            />
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">{t('channel.systemPrompt', 'System Prompt')}</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Custom instructions for this channel..."
              rows={4}
              className={`${inputClass} resize-y`}
            />
          </div>

          {/* AI Profile */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">{t('channel.aiProviderProfile', 'AI Provider Profile')}</label>
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              className={inputClass}
            >
              <option value="">{t('channel.defaultGlobalActive', 'Default (global active)')}</option>
              {Object.entries(profiles).map(([slug, p]) => (
                <option key={slug} value={slug}>{slug} ({p.model})</option>
              ))}
            </select>
          </div>

          {/* Disabled Tools */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-2">
              {t('channel.disabledTools', 'Disabled Tools')}
              {disabledTools.size > 0 && (
                <span className="ml-1 text-text-muted/60">{t('channel.disabledCount', '({{count}} disabled)', { count: disabledTools.size })}</span>
              )}
            </label>
            {tools.length === 0 ? (
              <p className="text-[11px] text-text-muted">{t('channel.loadingTools', 'Loading tools...')}</p>
            ) : (
              <div className="max-h-[200px] overflow-y-auto border border-border rounded-lg">
                {tools.map((tool) => (
                  <label
                    key={tool.name}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-tertiary cursor-pointer text-[12px]"
                  >
                    <input
                      type="checkbox"
                      checked={disabledTools.has(tool.name)}
                      onChange={() => toggleTool(tool.name)}
                      className="accent-accent"
                    />
                    <span className={disabledTools.has(tool.name) ? 'line-through text-text-muted' : 'text-text'}>
                      {tool.name}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          {error && <p className="text-[12px] text-red flex-1">{error}</p>}
          <div className="flex gap-2 ml-auto">
            <button onClick={onClose} className="btn-secondary">{t('common.cancel', 'Cancel')}</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? (isCreate ? t('channel.creating', 'Creating...') : t('channel.saving', 'Saving...')) : (isCreate ? t('channel.create', 'Create') : t('common.save', 'Save'))}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
