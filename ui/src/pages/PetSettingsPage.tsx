import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { ConfigSection, SettingsScrollArea } from '../components/form'
import { Toggle } from '../components/Toggle'
import { Button } from '../components/ui/button'
import { ActivityPreferencesSection } from './ActivityPreferencesSection'
import { usePetSound } from '../hooks/usePetSound'

export function PetSettingsPage() {
  const { t } = useTranslation()
  const sound = usePetSound()
  const file = useRef<HTMLInputElement>(null)
  const [volume, setVolume] = useState(50)
  const savedVolume = sound.settings?.volume
  useEffect(() => { if (savedVolume !== undefined) setVolume(Math.round(savedVolume * 100)) }, [savedVolume])
  return <div className="flex h-full min-h-0 flex-col">
    <PageHeader title={t('pet.title')} />
    <SettingsScrollArea>
      <div className="max-w-2xl">
        <ActivityPreferencesSection />
        <ConfigSection title={t('pet.sound')} help={t('pet.description')}>
          {sound.loading ? <p role="status">{t('pet.loading')}</p> : !sound.settings ?
            <p className="text-sm text-muted-foreground">{t('pet.desktopOnly')}</p> :
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="pet-sound-enabled" className="text-sm">{t('pet.enabled')}</label>
                <Toggle id="pet-sound-enabled" checked={sound.settings.enabled} pending={sound.pending}
                  ariaLabel={t('pet.enabled')} onChange={enabled => { void sound.update({ enabled }) }} />
              </div>
              <div>
                <div className="mb-2 flex justify-between text-sm"><label htmlFor="pet-volume">{t('pet.volume')}</label><span>{volume}%</span></div>
                <input id="pet-volume" type="range" min="0" max="100" value={volume} disabled={sound.pending}
                  className="w-full accent-primary" onChange={e => setVolume(Number(e.target.value))}
                  onPointerUp={e => { void sound.update({ volume: Number(e.currentTarget.value) / 100 }) }}
                  onKeyUp={e => { void sound.update({ volume: Number(e.currentTarget.value) / 100 }) }} />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">{t('pet.file')}</div>
                <p className="break-all text-sm text-muted-foreground">{sound.settings.source?.name ?? t('pet.noFile')}</p>
                <p className="text-xs leading-5 text-muted-foreground">{t('pet.fileHelp')}</p>
                <input ref={file} className="hidden" type="file" accept=".wav,.mp3,.ogg" aria-label={t('pet.choose')}
                  onChange={e => { const chosen = e.target.files?.[0]; e.target.value = ''; if (chosen) void sound.importFile(chosen) }} />
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="outline" disabled={sound.pending} onClick={() => file.current?.click()}>{t('pet.choose')}</Button>
                  <Button variant="outline" disabled={sound.pending || !sound.settings.source || volume === 0} onClick={() => { void sound.preview() }}>{t('pet.preview')}</Button>
                  <Button variant="ghost" disabled={sound.pending} onClick={() => { void sound.reset() }}>{t('pet.reset')}</Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('pet.resetHelp')}</p>
              </div>
              {sound.pending && <p role="status" className="text-sm text-muted-foreground">{t('pet.saving')}</p>}
            </div>}
          {sound.error && <p role="alert" className="mt-4 text-sm text-destructive">{t(`pet.error.${sound.error as 'unavailable' | 'invalidFile' | 'failed' | 'playback'}`)}</p>}
        </ConfigSection>
      </div>
    </SettingsScrollArea>
  </div>
}
